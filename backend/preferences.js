/**
 * OPBGestionale — Modulo Gestione Preferenze e Richieste Speciali
 *
 * Traduce le richieste del personale (ferie, riposi, preferenze turno)
 * in penalità soft per il solver CP-SAT.
 *
 * ─────────────────────────────────────────────────────────────────
 * TIPI DI RICHIESTA E TRATTAMENTO
 * ─────────────────────────────────────────────────────────────────
 *
 *  Tipo           │ Stato richiesto │ Comportamento solver
 *  ───────────────┼─────────────────┼─────────────────────────────────────────
 *  ferie          │ approved        │ HARD: blocca tutti i turni (come unavailability)
 *  permesso       │ approved        │ HARD: blocca i giorni richiesti
 *  recupero       │ approved        │ HARD: blocca i giorni richiesti
 *  ferie          │ pending         │ SOFT P3 (penalità alta): evita assegnazioni
 *  riposo_richiesto│ any            │ SOFT P2 (penalità media): preferisce non assegnare
 *  preferenza_turno│ any            │ SOFT P1 (penalità bassa): prova a soddisfare
 *  cambio_turno   │ pending/approved│ trattato separatamente (swap logic)
 *
 * LIVELLI DI PENALITÀ (score aggiunto al candidato — più alto = meno preferito)
 *  P_HARD_VIOLATION  = 10000  → usato solo quando non ci sono alternative (forced)
 *  P3_FERIE_PENDING  = 500    → ferie in attesa di approvazione
 *  P2_RIPOSO_RICH    = 200    → giorno di riposo richiesto
 *  P1_PREF_TURNO     = 50     → preferenza su turno specifico non soddisfatta
 *  P1_PREF_NOT       = 30     → vuole evitare quel turno
 *
 * ─────────────────────────────────────────────────────────────────
 * STRUTTURA OUTPUT (PreferencePenaltyMap)
 * ─────────────────────────────────────────────────────────────────
 *  {
 *    hard_blocks: Set<"nurseId_dayIndex">,       // giorni completamente bloccati
 *    penalties:   Map<"nurseId_dayIndex_shiftId", { penalty, reason, request_id }>,
 *    day_penalties: Map<"nurseId_dayIndex", { penalty, reason, request_id }>,  // su tutto il giorno
 *    preferred_shifts: Map<"nurseId_dayIndex", shiftTypeId>,  // turno che vorrebbe
 *    summary: { hard_count, soft_count, by_type }
 *  }
 */

'use strict';

// Penalità configurabili
const PENALTIES = {
  HARD_VIOLATION:  10000,  // costretto a violare: usato come ultimo resort
  FERIE_PENDING:     500,  // ferie in attesa — alta priorità soft
  RIPOSO_RICHIESTO:  200,  // giorno libero richiesto
  PREF_TURNO_WRONG:   80,  // assegnato turno diverso da quello preferito
  PREF_NOT_SHIFT:     50,  // turno che vuole evitare (prefer_not sul turno specifico)
};

/**
 * Costruisce la mappa di penalità a partire dall'elenco delle richieste.
 *
 * @param {Array}  requests   Lista richieste dal DB, normalizzate:
 *   [ { id, user_id, request_type_code, status_code,
 *       start_date, end_date, shift_type_id, notes } ]
 * @param {number} year
 * @param {number} month        (1-based)
 * @param {number} daysInMonth
 * @returns {PreferencePenaltyMap}
 */
function buildPreferencePenalties(requests, year, month, daysInMonth) {
  const hard_blocks    = new Set();
  const penalties      = new Map();   // key: "nurseId_dayIdx_shiftId"
  const day_penalties  = new Map();   // key: "nurseId_dayIdx"
  const preferred_shifts = new Map(); // key: "nurseId_dayIdx"

  const summary = { hard_count: 0, soft_count: 0, by_type: {} };

  for (const req of requests) {
    const days = _daysInRange(req.start_date, req.end_date, year, month, daysInMonth);
    if (days.length === 0) continue;

    const type   = (req.request_type_code || '').toLowerCase();
    const status = (req.status_code || '').toLowerCase();

    summary.by_type[type] = (summary.by_type[type] || 0) + 1;

    // ── VINCOLI HARD: ferie/permesso/recupero APPROVATI ──────────
    if (['ferie', 'permesso', 'recupero'].includes(type) && status === 'approved') {
      for (const d of days) {
        hard_blocks.add(`${req.user_id}_${d}`);
      }
      summary.hard_count++;
      continue;
    }

    // ── SOFT P3: ferie in attesa di approvazione ─────────────────
    if (type === 'ferie' && status === 'pending') {
      for (const d of days) {
        _addDayPenalty(day_penalties, req.user_id, d, {
          penalty:    PENALTIES.FERIE_PENDING,
          reason:     'Ferie richieste (in attesa approvazione)',
          request_id: req.id,
          type:       'ferie_pending',
          can_override: true,
        });
      }
      summary.soft_count++;
      continue;
    }

    // ── SOFT P2: riposo richiesto (qualsiasi stato) ───────────────
    if (type === 'riposo_richiesto' || type === 'recupero') {
      for (const d of days) {
        _addDayPenalty(day_penalties, req.user_id, d, {
          penalty:    PENALTIES.RIPOSO_RICHIESTO,
          reason:     'Riposo richiesto',
          request_id: req.id,
          type:       'riposo_richiesto',
          can_override: true,
        });
      }
      summary.soft_count++;
      continue;
    }

    // ── SOFT P1: preferenza su turno specifico ────────────────────
    if (type === 'preferenza_turno') {
      for (const d of days) {
        if (req.shift_type_id) {
          // Vuole quel turno specifico: penalizza ogni altro turno
          preferred_shifts.set(`${req.user_id}_${d}`, req.shift_type_id);
        }
        _addDayPenalty(day_penalties, req.user_id, d, {
          penalty:    PENALTIES.PREF_TURNO_WRONG,
          reason:     `Preferenza turno ${req.shift_type_id || 'non specificato'}`,
          request_id: req.id,
          type:       'preferenza_turno',
          shift_type_id: req.shift_type_id,
          can_override: true,
        });
      }
      summary.soft_count++;
      continue;
    }

    // ── SOFT: permesso/recupero PENDING ──────────────────────────
    if (['permesso', 'recupero'].includes(type) && status === 'pending') {
      for (const d of days) {
        _addDayPenalty(day_penalties, req.user_id, d, {
          penalty:    PENALTIES.RIPOSO_RICHIESTO,
          reason:     `${type} in attesa approvazione`,
          request_id: req.id,
          type:       `${type}_pending`,
          can_override: true,
        });
      }
      summary.soft_count++;
    }
  }

  return { hard_blocks, penalties, day_penalties, preferred_shifts, summary };
}

