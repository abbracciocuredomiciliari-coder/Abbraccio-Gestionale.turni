const express = require('express');
const db = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { buildAbsenceConstraints } = require('../absences');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

async function loadStaffWithExemptions() {
  return db.all(`
    SELECT id, first_name, last_name,
           night_exemption, exemption_scope,
           night_exemption_reason,
           night_exemption_from, night_exemption_until
    FROM users WHERE is_active = 1
  `);
}

// ─────────────────────────────────────────────────────────────────
/**
 * GET /api/absences
 * Lista assenze con filtri opzionali: user_id, type, year, month, status
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { user_id, type, year, month, status } = req.query;

    let where = [];
    const params = [];

    // Staff vede solo le proprie
    if (req.user.role === 'staff') {
      where.push('a.user_id = ?');
      params.push(req.user.id);
    } else if (user_id) {
      where.push('a.user_id = ?');
      params.push(user_id);
    }

    if (type)   { where.push('a.absence_type = ?'); params.push(type); }
    if (status) { where.push('a.status = ?');       params.push(status); }

    if (year && month) {
      const pad = n => String(n).padStart(2,'0');
      const d   = daysInMonth(parseInt(year), parseInt(month));
      const s   = `${year}-${pad(month)}-01`;
      const e   = `${year}-${pad(month)}-${pad(d)}`;
      where.push('a.start_date <= ? AND a.end_date >= ?');
      params.push(e, s);
    } else if (year) {
      where.push("strftime('%Y', a.start_date) = ?");
      params.push(String(year));
    }

    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const rows = await db.all(`
      SELECT a.*,
             u.first_name || ' ' || u.last_name AS nurse_name,
             ab.first_name || ' ' || ab.last_name AS approved_by_name
      FROM absences a
      JOIN users u ON a.user_id = u.id
      LEFT JOIN users ab ON a.approved_by = ab.id
      ${whereStr}
      ORDER BY a.start_date DESC, a.user_id
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('[absences GET /]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
/**
 * GET /api/absences/:id
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const row = await db.get(`
      SELECT a.*, u.first_name || ' ' || u.last_name AS nurse_name
      FROM absences a JOIN users u ON a.user_id = u.id
      WHERE a.id = ?
    `, [req.params.id]);

    if (!row) return res.status(404).json({ error: 'Assenza non trovata' });

    if (req.user.role === 'staff' && row.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Accesso negato' });
    }

    res.json(row);
  } catch (err) {
    console.error('[absences GET /:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
/**
 * POST /api/absences
 * Crea nuova assenza. Staff può creare per sé stesso, coordinator per tutti.
 *
 * Body: {
 *   user_id, absence_type, start_date, end_date,
 *   is_partial_day, partial_hours, partial_start, partial_end, partial_type,
 *   is_recurring, recurrence_rule, recurrence_end,
 *   notes
 * }
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      user_id, absence_type, start_date, end_date,
      is_partial_day = 0, partial_hours, partial_start, partial_end,
      partial_type = 'full',
      is_recurring = 0, recurrence_rule, recurrence_end,
      notes,
    } = req.body;

    if (!user_id || !absence_type || !start_date) {
      return res.status(400).json({ error: 'user_id, absence_type, start_date obbligatori' });
    }

    // Staff può creare solo per sé stesso
    if (req.user.role === 'staff' && parseInt(user_id) !== req.user.id) {
      return res.status(403).json({ error: 'Puoi inserire assenze solo per te stesso' });
    }

    const VALID_TYPES = ['ferie','permesso_104','maternita','congedo_straordinario',
                         'malattia','sciopero','formazione'];
    if (!VALID_TYPES.includes(absence_type)) {
      return res.status(400).json({ error: `Tipo assenza non valido: ${absence_type}` });
    }

    // Stato iniziale: coordinator approva subito, staff mette in pending
    const status = ['coordinator','admin'].includes(req.user.role) ? 'approved' : 'pending';
    const approved_by = status === 'approved' ? req.user.id : null;
    const approved_at = status === 'approved' ? new Date().toISOString() : null;

    const result = await db.run(`
      INSERT INTO absences
        (user_id, absence_type, start_date, end_date,
         is_partial_day, partial_hours, partial_start, partial_end, partial_type,
         is_recurring, recurrence_rule, recurrence_end,
         notes, status, approved_by, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      user_id, absence_type,
      start_date, end_date || start_date,
      is_partial_day ? 1 : 0,
      partial_hours || null, partial_start || null, partial_end || null,
      partial_type,
      is_recurring ? 1 : 0,
      recurrence_rule || null, recurrence_end || null,
      notes || null,
      status, approved_by, approved_at,
    ]);

    const created = await db.get('SELECT * FROM absences WHERE id = ?', [result.id]);
    res.status(201).json(created);
  } catch (err) {
    console.error('[absences POST /]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
/**
 * PATCH /api/absences/:id/approve
 * Approva un'assenza (solo coordinator/admin)
 */
