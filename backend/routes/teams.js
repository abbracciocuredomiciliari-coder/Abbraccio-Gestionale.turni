'use strict';
/**
 * routes/teams.js — Squadre, Membri, Rotazione Mensile, Capo-Turno Pending
 *
 * GET  /api/teams                            → lista squadre (filtrabile per shift_type_id)
 * POST /api/teams                            → crea squadra
 * PUT  /api/teams/:id                        → aggiorna squadra (nome, colore, rotation_order, is_active)
 * DELETE /api/teams/:id                      → disattiva squadra (soft delete)
 *
 * GET  /api/teams/:id/members                → composizione attuale + storico
 * POST /api/teams/:id/members                → aggiungi membro (con is_capo_turno)
 * PUT  /api/teams/:id/members/:memberId      → aggiorna membro (is_capo_turno, valid_until)
 * DELETE /api/teams/:id/members/:memberId    → chiudi membership (imposta valid_until = oggi)
 *
 * GET  /api/teams/rotations?year=&month=     → rotazioni del mese per tutti i turni
 * POST /api/teams/rotations                  → inserisce rotazione manuale (coordinatore)
 * DELETE /api/teams/rotations/:id            → rimuove override rotazione
 *
 * GET  /api/teams/capo-pending?schedule_id=  → flag capo-turno da nominare
 * POST /api/teams/capo-pending/:id/resolve   → coordinatore nomina sostituto
 * POST /api/teams/capo-pending/:id/waive     → coordinatore esenta il vincolo
 *
 * GET  /api/teams/shifts                     → shift_types con assignment_mode e min_capo_turno
 * PUT  /api/teams/shifts/:id                 → aggiorna assignment_mode e min_capo_turno
 *
 * GET  /api/teams/users/clinical-roles       → lista staff con clinical_role
 * PUT  /api/teams/users/:id/clinical-role    → aggiorna clinical_role (coordinatore)
 */

const express = require('express');
const db      = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// SHIFT TYPES — assignment_mode e min_capo_turno
// ═══════════════════════════════════════════════════════════════

