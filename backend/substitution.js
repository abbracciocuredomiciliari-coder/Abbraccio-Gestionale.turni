/**
 * OPBGestionale — Motore di Sostituzione di Emergenza (Dynamic Scheduling)
 *
 * Risponde alla domanda: "Mario Rossi si è ammalato alle 06:00 —
 * chi può coprire il suo turno M di oggi?"
 *
 * ──────────────────────────────────────────────────────────────
 * ALGORITMO DI RANKING CANDIDATI
 * ──────────────────────────────────────────────────────────────
 *
 *  Per ogni infermiere nel team, calcola un SubstitutionScore:
 *
 *   score = base_score
 *         + qualificationPenalty   (0 se abilitato, +1000 se non qualificato)
 *         + hardBlockPenalty       (Infinity se non disponibile oggi)
 *         + hoursPenalty           (Infinity se supera ore massime)
 *         + consecutivePenalty     (penalità se già molti turni consecutivi)
 *         + recentShiftPenalty     (penalità se ha già lavorato poco fa — riposo minimo)
 *         + equityBonus            (bonus negativo: chi ha meno carico storico è preferito)
 *
 *  base_score viene da equity.js (composite_score storico intra-mese)
 *
 *  Categorie di disponibilità:
 *   'available'     → libero oggi, nessuna violazione
 *   'overtime'      → già ha un turno ma potrebbe fare straordinario
 *   'recall'        → è in riposo ma non ha lavorato di notte ieri
 *   'unavailable'   → assente/bloccato hard
 *
 * ──────────────────────────────────────────────────────────────
 * OUTPUT rankCandidates()
 * ──────────────────────────────────────────────────────────────
 * {
 *   vacant_shift: { date, shift_code, shift_name, duration_hours },
 *   absent_nurse: { id, name },
 *   candidates: [
 *     {
 *       rank, nurse_id, nurse_name,
 *       availability,          // 'available' | 'overtime' | 'recall' | 'unavailable'
 *       substitution_type,     // 'voluntary' | 'overtime' | 'recall'
 *       score,                 // più basso = più prioritario
 *       hours_today,           // ore già lavorate oggi
 *       hours_week,            // ore settimanali correnti
 *       hours_month,           // ore mensili correnti
 *       hours_remaining,       // fino al limite mensile
 *       consecutive_days,      // giorni consecutivi di lavoro
 *       nights_this_month,
 *       current_shift,         // turno già assegnato oggi (se availability='overtime')
 *       qualifications,        // reparti/categorie abilitati
 *       is_qualified,          // per questo turno/reparto
 *       blocking_reason,       // se unavailable
 *       equity_load,           // composite_score corrente
 *       equity_rank,           // posizione nella classifica equità
 *     }
 *   ],
 *   summary: { available_count, overtime_count, recall_count, uncoverable }
 * }
 */

'use strict';

const { computeLoads } = require('./equity');
const { isFullDayBlocked, isShiftBlocked } = require('./absences');

// Limiti configurabili
const LIMITS = {
  MAX_HOURS_MONTH:       184,  // ore mensili massime contratto
  MAX_HOURS_WEEK:        48,   // ore settimanali massime (CCNL)
  MAX_CONSECUTIVE_DAYS:  6,    // giorni consecutivi senza riposo
  MIN_REST_HOURS:        11,   // riposo minimo tra turni (Direttiva 2003/88/CE)
};

// Penalità
const PEN = {
  NOT_QUALIFIED:       1000,   // non abilitato reparto/turno
  HARD_BLOCKED:        Infinity,
  HOURS_EXCEEDED:      Infinity,
  CONSECUTIVE_WARNING: 50,     // per ogni giorno sopra la soglia soft
  RECENT_SHIFT:        200,    // turno concluso meno di MIN_REST_HOURS fa
  RECALL_PENALTY:      150,    // richiamare qualcuno dal riposo
  OVERTIME_PENALTY:    300,    // straordinario (già ha un turno oggi)
};

// ─────────────────────────────────────────────────────────────────
// Funzione principale
// ─────────────────────────────────────────────────────────────────

