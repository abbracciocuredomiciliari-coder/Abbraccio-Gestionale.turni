const express = require('express');
const db = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { buildSkillMap, validateShiftSkillMix, generateSkillMixReport } = require('../skills');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────
// Helper: carica skill map da DB
// ─────────────────────────────────────────────────────────────────
async function loadSkillMap(referenceDate) {
  const today = referenceDate || new Date().toISOString().slice(0, 10);

  const [privileges, requirements] = await Promise.all([
    db.all(`
      SELECT ncp.user_id, ncp.skill_id,
             cs.code AS skill_code, cs.name AS skill_name,
             cs.department, cs.category,
             ncp.valid_from, ncp.valid_until, ncp.is_active,
             ncp.certificate_ref
      FROM nurse_clinical_privileges ncp
      JOIN clinical_skills cs ON ncp.skill_id = cs.id
      WHERE ncp.is_active = 1 AND cs.is_active = 1
    `),
    db.all(`
      SELECT ssr.shift_type_id, ssr.skill_id,
             cs.code AS skill_code, cs.name AS skill_name,
             ssr.department, ssr.min_count, ssr.max_count,
             ssr.is_mandatory, ssr.is_active
      FROM shift_skill_requirements ssr
      JOIN clinical_skills cs ON ssr.skill_id = cs.id
      WHERE ssr.is_active = 1 AND cs.is_active = 1
    `),
  ]);

  return buildSkillMap(privileges, requirements, today);
}

// ═════════════════════════════════════════════════════════════════
// CLINICAL SKILLS — Catalogo
// ═════════════════════════════════════════════════════════════════

