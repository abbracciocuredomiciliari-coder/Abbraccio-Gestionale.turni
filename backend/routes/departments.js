'use strict';
/**
 * routes/departments.js — Reparti multi-coordinatore
 *
 * REPARTI
 *   GET    /api/departments                        → lista reparti (coordinatore vede solo i suoi)
 *   POST   /api/departments                        → crea reparto (coordinator)
 *   GET    /api/departments/:id                    → dettaglio reparto
 *   PUT    /api/departments/:id                    → aggiorna reparto
 *   DELETE /api/departments/:id                    → disattiva reparto
 *
 * FABBISOGNO (shift config per reparto)
 *   GET    /api/departments/:id/shift-config       → fabbisogno turni del reparto
 *   PUT    /api/departments/:id/shift-config/:sid  → crea/aggiorna fabbisogno per turno
 *   DELETE /api/departments/:id/shift-config/:sid  → rimuove config (torna a default globale)
 *
 * STAFF DEL REPARTO
 *   GET    /api/departments/:id/staff              → infermieri del reparto (+ cross-coverage del mese)
 *   PUT    /api/departments/:id/staff/:uid/transfer → sposta definitivamente infermiere
 *
 * COPERTURA STRAORDINARIA (cross-coverage mensile)
 *   GET    /api/departments/:id/cross-coverage     → coperture del reparto per un mese
 *   POST   /api/departments/:id/cross-coverage     → aggiunge infermiere in copertura per mese
 *   DELETE /api/departments/:id/cross-coverage/:ccid → rimuove copertura straordinaria
 *
 * UTILITY
 *   GET    /api/departments/:id/requirements?year=&month= → fabbisogno completo per il solver
 *   POST   /api/departments/assign-teams           → associa tutti i team del coordinatore a un reparto
 */

const express = require('express');
const db      = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Helper: verifica che il reparto appartenga al coordinatore richiedente ──
async function ownsDepartment(deptId, userId, userRole) {
  if (userRole === 'admin') return true;
  const dept = await db.get(
    `SELECT id FROM departments WHERE id = ? AND coordinator_id = ? AND is_active = 1`,
    [deptId, userId]
  );
  return Boolean(dept);
}

// ═══════════════════════════════════════════════════════════════
// REPARTI
// ═══════════════════════════════════════════════════════════════

