/**
 * OPBGestionale — Motore di Vincoli Hard (Hard Constraint Engine)
 *
 * Architettura ispirata a Google OR-Tools CP-SAT:
 *   - Ogni vincolo è una funzione pura: (assignments, rules) → ViolationList
 *   - Il validatore esegue tutti i vincoli e aggrega i risultati
 *   - Nessun side-effect: può essere usato da solver, API REST, test unitari
 *
 * INPUT — Formato lista turni:
 *   [
 *     {
 *       nurse_id:       number,      // ID infermiere
 *       nurse_name:     string,      // nome per leggibilità nei messaggi
 *       work_date:      'YYYY-MM-DD',
 *       shift_code:     'M'|'P'|'N'|'G12'|'N12'|'R',
 *       start_time:     'HH:MM',     // es. '23:00'
 *       end_time:       'HH:MM',     // es. '07:00' (può essere giorno dopo)
 *       duration_hours: number,      // ore effettive del turno
 *       is_night:       boolean,     // true per N, N12
 *     }
 *   ]
 *
 * OUTPUT — Risultato validazione:
 *   {
 *     valid:      boolean,
 *     violations: [ { rule, severity, nurse_id, nurse_name, dates, message } ],
 *     summary:    { total_checked, violations_count, by_rule }
 *   }
 *
 * VINCOLI HARD implementati (severità 'error' = blocca schedulazione):
 *   H1 — Max ore settimanali (default 40h, configurabile)
 *   H2 — Riposo minimo tra turni consecutivi (default 11h, DLgs 66/2003)
 *   H3 — Max notti consecutive (default 2)
 *   H4 — Un solo turno al giorno per persona (no doppio turno non autorizzato)
 *   H5 — Riposo obbligatorio dopo notte: almeno 11h prima del turno successivo
 *
 * VINCOLI SOFT implementati (severità 'warning' = segnalato ma non bloccante):
 *   W1 — Max turni consecutivi (default 6 giorni)
 *   W2 — Minimo riposi per settimana (default 1 giorno/settimana)
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Utilità temporali
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converte 'YYYY-MM-DD' + 'HH:MM' in un oggetto Date assoluto (UTC).
 * Gestisce i turni a cavallo della mezzanotte:
 *   se end_time < start_time → il turno finisce il giorno DOPO.
 */
function toAbsoluteDateTime(date, time, isEnd = false, startTime = null) {
  const [h, m] = time.split(':').map(Number);
  const dt = new Date(`${date}T${time}:00Z`);
  // Se orario fine < orario inizio → il turno va nel giorno successivo
  if (isEnd && startTime) {
    const [sh] = startTime.split(':').map(Number);
    if (h < sh) dt.setUTCDate(dt.getUTCDate() + 1);
  }
  return dt;
}

/** Differenza in ore tra due Date (signed), troncata a 2 decimali */
function hoursBetween(dtA, dtB) {
  const raw = (dtB - dtA) / (1000 * 60 * 60);
  return Math.floor(raw * 100) / 100;  // truncate, non round — 10.983h rimane 10.98h
}

/** Estrae il numero della settimana ISO per una data 'YYYY-MM-DD' */
function isoWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dayOfWeek = d.getUTCDay() || 7; // lunedì=1 … domenica=7
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

/** Raggruppa turni per infermiere */
function groupByNurse(assignments) {
  const map = new Map();
  for (const a of assignments) {
    if (!map.has(a.nurse_id)) map.set(a.nurse_id, []);
    map.get(a.nurse_id).push(a);
  }
  // Ordina per data, poi per start_time (gestisce turni diversi stesso giorno)
  for (const [, arr] of map) {
    arr.sort((a, b) => {
      if (a.work_date !== b.work_date) return a.work_date > b.work_date ? 1 : -1;
      // Stesso giorno: ordina per start_time, ma la notte (23:xx) viene dopo
      const aH = parseInt(a.start_time || '00', 10);
      const bH = parseInt(b.start_time || '00', 10);
      // Turni notturni a inizio tarde notte (23:xx) vanno in coda
      const aNorm = aH >= 23 ? aH - 24 : aH;
      const bNorm = bH >= 23 ? bH - 24 : bH;
      return aNorm - bNorm;
    });
  }
  return map;
}