router.get('/catalog', authenticate, async (req, res) => {
  try {
    const { department, category } = req.query;
    let where = ['is_active = 1'];
    const params = [];
    if (department) { where.push('department = ?'); params.push(department); }
    if (category)   { where.push('category = ?');   params.push(category);  }
    const rows = await db.all(
      `SELECT * FROM clinical_skills WHERE ${where.join(' AND ')} ORDER BY department, name`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('[skills GET /catalog]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/catalog', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { code, name, department, category, description } = req.body;
    if (!code || !name || !category) {
      return res.status(400).json({ error: 'code, name, category obbligatori' });
    }
    const VALID = ['certification','seniority','role','qualification'];
    if (!VALID.includes(category)) {
      return res.status(400).json({ error: `category deve essere uno di: ${VALID.join(', ')}` });
    }
    const r = await db.run(
      `INSERT INTO clinical_skills (code, name, department, category, description)
       VALUES (?, ?, ?, ?, ?)`,
      [code.toUpperCase(), name, department || null, category, description || null]
    );
    const created = await db.get('SELECT * FROM clinical_skills WHERE id = ?', [r.id]);
    res.status(201).json(created);
  } catch (err) {
    console.error('[skills POST /catalog]', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/catalog/:id', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { name, department, category, description, is_active } = req.body;
    await db.run(
      `UPDATE clinical_skills SET name=COALESCE(?,name), department=COALESCE(?,department),
       category=COALESCE(?,category), description=COALESCE(?,description),
       is_active=COALESCE(?,is_active) WHERE id=?`,
      [name||null, department||null, category||null, description||null,
       is_active !== undefined ? (is_active ? 1 : 0) : null, req.params.id]
    );
    const updated = await db.get('SELECT * FROM clinical_skills WHERE id = ?', [req.params.id]);
    if (!updated) return res.status(404).json({ error: 'Skill non trovata' });
    res.json(updated);
  } catch (err) {
    console.error('[skills PATCH /catalog/:id]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════
// NURSE CLINICAL PRIVILEGES — Privilegi per infermiere
// ═════════════════════════════════════════════════════════════════

/**
 * GET /api/skills/nurses/:userId/privileges
 * Lista i privilegi clinici di un infermiere
 */
router.get('/nurses/:userId/privileges', authenticate, async (req, res) => {
  try {
    const userId = req.params.userId;
    if (req.user.role === 'staff' && parseInt(userId) !== req.user.id) {
      return res.status(403).json({ error: 'Accesso negato' });
    }
    const rows = await db.all(`
      SELECT ncp.*, cs.code AS skill_code, cs.name AS skill_name,
             cs.department, cs.category,
             u.first_name || ' ' || u.last_name AS granted_by_name
      FROM nurse_clinical_privileges ncp
      JOIN clinical_skills cs ON ncp.skill_id = cs.id
      LEFT JOIN users u ON ncp.granted_by = u.id
      WHERE ncp.user_id = ?
      ORDER BY cs.department, cs.name
    `, [userId]);
    res.json(rows);
  } catch (err) {
    console.error('[skills GET /nurses/:userId/privileges]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/skills/nurses/:userId/privileges
 * Aggiunge un privilegio clinico a un infermiere
 */
router.post('/nurses/:userId/privileges', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { skill_id, valid_from, valid_until, certificate_ref, notes } = req.body;
    if (!skill_id) return res.status(400).json({ error: 'skill_id obbligatorio' });

    const skill = await db.get('SELECT * FROM clinical_skills WHERE id = ? AND is_active = 1', [skill_id]);
    if (!skill) return res.status(404).json({ error: 'Skill non trovata o inattiva' });

    const today = new Date().toISOString().slice(0, 10);
    const r = await db.run(`
      INSERT OR REPLACE INTO nurse_clinical_privileges
        (user_id, skill_id, granted_by, valid_from, valid_until, certificate_ref, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      req.params.userId, skill_id, req.user.id,
      valid_from || today,
      valid_until || null,
      certificate_ref || null,
      notes || null,
    ]);
    const created = await db.get(`
      SELECT ncp.*, cs.code AS skill_code, cs.name AS skill_name
      FROM nurse_clinical_privileges ncp
      JOIN clinical_skills cs ON ncp.skill_id = cs.id
      WHERE ncp.id = ?
    `, [r.id]);
    res.status(201).json(created);
  } catch (err) {
    console.error('[skills POST /nurses/:userId/privileges]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/skills/nurses/:userId/privileges/:skillId
 * Revoca un privilegio clinico
 */
router.delete('/nurses/:userId/privileges/:skillId', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const r = await db.run(
      'UPDATE nurse_clinical_privileges SET is_active = 0 WHERE user_id = ? AND skill_id = ?',
      [req.params.userId, req.params.skillId]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'Privilegio non trovato' });
    res.json({ revoked: true });
  } catch (err) {
    console.error('[skills DELETE /nurses/:userId/privileges/:skillId]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/skills/nurses — Panoramica skill per tutto il team
 */
router.get('/nurses', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await db.all(`
      SELECT u.id, u.first_name, u.last_name,
             GROUP_CONCAT(cs.code, ',') AS skill_codes,
             GROUP_CONCAT(cs.name, '||') AS skill_names,
             COUNT(ncp.id) AS skill_count
      FROM users u
      LEFT JOIN nurse_clinical_privileges ncp
        ON ncp.user_id = u.id AND ncp.is_active = 1
        AND (ncp.valid_from IS NULL OR ncp.valid_from <= ?)
        AND (ncp.valid_until IS NULL OR ncp.valid_until >= ?)
      LEFT JOIN clinical_skills cs ON ncp.skill_id = cs.id AND cs.is_active = 1
      WHERE u.is_active = 1
      GROUP BY u.id
      ORDER BY u.last_name, u.first_name
    `, [today, today]);
    res.json(rows);
  } catch (err) {
    console.error('[skills GET /nurses]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════
// SHIFT SKILL REQUIREMENTS — Requisiti per turno
// ═════════════════════════════════════════════════════════════════

/**
 * GET /api/skills/shifts/:shiftId/requirements
 */
router.get('/shifts/:shiftId/requirements', authenticate, async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT ssr.*, cs.code AS skill_code, cs.name AS skill_name, cs.category
      FROM shift_skill_requirements ssr
      JOIN clinical_skills cs ON ssr.skill_id = cs.id
      WHERE ssr.shift_type_id = ? AND ssr.is_active = 1
      ORDER BY ssr.department, ssr.min_count DESC
    `, [req.params.shiftId]);
    res.json(rows);
  } catch (err) {
    console.error('[skills GET /shifts/:shiftId/requirements]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/skills/shifts/:shiftId/requirements
 * Aggiunge requisito skill a un turno
 */
router.post('/shifts/:shiftId/requirements', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { skill_id, department, min_count = 1, max_count, is_mandatory = 1, notes } = req.body;
    if (!skill_id) return res.status(400).json({ error: 'skill_id obbligatorio' });
    const r = await db.run(`
      INSERT OR REPLACE INTO shift_skill_requirements
        (shift_type_id, skill_id, department, min_count, max_count, is_mandatory, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [req.params.shiftId, skill_id, department || null,
        min_count, max_count || null, is_mandatory ? 1 : 0, notes || null]);
    const created = await db.get(`
      SELECT ssr.*, cs.code AS skill_code, cs.name AS skill_name
      FROM shift_skill_requirements ssr
      JOIN clinical_skills cs ON ssr.skill_id = cs.id
      WHERE ssr.id = ?
    `, [r.id]);
    res.status(201).json(created);
  } catch (err) {
    console.error('[skills POST /shifts/:shiftId/requirements]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/skills/shifts/:shiftId/requirements/:skillId
 */
router.delete('/shifts/:shiftId/requirements/:skillId', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const r = await db.run(
      'UPDATE shift_skill_requirements SET is_active = 0 WHERE shift_type_id = ? AND skill_id = ?',
      [req.params.shiftId, req.params.skillId]
    );
    if (r.changes === 0) return res.status(404).json({ error: 'Requisito non trovato' });
    res.json({ removed: true });
  } catch (err) {
    console.error('[skills DELETE /shifts/:shiftId/requirements/:skillId]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════
// VALIDATION & REPORT
// ═════════════════════════════════════════════════════════════════

/**
 * GET /api/skills/validate?schedule_id=X&department=ICU
 * Valida lo skill-mix di un planning già generato
 */
router.get('/validate', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { schedule_id, year, month, department } = req.query;

    let assignments;
    if (schedule_id) {
      assignments = await db.all(`
        SELECT sa.user_id, sa.work_date, sa.shift_type_id,
               st.code AS shift_code, st.name AS shift_name,
               COALESCE(st.is_night, 0) AS is_night
        FROM schedule_assignments sa
        JOIN shift_types st ON sa.shift_type_id = st.id
        WHERE sa.schedule_id = ?
      `, [schedule_id]);
    } else if (year && month) {
      const pad = n => String(n).padStart(2,'0');
      const dim = new Date(parseInt(year), parseInt(month), 0).getDate();
      const s = `${year}-${pad(month)}-01`;
      const e = `${year}-${pad(month)}-${pad(dim)}`;
      assignments = await db.all(`
        SELECT sa.user_id, sa.work_date, sa.shift_type_id,
               st.code AS shift_code, st.name AS shift_name
        FROM schedule_assignments sa
        JOIN shift_types st ON sa.shift_type_id = st.id
        WHERE sa.work_date >= ? AND sa.work_date <= ?
      `, [s, e]);
    } else {
      return res.status(400).json({ error: 'Specificare schedule_id oppure year + month' });
    }

    const skillMap = await loadSkillMap();
    const shifts   = await db.all('SELECT * FROM shift_types WHERE is_active = 1');
    const shiftsById = Object.fromEntries(shifts.map(s => [s.id, s]));

    const report = generateSkillMixReport(skillMap, assignments, shiftsById, department || null);
    res.json(report);
  } catch (err) {
    console.error('[skills GET /validate]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/skills/coverage?department=ICU
 * Mostra per ogni skill quanti infermieri la coprono (per pianificazione fabbisogno)
 */
router.get('/coverage', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { department } = req.query;
    const today = new Date().toISOString().slice(0, 10);

    const where = department ? 'AND (cs.department = ? OR cs.department IS NULL)' : '';
    const params = [today, today, ...(department ? [department] : [])];

    const rows = await db.all(`
      SELECT cs.id, cs.code, cs.name, cs.department, cs.category,
             COUNT(ncp.id) AS nurses_with_skill,
             GROUP_CONCAT(u.first_name || ' ' || u.last_name, ', ') AS nurse_names
      FROM clinical_skills cs
      LEFT JOIN nurse_clinical_privileges ncp
        ON ncp.skill_id = cs.id AND ncp.is_active = 1
        AND (ncp.valid_from IS NULL OR ncp.valid_from <= ?)
        AND (ncp.valid_until IS NULL OR ncp.valid_until >= ?)
      LEFT JOIN users u ON ncp.user_id = u.id AND u.is_active = 1
      WHERE cs.is_active = 1 ${where}
      GROUP BY cs.id
      ORDER BY cs.department, nurses_with_skill ASC, cs.name
    `, params);

    // Recupera requisiti per evidenziare gap
    const requirements = await db.all(`
      SELECT ssr.skill_id, ssr.department, SUM(ssr.min_count) AS total_required
      FROM shift_skill_requirements ssr
      WHERE ssr.is_active = 1
      GROUP BY ssr.skill_id, ssr.department
    `);
    const reqMap = {};
    for (const r of requirements) {
      reqMap[r.skill_id] = r.total_required;
    }

    const result = rows.map(r => ({
      ...r,
      required_minimum: reqMap[r.id] || null,
      coverage_gap: reqMap[r.id] ? Math.max(0, reqMap[r.id] - r.nurses_with_skill) : 0,
    }));

    res.json(result);
  } catch (err) {
    console.error('[skills GET /coverage]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
