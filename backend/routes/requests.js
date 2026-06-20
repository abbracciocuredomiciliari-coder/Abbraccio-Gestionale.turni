const express = require('express');
const db = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { buildPreferencePenalties, reportViolations } = require('../preferences');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    let query;
    let params = [];

    if (req.user.role === 'staff') {
      query = `
        SELECT r.id, r.start_date, r.end_date, r.notes, r.created_at, r.approved_at,
               rt.name AS request_type, rs.name AS status,
               approver.first_name || ' ' || approver.last_name AS approver_name
        FROM requests r
        JOIN request_types rt ON r.request_type_id = rt.id
        JOIN request_statuses rs ON r.status_id = rs.id
        LEFT JOIN users approver ON r.approved_by = approver.id
        WHERE r.user_id = $1
        ORDER BY r.created_at DESC`;
      params = [req.user.id];
    } else {
      query = `
        SELECT r.id, r.start_date, r.end_date, r.notes, r.created_at, r.approved_at,
               rt.name AS request_type, rs.name AS status,
               u.first_name || ' ' || u.last_name AS requester,
               approver.first_name || ' ' || approver.last_name AS approver_name
        FROM requests r
        JOIN request_types rt ON r.request_type_id = rt.id
        JOIN request_statuses rs ON r.status_id = rs.id
        JOIN users u ON r.user_id = u.id
        LEFT JOIN users approver ON r.approved_by = approver.id
        ORDER BY r.created_at DESC`;
    }

    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const { request_type_id, start_date, end_date, shift_type_id, notes } = req.body;

    const statusRow = await db.get('SELECT id FROM request_statuses WHERE code = ?', ['pending']);
    const statusId = statusRow.id;

    const insert = await db.run(
      `INSERT INTO requests (user_id, request_type_id, status_id, start_date, end_date, shift_type_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, request_type_id, statusId, start_date, end_date || start_date, shift_type_id, notes]
    );

    const newRequest = await db.get(
      `SELECT id, user_id, request_type_id, status_id, start_date, end_date, notes FROM requests WHERE id = ?`,
      [insert.id]
    );

    res.status(201).json(newRequest);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

router.post('/:id/approve', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const requestId = req.params.id;

    const update = await db.run(
      `UPDATE requests
       SET status_id = (SELECT id FROM request_statuses WHERE code = 'approved'),
           approved_by = ?,
           approved_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [req.user.id, requestId]
    );

    if (update.changes === 0) {
      return res.status(404).json({ error: 'Richiesta non trovata' });
    }

    const updated = await db.get(
      `SELECT id, status_id, approved_by, approved_at FROM requests WHERE id = ?`,
      [requestId]
    );

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

router.post('/:id/reject', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const requestId = req.params.id;

    const update = await db.run(
      `UPDATE requests
       SET status_id = (SELECT id FROM request_statuses WHERE code = 'rejected'),
           approved_by = ?,
           approved_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [req.user.id, requestId]
    );

    if (update.changes === 0) {
      return res.status(404).json({ error: 'Richiesta non trovata' });
    }

    const updated = await db.get(
      `SELECT id, status_id, approved_by, approved_at FROM requests WHERE id = ?`,
      [requestId]
    );

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

/**
 * GET /api/requests/pending-for-schedule?year=2026&month=7
 *
 * Restituisce tutte le richieste rilevanti per la pianificazione del mese,
 * già normalizzate come PreferencePenaltyMap (usato dal scheduler).
 * Solo coordinatori.
 */
router.get('/pending-for-schedule', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const year  = parseInt(req.query.year  || new Date().getFullYear());
    const month = parseInt(req.query.month || new Date().getMonth() + 1);
    const daysInMonth = new Date(year, month, 0).getDate();

    const startOfMonth = `${year}-${String(month).padStart(2,'0')}-01`;
    const endOfMonth   = `${year}-${String(month).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;

    const rows = await db.all(`
      SELECT r.id, r.user_id,
             rt.code AS request_type_code,
             rs.code AS status_code,
             r.start_date, r.end_date,
             r.shift_type_id, r.notes,
             u.first_name || ' ' || u.last_name AS nurse_name
      FROM requests r
      JOIN request_types rt    ON r.request_type_id = rt.id
      JOIN request_statuses rs ON r.status_id        = rs.id
      JOIN users u             ON r.user_id           = u.id
      WHERE r.end_date   >= ?
        AND r.start_date <= ?
        AND rs.code NOT IN ('rejected', 'cancelled')
      ORDER BY r.start_date
    `, [startOfMonth, endOfMonth]);

    const prefMap = buildPreferencePenalties(rows, year, month, daysInMonth);

    res.json({
      year, month, daysInMonth,
      requests: rows,
      preference_map: {
        hard_blocks_count:  prefMap.hard_blocks.size,
        soft_penalties_count: prefMap.day_penalties.size,
        preferred_shifts_count: prefMap.preferred_shifts.size,
        summary: prefMap.summary,
        hard_blocks: [...prefMap.hard_blocks],
        day_penalties: Object.fromEntries(prefMap.day_penalties),
      },
    });
  } catch (err) {
    console.error('[requests/pending-for-schedule]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/requests/stats?year=2026&month=7
 *
 * Statistiche richieste per il mese: quante approvate, pendenti, per tipo.
 */
router.get('/stats', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const year  = parseInt(req.query.year  || new Date().getFullYear());
    const month = parseInt(req.query.month || new Date().getMonth() + 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startOfMonth = `${year}-${String(month).padStart(2,'0')}-01`;
    const endOfMonth   = `${year}-${String(month).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;

    const rows = await db.all(`
      SELECT rt.code AS type, rs.code AS status, COUNT(*) AS cnt,
             u.first_name || ' ' || u.last_name AS nurse_name, r.user_id
      FROM requests r
      JOIN request_types rt    ON r.request_type_id = rt.id
      JOIN request_statuses rs ON r.status_id        = rs.id
      JOIN users u             ON r.user_id           = u.id
      WHERE r.end_date >= ? AND r.start_date <= ?
      GROUP BY rt.code, rs.code, r.user_id
    `, [startOfMonth, endOfMonth]);

    res.json({ year, month, stats: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/requests/check-violations
 *
 * Dato un planning (lista assegnazioni), verifica quante preferenze vengono violate.
 * Body: { assignments: [{nurse_id, day_index, shift_type_id, work_date, shift_code}],
 *         year, month }
 */
router.post('/check-violations', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { assignments, year, month } = req.body;
    if (!Array.isArray(assignments)) return res.status(400).json({ error: 'assignments[] richiesto' });

    const y = year  || new Date().getFullYear();
    const m = month || new Date().getMonth() + 1;
    const daysInMonth = new Date(y, m, 0).getDate();
    const startOfMonth = `${y}-${String(m).padStart(2,'0')}-01`;
    const endOfMonth   = `${y}-${String(m).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;

    const rows = await db.all(`
      SELECT r.id, r.user_id, rt.code AS request_type_code,
             rs.code AS status_code, r.start_date, r.end_date, r.shift_type_id
      FROM requests r
      JOIN request_types rt    ON r.request_type_id = rt.id
      JOIN request_statuses rs ON r.status_id = rs.id
      WHERE r.end_date >= ? AND r.start_date <= ? AND rs.code != 'rejected'
    `, [startOfMonth, endOfMonth]);

    const prefMap = buildPreferencePenalties(rows, y, m, daysInMonth);
    const report  = reportViolations(prefMap, assignments);

    res.json({ year: y, month: m, ...report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
