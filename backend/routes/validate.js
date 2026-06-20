const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { validateSchedule } = require('../constraints');

const router = express.Router();

/**
 * POST /api/validate
 *
 * Valida una lista di turni contro i vincoli hard/soft del sistema.
 * Carica le regole configurate dal DB (work_rules) e le applica.
 *
 * Body:
 *   { assignments: [ { nurse_id, nurse_name, work_date, shift_code,
 *                       start_time, end_time, duration_hours, is_night } ] }
 *
 * Response:
 *   { valid, status, violations, summary }
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { assignments } = req.body;
    if (!Array.isArray(assignments)) {
      return res.status(400).json({ error: '"assignments" deve essere un array' });
    }

    // Carica regole dal DB
    let rules = {};
    try {
      const rows = await db.all(`SELECT rule_key, rule_value FROM work_rules`);
      rules = Object.fromEntries(rows.map(r => [r.rule_key, r.rule_value]));
    } catch { /* usa default CCNL se tabella non esiste */ }

    const result = validateSchedule(assignments, rules);
    res.json(result);
  } catch (err) {
    console.error('[validate]', err);
    res.status(500).json({ error: 'Errore validazione: ' + err.message });
  }
});

/**
 * POST /api/validate/schedule/:scheduleId
 *
 * Valida un planning già salvato nel DB caricando automaticamente le assegnazioni.
 */
router.post('/schedule/:scheduleId', authenticate, async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT
        sa.user_id        AS nurse_id,
        u.first_name || ' ' || u.last_name AS nurse_name,
        sa.work_date,
        st.code           AS shift_code,
        st.start_time,
        st.end_time,
        sa.duration_hours,
        st.category = 'notte' AS is_night,
        sa.is_overtime
      FROM schedule_assignments sa
      JOIN users u       ON sa.user_id       = u.id
      JOIN shift_types st ON sa.shift_type_id = st.id
      WHERE sa.schedule_id = ?
      ORDER BY sa.work_date, sa.user_id
    `, [req.params.scheduleId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Planning non trovato o senza assegnazioni' });
    }

    const assignments = rows.map(r => ({
      ...r,
      is_night:    Boolean(r.is_night),
      is_overtime: Boolean(r.is_overtime),
    }));

    let rules = {};
    try {
      const ruleRows = await db.all(`SELECT rule_key, rule_value FROM work_rules`);
      rules = Object.fromEntries(ruleRows.map(r => [r.rule_key, r.rule_value]));
    } catch {}

    const result = validateSchedule(assignments, rules);
    res.json({ schedule_id: req.params.scheduleId, ...result });
  } catch (err) {
    console.error('[validate/schedule]', err);
    res.status(500).json({ error: 'Errore: ' + err.message });
  }
});

module.exports = router;