/** Raggruppa turni per (infermiere, settimana ISO) */
function groupByNurseWeek(assignments) {
  const map = new Map();
  for (const a of assignments) {
    const key = `${a.nurse_id}_W${isoWeek(a.work_date)}_${a.work_date.slice(0, 4)}`;
    if (!map.has(key)) map.set(key, { nurse_id: a.nurse_id, nurse_name: a.nurse_name, week: isoWeek(a.work_date), shifts: [] });
    map.get(key).shifts.push(a);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vincoli Hard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * H1 — Massimo ore settimanali.
 * Somma duration_hours per ogni infermiere per settimana ISO.
 * Viola se > maxHoursWeek.
 */
function checkMaxWeeklyHours(nurseMap, rules) {
  const violations = [];
  const maxH = rules.max_hours_per_week ?? 40;

  for (const [, shifts] of nurseMap) {
    // Raggruppa per settimana
    const byWeek = new Map();
    for (const s of shifts) {
      if (s.shift_code === 'R') continue; // riposi non contano
      const wk = `${s.work_date.slice(0, 4)}_W${isoWeek(s.work_date)}`;
      if (!byWeek.has(wk)) byWeek.set(wk, { hours: 0, dates: [], week: isoWeek(s.work_date) });
      const entry = byWeek.get(wk);
      entry.hours += s.duration_hours ?? 8;
      entry.dates.push(s.work_date);
    }
    for (const [, wkData] of byWeek) {
      if (wkData.hours > maxH) {
        violations.push({
          rule: 'H1_MAX_WEEKLY_HOURS',
          severity: 'error',
          nurse_id: shifts[0].nurse_id,
          nurse_name: shifts[0].nurse_name,
          dates: wkData.dates,
          message: `${shifts[0].nurse_name}: settimana ${wkData.week} → ${wkData.hours}h lavorate, limite ${maxH}h`,
          detail: { hours_worked: wkData.hours, limit: maxH, excess: wkData.hours - maxH },
        });
      }
    }
  }
  return violations;
}

/**
 * H2 — Riposo minimo tra turni consecutivi (DLgs 66/2003: 11h).
 * Calcola il gap in ore tra la fine di un turno e l'inizio del successivo.
 */
function checkMinRestBetweenShifts(nurseMap, rules) {
  const violations = [];
  const minRest = rules.min_rest_between_shifts ?? 11;

  for (const [, shifts] of nurseMap) {
    const workShifts = shifts.filter(s => s.shift_code !== 'R' && s.duration_hours > 0);
    for (let i = 0; i < workShifts.length - 1; i++) {
      const curr = workShifts[i];
      const next = workShifts[i + 1];
      // Doppio turno autorizzato (is_overtime) nello stesso giorno: non applicare H2
      if (curr.work_date === next.work_date && (curr.is_overtime || next.is_overtime)) continue;

      const currEnd   = toAbsoluteDateTime(curr.work_date, curr.end_time,   true, curr.start_time);
      const nextStart = toAbsoluteDateTime(next.work_date, next.start_time);
      const gap = hoursBetween(currEnd, nextStart);

      if (gap < minRest) {
        violations.push({
          rule: 'H2_MIN_REST_BETWEEN_SHIFTS',
          severity: 'error',
          nurse_id: curr.nurse_id,
          nurse_name: curr.nurse_name,
          dates: [curr.work_date, next.work_date],
          message: `${curr.nurse_name}: solo ${gap.toFixed(1)}h di riposo tra ${curr.work_date} (${curr.shift_code}) e ${next.work_date} (${next.shift_code}) — minimo ${minRest}h`,
          detail: { gap_hours: gap, required: minRest, shortage: Math.round((minRest - gap) * 100) / 100 },
        });
      }
    }
  }
  return violations;
}

/**
 * H3 — Massimo notti consecutive.
 * Conta le sequenze di turni notturni (is_night=true) consecutivi per data.
 */
function checkMaxConsecutiveNights(nurseMap, rules) {
  const violations = [];
  const maxNights = rules.max_consecutive_nights ?? 2;

  for (const [, shifts] of nurseMap) {
    const nights = shifts.filter(s => s.is_night);
    if (nights.length === 0) continue;

    let streak = 1;
    let streakStart = nights[0].work_date;

    for (let i = 1; i < nights.length; i++) {
      const prev = new Date(`${nights[i - 1].work_date}T00:00:00Z`);
      const curr = new Date(`${nights[i].work_date}T00:00:00Z`);
      const diffDays = (curr - prev) / 86400000;

      if (diffDays <= 1) {
        // Notti consecutive (stessa notte o notte del giorno dopo)
        // Le notti N iniziano alle 23:00 → due N consecutive hanno work_date distanza 1 giorno
        streak++;
        if (streak > maxNights) {
          violations.push({
            rule: 'H3_MAX_CONSECUTIVE_NIGHTS',
            severity: 'error',
            nurse_id: nights[i].nurse_id,
            nurse_name: nights[i].nurse_name,
            dates: nights.slice(i - streak + 1, i + 1).map(n => n.work_date),
            message: `${nights[i].nurse_name}: ${streak} notti consecutive (${streakStart} → ${nights[i].work_date}) — massimo ${maxNights}`,
            detail: { consecutive: streak, limit: maxNights },
          });
        }
      } else {
        streak = 1;
        streakStart = nights[i].work_date;
      }
    }
  }
  return violations;
}

/**
 * H4 — Un solo turno al giorno (senza flag overtime esplicito).
 * Due assegnazioni allo stesso infermiere nella stessa data è una violazione,
 * a meno che is_overtime=true su entrambe (doppio turno autorizzato).
 */
function checkOneTurnPerDay(nurseMap) {
  const violations = [];
  for (const [, shifts] of nurseMap) {
    const byDate = new Map();
    for (const s of shifts) {
      if (!byDate.has(s.work_date)) byDate.set(s.work_date, []);
      byDate.get(s.work_date).push(s);
    }
    for (const [date, dayShifts] of byDate) {
      const nonOvertime = dayShifts.filter(s => !s.is_overtime);
      if (nonOvertime.length > 1) {
        violations.push({
          rule: 'H4_ONE_SHIFT_PER_DAY',
          severity: 'error',
          nurse_id: shifts[0].nurse_id,
          nurse_name: shifts[0].nurse_name,
          dates: [date],
          message: `${shifts[0].nurse_name}: ${nonOvertime.length} turni assegnati il ${date} senza autorizzazione straordinario (${nonOvertime.map(s => s.shift_code).join(', ')})`,
          detail: { shifts_on_day: nonOvertime.map(s => s.shift_code) },
        });
      }
    }
  }
  return violations;
}

/**
 * H5 — Riposo dopo turno notturno.
 * Dopo una notte (N/N12) il turno successivo deve garantire almeno minRest ore.
 * Caso specifico di H2 ma segnalato separatamente per chiarezza normativa.
 */
function checkRestAfterNight(nurseMap, rules) {
  const violations = [];
  const minRest = rules.min_rest_between_shifts ?? 11;

  for (const [, shifts] of nurseMap) {
    const workShifts = shifts.filter(s => s.duration_hours > 0);
    for (let i = 0; i < workShifts.length - 1; i++) {
      const curr = workShifts[i];
      const next = workShifts[i + 1];
      if (!curr.is_night) continue;
      // Doppio turno autorizzato stesso giorno: non applicare H5
      if (curr.work_date === next.work_date && (curr.is_overtime || next.is_overtime)) continue;

      const currEnd   = toAbsoluteDateTime(curr.work_date, curr.end_time, true, curr.start_time);
      const nextStart = toAbsoluteDateTime(next.work_date, next.start_time);
      const gap = hoursBetween(currEnd, nextStart);

      if (gap < minRest) {
        violations.push({
          rule: 'H5_REST_AFTER_NIGHT',
          severity: 'error',
          nurse_id: curr.nurse_id,
          nurse_name: curr.nurse_name,
          dates: [curr.work_date, next.work_date],
          message: `${curr.nurse_name}: turno ${next.shift_code} il ${next.work_date} troppo vicino alla notte del ${curr.work_date} (gap=${gap.toFixed(1)}h, richieste ${minRest}h)`,
          detail: { gap_hours: gap, required: minRest, shortage: Math.round((minRest - gap) * 100) / 100 },
        });
      }
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vincoli Soft (warning)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * W1 — Massimo turni consecutivi senza riposo.
 * Più di maxConsecutiveDays giorni lavorativi consecutivi.
 */
function checkMaxConsecutiveDays(nurseMap, rules) {
  const violations = [];
  const maxDays = rules.max_consecutive_days ?? 6;

  for (const [, shifts] of nurseMap) {
    const workDays = [...new Set(
      shifts.filter(s => s.shift_code !== 'R' && s.duration_hours > 0).map(s => s.work_date)
    )].sort();

    let streak = 1;
    let streakStart = workDays[0];

    for (let i = 1; i < workDays.length; i++) {
      const prev = new Date(`${workDays[i - 1]}T00:00:00Z`);
      const curr = new Date(`${workDays[i]}T00:00:00Z`);
      const diff = (curr - prev) / 86400000;

      if (diff === 1) {
        streak++;
        if (streak > maxDays) {
          violations.push({
            rule: 'W1_MAX_CONSECUTIVE_DAYS',
            severity: 'warning',
            nurse_id: shifts[0].nurse_id,
            nurse_name: shifts[0].nurse_name,
            dates: [streakStart, workDays[i]],
            message: `${shifts[0].nurse_name}: ${streak} giorni consecutivi senza riposo (${streakStart} → ${workDays[i]}) — consigliato max ${maxDays}`,
            detail: { consecutive: streak, limit: maxDays },
          });
        }
      } else {
        streak = 1;
        streakStart = workDays[i];
      }
    }
  }
  return violations;
}

/**
 * W2 — Minimo riposi a settimana.
 */
function checkMinRestDaysPerWeek(nurseMap, rules) {
  const violations = [];
  const minRestDays = rules.min_rest_days_per_week ?? 1;

  const weekMap = groupByNurseWeek([].concat(...[...nurseMap.values()]));
  for (const [, wkData] of weekMap) {
    const restDays = wkData.shifts.filter(s => s.shift_code === 'R' || s.duration_hours === 0).length;
    const workDays = wkData.shifts.filter(s => s.shift_code !== 'R' && s.duration_hours > 0).length;
    // Consideriamo solo settimane con almeno 5 turni registrati (evita falsi positivi su settimane parziali)
    if (workDays + restDays < 5) continue;
    if (restDays < minRestDays) {
      violations.push({
        rule: 'W2_MIN_REST_DAYS_PER_WEEK',
        severity: 'warning',
        nurse_id: wkData.nurse_id,
        nurse_name: wkData.nurse_name,
        dates: wkData.shifts.map(s => s.work_date),
        message: `${wkData.nurse_name}: settimana ${wkData.week} → solo ${restDays} giorni di riposo, minimo ${minRestDays}`,
        detail: { rest_days: restDays, required: minRestDays },
      });
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validatore principale — API pubblica del modulo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valida una lista di assegnazioni turno contro i vincoli hard e soft.
 *
 * @param {Array}  assignments  Lista di turni (vedi formato in cima al file)
 * @param {Object} rules        Regole configurabili (da work_rules nel DB)
 *                              Valori di default CCNL se non specificati
 * @returns {Object} { valid, violations, summary }
 */
function validateSchedule(assignments, rules = {}) {
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return {
      valid: true,
      violations: [],
      summary: { total_assignments: 0, violations_count: 0, by_rule: {} },
    };
  }

  const nurseMap = groupByNurse(assignments);

  // Esegui tutti i vincoli in ordine di priorità
  const allViolations = [
    ...checkOneTurnPerDay(nurseMap),           // H4 — un turno al giorno
    ...checkMinRestBetweenShifts(nurseMap, rules), // H2 — riposo minimo
    ...checkRestAfterNight(nurseMap, rules),       // H5 — riposo dopo notte (subset H2, segnalato separatamente)
    ...checkMaxConsecutiveNights(nurseMap, rules), // H3 — max notti consecutive
    ...checkMaxWeeklyHours(nurseMap, rules),       // H1 — max ore settimanali
    ...checkMaxConsecutiveDays(nurseMap, rules),   // W1 — soft: giorni consecutivi
    ...checkMinRestDaysPerWeek(nurseMap, rules),   // W2 — soft: riposi settimanali
  ];

  // Deduplicazione: H2 e H5 possono segnalare la stessa coppia di date
  // Teniamo H5 (più specifico) e rimuoviamo il duplicato H2
  const seen = new Set();
  const violations = [];
  for (const v of allViolations) {
    const key = `${v.rule}_${v.nurse_id}_${v.dates.join('_')}`;
    if (seen.has(key)) continue;
    // Sopprime H2 se già segnalato da H5 per le stesse date/infermiere
    if (v.rule === 'H2_MIN_REST_BETWEEN_SHIFTS') {
      const h5Key = `H5_REST_AFTER_NIGHT_${v.nurse_id}_${v.dates.join('_')}`;
      if (seen.has(h5Key)) continue;
    }
    seen.add(key);
    violations.push(v);
  }

  // Raggruppamento per regola per il summary
  const by_rule = {};
  for (const v of violations) {
    if (!by_rule[v.rule]) by_rule[v.rule] = { errors: 0, warnings: 0 };
    if (v.severity === 'error')   by_rule[v.rule].errors++;
    if (v.severity === 'warning') by_rule[v.rule].warnings++;
  }

  const hasErrors = violations.some(v => v.severity === 'error');

  return {
    valid: !hasErrors,
    status: hasErrors ? 'NON VALIDO' : (violations.length > 0 ? 'VALIDO CON AVVISI' : 'VALIDO'),
    violations,
    summary: {
      total_assignments: assignments.length,
      nurses_checked: nurseMap.size,
      violations_count: violations.length,
      errors_count:   violations.filter(v => v.severity === 'error').length,
      warnings_count: violations.filter(v => v.severity === 'warning').length,
      by_rule,
    },
  };
}

module.exports = { validateSchedule };
