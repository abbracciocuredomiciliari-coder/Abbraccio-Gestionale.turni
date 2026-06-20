const express = require('express');
const db = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * Costruisce la query di punteggio cumulativo.
 * 
 * Formula per ogni assegnazione:
 *   score += duration_hours * effective_weight
 *
 * effective_weight = MAX tra:
 *   - peso del tipo turno (night=1.5, long=1.1, normal=1.0)
 *   - peso weekend (1.2) se la data cade di sabato/domenica
 *   - peso overtime (2.0) se is_overtime=1
 *
 * Il MAX garantisce che una notte di domenica valga 1.5 (notte) e non 1.2+1.5.
 * Invece uno straordinario vale sempre 2.0 indipendentemente dal tipo.
 */
function buildScoreQuery(windowMonths) {
  return `
    SELECT
      u.id,
      u.first_name,
      u.last_name,
      COALESCE(SUM(
        COALESCE(sa.duration_hours, st.duration_hours, 8) *
        CASE
          WHEN sa.is_overtime = 1
            THEN (SELECT weight_value FROM shift_weights WHERE weight_key = 'overtime')
          ELSE MAX(
            CASE
              WHEN st.weight_key = 'night'
                THEN (SELECT weight_value FROM shift_weights WHERE weight_key = 'night')
              WHEN st.duration_hours >= 12
                THEN (SELECT weight_value FROM shift_weights WHERE weight_key = 'long_shift')
              ELSE
                (SELECT weight_value FROM shift_weights WHERE weight_key = 'normal')
            END,
            CASE
              WHEN strftime('%w', sa.work_date) IN ('0', '6')
                THEN (SELECT weight_value FROM shift_weights WHERE weight_key = 'weekend')
              ELSE 0
            END
          )
        END
      ), 0) AS cumulative_score,

      COUNT(sa.id) AS total_shifts,

      COALESCE(SUM(CASE WHEN st.weight_key = 'night' THEN 1 ELSE 0 END), 0) AS night_count,
      COALESCE(SUM(CASE WHEN strftime('%w', sa.work_date) IN ('0','6') THEN 1 ELSE 0 END), 0) AS weekend_count,
      COALESCE(SUM(CASE WHEN sa.is_overtime = 1 THEN 1 ELSE 0 END), 0) AS overtime_count,
      COALESCE(SUM(COALESCE(sa.duration_hours, st.duration_hours, 8)), 0) AS total_hours

    FROM users u
    JOIN roles r ON u.role_id = r.id
    LEFT JOIN schedule_assignments sa
      ON sa.user_id = u.id
      AND sa.work_date >= date('now', '-' || ${windowMonths} || ' months')
    LEFT JOIN shift_types st ON sa.shift_type_id = st.id
    WHERE r.name = 'staff' AND u.is_active = 1
    GROUP BY u.id
    ORDER BY cumulative_score ASC
  `;
}

// ── GET /api/balance ── Classifica punteggio cumulativo
router.get('/', authenticate, async (req, res) => {
  try {
    // Legge finestra configurabile
    const windowRow = await db.get(
      `SELECT weight_value FROM shift_weights WHERE weight_key = 'window_months'`
    );
    const windowMonths = windowRow?.weight_value || 3;

    const rows = await db.all(buildScoreQuery(windowMonths));

    // Rank: chi ha score più basso = priorità 1 per turni gravosi
    const ranked = rows.map((r, i) => ({
      ...r,
      rank: i + 1,
      cumulative_score: Math.round(r.cumulative_score * 100) / 100
    }));

    res.json({ window_months: windowMonths, staff: ranked });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

// ── GET /api/balance/weights ── Legge i pesi configurati
router.get('/weights', authenticate, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT sw.id, sw.weight_key, sw.weight_value, sw.description,
              u.first_name, u.last_name, sw.updated_at
       FROM shift_weights sw
       LEFT JOIN users u ON sw.updated_by = u.id
       ORDER BY sw.id`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Errore server' });
  }
});

// ── PUT /api/balance/weights/:key ── Aggiorna un peso (coordinatore)
router.put('/weights/:key', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { weight_value } = req.body;
    if (weight_value === undefined) return res.status(400).json({ error: 'weight_value obbligatorio' });
    const r = await db.run(
      `UPDATE shift_weights SET weight_value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE weight_key = ?`,
      [weight_value, req.user.id, req.params.key]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'Peso non trovato' });
    const updated = await db.get(`SELECT * FROM shift_weights WHERE weight_key = ?`, [req.params.key]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Errore server' });
  }
});

// ── GET /api/balance/detail/:userId ── Dettaglio breakdown per un infermiere
router.get('/detail/:userId', authenticate, async (req, res) => {
  try {
    const isCoord = req.user.role === 'coordinator' || req.user.role === 'admin';
    const targetId = isCoord ? Number(req.params.userId) : req.user.id;

    const windowRow = await db.get(`SELECT weight_value FROM shift_weights WHERE weight_key = 'window_months'`);
    const windowMonths = windowRow?.weight_value || 3;

    const detail = await db.all(`
      SELECT
        sa.work_date,
        st.code AS shift_code,
        st.name AS shift_name,
        st.color,
        st.weight_key,
        sa.is_overtime,
        COALESCE(sa.duration_hours, st.duration_hours, 8) AS hours,
        ROUND(
          COALESCE(sa.duration_hours, st.duration_hours, 8) *
          CASE
            WHEN sa.is_overtime = 1
              THEN (SELECT weight_value FROM shift_weights WHERE weight_key = 'overtime')
            ELSE MAX(
              CASE
                WHEN st.weight_key = 'night'
                  THEN (SELECT weight_value FROM shift_weights WHERE weight_key = 'night')
                WHEN st.duration_hours >= 12
                  THEN (SELECT weight_value FROM shift_weights WHERE weight_key = 'long_shift')
                ELSE (SELECT weight_value FROM shift_weights WHERE weight_key = 'normal')
              END,
              CASE
                WHEN strftime('%w', sa.work_date) IN ('0','6')
                  THEN (SELECT weight_value FROM shift_weights WHERE weight_key = 'weekend')
                ELSE 0
              END
            )
          END
        , 3) AS score_contribution
      FROM schedule_assignments sa
      JOIN shift_types st ON sa.shift_type_id = st.id
      WHERE sa.user_id = ?
        AND sa.work_date >= date('now', '-' || ? || ' months')
      ORDER BY sa.work_date DESC
      LIMIT 100
    `, [targetId, windowMonths]);

    res.json({ window_months: windowMonths, entries: detail });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

module.exports = router;
