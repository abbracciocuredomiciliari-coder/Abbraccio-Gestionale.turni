const express = require('express');
const db = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/work-rules ── Legge tutte le regole
router.get('/', authenticate, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT wr.id, wr.rule_key, wr.rule_value, wr.description,
              u.first_name, u.last_name, wr.updated_at
       FROM work_rules wr
       LEFT JOIN users u ON wr.updated_by = u.id
       ORDER BY wr.id`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

// ── PUT /api/work-rules/:key ── Aggiorna una regola (coordinatore)
router.put('/:key', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { rule_value } = req.body;
    if (rule_value === undefined || rule_value === null) {
      return res.status(400).json({ error: 'rule_value obbligatorio' });
    }
    const r = await db.run(
      `UPDATE work_rules SET rule_value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE rule_key = ?`,
      [rule_value, req.user.id, req.params.key]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'Regola non trovata' });
    const updated = await db.get(`SELECT * FROM work_rules WHERE rule_key = ?`, [req.params.key]);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

module.exports = router;
