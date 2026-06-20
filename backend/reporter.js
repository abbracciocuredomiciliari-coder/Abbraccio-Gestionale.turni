/**
 * OPBGestionale — Modulo Reportistica
 *
 * Funzioni pure che trasformano assegnazioni + richieste in report
 * leggibili (JSON strutturato, CSV).
 *
 * Exports:
 *   buildCalendarReport(assignments, staff, shiftTypes, year, month)
 *     → report calendario mensile per giorno e per infermiere
 *
 *   buildEquityReport(assignments, requests, staff, shiftTypes, year, month)
 *     → report equità: notti / festivi / ore / richieste rifiutate
 *
 *   calendarToCSV(calendarReport)
 *     → stringa CSV del calendario (righe = giorni, colonne = infermieri)
 *
 *   equityToCSV(equityReport)
 *     → stringa CSV del report equità (righe = infermieri)
 *
 *   calendarToJSON(calendarReport)
 *     → JSON compatto del calendario
 */

'use strict';

const { computeEquityMetrics, gini, mean, variance } = require('./equity');

// ─────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────

function isWeekend(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

function isHoliday(dateStr, holidays = []) {
  const mmdd = dateStr.slice(5); // "MM-DD"
  const fixed = ['01-01','04-25','05-01','06-02','08-15','11-01','12-08','12-25','12-26'];
  return fixed.includes(mmdd) || holidays.includes(dateStr);
}

function dayName(dateStr) {
  const DAYS = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
  return DAYS[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
}

function pad2(n) { return String(n).padStart(2, '0'); }

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function monthDateRange(year, month) {
  const d = daysInMonth(year, month);
  return {
    start: `${year}-${pad2(month)}-01`,
    end:   `${year}-${pad2(month)}-${pad2(d)}`,
    days:  d,
  };
}

// ─────────────────────────────────────────────────────────────────
// 1. CALENDARIO MENSILE
// ─────────────────────────────────────────────────────────────────

/**
 * Costruisce il report calendario mensile.
 *
 * @param {Array}  assignments  [{user_id, work_date, shift_code, shift_name,
 *                               duration_hours, is_night, is_overtime, color}]
 * @param {Array}  staff        [{id, first_name, last_name, role}]
 * @param {number} year
 * @param {number} month
 * @param {Array}  holidays     ['YYYY-MM-DD'] giorni festivi nazionali extra
 * @returns {CalendarReport}
 */
function buildCalendarReport(assignments, staff, year, month, holidays = []) {
  const { days } = monthDateRange(year, month);

  // Indice: nurse_id → staff record
  const staffMap = new Map(staff.map(s => [s.id, s]));

  // Struttura: giorni × infermieri
  const byDate = {};
  for (let d = 1; d <= days; d++) {
    const ds = `${year}-${pad2(month)}-${pad2(d)}`;
    byDate[ds] = {
      date:     ds,
      day_name: dayName(ds),
      is_weekend: isWeekend(ds),
      is_holiday: isHoliday(ds, holidays),
      is_festive: isWeekend(ds) || isHoliday(ds, holidays),
      shifts: [],       // [ { nurse_id, nurse_name, shift_code, duration_hours, is_night, is_overtime } ]
      coverage: {},     // shift_code → count
      nurses_off: [],   // chi non lavora quel giorno
    };
  }

  // Popola con le assegnazioni
  for (const a of assignments) {
    if (!byDate[a.work_date]) continue;
    const s = staffMap.get(a.user_id);
    const nurseName = s ? `${s.first_name} ${s.last_name}` : `ID:${a.user_id}`;

    byDate[a.work_date].shifts.push({
      nurse_id:      a.user_id,
      nurse_name:    nurseName,
      shift_code:    a.shift_code,
      shift_name:    a.shift_name || a.shift_code,
      duration_hours: a.duration_hours ?? 8,
      is_night:      Boolean(a.is_night),
      is_overtime:   Boolean(a.is_overtime),
      color:         a.color || '#gray',
    });

    const cc = byDate[a.work_date].coverage;
    cc[a.shift_code] = (cc[a.shift_code] || 0) + 1;
  }

  // Chi è libero ogni giorno
  const workedNursesByDate = {};
  for (const [ds, day] of Object.entries(byDate)) {
    workedNursesByDate[ds] = new Set(day.shifts.map(s => s.nurse_id));
    day.nurses_off = staff
      .filter(s => !workedNursesByDate[ds].has(s.id))
      .map(s => ({ nurse_id: s.id, nurse_name: `${s.first_name} ${s.last_name}` }));
  }

  // Vista per infermiere: timeline mensile
  const byNurse = {};
  for (const s of staff) {
    byNurse[s.id] = {
      nurse_id:   s.id,
      nurse_name: `${s.first_name} ${s.last_name}`,
      timeline:   {},  // 'YYYY-MM-DD' → { shift_code, is_night, is_overtime } | 'R' (riposo)
    };
    // Inizializza tutti i giorni a riposo
    for (let d = 1; d <= days; d++) {
      const ds = `${year}-${pad2(month)}-${pad2(d)}`;
      byNurse[s.id].timeline[ds] = { shift_code: 'R', shift_name: 'Riposo', is_night: false, is_overtime: false };
    }
  }
  for (const a of assignments) {
    if (!byNurse[a.user_id]) continue;
    byNurse[a.user_id].timeline[a.work_date] = {
      shift_code:    a.shift_code,
      shift_name:    a.shift_name || a.shift_code,
      duration_hours: a.duration_hours ?? 8,
      is_night:      Boolean(a.is_night),
      is_overtime:   Boolean(a.is_overtime),
      is_festive:    byDate[a.work_date]?.is_festive ?? false,
    };
  }

  // Totali mese
  const summary = {
    year, month,
    total_assignments: assignments.length,
    festive_days: Object.values(byDate).filter(d => d.is_festive).length,
    weekend_days: Object.values(byDate).filter(d => d.is_weekend).length,
    holiday_days: Object.values(byDate).filter(d => d.is_holiday).length,
    staff_count:  staff.length,
  };

  return { summary, by_date: byDate, by_nurse: byNurse };
}

// ─────────────────────────────────────────────────────────────────
// 2. REPORT EQUITÀ
// ─────────────────────────────────────────────────────────────────

/**
 * Costruisce il report di equità per il mese.
 *
 * @param {Array} assignments   Assegnazioni del mese (come buildCalendarReport)
 * @param {Array} requests      Richieste del personale per il mese
 *   [{id, user_id, request_type_code, status_code, start_date, end_date, notes}]
 * @param {Array} staff
 * @param {number} year
 * @param {number} month
 * @param {Array} holidays
 * @returns {EquityReport}
 */
function buildEquityReport(assignments, requests, staff, year, month, holidays = []) {
  const staffMap = new Map(staff.map(s => [s.id, s]));

  // Per ogni infermiere: calcola statistiche
  const nurseStats = new Map();
  for (const s of staff) {
    nurseStats.set(s.id, {
      nurse_id:       s.id,
      nurse_name:     `${s.first_name} ${s.last_name}`,
      // Turni
      total_shifts:   0,
      total_hours:    0,
      nights:         0,
      weekend_shifts: 0,
      holiday_shifts: 0,
      festive_shifts: 0,   // notti + weekend + festivi
      overtime_shifts: 0,
      // Per tipo turno
      by_shift_code:  {},  // code → count
      // Richieste
      requests_total:    0,
      requests_approved: 0,
      requests_rejected: 0,
      requests_pending:  0,
      requests_refused_by_system: [],  // violazioni forzate
      days_off_requested: 0,
      days_off_granted:   0,
    });
  }

  // Processa assegnazioni
  for (const a of assignments) {
    const L = nurseStats.get(a.user_id);
    if (!L) continue;

    const isW   = isWeekend(a.work_date);
    const isH   = isHoliday(a.work_date, holidays);
    const isN   = Boolean(a.is_night);
    const isOT  = Boolean(a.is_overtime);
    const hours = a.duration_hours ?? 8;

    L.total_shifts++;
    L.total_hours += hours;
    if (isN)  L.nights++;
    if (isW)  L.weekend_shifts++;
    if (isH)  L.holiday_shifts++;
    if (isW || isH || isN) L.festive_shifts++;
    if (isOT) L.overtime_shifts++;
    L.by_shift_code[a.shift_code] = (L.by_shift_code[a.shift_code] || 0) + 1;
  }

  // Processa richieste
  for (const r of requests) {
    const L = nurseStats.get(r.user_id);
    if (!L) continue;

    L.requests_total++;
    const status = (r.status_code || '').toLowerCase();
    const type   = (r.request_type_code || '').toLowerCase();

    if (status === 'approved') L.requests_approved++;
    else if (status === 'rejected') L.requests_rejected++;
    else if (status === 'pending')  L.requests_pending++;

    // Conta giorni richiesti/concessi
    if (['ferie', 'permesso', 'recupero', 'riposo_richiesto'].includes(type)) {
      const start = new Date(`${r.start_date}T00:00:00Z`);
      const end   = new Date(`${r.end_date}T00:00:00Z`);
      const daysReq = Math.round((end - start) / 86400000) + 1;
      L.days_off_requested += daysReq;
      if (status === 'approved') L.days_off_granted += daysReq;
    }

    // Richieste rifiutate: approvate ma violate dal solver (type forzato)
    if (r.forced_violation) {
      L.requests_refused_by_system.push({
        date:    r.date,
        reason:  r.reason || 'Copertura turno insufficiente',
        request_id: r.id,
      });
    }
  }

  // Metriche di equità aggregate
  const list = [...nurseStats.values()];
  const nightArr   = list.map(l => l.nights);
  const weekArr    = list.map(l => l.weekend_shifts);
  const hoursArr   = list.map(l => l.total_hours);
  const festArr    = list.map(l => l.festive_shifts);

  const metrics = {
    nights: {
      mean:    Math.round(mean(nightArr)    * 10) / 10,
      std_dev: Math.round(Math.sqrt(variance(nightArr)) * 10) / 10,
      gini:    Math.round(gini(nightArr)    * 1000) / 1000,
      min:     Math.min(...nightArr),
      max:     Math.max(...nightArr),
      gap:     Math.max(...nightArr) - Math.min(...nightArr),
    },
    weekends: {
      mean:    Math.round(mean(weekArr)     * 10) / 10,
      std_dev: Math.round(Math.sqrt(variance(weekArr))  * 10) / 10,
      gini:    Math.round(gini(weekArr)     * 1000) / 1000,
      min:     Math.min(...weekArr),
      max:     Math.max(...weekArr),
      gap:     Math.max(...weekArr) - Math.min(...weekArr),
    },
    hours: {
      mean:    Math.round(mean(hoursArr)    * 10) / 10,
      std_dev: Math.round(Math.sqrt(variance(hoursArr)) * 10) / 10,
      gini:    Math.round(gini(hoursArr)    * 1000) / 1000,
      min:     Math.min(...hoursArr),
      max:     Math.max(...hoursArr),
      gap:     Math.max(...hoursArr) - Math.min(...hoursArr),
    },
    festive: {
      mean:    Math.round(mean(festArr)     * 10) / 10,
      gini:    Math.round(gini(festArr)     * 1000) / 1000,
      gap:     Math.max(...festArr) - Math.min(...festArr),
    },
    equity_score: _equityScore(nightArr, weekArr),
  };

  // Ranking equità (dal più svantaggiato al meno)
  const ranking = [...nurseStats.values()]
    .sort((a, b) => b.festive_shifts - a.festive_shifts)
    .map((l, i) => ({ rank: i + 1, ...l }));

  // Richieste rifiutate o pending aggregate
  const unresolved = requests.filter(r =>
    ['pending'].includes((r.status_code || '').toLowerCase())
  );
  const rejected = requests.filter(r =>
    ['rejected'].includes((r.status_code || '').toLowerCase())
  );

  return {
    year, month,
    generated_at: new Date().toISOString(),
    summary: {
      staff_count:         staff.length,
      total_assignments:   assignments.length,
      total_hours:         list.reduce((s, l) => s + l.total_hours, 0),
      total_nights:        list.reduce((s, l) => s + l.nights, 0),
      total_weekends:      list.reduce((s, l) => s + l.weekend_shifts, 0),
      total_festive:       list.reduce((s, l) => s + l.festive_shifts, 0),
      total_overtime:      list.reduce((s, l) => s + l.overtime_shifts, 0),
      requests_total:      requests.length,
      requests_approved:   requests.filter(r => r.status_code === 'approved').length,
      requests_rejected:   rejected.length,
      requests_pending:    unresolved.length,
      equity_score:        metrics.equity_score,
    },
    metrics,
    by_nurse:    ranking,
    unresolved_requests: unresolved.map(r => ({
      request_id:  r.id,
      nurse_id:    r.user_id,
      nurse_name:  staffMap.get(r.user_id) ? `${staffMap.get(r.user_id).first_name} ${staffMap.get(r.user_id).last_name}` : `ID:${r.user_id}`,
      type:        r.request_type_code,
      start_date:  r.start_date,
      end_date:    r.end_date,
      notes:       r.notes,
    })),
  };
}

function _equityScore(nightArr, weekArr) {
  if (nightArr.length < 2) return 100;
  const gN = gini(nightArr);
  const gW = gini(weekArr);
  return Math.round((1 - (gN * 0.6 + gW * 0.4)) * 100);
}

// ─────────────────────────────────────────────────────────────────
// 3. EXPORT CSV
// ─────────────────────────────────────────────────────────────────

/**
 * Esporta il calendario mensile in CSV.
 * Formato: righe = giorni del mese, colonne = infermieri
 * Cella = codice turno ('M', 'P', 'N', 'R') o vuota
 */
function calendarToCSV(calendarReport) {
  const { by_date, by_nurse, summary } = calendarReport;
  const { year, month } = summary;

  // Intestazione: Data, Giorno, Festivo, poi un infermiere per colonna
  const nurses = Object.values(by_nurse).sort((a, b) =>
    a.nurse_name.localeCompare(b.nurse_name)
  );

  const header = ['Data', 'Giorno', 'Festivo', ...nurses.map(n => `"${n.nurse_name}"`)].join(';');

  const rows = Object.entries(by_date)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ds, day]) => {
      const cols = nurses.map(n => {
        const t = n.timeline[ds];
        if (!t || t.shift_code === 'R') return 'R';
        return t.is_overtime ? `${t.shift_code}*` : t.shift_code;
      });
      return [
        ds,
        day.day_name,
        day.is_festive ? 'SI' : '',
        ...cols,
      ].join(';');
    });

  // Footer: totali per infermiere
  const totLine = ['TOTALE TURNI', '', '',
    ...nurses.map(n => {
      const stats = Object.values(n.timeline).filter(t => t.shift_code !== 'R').length;
      return stats;
    })
  ].join(';');
  const nightLine = ['NOTTI', '', '',
    ...nurses.map(n => Object.values(n.timeline).filter(t => t.is_night).length)
  ].join(';');
  const weekLine = ['WEEKEND', '', '',
    ...nurses.map(n => Object.values(n.timeline).filter(t => t.is_festive && !t.is_night).length)
  ].join(';');

  return [header, ...rows, '', totLine, nightLine, weekLine].join('\n');
}