/**
 * Calcola la penalità per assegnare l'infermiere nurseId al turno shiftTypeId
 * nel giorno dayIndex. Ritorna { penalty, reasons[] }.
 *
 * penalty=0 → nessuna violazione di preferenza
 * penalty>0 → violazione con motivazione
 */
function getPenalty(prefMap, nurseId, dayIndex, shiftTypeId) {
  let totalPenalty = 0;
  const reasons = [];

  // Penalità giornaliera (ferie, riposo richiesto, ecc.)
  const dayKey = `${nurseId}_${dayIndex}`;
  const dayP   = prefMap.day_penalties.get(dayKey);
  if (dayP) {
    totalPenalty += dayP.penalty;
    reasons.push(dayP.reason);
  }

  // Penalità specifica per il turno sbagliato
  const preferredShift = prefMap.preferred_shifts.get(dayKey);
  if (preferredShift && String(preferredShift) !== String(shiftTypeId)) {
    totalPenalty += PENALTIES.PREF_TURNO_WRONG;
    reasons.push(`Vuole turno ${preferredShift}, assegnato ${shiftTypeId}`);
  }

  return { penalty: totalPenalty, reasons };
}

/**
 * Verifica se un infermiere è hard-bloccato per un certo giorno.
 */
function isHardBlocked(prefMap, nurseId, dayIndex) {
  return prefMap.hard_blocks.has(`${nurseId}_${dayIndex}`);
}

/**
 * Genera il report delle violazioni di preferenza per un planning già costruito.
 * Input: lista di assegnazioni [ { nurse_id, day_index, shift_type_id } ]
 */
function reportViolations(prefMap, assignments) {
  const violations = [];

  for (const a of assignments) {
    const { penalty, reasons } = getPenalty(prefMap, a.nurse_id, a.day_index, a.shift_type_id);
    if (penalty > 0) {
      violations.push({
        nurse_id:     a.nurse_id,
        nurse_name:   a.nurse_name,
        day_index:    a.day_index,
        work_date:    a.work_date,
        shift_type_id: a.shift_type_id,
        shift_code:   a.shift_code,
        penalty,
        reasons,
        forced: penalty >= PENALTIES.HARD_VIOLATION,
      });
    }
  }

  violations.sort((a, b) => b.penalty - a.penalty);

  return {
    violations,
    total_penalty:    violations.reduce((s, v) => s + v.penalty, 0),
    forced_count:     violations.filter(v => v.forced).length,
    soft_count:       violations.filter(v => !v.forced).length,
    satisfaction_rate: assignments.length > 0
      ? Math.round((1 - violations.length / assignments.length) * 100)
      : 100,
  };
}

// ─────────────────────────────────────────────────────────────────
// Utility interne
// ─────────────────────────────────────────────────────────────────

/** Converte range date → array di dayIndex (0-based) nel mese/anno */
function _daysInRange(startDate, endDate, year, month, daysInMonth) {
  const result = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end   = new Date(`${endDate  }T00:00:00Z`);

  for (let d = 0; d < daysInMonth; d++) {
    const curr = new Date(Date.UTC(year, month - 1, d + 1));
    if (curr >= start && curr <= end) result.push(d);
  }
  return result;
}

/** Aggiunge una penalità giornaliera, prendendo il MAX se ce n'è già una */
function _addDayPenalty(map, nurseId, dayIndex, data) {
  const key  = `${nurseId}_${dayIndex}`;
  const prev = map.get(key);
  // Tieni la penalità più alta (non sommare: una ferie già richiesta non si amplifica)
  if (!prev || data.penalty > prev.penalty) {
    map.set(key, data);
  }
}

module.exports = {
  buildPreferencePenalties,
  getPenalty,
  isHardBlocked,
  reportViolations,
  PENALTIES,
};