// Lista reparti: admin vede tutto, coordinator vede solo i suoi
router.get('/', authenticate, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') {
      rows = await db.all(
        `SELECT d.*,
                u.first_name || ' ' || u.last_name AS coordinator_name,
                a.name AS area_name, a.id AS area_id,
                (SELECT COUNT(*) FROM users WHERE department_id = d.id AND is_active = 1) AS staff_count,
                (SELECT COUNT(*) FROM teams WHERE department_id = d.id AND is_active = 1)  AS team_count
         FROM departments d
         JOIN users u ON d.coordinator_id = u.id
         LEFT JOIN areas a ON d.area_id = a.id
         WHERE d.is_active = 1
         ORDER BY d.name`
      );
    } else {
      rows = await db.all(
        `SELECT d.*,
                u.first_name || ' ' || u.last_name AS coordinator_name,
                a.name AS area_name, a.id AS area_id,
                (SELECT COUNT(*) FROM users WHERE department_id = d.id AND is_active = 1) AS staff_count,
                (SELECT COUNT(*) FROM teams WHERE department_id = d.id AND is_active = 1)  AS team_count
         FROM departments d
         JOIN users u ON d.coordinator_id = u.id
         LEFT JOIN areas a ON d.area_id = a.id
         WHERE d.coordinator_id = ? AND d.is_active = 1
         ORDER BY d.name`,
        [req.user.id]
      );
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const dept = await db.get(
      `SELECT d.*,
              u.first_name || ' ' || u.last_name AS coordinator_name
       FROM departments d
       JOIN users u ON d.coordinator_id = u.id
       WHERE d.id = ? AND d.is_active = 1`,
      [req.params.id]
    );
    if (!dept) return res.status(404).json({ error: 'Reparto non trovato.' });
    if (!(await ownsDepartment(dept.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato a questo reparto.' });
    res.json(dept);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticate, async (req, res) => {
  try {
    // admin e area_manager possono specificare coordinator_id nel body
    const canSpecifyCoord = ['admin','area_manager'].includes(req.user.role);
    if (!canSpecifyCoord && req.user.role !== 'coordinator')
      return res.status(403).json({ error: 'Non autorizzato a creare reparti.' });

    const { name, code, notes, coordinator_id, area_id } = req.body;
    if (!name)
      return res.status(400).json({ error: 'name obbligatorio.' });

    const safeCode = code
      ? code.toUpperCase()
      : name.toUpperCase().replace(/\s+/g, '_').slice(0, 10) + '_' + Date.now().toString().slice(-4);

    const effectiveCoordId = canSpecifyCoord && coordinator_id
      ? coordinator_id
      : req.user.id;

    const ins = await db.run(
      `INSERT INTO departments (name, code, coordinator_id, area_id, notes)
       VALUES (?, ?, ?, ?, ?)`,
      [name, safeCode, effectiveCoordId, area_id || null, notes || null]
    );
    const row = await db.get(
      `SELECT d.*, u.first_name || ' ' || u.last_name AS coordinator_name
       FROM departments d JOIN users u ON d.coordinator_id = u.id
       WHERE d.id = ?`,
      [ins.id]
    );
    res.status(201).json(row);
  } catch (err) {
    if (err.message?.includes('UNIQUE'))
      return res.status(409).json({ error: 'Codice reparto già esistente.' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    if (!(await ownsDepartment(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });

    const { name, code, notes, is_active } = req.body;
    const upd = await db.run(
      `UPDATE departments SET
         name      = COALESCE(?, name),
         code      = COALESCE(?, code),
         notes     = COALESCE(?, notes),
         is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [name, code, notes, is_active, req.params.id]
    );
    if (upd.changes === 0) return res.status(404).json({ error: 'Reparto non trovato.' });
    const row = await db.get(`SELECT * FROM departments WHERE id = ?`, [req.params.id]);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    if (!(await ownsDepartment(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });

    await db.run(`UPDATE departments SET is_active = 0 WHERE id = ?`, [req.params.id]);
    res.json({ message: 'Reparto disattivato.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// FABBISOGNO PER REPARTO × TURNO (department_shift_config)
// ═══════════════════════════════════════════════════════════════

router.get('/:id/shift-config', authenticate, async (req, res) => {
  try {
    if (!(await ownsDepartment(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });

    // Usa la vista v_dept_shift_requirements che fa già il fallback
    const rows = await db.all(
      `SELECT * FROM v_dept_shift_requirements WHERE department_id = ?
       ORDER BY shift_code`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/shift-config/:shiftTypeId', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    if (!(await ownsDepartment(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });

    const { required_staff, assignment_mode, min_capo_turno, is_active, notes } = req.body;
    const allowed = ['FREE', 'TEAM', 'MIXED'];
    if (assignment_mode && !allowed.includes(assignment_mode))
      return res.status(400).json({ error: `assignment_mode deve essere: ${allowed.join(', ')}` });

    await db.run(
      `INSERT INTO department_shift_config
         (department_id, shift_type_id, required_staff, assignment_mode, min_capo_turno, is_active, notes)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(department_id, shift_type_id) DO UPDATE SET
         required_staff  = COALESCE(excluded.required_staff,  required_staff),
         assignment_mode = COALESCE(excluded.assignment_mode, assignment_mode),
         min_capo_turno  = COALESCE(excluded.min_capo_turno,  min_capo_turno),
         is_active       = COALESCE(excluded.is_active,       is_active),
         notes           = COALESCE(excluded.notes,           notes)`,
      [
        req.params.id, req.params.shiftTypeId,
        required_staff ?? 1,
        assignment_mode ?? 'FREE',
        min_capo_turno ?? 0,
        is_active ?? 1,
        notes ?? null,
      ]
    );
    const row = await db.get(
      `SELECT * FROM v_dept_shift_requirements
       WHERE department_id = ? AND shift_type_id = ?`,
      [req.params.id, req.params.shiftTypeId]
    );
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/shift-config/:shiftTypeId', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    if (!(await ownsDepartment(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });

    const upd = await db.run(
      `DELETE FROM department_shift_config
       WHERE department_id = ? AND shift_type_id = ?`,
      [req.params.id, req.params.shiftTypeId]
    );
    if (upd.changes === 0)
      return res.status(404).json({ error: 'Config non trovata — usa già il default globale.' });
    res.json({ message: 'Config rimossa. Il turno usa ora il fabbisogno globale.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// STAFF DEL REPARTO
// ═══════════════════════════════════════════════════════════════

router.get('/:id/staff', authenticate, async (req, res) => {
  try {
    if (!(await ownsDepartment(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });

    const { year, month } = req.query;
    const deptId = req.params.id;

    // Staff principale del reparto
    const homeStaff = await db.all(
      `SELECT u.id, u.first_name, u.last_name,
              COALESCE(u.clinical_role,'STAFF') AS clinical_role,
              u.department_id AS home_dept_id,
              0 AS is_cross_coverage, NULL AS cross_from_dept, NULL AS cross_reason
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.department_id = ? AND u.is_active = 1 AND r.name = 'staff'
       ORDER BY u.last_name, u.first_name`,
      [deptId]
    );

    // Cross-coverage (se specificato mese/anno)
    let crossStaff = [];
    if (year && month) {
      crossStaff = await db.all(
        `SELECT u.id, u.first_name, u.last_name,
                COALESCE(u.clinical_role,'STAFF') AS clinical_role,
                u.department_id AS home_dept_id,
                1 AS is_cross_coverage,
                d_from.name AS cross_from_dept,
                cc.reason   AS cross_reason
         FROM department_cross_coverage cc
         JOIN users u ON cc.user_id = u.id
         JOIN departments d_from ON cc.from_dept_id = d_from.id
         WHERE cc.to_dept_id = ? AND cc.year = ? AND cc.month = ?
           AND u.is_active = 1
         ORDER BY u.last_name, u.first_name`,
        [deptId, year, month]
      );
    }

    res.json({
      department_id: +deptId,
      year: year ? +year : null,
      month: month ? +month : null,
      home_staff: homeStaff,
      cross_coverage: crossStaff,
      total: homeStaff.length + crossStaff.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trasferimento definitivo infermiere → altro reparto
router.put('/:id/staff/:uid/transfer', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { to_department_id, notes } = req.body;
    if (!to_department_id)
      return res.status(400).json({ error: 'to_department_id obbligatorio.' });

    // Il coordinatore deve possedere entrambi i reparti (o essere admin)
    const ownsFrom = await ownsDepartment(req.params.id, req.user.id, req.user.role);
    const ownsTo   = await ownsDepartment(to_department_id, req.user.id, req.user.role);
    if (!ownsFrom || !ownsTo)
      return res.status(403).json({ error: 'Puoi trasferire solo tra reparti di tua pertinenza.' });

    // Verifica che l'infermiere appartenga al reparto di origine
    const user = await db.get(
      `SELECT id, first_name, last_name, department_id FROM users WHERE id = ? AND is_active = 1`,
      [req.params.uid]
    );
    if (!user) return res.status(404).json({ error: 'Infermiere non trovato.' });
    if (user.department_id !== +req.params.id)
      return res.status(422).json({ error: 'Infermiere non appartiene al reparto indicato.' });

    // Aggiorna reparto principale
    await db.run(
      `UPDATE users SET department_id = ? WHERE id = ?`,
      [to_department_id, req.params.uid]
    );

    // Chiude le membership nelle squadre del vecchio reparto
    const today = new Date().toISOString().slice(0, 10);
    await db.run(
      `UPDATE team_members SET valid_until = ?
       WHERE user_id = ?
         AND team_id IN (SELECT id FROM teams WHERE department_id = ?)
         AND (valid_until IS NULL OR valid_until >= ?)`,
      [today, req.params.uid, req.params.id, today]
    );

    res.json({
      message: `${user.first_name} ${user.last_name} trasferito definitivamente.`,
      user_id: +req.params.uid,
      from_department_id: +req.params.id,
      to_department_id: +to_department_id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// COPERTURA STRAORDINARIA (cross-coverage mensile)
// ═══════════════════════════════════════════════════════════════

router.get('/:id/cross-coverage', authenticate, async (req, res) => {
  try {
    if (!(await ownsDepartment(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });

    const { year, month } = req.query;
    if (!year || !month)
      return res.status(400).json({ error: 'year e month obbligatori.' });

    const rows = await db.all(
      `SELECT cc.*,
              u.first_name || ' ' || u.last_name AS nurse_name,
              COALESCE(u.clinical_role,'STAFF')   AS clinical_role,
              d_from.name AS from_dept_name,
              d_to.name   AS to_dept_name,
              cb.first_name || ' ' || cb.last_name AS created_by_name
       FROM department_cross_coverage cc
       JOIN users u         ON cc.user_id      = u.id
       JOIN departments d_from ON cc.from_dept_id = d_from.id
       JOIN departments d_to   ON cc.to_dept_id   = d_to.id
       LEFT JOIN users cb   ON cc.created_by   = cb.id
       WHERE cc.to_dept_id = ? AND cc.year = ? AND cc.month = ?
       ORDER BY u.last_name`,
      [req.params.id, year, month]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/cross-coverage', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const toDeptId = +req.params.id;
    if (!(await ownsDepartment(toDeptId, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });

    const { user_ids, year, month, reason } = req.body;
    if (!user_ids?.length || !year || !month)
      return res.status(400).json({ error: 'user_ids (array), year e month obbligatori.' });

    const results = [];
    for (const uid of user_ids) {
      // Determina il reparto di provenienza
      const user = await db.get(
        `SELECT id, first_name, last_name, department_id FROM users WHERE id = ? AND is_active = 1`,
        [uid]
      );
      if (!user) { results.push({ user_id: uid, status: 'not_found' }); continue; }
      if (!user.department_id) { results.push({ user_id: uid, status: 'no_dept' }); continue; }
      if (user.department_id === toDeptId) { results.push({ user_id: uid, status: 'same_dept' }); continue; }

      try {
        const ins = await db.run(
          `INSERT OR IGNORE INTO department_cross_coverage
             (user_id, from_dept_id, to_dept_id, year, month, reason, created_by)
           VALUES (?,?,?,?,?,?,?)`,
          [uid, user.department_id, toDeptId, year, month, reason || null, req.user.id]
        );
        results.push({
          user_id: uid,
          nurse_name: `${user.first_name} ${user.last_name}`,
          status: ins.changes > 0 ? 'added' : 'already_exists',
        });
      } catch (e) {
        results.push({ user_id: uid, status: 'error', message: e.message });
      }
    }

    res.status(201).json({ department_id: toDeptId, year, month, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/cross-coverage/:ccId', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    if (!(await ownsDepartment(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });

    const upd = await db.run(
      `DELETE FROM department_cross_coverage WHERE id = ? AND to_dept_id = ?`,
      [req.params.ccId, req.params.id]
    );
    if (upd.changes === 0) return res.status(404).json({ error: 'Copertura non trovata.' });
    res.json({ message: 'Copertura straordinaria rimossa.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// UTILITY: fabbisogno completo per il solver (usato internamente)
// ═══════════════════════════════════════════════════════════════

router.get('/:id/requirements', authenticate, async (req, res) => {
  try {
    if (!(await ownsDepartment(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });

    const { year, month } = req.query;
    if (!year || !month)
      return res.status(400).json({ error: 'year e month obbligatori.' });

    const deptId = req.params.id;

    // Fabbisogno per turno (dalla vista)
    const shiftReqs = await db.all(
      `SELECT * FROM v_dept_shift_requirements WHERE department_id = ?`,
      [deptId]
    );

    // Staff disponibile (proprio + cross-coverage)
    const staff = await db.all(
      `SELECT u.id, u.first_name, u.last_name,
              COALESCE(u.clinical_role,'STAFF') AS clinical_role,
              u.skills, u.department_id AS home_dept_id,
              0 AS is_cross_coverage
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.department_id = ? AND u.is_active = 1 AND r.name = 'staff'
       UNION ALL
       SELECT u.id, u.first_name, u.last_name,
              COALESCE(u.clinical_role,'STAFF') AS clinical_role,
              u.skills, u.department_id AS home_dept_id,
              1 AS is_cross_coverage
       FROM department_cross_coverage cc
       JOIN users u ON cc.user_id = u.id
       JOIN roles r ON u.role_id = r.id
       WHERE cc.to_dept_id = ? AND cc.year = ? AND cc.month = ?
         AND u.is_active = 1 AND r.name = 'staff'`,
      [deptId, deptId, year, month]
    );

    res.json({
      department_id: +deptId,
      year: +year,
      month: +month,
      shift_requirements: shiftReqs,
      available_staff: staff,
      staff_count: staff.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// UTILITY: assegna tutti i team del coordinatore a un reparto
// (copia rapida: associa i team del reparto A al reparto B)
// ═══════════════════════════════════════════════════════════════

router.post('/assign-teams', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { from_department_id, to_department_id, team_ids } = req.body;
    if (!to_department_id)
      return res.status(400).json({ error: 'to_department_id obbligatorio.' });

    const ownsTo = await ownsDepartment(to_department_id, req.user.id, req.user.role);
    if (!ownsTo) return res.status(403).json({ error: 'Accesso non autorizzato al reparto destinazione.' });

    let teamsToAssign = [];
    if (team_ids?.length) {
      // Assegna team specifici (verifica ownership)
      teamsToAssign = team_ids;
    } else if (from_department_id) {
      // Prende tutti i team attivi del reparto sorgente
      const owns = await ownsDepartment(from_department_id, req.user.id, req.user.role);
      if (!owns) return res.status(403).json({ error: 'Accesso non autorizzato al reparto sorgente.' });
      const teams = await db.all(
        `SELECT id FROM teams WHERE department_id = ? AND is_active = 1`,
        [from_department_id]
      );
      teamsToAssign = teams.map(t => t.id);
    } else {
      // Prende tutti i team del coordinatore senza reparto assegnato
      const allDepts = await db.all(
        `SELECT id FROM departments WHERE coordinator_id = ? AND is_active = 1`,
        [req.user.id]
      );
      const deptIds = allDepts.map(d => d.id);
      if (deptIds.length > 0) {
        const teams = await db.all(
          `SELECT id FROM teams WHERE department_id IS NULL AND is_active = 1`
        );
        teamsToAssign = teams.map(t => t.id);
      }
    }

    let updated = 0;
    for (const tid of teamsToAssign) {
      const upd = await db.run(
        `UPDATE teams SET department_id = ? WHERE id = ?`,
        [to_department_id, tid]
      );
      updated += upd.changes;
    }

    res.json({
      message: `${updated} team assegnati al reparto ${to_department_id}.`,
      to_department_id: +to_department_id,
      teams_updated: updated,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