/**
 * Esporta il report di equità in CSV.
 * Una riga per infermiere con tutte le statistiche.
 */
function equityToCSV(equityReport) {
  const header = [
    'Infermiere', 'Turni Tot.', 'Ore Tot.',
    'Notti', 'Weekend', 'Festivi', 'Straordinari',
    'Richieste Tot.', 'Approvate', 'Rifiutate', 'In Attesa',
    'Gg. Richiesti', 'Gg. Concessi',
    'Richieste Rifiutate dal Sistema',
  ].join(';');

  const rows = equityReport.by_nurse.map(l => [
    `"${l.nurse_name}"`,
    l.total_shifts,
    l.total_hours,
    l.nights,
    l.weekend_shifts,
    l.festive_shifts,
    l.overtime_shifts,
    l.requests_total,
    l.requests_approved,
    l.requests_rejected,
    l.requests_pending,
    l.days_off_requested,
    l.days_off_granted,
    l.requests_refused_by_system.length,
  ].join(';'));

  const sep = ['─'.repeat(20)].join('');
  const metLines = [
    '',
    `METRICHE DI EQUITÀ;;${equityReport.year}/${String(equityReport.month).padStart(2,'0')}`,
    `Equity Score;;${equityReport.metrics.equity_score}/100`,
    `Gini Notti;;${equityReport.metrics.nights.gini}`,
    `Δ Notti (max-min);;${equityReport.metrics.nights.gap}`,
    `Gini Weekend;;${equityReport.metrics.weekends.gini}`,
    `Δ Weekend (max-min);;${equityReport.metrics.weekends.gap}`,
    `Media ore/infermiere;;${equityReport.metrics.hours.mean}`,
  ];

  return [header, ...rows, ...metLines].join('\n');
}