/**
 * Calcola e ordina i candidati per coprire un turno lasciato vacante.
 *
 * @param {Object} params
 *   @param {string}   params.workDate          'YYYY-MM-DD'
 *   @param {Object}   params.vacantShift       { id, code, name, start_time, end_time, duration_hours, is_night, category }
 *   @param {number}   params.absentNurseId     id infermiere assente
 *   @param {Array}    params.staff             tutti gli infermieri attivi
 *   @param {Array}    params.todayAssignments  assegnazioni del giorno (schedule_assignments per workDate)
 *   @param {Array}    params.monthAssignments  assegnazioni del mese corrente (per calcolo ore)
 *   @param {Array}    params.historyAssignments assegnazioni storiche (ultimi 3 mesi, per equity)
 *   @param {Object}   params.absenceMap        output di buildAbsenceConstraints (può essere null)
 *   @param {Array}    params.qualifications    user_qualifications dal DB
 *   @param {Object}   params.constraints       { userId: { shiftId: 'cannot'|'prefer_not'|'only' } }
 *   @param {string}   params.department        reparto del turno (opzionale)
 *   @param {Object}   params.limits            override LIMITS (opzionale)
 *   @param {boolean}  params.allowOvertime     permette straordinari (default true)
 *   @param {boolean}  params.allowRecall       permette richiami dal riposo (default true)
 *
 * @returns {SubstitutionRanking}
 */
