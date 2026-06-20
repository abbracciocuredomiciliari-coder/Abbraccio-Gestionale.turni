/**
 * OPBGestionale — Motore di Equità (Soft Constraint Engine)
 *
 * Obiettivo: minimizzare la VARIANZA dei carichi tra gli infermieri,
 * garantendo che nessuno faccia sempre le notti o i festivi.
 *
 * ─────────────────────────────────────────────────────────────────
 * MODELLO DI CARICO (Load Model)
 * ─────────────────────────────────────────────────────────────────
 * Per ogni infermiere i, il carico è un vettore multi-dimensionale:
 *
 *   load[i] = {
 *     total:   Σ (duration_hours × score_weight)   ← carico pesato totale
 *     nights:  Σ turni notturni                    ← conteggio notti
 *     weekends:Σ turni sabato/domenica             ← conteggio weekend
 *     overtime:Σ turni straordinari                ← conteggio straordinari
 *   }
 *
 * Lo score cumulativo composito è:
 *   composite_score = total_weighted
 *                   + nights  × NIGHT_BONUS
 *                   + weekends × WEEKEND_BONUS
 *                   + overtime × OVERTIME_BONUS
 *
 * NIGHT_BONUS / WEEKEND_BONUS amplificano il peso di queste categorie
 * per il ranking interno — evita che chi ha fatto molte notti venga
 * assegnato a ulteriori notti anche se ha poche ore totali.
 *
 * ─────────────────────────────────────────────────────────────────
 * METRICHE DI EQUITÀ
 * ─────────────────────────────────────────────────────────────────
 *   variance(x)   = Σ(xi - mean)² / n
 *   std_dev(x)    = √variance(x)
 *   gini(x)       = Σ|xi - xj| / (2 × n × mean)   ∈ [0,1]
 *                   0 = perfetta equità, 1 = massima disuguaglianza
 *   cv(x)         = std_dev / mean                  (coefficiente di variazione)
 *
 * Il Gini è la metrica principale perché è scale-invariant
 * (funziona sia con ore che con punti pesati).
 *
 * ─────────────────────────────────────────────────────────────────
 * ALGORITMO DI PRIORITÀ PER L'ASSEGNAZIONE
 * ─────────────────────────────────────────────────────────────────
 * Dato un turno da assegnare di tipo T al giorno D:
 *
 *   priority_score(i) = composite_score[i]          ← chi ha meno → priorità
 *                     + in_month_penalty(i, T)       ← equità intra-mese
 *                     + consecutive_penalty(i, D)    ← evita lunghe sequenze
 *                     + preference_penalty(i, T)     ← vincoli soft personali
 *
 * Scegli l'infermiere con priority_score minimo.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────
// Costanti di amplificazione per il composite score
// ─────────────────────────────────────────────────────────────────
const BONUS = {
  NIGHT:    8,   // ogni notte aggiunge 8pt extra al composite (in aggiunta al peso)
  WEEKEND:  4,   // ogni weekend aggiunge 4pt extra
  OVERTIME: 16,  // ogni straordinario aggiunge 16pt extra
  ONCALL:   2,   // reperibilità: 2pt extra (< NIGHT, peso ridotto — solo disponibilità)
};

// Peso equità default per la reperibilità (ore × peso < turno normale)
const ONCALL_WEIGHT_DEFAULT = 0.3;

// ─────────────────────────────────────────────────────────────────
// Statistiche di base
// ─────────────────────────────────────────────────────────────────

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function variance(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
}

function stdDev(arr) {
  return Math.sqrt(variance(arr));
}

/**
 * Indice di Gini — misura di disuguaglianza [0=equo, 1=disuguale]
 * Riferimento: Gini (1912), usato in letteratura OR per shift scheduling equity
 */
function gini(arr) {
  const n = arr.length;
  if (n < 2) return 0;
  const m = mean(arr);
  if (m === 0) return 0;
  let sumDiff = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      sumDiff += Math.abs(arr[i] - arr[j]);
  return sumDiff / (2 * n * n * m);
}

/** Coefficiente di variazione (std/mean) — normalizza indipendentemente dalla scala */
function cv(arr) {
  const m = mean(arr);
  return m === 0 ? 0 : stdDev(arr) / m;
}

