/**
 * OPBGestionale — Modulo Assenze Hard-Constraint
 *
 * Gestisce le 4 categorie di assenza come vincoli HARD non negoziabili:
 *
 *  1. Ferie programmate    → blocca il giorno intero (tutti i turni)
 *  2. Permesso 104 / Mat.  → giornata intera O parziale (blocca solo turni
 *                            che si sovrappongono all'orario di assenza)
 *  3. Congedi straordinari → eventi puntuali o ricorrenti (settimanali/mensili)
 *  4. Esonero notturno     → flag sul profilo utente; blocca categorie di turno
 *                            in base all'exemption_scope:
 *                              'night'            → solo notti
 *                              'night_afternoon'  → notti + pomeriggi
 *                              'night_overtime'   → notti + straordinari (L.104)
 *                              'all_festive'      → notti + weekend + festivi
 *
 * Output: AbsenceConstraintMap — struttura consumata da solver.js in propagate()
 *
 * ──────────────────────────────────────────────────────────────────
 * STRUTTURA AbsenceConstraintMap
 * ──────────────────────────────────────────────────────────────────
 * {
 *   full_day_blocks:    Set<"nurseId_dayIndex">          // intero giorno bloccato
 *   partial_day_blocks: Map<"nurseId_dayIndex", PartialBlock[]>  // solo certi turni
 *   shift_category_blocks: Map<nurseId, ShiftCategoryBlock>     // esonero notturno
 *   summary: { total_absences, by_type, nurses_affected }
 * }
 *
 * PartialBlock = { partial_hours, start_hhmm, end_hhmm, partial_type, reason }
 * ShiftCategoryBlock = { scope, blocked_categories: Set<string>,
 *                        from_date, until_date, reason }
 * ──────────────────────────────────────────────────────────────────
 */

'use strict';

// Categorie di turno bloccate per ogni exemption_scope
const EXEMPTION_SCOPE_CATEGORIES = {
  night:           new Set(['night']),
  night_afternoon: new Set(['night', 'afternoon']),
  night_overtime:  new Set(['night', 'overtime']),
  all_festive:     new Set(['night', 'afternoon', 'overtime', 'festive']),
};

// Tipi di assenza che bloccano l'intera giornata
const FULL_DAY_ABSENCE_TYPES = new Set([
  'ferie', 'maternita', 'malattia', 'sciopero', 'formazione',
  // 104 e congedo_straordinario possono essere parziali → gestiti separatamente
]);

// ─────────────────────────────────────────────────────────────────
// Funzione principale
// ─────────────────────────────────────────────────────────────────

/**
 * Costruisce la mappa vincoli hard da assenze + profili utente.
 *
 * @param {Array}  absences   Assenze approvate dal DB (tabella `absences`)
 *   [ { id, user_id, absence_type, start_date, end_date,
 *       is_partial_day, partial_hours, partial_start, partial_end, partial_type,
 *       is_recurring, recurrence_rule, recurrence_end, status } ]
 *
 * @param {Array}  staff      Staff con flag esonero
 *   [ { id, first_name, last_name,
 *       night_exemption, exemption_scope,
 *       night_exemption_from, night_exemption_until } ]
 *
 * @param {number} year
 * @param {number} month      (1-based)
 * @param {number} daysInMonth
 * @returns {AbsenceConstraintMap}
 */