function rankCandidates({
  workDate,
  vacantShift,
  absentNurseId,
  staff,
  todayAssignments,
  monthAssignments,
  historyAssignments = [],
  absenceMap = null,
  qualifications = [],
  constraints = {},
  department = null,
  limits: limitsOverride = {},
  allowOvertime = true,
  allowRecall = true,
}) {
  const L = { ...LIMITS, ...limitsOverride };

  // Carichi storici per equità
  const equityLoads = computeLoads(historyAssignments);
  const equityList  = [...equityLoads.values()].sort((a, b) => a.composite_score - b.composite_score);
  const equityRanks = new Map(equityList.map((l, i) => [l.nurse_id, i + 1]));

  // Indice assegnazioni oggi e del mese per nurse
  const todayByNurse  = _groupBy(todayAssignments,  'user_id');
  const monthByNurse  = _groupBy(monthAssignments,  'user_id');

  // Qualificazioni per nurse
  const qualByNurse = _groupBy(qualifications, 'user_id');

  const candidates = [];

  for (const nurse of staff) {
    if (nurse.id === absentNurseId) continue;
    if (!nurse.is_active) continue;

    const result = _evaluateCandidate({
      nurse, vacantShift, workDate, department,
      todayShifts:  todayByNurse[nurse.id]  || [],
      monthShifts:  monthByNurse[nurse.id]  || [],
      historyLoad:  equityLoads.get(nurse.id),
      equityRank:   equityRanks.get(nurse.id) || equityList.length,
      equityTotal:  equityList.length,
      nurseQuals:   qualByNurse[nurse.id] || [],
      nurseConstraints: constraints[nurse.id] || {},
      absenceMap,
      limits: L,
      allowOvertime,
      allowRecall,
    });

    candidates.push(result);
  }

  // Ordina: unavailable per ultimi, poi per score crescente
  candidates.sort((a, b) => {
    const order = { available:0, recall:1, overtime:2, unavailable:3 };
    const ao = order[a.availability] ?? 9;
    const bo = order[b.availability] ?? 9;
    if (ao !== bo) return ao - bo;
    return a.score - b.score;
  });

  // Assegna rank (solo tra i non-unavailable)
  let rank = 1;
  for (const c of candidates) {
    if (c.availability !== 'unavailable') c.rank = rank++;
    else c.rank = null;
  }

  const available  = candidates.filter(c => c.availability === 'available').length;
  const overtime   = candidates.filter(c => c.availability === 'overtime').length;
  const recall     = candidates.filter(c => c.availability === 'recall').length;

  return {
    vacant_shift: {
      date:           workDate,
      shift_id:       vacantShift.id,
      shift_code:     vacantShift.code,
      shift_name:     vacantShift.name || vacantShift.shift_name,
      start_time:     vacantShift.start_time,
      end_time:       vacantShift.end_time,
      duration_hours: vacantShift.duration_hours,
      is_night:       Boolean(vacantShift.is_night),
      department:     department || null,
    },
    absent_nurse: {
      id:   absentNurseId,
      name: staff.find(s => s.id === absentNurseId)
        ? `${staff.find(s => s.id === absentNurseId).first_name} ${staff.find(s => s.id === absentNurseId).last_name}`
        : `Infermiere #${absentNurseId}`,
    },
    candidates,
    summary: {
      total_evaluated:  candidates.length,
      available_count:  available,
      overtime_count:   overtime,
      recall_count:     recall,
      unavailable_count: candidates.length - available - overtime - recall,
      uncoverable:      available + overtime + recall === 0,
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Valutazione singolo candidato
// ─────────────────────────────────────────────────────────────────

function _evaluateCandidate({
  nurse, vacantShift, workDate, department,
  todayShifts, monthShifts, historyLoad,
  equityRank, equityTotal, nurseQuals, nurseConstraints,
  absenceMap, limits: L, allowOvertime, allowRecall,
}) {
  const result = {
    rank:              null,
    nurse_id:          nurse.id,
    nurse_name:        `${nurse.first_name} ${nurse.last_name}`,
    availability:      'unavailable',
    substitution_type: null,
    score:             0,
    hours_today:       0,
    hours_week:        0,
    hours_month:       0,
    hours_remaining:   0,
    consecutive_days:  0,
    nights_this_month: 0,
    current_shift:     null,
    qualifications:    nurseQuals.map(q => ({ department: q.department, shift_category: q.shift_category })),
    is_qualified:      true,
    blocking_reason:   null,
    equity_load:       historyLoad?.composite_score ?? 0,
    equity_rank:       equityRank,
  };

  // ── Vincolo "cannot" per questo turno ──
  const cannotShift = nurseConstraints[vacantShift.id] === 'cannot';
  if (cannotShift) {
    result.availability  = 'unavailable';
    result.blocking_reason = 'Vincolo "cannot" per questo turno';
    result.score = PEN.HARD_BLOCKED;
    return result;
  }

  // ── Blocco hard da assenze ──
  const dayIndex = _dayIndex(workDate);
  if (absenceMap) {
    if (isFullDayBlocked(absenceMap, nurse.id, dayIndex)) {
      result.blocking_reason = 'Assenza approvata (giornata intera)';
      result.score = PEN.HARD_BLOCKED;
      return result;
    }
    const shiftBlockCheck = isShiftBlocked(absenceMap, nurse.id, dayIndex, vacantShift, {});
    if (shiftBlockCheck.blocked) {
      result.blocking_reason = shiftBlockCheck.reason;
      result.score = PEN.HARD_BLOCKED;
      return result;
    }
  }

  // ── Esonero notturno (flag profilo) ──
  if (vacantShift.is_night && nurse.night_exemption) {
    result.blocking_reason = `Esonero notturno (${nurse.exemption_scope || 'night'})`;
    result.score = PEN.HARD_BLOCKED;
    return result;
  }

  // ── Ore mensili / settimanali ──
  const hoursMonth = monthShifts.reduce((s, a) => s + (a.duration_hours || 8), 0);
  const hoursWeek  = _hoursThisWeek(monthShifts, workDate);
  const hoursToday = todayShifts.reduce((s, a) => s + (a.duration_hours || 8), 0);

  result.hours_today  = hoursToday;
  result.hours_week   = hoursWeek;
  result.hours_month  = hoursMonth;
  result.hours_remaining = Math.max(0, L.MAX_HOURS_MONTH - hoursMonth);
  result.nights_this_month = monthShifts.filter(a => Boolean(a.is_night)).length;

  if (hoursMonth + vacantShift.duration_hours > L.MAX_HOURS_MONTH) {
    result.blocking_reason = `Supera ore mensili massime (${hoursMonth}/${L.MAX_HOURS_MONTH}h)`;
    result.score = PEN.HOURS_EXCEEDED;
    return result;
  }
  if (hoursWeek + vacantShift.duration_hours > L.MAX_HOURS_WEEK) {
    result.blocking_reason = `Supera ore settimanali massime (${hoursWeek}/${L.MAX_HOURS_WEEK}h)`;
    result.score = PEN.HOURS_EXCEEDED;
    return result;
  }

  // ── Qualificazione reparto/turno ──
  if (department || vacantShift.category) {
    const isQualified = _checkQualification(nurseQuals, department, vacantShift);
    result.is_qualified = isQualified;
    if (!isQualified) {
      result.blocking_reason = `Non qualificato per ${department || vacantShift.category}`;
      // Non è hard block — appare come unavailable con penalità alta
      result.score = PEN.NOT_QUALIFIED;
      result.availability = 'unavailable';
      return result;
    }
  }

  // ── Turni consecutivi ──
  const consecutiveDays = _consecutiveDays(monthShifts, workDate);
  result.consecutive_days = consecutiveDays;
  let score = historyLoad?.composite_score ?? 0;

  if (consecutiveDays >= L.MAX_CONSECUTIVE_DAYS) {
    // Superato limite duro: sconsigliato ma non impossibile
    score += PEN.CONSECUTIVE_WARNING * (consecutiveDays - L.MAX_CONSECUTIVE_DAYS + 1);
  }

  // ── Oggi ha già un turno? ──
  if (todayShifts.length > 0) {
    if (!allowOvertime) {
      result.blocking_reason = 'Già assegnato oggi (straordinari non permessi)';
      result.score = PEN.HARD_BLOCKED;
      return result;
    }

    // Verifica riposo minimo tra i due turni
    const lastShift = todayShifts[0];
    const restViolation = _checkMinRest(lastShift, vacantShift);
    if (restViolation) {
      result.blocking_reason = restViolation;
      result.score = PEN.HARD_BLOCKED;
      return result;
    }

    result.availability    = 'overtime';
    result.substitution_type = 'overtime';
    result.current_shift   = {
      shift_code: lastShift.shift_code,
      shift_name: lastShift.shift_name,
      start_time: lastShift.start_time,
      end_time:   lastShift.end_time,
    };
    score += PEN.OVERTIME_PENALTY;
  } else {
    // Libero oggi: controlla se ha lavorato ieri di notte
    const workedNightYesterday = _workedNightYesterday(monthShifts, workDate);
    if (workedNightYesterday) {
      if (!allowRecall) {
        result.blocking_reason = 'Riposo post-notte (richiamo non permesso)';
        result.score = PEN.HARD_BLOCKED;
        return result;
      }
      result.availability    = 'recall';
      result.substitution_type = 'recall';
      score += PEN.RECALL_PENALTY;
    } else {
      result.availability    = 'available';
      result.substitution_type = 'voluntary';
    }
  }

  // ── Bonus equità: chi ha meno carico storico è preferito ──
  // equityRank / equityTotal → normalizzato in [0, 1]
  // Il ranking già riflette chi ha meno composite_score (rank 1 = meno caricato)
  const equityBonus = ((equityRank - 1) / Math.max(equityTotal - 1, 1)) * 100;
  score += equityBonus;

  // Penalità extra per notti: se l'infermiere ne ha già tante questo mese
  if (vacantShift.is_night) {
    score += result.nights_this_month * 5;
  }

  result.score = Math.round(score * 100) / 100;
  return result;
}

// ─────────────────────────────────────────────────────────────────
// Funzione di applicazione sostituzione
// ─────────────────────────────────────────────────────────────────

/**
 * Prepara l'oggetto di sostituzione da persistere nel DB.
 * Non tocca il DB direttamente — è la route a farlo.
 *
 * @param {Object} ranking        Output di rankCandidates()
 * @param {number} substituteId   nurse_id del sostituto scelto
 * @param {string} absenceReason  'malattia_improvvisa'|'emergenza_familiare'|…
 * @param {number} confirmedBy    user_id del coordinatore
 * @returns {{ substitution, scheduleAssignment, isOvertime }}
 */
function buildSubstitution(ranking, substituteId, absenceReason, confirmedBy) {
  const candidate = ranking.candidates.find(c => c.nurse_id === substituteId);
  if (!candidate) {
    throw new Error(`Candidato ${substituteId} non trovato nel ranking`);
  }
  if (candidate.availability === 'unavailable') {
    throw new Error(`Infermiere ${candidate.nurse_name} non disponibile: ${candidate.blocking_reason}`);
  }

  const isOvertime = candidate.substitution_type === 'overtime';

  const substitution = {
    work_date:          ranking.vacant_shift.date,
    shift_type_id:      ranking.vacant_shift.shift_id,
    absent_user_id:     ranking.absent_nurse.id,
    absence_reason:     absenceReason,
    substitute_user_id: substituteId,
    substitution_type:  candidate.substitution_type,
    status:             'filled',
    confirmed_by:       confirmedBy,
    confirmed_at:       new Date().toISOString(),
    equity_score_before: null,  // compilato dalla route con dati DB
    equity_score_after:  null,
  };

  const scheduleAssignment = {
    user_id:      substituteId,
    work_date:    ranking.vacant_shift.date,
    shift_type_id: ranking.vacant_shift.shift_id,
    is_overtime:  isOvertime ? 1 : 0,
  };

  return { substitution, scheduleAssignment, isOvertime };
}

// ─────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────

function _groupBy(arr, key) {
  const map = {};
  for (const item of arr) {
    const k = item[key];
    if (!map[k]) map[k] = [];
    map[k].push(item);
  }
  return map;
}

/** dayIndex 0-based dal work_date nel mese corrente */
function _dayIndex(workDate) {
  return parseInt(workDate.slice(8, 10), 10) - 1;
}

/** Ore lavorate nella settimana ISO contenente workDate */
function _hoursThisWeek(monthShifts, workDate) {
  const d = new Date(`${workDate}T00:00:00Z`);
  // Lunedì della settimana
  const dow = (d.getUTCDay() + 6) % 7; // 0=lun, 6=dom
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - dow);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const monStr = monday.toISOString().slice(0, 10);
  const sunStr = sunday.toISOString().slice(0, 10);

  return monthShifts
    .filter(a => a.work_date >= monStr && a.work_date <= sunStr)
    .reduce((s, a) => s + (a.duration_hours || 8), 0);
}

/** Giorni consecutivi di lavoro arrivando a workDate (non incluso) */
function _consecutiveDays(monthShifts, workDate) {
  const worked = new Set(monthShifts.map(a => a.work_date));
  let count = 0;
  const d = new Date(`${workDate}T00:00:00Z`);
  for (let i = 1; i <= 10; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (worked.has(d.toISOString().slice(0, 10))) count++;
    else break;
  }
  return count;
}

/** Ha lavorato un turno notturno ieri? */
function _workedNightYesterday(monthShifts, workDate) {
  const d = new Date(`${workDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const yesterday = d.toISOString().slice(0, 10);
  return monthShifts.some(a => a.work_date === yesterday && Boolean(a.is_night));
}

/**
 * Verifica se tra il turno già assegnato e il turno da coprire
 * c'è abbastanza riposo (MIN_REST_HOURS).
 * Ritorna null se OK, stringa con motivo se violazione.
 */
function _checkMinRest(existingShift, newShift) {
  if (!existingShift.end_time || !newShift.start_time) return null;

  const [eH, eM] = existingShift.end_time.split(':').map(Number);
  const [sH, sM] = newShift.start_time.split(':').map(Number);

  let endMin   = eH * 60 + eM;
  let startMin = sH * 60 + sM;

  // Turno notturno: end_time < start_time → add 1440
  if (existingShift.is_night && endMin < 60) endMin += 1440; // es. 07:00 → 31:00

  // Se il nuovo turno inizia prima della fine del precedente (in giornata)
  if (startMin < endMin % 1440) startMin += 1440;

  const restMin = startMin - endMin;
  const restHours = restMin / 60;

  if (restHours < LIMITS.MIN_REST_HOURS) {
    return `Riposo insufficiente: ${restHours.toFixed(1)}h (minimo ${LIMITS.MIN_REST_HOURS}h richiesti)`;
  }
  return null;
}

/** Verifica qualificazione per reparto e/o categoria turno */
function _checkQualification(nurseQuals, department, shift) {
  if (!nurseQuals || nurseQuals.length === 0) {
    // Nessuna qualificazione specificata → consideriamo abilitato per tutti
    return true;
  }

  const today = new Date().toISOString().slice(0, 10);

  return nurseQuals.some(q => {
    // Verifica validità temporale
    if (q.valid_from  && today < q.valid_from)  return false;
    if (q.valid_until && today > q.valid_until) return false;

    const deptMatch = !department || !q.department ||
                      q.department.toLowerCase() === department.toLowerCase();
    const catMatch  = !shift.category || !q.shift_category ||
                      q.shift_category.toLowerCase() === shift.category.toLowerCase() ||
                      q.shift_category.toLowerCase() === shift.code.toLowerCase();

    return deptMatch && catMatch;
  });
}

// ─────────────────────────────────────────────────────────────────
module.exports = { rankCandidates, buildSubstitution, LIMITS };