/**
 * Esporta il calendario in formato JSON compatto (per API).
 */
function calendarToJSON(calendarReport) {
  return JSON.stringify(calendarReport, null, 2);
}

/**
 * Formato tabellare leggibile per stampa/log — utile in testing.
 */
function calendarToTable(calendarReport) {
  const { by_date, by_nurse, summary } = calendarReport;
  const nurses = Object.values(by_nurse).sort((a, b) =>
    a.nurse_name.localeCompare(b.nurse_name)
  );

  const COL = 6;
  const nameHeaders = nurses.map(n => n.nurse_name.split(' ')[0].padEnd(COL));
  const header = `${'Data'.padEnd(12)} ${'Gio'.padEnd(4)} ${'Fest'.padEnd(5)} ${nameHeaders.join(' ')}`;
  const sep = '─'.repeat(header.length);

  const rows = Object.entries(by_date)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ds, day]) => {
      const cols = nurses.map(n => {
        const t = n.timeline[ds];
        if (!t || t.shift_code === 'R') return '─'.padEnd(COL);
        const code = t.is_overtime ? `${t.shift_code}*` : t.shift_code;
        return code.padEnd(COL);
      });
      const fest = day.is_festive ? (day.is_holiday ? '🎉' : '📅') : '  ';
      return `${ds.padEnd(12)} ${day.day_name.padEnd(4)} ${fest.padEnd(5)} ${cols.join(' ')}`;
    });

  return [sep, header, sep, ...rows, sep].join('\n');
}

module.exports = {
  buildCalendarReport,
  buildEquityReport,
  calendarToCSV,
  equityToCSV,
  calendarToJSON,
  calendarToTable,
};