// ─────────────────────────────────────────────────────────────────
// Calcolo carico storico per infermiere
// ─────────────────────────────────────────────────────────────────

/**
 * Calcola il carico composito di ogni infermiere dato lo storico delle assegnazioni.
 *
 * @param {Array}  assignments   Lista assegnazioni storiche
 *   [ { nurse_id, work_date, shift_code, duration_hours, score_weight,
 *       is_night, is_overtime, work_date } ]
 * @param {Object} weights       Pesi configurabili (da shift_weights nel DB)
 * @param {number} windowMonths  Finestra temporale in mesi (default 3)
 * @returns {Map<number, NurseLoad>}  nurse_id → carico
 */
function computeLoads(assignments, weights = {}, windowMonths = 3) {
  const nightW    = weights.night      ?? 1.5;
  const weekendW  = weights.weekend    ?? 1.2;
  const overtimeW = weights.overtime   ?? 2.0;
  const normalW   = weights.normal     ?? 1.0;
  const oncallW   = weights.oncall     ?? ONCALL_WEIGHT_DEFAULT;

  // Finestra temporale
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - windowMonths);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const loads = new Map();

  for (const a of assignments) {
    if (a.work_date < cutoffStr) continue;
    if (a.shift_code === 'R' || (a.duration_hours ?? 0) === 0) continue;

    if (!loads.has(a.nurse_id)) {
      loads.set(a.nurse_id, {
        nurse_id:   a.nurse_id,
        nurse_name: a.nurse_name || String(a.nurse_id),
        total_weighted: 0,
        total_hours:    0,
        nights:         0,
        weekends:       0,
        overtime:       0,
        oncalls:        0,   // conteggio reperibilità
        shift_counts:   {},  // shift_code → count
        composite_score: 0,
      });
    }

    const L = loads.get(a.nurse_id);
    const hours = a.duration_hours ?? 8;
    const isWeekend = _isWeekend(a.work_date);
    const isNight   = Boolean(a.is_night);
    const isOT      = Boolean(a.is_overtime);
    const isOncall  = Boolean(a.is_oncall);

    // Reperibilità: peso ridotto, non conta come ore lavorate standard
    if (isOncall) {
      const eqW = a.equity_weight ?? oncallW;
      L.total_weighted += hours * eqW;
      // Le ore di reperibilità non entrano in total_hours (non è un turno attivo)
      L.oncalls++;
      if (a.shift_code)
        L.shift_counts['OC'] = (L.shift_counts['OC'] || 0) + 1;
      continue;  // non eseguire il blocco normale
    }

    // Peso effettivo = MAX(tipo_turno, weekend) oppure overtime se straordinario
    let w;
    if (isOT) {
      w = overtimeW;
    } else {
      const typeW = isNight ? nightW : normalW;
      w = isWeekend ? Math.max(typeW, weekendW) : typeW;
    }

    L.total_weighted += hours * w;
    L.total_hours    += hours;
    if (isNight)   L.nights++;
    if (isWeekend) L.weekends++;
    if (isOT)      L.overtime++;
    L.shift_counts[a.shift_code] = (L.shift_counts[a.shift_code] || 0) + 1;
  }

  // Calcola composite_score con bonus categoriali
  for (const [, L] of loads) {
    L.composite_score = L.total_weighted
      + L.nights   * BONUS.NIGHT
      + L.weekends * BONUS.WEEKEND
      + L.overtime * BONUS.OVERTIME
      + (L.oncalls  ?? 0) * BONUS.ONCALL;
    // Arrotonda a 2 decimali
    L.composite_score  = Math.round(L.composite_score  * 100) / 100;
    L.total_weighted   = Math.round(L.total_weighted   * 100) / 100;
  }

  return loads;
}

