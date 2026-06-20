const express = require('express');
const db = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  buildCalendarReport,
  buildEquityReport,
  calendarToCSV,
  equityToCSV,
  calendarToJSON,
} = require('../reporter');

const router = express.Router();

// Helper: carica assegnazioni arricchite per anno/mese
async function loadAssignments(year, month) {
  const start = `${year}-${String(month).padStart(2,'0')}-01`;
  const days  = new Date(year, month, 0).getDate();
  const end   = `${year}-${String(month).padStart(2,'0')}-${String(days).padStart(2,'0')}`;

  return db.all(`
    SELECT
      sa.user_id,
      sa.work_date,
      sa.is_overtime,
      sa.duration_hours,
      st.code        AS shift_code,
      st.name        AS shift_name,
      st.color,
      st.category = 'notte' AS is_night,
      st.start_time,
      st.end_time
    FROM schedule_assignments sa
    JOIN shift_types st ON sa.shift_type_id = st.id
    WHERE sa.work_date BETWEEN ? AND ?
    ORDER BY sa.work_date, sa.user_id
  `, [start, end]);
}

// Helper: carica staff attivo
async function loadStaff() {
  return db.all(`
    SELECT u.id, u.first_name, u.last_name, r.name AS role
    FROM users u
    JOIN roles r ON u.role_id = r.id
    WHERE u.is_active = 1
    ORDER BY u.last_name, u.first_name
  `);
}

// Helper: carica richieste del mese
async function loadRequests(year, month) {
  const start = `${year}-${String(month).padStart(2,'0')}-01`;
  const days  = new Date(year, month, 0).getDate();
  const end   = `${year}-${String(month).padStart(2,'0')}-${String(days).padStart(2,'0')}`;

  return db.all(`
    SELECT
      r.id, r.user_id, r.notes, r.start_date, r.end_date,
      rt.code AS request_type_code,
      rs.code AS status_code
    FROM requests r
    JOIN request_types rt    ON r.request_type_id = rt.id
    JOIN request_statuses rs ON r.status_id = rs.id
    WHERE r.end_date >= ? AND r.start_date <= ?
    ORDER BY r.start_date, r.user_id
  `, [start, end]);
}

// ─────────────────────────────────────────────────────────────────
/**
 * GET /api/reports/calendar?year=2026&month=7&format=json
 *
 * Esporta il calendario mensile.
 * format: json (default) | csv
 * Se format=csv risponde con Content-Type text/csv per il download.
 */