router.patch('/:id/approve', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const u = await db.run(`
      UPDATE absences
      SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `, [req.user.id, req.params.id]);

    if (u.changes === 0) {
      return res.status(404).json({ error: 'Assenza non trovata o già processata' });
    }
    const row = await db.get('SELECT * FROM absences WHERE id = ?', [req.params.id]);
    res.json(row);
  } catch (err) {
    console.error('[absences PATCH /approve]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
/**
 * PATCH /api/absences/:id/reject
 */
router.patch('/:id/reject', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { notes } = req.body;
    const u = await db.run(`
      UPDATE absences
      SET status = 'rejected', notes = COALESCE(?, notes), updated_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `, [notes || null, req.params.id]);

    if (u.changes === 0) {
      return res.status(404).json({ error: 'Assenza non trovata o già processata' });
    }
    const row = await db.get('SELECT * FROM absences WHERE id = ?', [req.params.id]);
    res.json(row);
  } catch (err) {
    console.error('[absences PATCH /reject]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
/**
 * DELETE /api/absences/:id
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const row = await db.get('SELECT * FROM absences WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Assenza non trovata' });

    if (req.user.role === 'staff' && row.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Accesso negato' });
    }

    await db.run('DELETE FROM absences WHERE id = ?', [req.params.id]);
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    console.error('[absences DELETE /:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
/**
 * GET /api/absences/solver-map?year=2026&month=7
 *
 * Restituisce la AbsenceConstraintMap pronta per il solver.
 * Usato da scheduler.js prima di avviare il solve().
 */
router.get('/solver-map', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const year  = parseInt(req.query.year  || new Date().getFullYear());
    const month = parseInt(req.query.month || new Date().getMonth() + 1);
    const dim   = daysInMonth(year, month);
    const pad   = n => String(n).padStart(2,'0');
    const start = `${year}-${pad(month)}-01`;
    const end   = `${year}-${pad(month)}-${pad(dim)}`;

    const [absences, staff] = await Promise.all([
      db.all(`
        SELECT * FROM absences
        WHERE status = 'approved'
          AND start_date <= ? AND end_date >= ?
      `, [end, start]),
      loadStaffWithExemptions(),
    ]);

    const absMap = buildAbsenceConstraints(absences, staff, year, month, dim);

    // Serializza Sets e Maps per JSON
    res.json({
      year, month,
      full_day_blocks:      [...absMap.full_day_blocks],
      partial_day_blocks:   Object.fromEntries(absMap.partial_day_blocks),
      shift_category_blocks: Object.fromEntries(
        [...absMap.shift_category_blocks.entries()].map(([k, v]) => [
          k, { ...v, blocked_categories: [...v.blocked_categories] }
        ])
      ),
      summary: {
        ...absMap.summary,
        nurses_affected: absMap.summary.nurses_affected,
      },
    });
  } catch (err) {
    console.error('[absences GET /solver-map]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
/**
 * GET /api/absences/exemptions
 * Lista infermieri con esonero notturno attivo (o storico).
 */
router.get('/exemptions', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT id, first_name, last_name,
             night_exemption, exemption_scope,
             night_exemption_reason,
             night_exemption_from, night_exemption_until
      FROM users
      WHERE is_active = 1 AND night_exemption = 1
      ORDER BY last_name, first_name
    `);
    res.json(rows);
  } catch (err) {
    console.error('[absences GET /exemptions]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
/**
 * PATCH /api/absences/exemptions/:userId
 * Aggiorna il flag esonero notturno su un utente.
 *
 * Body: { night_exemption, exemption_scope, night_exemption_reason,
 *         night_exemption_from, night_exemption_until }
 */
router.patch('/exemptions/:userId', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const {
      night_exemption,
      exemption_scope = 'night',
      night_exemption_reason,
      night_exemption_from,
      night_exemption_until,
    } = req.body;

    const VALID_SCOPES = ['night','night_afternoon','night_overtime','all_festive'];
    if (!VALID_SCOPES.includes(exemption_scope)) {
      return res.status(400).json({ error: `exemption_scope non valido: ${exemption_scope}` });
    }

    await db.run(`
      UPDATE users SET
        night_exemption         = ?,
        exemption_scope         = ?,
        night_exemption_reason  = ?,
        night_exemption_from    = ?,
        night_exemption_until   = ?,
        updated_at              = datetime('now')
      WHERE id = ?
    `, [
      night_exemption ? 1 : 0,
      exemption_scope,
      night_exemption_reason || null,
      night_exemption_from   || null,
      night_exemption_until  || null,
      req.params.userId,
    ]);

    const updated = await db.get(
      'SELECT id, first_name, last_name, night_exemption, exemption_scope, night_exemption_reason, night_exemption_from, night_exemption_until FROM users WHERE id = ?',
      [req.params.userId]
    );

    if (!updated) return res.status(404).json({ error: 'Utente non trovato' });
    res.json(updated);
  } catch (err) {
    console.error('[absences PATCH /exemptions/:userId]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