function buildAbsenceConstraints(absences, staff, year, month, daysInMonth) {
  const full_day_blocks    = new Set();
  const partial_day_blocks = new Map();   // "nurseId_dayIdx" → PartialBlock[]
  const shift_category_blocks = new Map(); // nurseId → ShiftCategoryBlock

  const summary = { total_absences: 0, by_type: {}, nurses_affected: new Set() };

  // ── 1. Processa assenze dalla tabella `absences` ────────────────
  for (const abs of absences) {
    if ((abs.status || 'approved') !== 'approved') continue;

    const type = abs.absence_type;
    summary.by_type[type] = (summary.by_type[type] || 0) + 1;
    summary.total_absences++;

    // Espande le date del range (gestendo ricorrenze)
    const days = _expandAbsenceDays(abs, year, month, daysInMonth);
    if (days.length === 0) continue;

    summary.nurses_affected.add(abs.user_id);

    for (const dayIdx of days) {
      const key = `${abs.user_id}_${dayIdx}`;

      if (!abs.is_partial_day || FULL_DAY_ABSENCE_TYPES.has(type)) {
        // Blocco giornata intera
        full_day_blocks.add(key);
      } else {
        // Permesso orario: blocca solo i turni che si sovrappongono
        if (!partial_day_blocks.has(key)) partial_day_blocks.set(key, []);
        partial_day_blocks.get(key).push({
          partial_hours: abs.partial_hours,
          start_hhmm:   abs.partial_start,
          end_hhmm:     abs.partial_end,
          partial_type: abs.partial_type || 'hours_only',
          reason:       _absenceLabel(type, abs),
          absence_id:   abs.id,
        });
      }
    }
  }

  // ── 2. Processa esoneri notturni dal profilo utente ─────────────
  const today = new Date().toISOString().slice(0, 10);
  for (const s of staff) {
    if (!s.night_exemption) continue;

    // Verifica validità temporale dell'esonero
    const from  = s.night_exemption_from  || '2000-01-01';
    const until = s.night_exemption_until || '2099-12-31';

    // Mese corrente è nel range dell'esonero?
    const monthStart = `${year}-${String(month).padStart(2,'0')}-01`;
    const monthEnd   = `${year}-${String(month).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;

    if (monthStart > until || monthEnd < from) continue; // esonero non attivo questo mese

    const scope = s.exemption_scope || 'night';
    const blocked_categories = EXEMPTION_SCOPE_CATEGORIES[scope]
      || EXEMPTION_SCOPE_CATEGORIES.night;

    shift_category_blocks.set(s.id, {
      nurse_id:          s.id,
      scope,
      blocked_categories,
      from_date:         from,
      until_date:        until,
      reason:            s.night_exemption_reason || `Esonero notturno (${scope})`,
    });

    summary.nurses_affected.add(s.id);
  }

  summary.nurses_affected = summary.nurses_affected.size;

  return { full_day_blocks, partial_day_blocks, shift_category_blocks, summary };
}

// ─────────────────────────────────────────────────────────────────
// Funzioni di query usate dal solver
// ─────────────────────────────────────────────────────────────────

/**
 * Verifica se l'infermiere è completamente bloccato per un giorno.
 * (ferie / maternità / malattia / …)
 */
function isFullDayBlocked(absMap, nurseId, dayIndex) {
  return absMap.full_day_blocks.has(`${nurseId}_${dayIndex}`);
}

/**
 * Verifica se un turno specifico è bloccato per l'infermiere in un giorno.
 * Considera sia blocchi giornalieri che permessi parziali che esoneri notturni.
 *
 * @param {AbsenceConstraintMap} absMap
 * @param {number} nurseId
 * @param {number} dayIndex   0-based
 * @param {Object} shift      { id, code, is_night, category, start_time, end_time, duration_hours }
 * @param {Object} dayContext { is_weekend, is_festive }   opzionale
 * @returns {{ blocked: boolean, reason: string|null }}
 */
function isShiftBlocked(absMap, nurseId, dayIndex, shift, dayContext = {}) {
  // 1. Blocco giornata intera
  if (isFullDayBlocked(absMap, nurseId, dayIndex)) {
    return { blocked: true, reason: 'Giornata bloccata (assenza approvata)' };
  }

  // 2. Permesso parziale: verifica sovrapposizione oraria
  const partialKey = `${nurseId}_${dayIndex}`;
  const partials   = absMap.partial_day_blocks.get(partialKey);
  if (partials) {
    for (const p of partials) {
      if (_shiftOverlapsPartial(shift, p)) {
        return {
          blocked: true,
          reason: `${p.reason} (${p.partial_hours}h — ${p.partial_type})`,
        };
      }
    }
  }

  // 3. Esonero notturno: verifica categoria turno
  const exemption = absMap.shift_category_blocks.get(nurseId);
  if (exemption) {
    if (_isShiftBlockedByExemption(shift, exemption, dayContext)) {
      return {
        blocked: true,
        reason: `${exemption.reason} — turno ${shift.code} non assegnabile`,
      };
    }
  }

  return { blocked: false, reason: null };
}

/**
 * Restituisce tutte le categorie di turno bloccate per un infermiere
 * (usato in propagate() per settare -1 in blocco).
 * Ritorna null se nessun esonero attivo.
 */
function getExemptionBlock(absMap, nurseId) {
  return absMap.shift_category_blocks.get(nurseId) || null;
}

// ─────────────────────────────────────────────────────────────────
// Utility: espansione giorni (range + ricorrenze)
// ─────────────────────────────────────────────────────────────────

/**
 * Espande un'assenza in una lista di dayIndex (0-based) per il mese corrente.
 * Gestisce sia range semplici che ricorrenze settimanali/mensili.
 */
function _expandAbsenceDays(abs, year, month, daysInMonth) {
  const result = [];

  if (abs.is_recurring && abs.recurrence_rule) {
    result.push(..._expandRecurring(abs, year, month, daysInMonth));
  } else {
    result.push(..._daysInRange(abs.start_date, abs.end_date, year, month, daysInMonth));
  }

  return [...new Set(result)].sort((a, b) => a - b);
}

/**
 * Espande ricorrenze (es. 'WEEKLY:MON,WED', 'MONTHLY:1')
 * nel mese corrente.
 */
function _expandRecurring(abs, year, month, daysInMonth) {
  const rule       = (abs.recurrence_rule || '').toUpperCase();
  const ruleEnd    = abs.recurrence_end || '2099-12-31';
  const ruleStart  = abs.start_date;
  const result     = [];

  const DAYS_MAP = { MON:1, TUE:2, WED:3, THU:4, FRI:5, SAT:6, SUN:0 };

  if (rule.startsWith('WEEKLY:')) {
    // WEEKLY:MON,WED,FRI → ogni lunedì, mercoledì, venerdì
    const dowList = rule.replace('WEEKLY:', '').split(',')
      .map(d => DAYS_MAP[d.trim()])
      .filter(d => d !== undefined);

    for (let d = 1; d <= daysInMonth; d++) {
      const ds  = _ds(year, month, d);
      if (ds < ruleStart || ds > ruleEnd) continue;
      const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
      if (dowList.includes(dow)) result.push(d - 1);
    }
  } else if (rule.startsWith('MONTHLY:')) {
    // MONTHLY:5 → il 5 di ogni mese
    const dayOfMonth = parseInt(rule.replace('MONTHLY:', ''), 10);
    if (!isNaN(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= daysInMonth) {
      const ds = _ds(year, month, dayOfMonth);
      if (ds >= ruleStart && ds <= ruleEnd) result.push(dayOfMonth - 1);
    }
  } else {
    // Regola non riconosciuta: tratta come range normale
    result.push(..._daysInRange(abs.start_date, abs.end_date, year, month, daysInMonth));
  }

  return result;
}

/** Range date → dayIndex array (0-based) */
function _daysInRange(startDate, endDate, year, month, daysInMonth) {
  const result = [];
  const start  = new Date(`${startDate}T00:00:00Z`);
  const end    = new Date(`${endDate}T00:00:00Z`);
  for (let d = 0; d < daysInMonth; d++) {
    const curr = new Date(Date.UTC(year, month - 1, d + 1));
    if (curr >= start && curr <= end) result.push(d);
  }
  return result;
}

function _ds(year, month, day) {
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

// ─────────────────────────────────────────────────────────────────
// Utility: sovrapposizione oraria
// ─────────────────────────────────────────────────────────────────

/**
 * Verifica se un turno si sovrappone a un permesso parziale.
 * Per i turni notturni (cross-midnight) il calcolo considera la
 * fascia 23:00-07:00 come 23:00-31:00 (ore > 24).
 */
function _shiftOverlapsPartial(shift, partial) {
  // Se non abbiamo orari precisi: usiamo il partial_type come euristica
  if (!partial.start_hhmm && !partial.end_hhmm) {
    return _partialTypeBlocksShift(shift, partial.partial_type);
  }

  const [sH, sM] = (shift.start_time || '00:00').split(':').map(Number);
  const [eH, eM] = (shift.end_time   || '00:00').split(':').map(Number);
  const [pH, pM] = (partial.start_hhmm || '00:00').split(':').map(Number);
  const [qH, qM] = (partial.end_hhmm   || '23:59').split(':').map(Number);

  let shiftStart = sH * 60 + sM;
  let shiftEnd   = eH * 60 + eM;
  const partStart = pH * 60 + pM;
  const partEnd   = qH * 60 + qM;

  // Turno notturno: fine < inizio → aggiungi 1440 (24h in minuti)
  if (shiftEnd < shiftStart) shiftEnd += 1440;

  // Sovrapposizione: [shiftStart, shiftEnd) ∩ [partStart, partEnd) ≠ ∅
  return shiftStart < partEnd && shiftEnd > partStart;
}

/**
 * Fallback euristico quando non ci sono orari precisi:
 * il partial_type indica il tipo di uscita/ingresso.
 */
function _partialTypeBlocksShift(shift, partialType) {
  const isNight = Boolean(shift.is_night) || (shift.category || '').includes('notte');
  const isAfternoon = (shift.category || '').includes('pomeriggio') ||
                      shift.code === 'P' || shift.code === 'P12';
  const isMorning = (shift.category || '').includes('mattina') ||
                    shift.code === 'M' || shift.code === 'G12';

  switch (partialType) {
    case 'morning_exit':     return isNight || isAfternoon; // esce dal mattino: P e N bloccate
    case 'afternoon_late':   return isNight;                // entra tardi: solo N bloccata
    case 'hours_only':       return false;                  // ore parziali: non blocca turni interi
    case 'full':             return true;
    default:                 return false;
  }
}

// ─────────────────────────────────────────────────────────────────
// Utility: esonero notturno vs categoria turno
// ─────────────────────────────────────────────────────────────────

/**
 * Determina se un turno è bloccato dall'esonero dell'infermiere.
 */
function _isShiftBlockedByExemption(shift, exemption, dayContext) {
  const cats = exemption.blocked_categories;
  const isNight     = Boolean(shift.is_night);
  const isAfternoon = (shift.category || '').includes('pomeriggio') ||
                      shift.code === 'P' || shift.code === 'P12' ||
                      (shift.start_time && parseInt(shift.start_time) >= 15);
  const isOvertime  = Boolean(shift.is_overtime);
  const isFestive   = Boolean(dayContext.is_weekend) || Boolean(dayContext.is_festive);
  const isLong      = (shift.duration_hours || 0) >= 12;

  if (cats.has('night') && isNight) return true;
  if (cats.has('afternoon') && isAfternoon) return true;
  if (cats.has('overtime') && (isOvertime || isLong)) return true;
  if (cats.has('festive') && isFestive) return true;

  return false;
}

function _absenceLabel(type, abs) {
  const labels = {
    ferie:                   'Ferie programmate',
    permesso_104:            'Permesso L.104',
    maternita:               'Maternità/Paternità',
    congedo_straordinario:   'Congedo straordinario',
    malattia:                'Malattia',
    sciopero:                'Sciopero',
    formazione:              'Formazione/ECM',
  };
  return labels[type] || type;
}

// ─────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────

module.exports = {
  buildAbsenceConstraints,
  isFullDayBlocked,
  isShiftBlocked,
  getExemptionBlock,
  EXEMPTION_SCOPE_CATEGORIES,
};