router.get('/shifts', authenticate, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT id, code, name, duration_hours, required_staff,
              COALESCE(assignment_mode,'FREE') AS assignment_mode,
              COALESCE(min_capo_turno,0)       AS min_capo_turno,
              is_active
       FROM shift_types ORDER BY id`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/shifts/:id', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { assignment_mode, min_capo_turno } = req.body;
    const upd = await db.run(
      `UPDATE shift_types SET
         assignment_mode = COALESCE(?, assignment_mode),
         min_capo_turno  = COALESCE(?, min_capo_turno)
       WHERE id = ?`,
      [assignment_mode, min_capo_turno, req.params.id]
    );
    if (upd.changes === 0) return res.status(404).json({ error: 'Turno non trovato.' });
    const row = await db.get(
      `SELECT id, code, name, assignment_mode, min_capo_turno FROM shift_types WHERE id = ?`,
      [req.params.id]
    );
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// USERS — clinical_role
// ═══════════════════════════════════════════════════════════════

router.get('/users/clinical-roles', authenticate, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT u.id, u.first_name, u.last_name,
              COALESCE(u.clinical_role,'STAFF') AS clinical_role
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name = 'staff' AND u.is_active = 1
       ORDER BY u.last_name, u.first_name`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:id/clinical-role', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { clinical_role } = req.body;
    const allowed = ['STAFF','CAPO_TURNO','RESPONSABILE'];
    if (!allowed.includes(clinical_role))
      return res.status(400).json({ error: `clinical_role deve essere uno di: ${allowed.join(', ')}` });

    const upd = await db.run(
      `UPDATE users SET clinical_role = ? WHERE id = ?`,
      [clinical_role, req.params.id]
    );
    if (upd.changes === 0) return res.status(404).json({ error: 'Utente non trovato.' });
    res.json({ id: +req.params.id, clinical_role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// TEAMS — CRUD
// ═══════════════════════════════════════════════════════════════

router.get('/', authenticate, async (req, res) => {
  try {
    const { shift_type_id } = req.query;
    let where = '1=1';
    const params = [];
    if (shift_type_id) { where += ' AND t.shift_type_id = ?'; params.push(shift_type_id); }

    const rows = await db.all(
      `SELECT t.*,
              st.code AS shift_code, st.name AS shift_name,
              COALESCE(st.assignment_mode,'FREE') AS assignment_mode,
              (SELECT COUNT(*) FROM team_members tm
               WHERE tm.team_id = t.id
                 AND (tm.valid_until IS NULL OR tm.valid_until >= date('now'))) AS active_members
       FROM teams t
       JOIN shift_types st ON t.shift_type_id = st.id
       WHERE ${where}
       ORDER BY t.shift_type_id, t.rotation_order`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { shift_type_id, name, color, rotation_order = 1, notes } = req.body;
    if (!shift_type_id || !name)
      return res.status(400).json({ error: 'shift_type_id e name obbligatori.' });

    const ins = await db.run(
      `INSERT INTO teams (shift_type_id, name, color, rotation_order, notes, created_by)
       VALUES (?,?,?,?,?,?)`,
      [shift_type_id, name, color || '#607D8B', rotation_order, notes || null, req.user.id]
    );
    const row = await db.get(`SELECT * FROM teams WHERE id = ?`, [ins.id]);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { name, color, rotation_order, is_active, notes } = req.body;
    const upd = await db.run(
      `UPDATE teams SET
         name           = COALESCE(?, name),
         color          = COALESCE(?, color),
         rotation_order = COALESCE(?, rotation_order),
         is_active      = COALESCE(?, is_active),
         notes          = COALESCE(?, notes)
       WHERE id = ?`,
      [name, color, rotation_order, is_active, notes, req.params.id]
    );
    if (upd.changes === 0) return res.status(404).json({ error: 'Squadra non trovata.' });
    const row = await db.get(`SELECT * FROM teams WHERE id = ?`, [req.params.id]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const upd = await db.run(
      `UPDATE teams SET is_active = 0 WHERE id = ?`, [req.params.id]
    );
    if (upd.changes === 0) return res.status(404).json({ error: 'Squadra non trovata.' });
    res.json({ message: 'Squadra disattivata.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// TEAM MEMBERS
// ═══════════════════════════════════════════════════════════════

router.get('/:id/members', authenticate, async (req, res) => {
  try {
    const { history } = req.query;  // ?history=1 per vedere anche i membri scaduti
    let where = 'tm.team_id = ?';
    if (!history) where += " AND (tm.valid_until IS NULL OR tm.valid_until >= date('now'))";

    const rows = await db.all(
      `SELECT tm.*,
              u.first_name || ' ' || u.last_name AS nurse_name,
              COALESCE(u.clinical_role,'STAFF')   AS clinical_role
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE ${where}
       ORDER BY tm.is_capo_turno DESC, u.last_name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/members', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const teamId = req.params.id;
    const { user_id, is_capo_turno = 0, valid_from, notes } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id obbligatorio.' });

    const from = valid_from || new Date().toISOString().slice(0,10);

    // Se is_capo_turno=1, rimuove capo precedente nella stessa squadra
    if (is_capo_turno) {
      await db.run(
        `UPDATE team_members SET valid_until = date(?, '-1 day')
         WHERE team_id = ? AND is_capo_turno = 1
           AND (valid_until IS NULL OR valid_until >= ?)`,
        [from, teamId, from]
      );
    }

    // Chiude membership precedente dello stesso utente se esiste
    await db.run(
      `UPDATE team_members SET valid_until = date(?, '-1 day')
       WHERE team_id = ? AND user_id = ?
         AND (valid_until IS NULL OR valid_until >= ?)`,
      [from, teamId, user_id, from]
    );

    const ins = await db.run(
      `INSERT INTO team_members (team_id, user_id, is_capo_turno, valid_from, added_by, notes)
       VALUES (?,?,?,?,?,?)`,
      [teamId, user_id, is_capo_turno ? 1 : 0, from, req.user.id, notes || null]
    );
    const row = await db.get(
      `SELECT tm.*, u.first_name || ' ' || u.last_name AS nurse_name
       FROM team_members tm JOIN users u ON tm.user_id = u.id
       WHERE tm.id = ?`,
      [ins.id]
    );
    res.status(201).json(row);
  } catch (err) {
    if (err.message?.includes('UNIQUE'))
      return res.status(409).json({ error: 'Membro già presente in squadra per questa data.' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/members/:memberId', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { is_capo_turno, valid_until, notes } = req.body;
    const upd = await db.run(
      `UPDATE team_members SET
         is_capo_turno = COALESCE(?, is_capo_turno),
         valid_until   = COALESCE(?, valid_until),
         notes         = COALESCE(?, notes)
       WHERE id = ? AND team_id = ?`,
      [is_capo_turno !== undefined ? (is_capo_turno ? 1 : 0) : null,
       valid_until, notes, req.params.memberId, req.params.id]
    );
    if (upd.changes === 0) return res.status(404).json({ error: 'Membro non trovato.' });
    const row = await db.get(
      `SELECT tm.*, u.first_name || ' ' || u.last_name AS nurse_name
       FROM team_members tm JOIN users u ON tm.user_id = u.id WHERE tm.id = ?`,
      [req.params.memberId]
    );
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/members/:memberId', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0,10);
    const upd = await db.run(
      `UPDATE team_members SET valid_until = ? WHERE id = ? AND team_id = ?`,
      [today, req.params.memberId, req.params.id]
    );
    if (upd.changes === 0) return res.status(404).json({ error: 'Membro non trovato.' });
    res.json({ message: 'Membership chiusa da oggi.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ROTAZIONI MENSILI
// ═══════════════════════════════════════════════════════════════

router.get('/rotations', authenticate, async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month)
      return res.status(400).json({ error: 'year e month obbligatori.' });

    const rows = await db.all(
      `SELECT tmr.*, t.name AS team_name, t.rotation_order,
              t.shift_type_id, st.code AS shift_code, st.name AS shift_name,
              u.first_name || ' ' || u.last_name AS assigned_by_name
       FROM team_monthly_rotation tmr
       JOIN teams t       ON tmr.team_id     = t.id
       JOIN shift_types st ON t.shift_type_id = st.id
       LEFT JOIN users u  ON tmr.assigned_by  = u.id
       WHERE tmr.year = ? AND tmr.month = ?
       ORDER BY st.id, t.rotation_order`,
      [year, month]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/rotations', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { team_id, year, month, override_reason } = req.body;
    if (!team_id || !year || !month)
      return res.status(400).json({ error: 'team_id, year e month obbligatori.' });

    await db.run(
      `INSERT OR REPLACE INTO team_monthly_rotation
       (team_id, year, month, is_override, override_reason, assigned_by)
       VALUES (?,?,?,1,?,?)`,
      [team_id, year, month, override_reason || null, req.user.id]
    );
    const row = await db.get(
      `SELECT tmr.*, t.name AS team_name, st.code AS shift_code
       FROM team_monthly_rotation tmr
       JOIN teams t ON tmr.team_id = t.id
       JOIN shift_types st ON t.shift_type_id = st.id
       WHERE tmr.team_id = ? AND tmr.year = ? AND tmr.month = ?`,
      [team_id, year, month]
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/rotations/:id', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const upd = await db.run(
      `DELETE FROM team_monthly_rotation WHERE id = ? AND is_override = 1`,
      [req.params.id]
    );
    if (upd.changes === 0)
      return res.status(404).json({ error: 'Rotazione non trovata o non è un override.' });
    res.json({ message: 'Override rotazione rimosso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// CAPO-TURNO PENDING
// ═══════════════════════════════════════════════════════════════

router.get('/capo-pending', authenticate, async (req, res) => {
  try {
    const { schedule_id, status = 'pending' } = req.query;
    let where = "ctp.status = ?";
    const params = [status];
    if (schedule_id) { where += ' AND ctp.schedule_id = ?'; params.push(schedule_id); }

    const rows = await db.all(
      `SELECT ctp.*,
              t.name  AS team_name,
              st.code AS shift_code,
              absent.first_name || ' ' || absent.last_name AS absent_nurse_name,
              sub.first_name    || ' ' || sub.last_name    AS substitute_nurse_name,
              nom.first_name    || ' ' || nom.last_name    AS nominated_by_name
       FROM capo_turno_pending ctp
       JOIN teams       t      ON ctp.team_id        = t.id
       JOIN shift_types st     ON ctp.shift_type_id  = st.id
       JOIN users       absent ON ctp.absent_user_id = absent.id
       LEFT JOIN users  sub    ON ctp.substitute_user_id = sub.id
       LEFT JOIN users  nom    ON ctp.nominated_by   = nom.id
       WHERE ${where}
       ORDER BY ctp.work_date`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/capo-pending/:id/resolve', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { substitute_user_id, notes } = req.body;
    if (!substitute_user_id)
      return res.status(400).json({ error: 'substitute_user_id obbligatorio.' });

    // Verifica che il sostituto abbia clinical_role adeguato
    const user = await db.get(
      `SELECT id, clinical_role, first_name, last_name FROM users WHERE id = ?`,
      [substitute_user_id]
    );
    if (!user) return res.status(404).json({ error: 'Infermiere sostituto non trovato.' });
    if (!['CAPO_TURNO','RESPONSABILE'].includes(user.clinical_role)) {
      return res.status(422).json({
        error: `${user.first_name} ${user.last_name} non ha clinical_role CAPO_TURNO o RESPONSABILE.`,
        current_role: user.clinical_role,
      });
    }

    const upd = await db.run(
      `UPDATE capo_turno_pending SET
         substitute_user_id = ?,
         nominated_by       = ?,
         status             = 'filled',
         resolved_at        = datetime('now'),
         notes              = COALESCE(?, notes)
       WHERE id = ? AND status = 'pending'`,
      [substitute_user_id, req.user.id, notes, req.params.id]
    );
    if (upd.changes === 0)
      return res.status(404).json({ error: 'Flag non trovato o già risolto.' });

    const row = await db.get(
      `SELECT ctp.*, u.first_name || ' ' || u.last_name AS substitute_name
       FROM capo_turno_pending ctp
       LEFT JOIN users u ON ctp.substitute_user_id = u.id
       WHERE ctp.id = ?`,
      [req.params.id]
    );
    res.json({ message: 'Capo-turno sostituto nominato.', pending: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/capo-pending/:id/waive', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { notes } = req.body;
    const upd = await db.run(
      `UPDATE capo_turno_pending SET
         status = 'waived', resolved_at = datetime('now'),
         nominated_by = ?, notes = COALESCE(?, notes)
       WHERE id = ? AND status = 'pending'`,
      [req.user.id, notes, req.params.id]
    );
    if (upd.changes === 0)
      return res.status(404).json({ error: 'Flag non trovato o già risolto.' });
    res.json({ message: 'Vincolo capo-turno esonerato per questo turno.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