/** Verifica se una data 'YYYY-MM-DD' cade di sabato o domenica */
function _isWeekend(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

// ─────────────────────────────────────────────────────────────────
// Metriche di equità aggregate
// ─────────────────────────────────────────────────────────────────

/**
 * Calcola le metriche di equità per un insieme di carichi.
 * Ritorna un oggetto con statistiche per total, nights, weekends.
 */
function computeEquityMetrics(loads) {
  const list = [...loads.values()];
  if (list.length === 0) return null;

  const toStats = (arr, label) => ({
    label,
    values: arr,
    mean:    Math.round(mean(arr) * 100) / 100,
    std_dev: Math.round(stdDev(arr) * 100) / 100,
    variance:Math.round(variance(arr) * 100) / 100,
    gini:    Math.round(gini(arr) * 1000) / 1000,
    cv:      Math.round(cv(arr) * 1000) / 1000,
    min:     Math.min(...arr),
    max:     Math.max(...arr),
    range:   Math.max(...arr) - Math.min(...arr),
  });

  return {
    composite: toStats(list.map(l => l.composite_score), 'Punteggio composito'),
    weighted:  toStats(list.map(l => l.total_weighted),  'Ore ponderate'),
    hours:     toStats(list.map(l => l.total_hours),     'Ore totali'),
    nights:    toStats(list.map(l => l.nights),          'Turni notturni'),
    weekends:  toStats(list.map(l => l.weekends),        'Turni weekend'),
    overtime:  toStats(list.map(l => l.overtime),        'Straordinari'),
    oncalls:   toStats(list.map(l => l.oncalls ?? 0),   'Reperibilità'),
    equity_score: _overallEquityScore(loads),
  };
}

/**
 * Score di equità globale [0-100]: 100 = perfettamente equo.
 * Combinazione pesata dei Gini index per ogni dimensione.
 */
function _overallEquityScore(loads) {
  const list = [...loads.values()];
  if (list.length < 2) return 100;

  const gTotal   = gini(list.map(l => l.composite_score));
  const gNights  = gini(list.map(l => l.nights));
  const gWeekend = gini(list.map(l => l.weekends));

  const gOncalls = gini(list.map(l => l.oncalls ?? 0));
  // Pesi: notti e weekend pesano di più; reperibilità peso minore
  const G = (gTotal * 0.35) + (gNights * 0.30) + (gWeekend * 0.20) + (gOncalls * 0.15);
  return Math.round((1 - G) * 100);
}

// ─────────────────────────────────────────────────────────────────
// Ranking e suggerimenti per l'assegnazione
// ─────────────────────────────────────────────────────────────────

/**
 * Dato un tipo di turno (night|weekend|normal), restituisce la lista
 * degli infermieri ordinati dal più "bisognoso" al meno.
 * Chi ha composite_score basso → priorità massima.
 *
 * @param {Map}    loads         Output di computeLoads()
 * @param {string} shiftCategory 'night' | 'weekend' | 'normal' | 'overtime'
 * @returns {Array} Lista ordinata con rank, score, gap dalla media
 */
function rankByPriority(loads, shiftCategory = 'normal') {
  const list = [...loads.values()];
  const m = mean(list.map(l => l.composite_score));

  // Per notti: ordina prima per nights count (chi ne ha meno), poi composite
  // Per weekend: ordina prima per weekends count
  // Per tutti: composite_score come tiebreaker
  const sorted = [...list].sort((a, b) => {
    if (shiftCategory === 'night') {
      if (a.nights !== b.nights) return a.nights - b.nights;
    } else if (shiftCategory === 'weekend') {
      if (a.weekends !== b.weekends) return a.weekends - b.weekends;
    } else if (shiftCategory === 'overtime') {
      if (a.overtime !== b.overtime) return a.overtime - b.overtime;
    } else if (shiftCategory === 'oncall') {
      if (a.oncalls !== b.oncalls) return (a.oncalls ?? 0) - (b.oncalls ?? 0);
    }
    return a.composite_score - b.composite_score;
  });

  return sorted.map((l, i) => ({
    rank:            i + 1,
    nurse_id:        l.nurse_id,
    nurse_name:      l.nurse_name,
    composite_score: l.composite_score,
    gap_from_mean:   Math.round((l.composite_score - m) * 100) / 100,
    nights:          l.nights,
    weekends:        l.weekends,
    overtime:        l.overtime,
    oncalls:         l.oncalls ?? 0,
    total_hours:     l.total_hours,
    total_weighted:  l.total_weighted,
    priority:        i < Math.ceil(sorted.length / 3) ? 'alta' :
                     i < Math.ceil(sorted.length * 2 / 3) ? 'media' : 'bassa',
  }));
}

/**
 * Genera suggerimenti testuali per il coordinatore su situazioni di squilibrio.
 */
function generateRecommendations(loads, metrics) {
  const list = [...loads.values()];
  const recs = [];

  if (!metrics) return recs;

  // Individua infermieri con carico estremo
  const nightMean = metrics.nights.mean;
  const weekMean  = metrics.weekends.mean;
  const compMean  = metrics.composite.mean;

  for (const l of list) {
    // Chi ha fatto troppe notti rispetto alla media
    if (l.nights > nightMean * 1.5 && nightMean > 0) {
      recs.push({
        type: 'overloaded_nights',
        severity: 'warning',
        nurse_id:   l.nurse_id,
        nurse_name: l.nurse_name,
        message: `${l.nurse_name} ha ${l.nights} notti (media: ${nightMean.toFixed(1)}) — evitare ulteriori turni notturni`,
        suggestion: 'Assegnare preferibilmente turni diurni nei prossimi mesi',
      });
    }
    // Chi ha fatto troppe poche notti e dovrebbe "compensare"
    if (l.nights < nightMean * 0.5 && nightMean > 0 && l.total_hours > 0) {
      recs.push({
        type: 'underloaded_nights',
        severity: 'info',
        nurse_id:   l.nurse_id,
        nurse_name: l.nurse_name,
        message: `${l.nurse_name} ha solo ${l.nights} notti (media: ${nightMean.toFixed(1)}) — candidato prioritario per notti`,
        suggestion: 'Considerare per i prossimi turni notturni disponibili',
      });
    }
    // Troppi weekend
    if (l.weekends > weekMean * 1.5 && weekMean > 0) {
      recs.push({
        type: 'overloaded_weekends',
        severity: 'warning',
        nurse_id:   l.nurse_id,
        nurse_name: l.nurse_name,
        message: `${l.nurse_name} ha ${l.weekends} weekend lavorati (media: ${weekMean.toFixed(1)})`,
        suggestion: 'Garantire almeno 2 weekend liberi nel prossimo mese',
      });
    }
    // Carico composito molto alto
    if (l.composite_score > compMean * 1.4 && compMean > 0) {
      recs.push({
        type: 'high_composite_load',
        severity: 'warning',
        nurse_id:   l.nurse_id,
        nurse_name: l.nurse_name,
        message: `${l.nurse_name} ha punteggio composito ${l.composite_score} (media: ${compMean.toFixed(1)}, +${Math.round((l.composite_score/compMean - 1)*100)}%)`,
        suggestion: 'Preferire turni leggeri (mattina feriale) per riequilibrare',
      });
    }
  }

  // Raccomandazione globale sull'equità
  if (metrics.equity_score < 70) {
    recs.unshift({
      type: 'low_equity_global',
      severity: 'alert',
      nurse_id:   null,
      nurse_name: null,
      message: `Equità complessiva bassa: ${metrics.equity_score}/100 — distribuzione sbilanciata`,
      suggestion: 'Riesaminare i turni del mese prossimo privilegiando chi ha score più basso',
    });
  }

  return recs;
}

// ─────────────────────────────────────────────────────────────────
// Delta equità — quanto migliora/peggiora assegnando turno X a Y
// ─────────────────────────────────────────────────────────────────

/**
 * Simula l'assegnazione di un turno a un infermiere e calcola la
 * variazione di varianza e Gini che ne risulterebbe.
 * Usato dal solver per scegliere l'assegnazione che minimizza la varianza.
 *
 * @param {Map}    loads         Stato corrente dei carichi
 * @param {number} nurseId       Infermiere candidato
 * @param {Object} shiftToAdd    { duration_hours, is_night, is_weekend, is_overtime, weight }
 * @returns {{ delta_variance, delta_gini, new_composite }}
 */
function simulateAssignment(loads, nurseId, shiftToAdd) {
  const list = [...loads.values()];
  const scores = list.map(l => l.composite_score);
  const varBefore = variance(scores);
  const giniBefore = gini(scores);

  // Stima il contributo del nuovo turno
  const hours = shiftToAdd.duration_hours ?? 8;
  const w     = shiftToAdd.weight ?? 1.0;
  const nightBonus   = shiftToAdd.is_night    ? BONUS.NIGHT    : 0;
  const weekendBonus = shiftToAdd.is_weekend  ? BONUS.WEEKEND  : 0;
  const otBonus      = shiftToAdd.is_overtime ? BONUS.OVERTIME : 0;
  const delta = hours * w + nightBonus + weekendBonus + otBonus;

  // Simula scores dopo l'assegnazione
  const newScores = list.map(l =>
    l.nurse_id === nurseId ? l.composite_score + delta : l.composite_score
  );
  const varAfter  = variance(newScores);
  const giniAfter = gini(newScores);

  const nurseLoad = loads.get(nurseId);
  return {
    nurse_id:       nurseId,
    delta_variance: Math.round((varAfter  - varBefore)  * 100) / 100,
    delta_gini:     Math.round((giniAfter - giniBefore) * 1000) / 1000,
    new_composite:  Math.round(((nurseLoad?.composite_score ?? 0) + delta) * 100) / 100,
    current_composite: nurseLoad?.composite_score ?? 0,
    shift_delta:    Math.round(delta * 100) / 100,
  };
}

/**
 * Dato un insieme di candidati, scegli quello che MINIMIZZA la varianza.
 * Questa è la funzione chiamata dal solver per ogni turno da assegnare.
 *
 * @param {Map}    loads        Carichi correnti (aggiornati incrementalmente)
 * @param {Array}  candidateIds Lista di nurse_id candidati
 * @param {Object} shiftInfo    Info sul turno: { duration_hours, is_night, is_weekend, weight }
 * @returns {number} nurse_id dell'assegnazione ottimale
 */
function chooseBestCandidate(loads, candidateIds, shiftInfo) {
  if (candidateIds.length === 0) return null;
  if (candidateIds.length === 1) return candidateIds[0];

  let bestId    = null;
  let bestDeltaVariance = Infinity;

  for (const id of candidateIds) {
    const sim = simulateAssignment(loads, id, shiftInfo);
    if (sim.delta_variance < bestDeltaVariance) {
      bestDeltaVariance = sim.delta_variance;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * Aggiorna incrementalmente il carico di un infermiere dopo un'assegnazione.
 * Chiamato dal solver dopo ogni assegnazione per mantenere i carichi aggiornati.
 */
function applyAssignment(loads, nurseId, nurseName, shiftInfo) {
  if (!loads.has(nurseId)) {
    loads.set(nurseId, {
      nurse_id: nurseId, nurse_name: nurseName,
      total_weighted: 0, total_hours: 0,
      nights: 0, weekends: 0, overtime: 0, oncalls: 0,
      shift_counts: {}, composite_score: 0,
    });
  }
  const L = loads.get(nurseId);
  const hours = shiftInfo.duration_hours ?? 8;

  // Reperibilità: peso ridotto, non entra in total_hours
  if (shiftInfo.is_oncall) {
    const eqW = shiftInfo.oncall_weight ?? ONCALL_WEIGHT_DEFAULT;
    L.total_weighted += hours * eqW;
    L.oncalls = (L.oncalls ?? 0) + 1;
    L.shift_counts['OC'] = (L.shift_counts['OC'] || 0) + 1;
  } else {
    const w = shiftInfo.weight ?? 1.0;
    L.total_weighted += hours * w;
    L.total_hours    += hours;
    if (shiftInfo.is_night)    L.nights++;
    if (shiftInfo.is_weekend)  L.weekends++;
    if (shiftInfo.is_overtime) L.overtime++;
    if (shiftInfo.shift_code)
      L.shift_counts[shiftInfo.shift_code] = (L.shift_counts[shiftInfo.shift_code] || 0) + 1;
  }

  L.composite_score = L.total_weighted
    + L.nights              * BONUS.NIGHT
    + L.weekends            * BONUS.WEEKEND
    + L.overtime            * BONUS.OVERTIME
    + (L.oncalls ?? 0)      * BONUS.ONCALL;
}

// ─────────────────────────────────────────────────────────────────
// API pubblica del modulo
// ─────────────────────────────────────────────────────────────────

module.exports = {
  computeLoads,
  computeEquityMetrics,
  rankByPriority,
  generateRecommendations,
  simulateAssignment,
  chooseBestCandidate,
  applyAssignment,
  // esporta anche le statistiche di base per uso esterno
  mean, variance, stdDev, gini, cv,
  BONUS,
  ONCALL_WEIGHT_DEFAULT,
};
