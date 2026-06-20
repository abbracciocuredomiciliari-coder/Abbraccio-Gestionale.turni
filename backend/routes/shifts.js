const express = require('express');
const db = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT id, code, name, start_time, end_time, duration_hours, required_staff,
              color, is_active, required_skills, min_skilled_staff
       FROM shift_types
       ORDER BY start_time`
    );
    // Parsa required_skills da JSON string
    rows.forEach(r => {
      r.required_skills = r.required_skills
        ? (typeof r.required_skills === 'string' ? JSON.parse(r.required_skills) : r.required_skills)
        : [];
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

router.put('/:id', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { required_staff, duration_hours, start_time, end_time,
            is_active, required_skills, min_skilled_staff } = req.body;

    // Normalizza required_skills: accetta array o stringa JSON
    let skillsJson = undefined;
    if (required_skills !== undefined) {
      const arr = Array.isArray(required_skills)
        ? required_skills
        : (typeof required_skills === 'string' && required_skills.startsWith('['))
          ? JSON.parse(required_skills)
          : [];
      const normalized = [...new Set(arr.map(t => String(t).trim().toUpperCase()))].filter(Boolean);
      skillsJson = normalized.length > 0 ? JSON.stringify(normalized) : null;
    }

    const update = await db.run(
      `UPDATE shift_types
       SET required_staff      = COALESCE(?, required_staff),
           duration_hours      = COALESCE(?, duration_hours),
           start_time          = COALESCE(?, start_time),
           end_time            = COALESCE(?, end_time),
           is_active           = COALESCE(?, is_active),
           required_skills     = CASE WHEN ? IS NOT NULL THEN ? ELSE required_skills END,
           min_skilled_staff   = COALESCE(?, min_skilled_staff)
       WHERE id = ?`,
      [required_staff, duration_hours, start_time, end_time, is_active,
       skillsJson, skillsJson,
       min_skilled_staff ?? null, req.params.id]
    );

    if (update.changes === 0) {
      return res.status(404).json({ error: 'Turno non trovato' });
    }

    const row = await db.get(
      `SELECT id, code, name, start_time, end_time, duration_hours, required_staff,
              color, is_active, required_skills, min_skilled_staff
       FROM shift_types WHERE id = ?`,
      [req.params.id]
    );
    row.required_skills = row.required_skills
      ? (typeof row.required_skills === 'string' ? JSON.parse(row.required_skills) : row.required_skills)
      : [];

    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

module.exports = router;