router.get('/calendar', authenticate, async (req, res) => {
  try {
    const year   = parseInt(req.query.year  || new Date().getFullYear());
    const month  = parseInt(req.query.month || new Date().getMonth() + 1);
    const format = (req.query.format || 'json').toLowerCase();

    const [rawAssignments, staff] = await Promise.all([
      loadAssignments(year, month),
      loadStaff(),
    ]);

    // Normalizza booleani SQLite (0/1 → false/true)
    const assignments = rawAssignments.map(a => ({
      ...a,
      is_night:    Boolean(a.is_night),
      is_overtime: Boolean(a.is_overtime),
      duration_hours: a.duration_hours ?? 8,
    }));

    const report = buildCalendarReport(assignments, staff, year, month);

    if (format === 'csv') {
      const csv = calendarToCSV(report);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition',
        `attachment; filename="calendario_${year}_${String(month).padStart(2,'0')}.csv"`);
      return res.send('\uFEFF' + csv); // BOM per Excel
    }

    res.json(report);
  } catch (err) {
    console.error('[reports/calendar]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
/**
 * GET /api/reports/equity?year=2026&month=7&format=json
 *
 * Report di equità: notti, festivi, ore, richieste rifiutate per infermiere.
 * format: json (default) | csv
 */
router.get('/equity', authenticate, async (req, res) => {
  try {
    const year   = parseInt(req.query.year  || new Date().getFullYear());
    const month  = parseInt(req.query.month || new Date().getMonth() + 1);
    const format = (req.query.format || 'json').toLowerCase();

    const [rawAssignments, staff, requests] = await Promise.all([
      loadAssignments(year, month),
      loadStaff(),
      loadRequests(year, month),
    ]);

    const assignments = rawAssignments.map(a => ({
      ...a,
      is_night:    Boolean(a.is_night),
      is_overtime: Boolean(a.is_overtime),
      duration_hours: a.duration_hours ?? 8,
    }));

    const report = buildEquityReport(assignments, requests, staff, year, month);

    if (format === 'csv') {
      const csv = equityToCSV(report);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition',
        `attachment; filename="equita_${year}_${String(month).padStart(2,'0')}.csv"`);
      return res.send('\uFEFF' + csv);
    }

    res.json(report);
  } catch (err) {
    console.error('[reports/equity]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
/**
 * GET /api/reports/nurse/:nurseId?year=2026&month=7
 *
 * Report personale per singolo infermiere:
 * turni del mese + richieste + statistiche individuali.
 */
router.get('/nurse/:nurseId', authenticate, async (req, res) => {
  try {
    const nurseId = parseInt(req.params.nurseId);
    const year    = parseInt(req.query.year  || new Date().getFullYear());
    const month   = parseInt(req.query.month || new Date().getMonth() + 1);

    // Accesso: staff può vedere solo se stessa
    if (req.user.role === 'staff' && req.user.id !== nurseId) {
      return res.status(403).json({ error: 'Accesso negato' });
    }

    const start = `${year}-${String(month).padStart(2,'0')}-01`;
    const days  = new Date(year, month, 0).getDate();
    const end   = `${year}-${String(month).padStart(2,'0')}-${String(days).padStart(2,'0')}`;

    const [nurse, rawAssignments, requests] = await Promise.all([
      db.get(`SELECT id, first_name, last_name, email FROM users WHERE id = ?`, [nurseId]),
      db.all(`
        SELECT sa.work_date, sa.is_overtime, sa.duration_hours,
               st.code AS shift_code, st.name AS shift_name, st.color,
               st.start_time, st.end_time, st.category = 'notte' AS is_night
        FROM schedule_assignments sa
        JOIN shift_types st ON sa.shift_type_id = st.id
        WHERE sa.user_id = ? AND sa.work_date BETWEEN ? AND ?
        ORDER BY sa.work_date
      `, [nurseId, start, end]),
      db.all(`
        SELECT r.id, r.start_date, r.end_date, r.notes,
               rt.code AS request_type_code, rs.code AS status_code
        FROM requests r
        JOIN request_types rt    ON r.request_type_id = rt.id
        JOIN request_statuses rs ON r.status_id = rs.id
        WHERE r.user_id = ? AND r.end_date >= ? AND r.start_date <= ?
      `, [nurseId, start, end]),
    ]);

    if (!nurse) return res.status(404).json({ error: 'Infermiere non trovato' });

    const assignments = rawAssignments.map(a => ({
      ...a,
      is_night:    Boolean(a.is_night),
      is_overtime: Boolean(a.is_overtime),
      duration_hours: a.duration_hours ?? 8,
    }));

    const stats = {
      total_shifts:    assignments.length,
      total_hours:     assignments.reduce((s, a) => s + a.duration_hours, 0),
      nights:          assignments.filter(a => a.is_night).length,
      weekends:        assignments.filter(a => {
        const d = new Date(`${a.work_date}T00:00:00Z`).getUTCDay();
        return d === 0 || d === 6;
      }).length,
      overtime:        assignments.filter(a => a.is_overtime).length,
      by_shift:        assignments.reduce((acc, a) => {
        acc[a.shift_code] = (acc[a.shift_code] || 0) + 1;
        return acc;
      }, {}),
    };

    res.json({
      nurse,
      year, month,
      stats,
      assignments,
      requests: requests.map(r => ({
        ...r,
        is_approved: r.status_code === 'approved',
        is_rejected: r.status_code === 'rejected',
        is_pending:  r.status_code === 'pending',
      })),
    });
  } catch (err) {
    console.error('[reports/nurse]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
/**
 * GET /api/reports/export?year=2026&month=7&type=full
 *
 * Esporta tutto in un unico JSON: calendario + equity + richieste.
 * Utile per archiviazione o invio e-mail.
 * type: full (default) | calendar | equity
 */
router.get('/export', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const year  = parseInt(req.query.year  || new Date().getFullYear());
    const month = parseInt(req.query.month || new Date().getMonth() + 1);
    const type  = (req.query.type || 'full').toLowerCase();

    const [rawAssignments, staff, requests] = await Promise.all([
      loadAssignments(year, month),
      loadStaff(),
      loadRequests(year, month),
    ]);

    const assignments = rawAssignments.map(a => ({
      ...a,
      is_night:    Boolean(a.is_night),
      is_overtime: Boolean(a.is_overtime),
      duration_hours: a.duration_hours ?? 8,
    }));

    const result = {
      exported_at: new Date().toISOString(),
      year, month,
    };

    if (type === 'calendar' || type === 'full') {
      result.calendar = buildCalendarReport(assignments, staff, year, month);
    }
    if (type === 'equity' || type === 'full') {
      result.equity = buildEquityReport(assignments, requests, staff, year, month);
    }
    if (type === 'full') {
      result.requests = requests;
    }

    res.setHeader('Content-Disposition',
      `attachment; filename="report_${year}_${String(month).padStart(2,'0')}.json"`);
    res.json(result);
  } catch (err) {
    console.error('[reports/export]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
