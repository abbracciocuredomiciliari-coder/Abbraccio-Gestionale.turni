const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const {
  computeLoads,
  computeEquityMetrics,
  rankByPriority,
  generateRecommendations,
  simulateAssignment,
} = require('../equity');

const router = express.Router();

/**
 * GET /api/equity/report?months=3
 *
 * Report completo di equità: carichi storici, metriche, ranking, raccomandazioni.
 */
router.get('/report', authenticate, async (req, res) => {
  try {
    const months = parseInt(req.query.months || '3', 10);
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const assignments = await db.all(`
      SELECT
        sa.user_id        AS nurse_id,
        u.first_name || ' ' || u.last_name AS nurse_name,
        sa.work_date,
        st.code           AS shift_code,
        sa.duration_hours,
        sa.score_weight,
        st.category = 'notte' AS is_night,
        sa.is_overtime,
        sa.work_date >= ? AS in_window
      FROM schedule_assignments sa
      JOIN users u       ON sa.user_id       = u.id
      JOIN shift_types st ON sa.shift_type_id = st.id
      WHERE sa.work_date >= ?
        AND u.is_active = 1
        AND u.role_id = (SELECT id FROM roles WHERE name = 'staff' LIMIT 1)
      ORDER BY sa.work_date, sa.user_id
    `, [cutoffStr, cutoffStr]);

    // Carica pesi dal DB
    let weights = {};
    try {
      const wRows = await db.all(`SELECT weight_key, weight_value FROM shift_weights`);
      weights = Object.fromEntries(wRows.map(r => [r.weight_key, r.weight_value]));
    } catch {}

    const mapped = assignments.map(a => ({
      ...a,
      is_night:    Boolean(a.is_night),
      is_overtime: Boolean(a.is_overtime),
    }));

    const loads   = computeLoads(mapped, weights, months);
    const metrics = computeEquityMetrics(loads);
    const rankN   = rankByPriority(loads, 'night');
    const rankW   = rankByPriority(loads, 'weekend');
    const rankAll = rankByPriority(loads, 'normal');
    const recs    = generateRecommendations(loads, metrics);

    res.json({
      window_months: months,
      cutoff_date:   cutoffStr,
      nurses_count:  loads.size,
      equity_score:  metrics?.equity_score,
      metrics,
      ranking: {
        by_composite:  rankAll,
        priority_nights:  rankN,
        priority_weekends: rankW,
      },
      recommendations: recs,
    });
  } catch (err) {
    console.error('[equity/report]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/equity/ranking/:shiftCategory
 * shiftCategory: night | weekend | normal | overtime
 *
 * Chi assegnare prioritariamente al prossimo turno di tipo X
 */
router.get('/ranking/:shiftCategory', authenticate, async (req, res) => {
  try {
    const { shiftCategory } = req.params;
    const months = parseInt(req.query.months || '3', 10);
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);

    const assignments = await db.all(`
      SELECT sa.user_id AS nurse_id,
             u.first_name || ' ' || u.last_name AS nurse_name,
             sa.work_date, st.code AS shift_code,
             sa.duration_hours, sa.score_weight,
             st.category = 'notte' AS is_night,
             sa.is_overtime
      FROM schedule_assignments sa
      JOIN users u        ON sa.user_id       = u.id
      JOIN shift_types st ON sa.shift_type_id = st.id
      WHERE sa.work_date >= ?
        AND u.is_active = 1
      ORDER BY sa.work_date
    `, [cutoff.toISOString().slice(0, 10)]);

    let weights = {};
    try {
      const wRows = await db.all(`SELECT weight_key, weight_value FROM shift_weights`);
      weights = Object.fromEntries(wRows.map(r => [r.weight_key, r.weight_value]));
    } catch {}

    const loads  = computeLoads(assignments.map(a => ({ ...a, is_night: Boolean(a.is_night), is_overtime: Boolean(a.is_overtime) })), weights, months);
    const ranked = rankByPriority(loads, shiftCategory);

    res.json({ shift_category: shiftCategory, ranking: ranked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/equity/simulate
 *
 * Simula l'impatto di un'assegnazione sulla varianza del team.
 * Body: { nurse_ids: [1,2,3], shift: { duration_hours, is_night, is_weekend, weight } }
 */
router.post('/simulate', authenticate, async (req, res) => {
  try {
    const { nurse_ids, shift, months = 3 } = req.body;
    if (!Array.isArray(nurse_ids) || !shift) {
      return res.status(400).json({ error: 'nurse_ids (array) e shift (object) richiesti' });
    }

    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);

    const assignments = await db.all(`
      SELECT sa.user_id AS nurse_id,
             u.first_name || ' ' || u.last_name AS nurse_name,
             sa.work_date, st.code AS shift_code,
             sa.duration_hours, sa.score_weight,
             st.category = 'notte' AS is_night, sa.is_overtime
      FROM schedule_assignments sa
      JOIN users u        ON sa.user_id = u.id
      JOIN shift_types st ON sa.shift_type_id = st.id
      WHERE sa.work_date >= ? AND u.is_active = 1
    `, [cutoff.toISOString().slice(0, 10)]);

    let weights = {};
    try {
      const wRows = await db.all(`SELECT weight_key, weight_value FROM shift_weights`);
      weights = Object.fromEntries(wRows.map(r => [r.weight_key, r.weight_value]));
    } catch {}

    const loads = computeLoads(assignments.map(a => ({ ...a, is_night: Boolean(a.is_night), is_overtime: Boolean(a.is_overtime) })), weights, months);

    // Simula ogni candidato e ordina per delta_variance minore
    const simulations = nurse_ids
      .map(id => simulateAssignment(loads, id, shift))
      .sort((a, b) => a.delta_variance - b.delta_variance);

    res.json({
      recommendation: simulations[0]?.nurse_id,
      reason: 'Minimizza la varianza del carico tra gli infermieri',
      simulations,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
