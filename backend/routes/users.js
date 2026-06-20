const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Helper: parse skills JSON ─────────────────────────────────
function parseSkills(row) {
  if (!row) return row;
  row.skills = row.skills
    ? (typeof row.skills === 'string' ? JSON.parse(row.skills) : row.skills)
    : [];
  return row;
}

// ── Ruoli che possono creare utenti e cosa possono creare ─────
// admin        → tutto
// area_manager → coordinator (nei reparti della propria area)
// coordinator  → staff (nel proprio reparto)
const CAN_CREATE = {
  admin:        ['admin', 'area_manager', 'coordinator', 'staff'],
  area_manager: ['coordinator'],
  coordinator:  ['staff'],
};

// ═══════════════════════════════════════════════════════════════
// GET /  — lista utenti (filtrata per ruolo richiedente)
// ═══════════════════════════════════════════════════════════════
router.get('/', authenticate, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') {
      rows = await db.all(
        `SELECT u.id, u.username, u.email, u.first_name, u.last_name,
                u.is_active, u.skills, u.clinical_role, u.department_id,
                r.name AS role,
                d.name AS department_name,
                ar.id AS area_id, ar.name AS area_name
         FROM users u
         JOIN roles r ON u.role_id = r.id
         LEFT JOIN departments d ON u.department_id = d.id
         LEFT JOIN areas ar ON d.area_id = ar.id
         ORDER BY u.last_name, u.first_name`
      );
    } else if (req.user.role === 'area_manager') {
      // Vede tutti i coordinatori e staff dei reparti della propria area
      rows = await db.all(
        `SELECT u.id, u.username, u.email, u.first_name, u.last_name,
                u.is_active, u.skills, u.clinical_role, u.department_id,
                r.name AS role,
                d.name AS department_name,
                ar.id AS area_id, ar.name AS area_name
         FROM users u
         JOIN roles r ON u.role_id = r.id
         LEFT JOIN departments d ON u.department_id = d.id
         LEFT JOIN areas ar ON d.area_id = ar.id
         WHERE ar.area_manager_id = ? OR u.id = ?
         ORDER BY u.last_name, u.first_name`,
        [req.user.id, req.user.id]
      );
    } else if (req.user.role === 'coordinator') {
      // Vede solo gli utenti del proprio reparto
      rows = await db.all(
        `SELECT u.id, u.username, u.email, u.first_name, u.last_name,
                u.is_active, u.skills, u.clinical_role, u.department_id,
                r.name AS role,
                d.name AS department_name
         FROM users u
         JOIN roles r ON u.role_id = r.id
         LEFT JOIN departments d ON u.department_id = d.id
         WHERE u.department_id IN (
           SELECT id FROM departments WHERE coordinator_id = ?
         ) OR u.id = ?
         ORDER BY u.last_name, u.first_name`,
        [req.user.id, req.user.id]
      );
    } else {
      // staff vede solo se stesso
      rows = await db.all(
        `SELECT u.id, u.username, u.email, u.first_name, u.last_name,
                u.is_active, u.skills, u.clinical_role, u.department_id,
                r.name AS role, d.name AS department_name
         FROM users u
         JOIN roles r ON u.role_id = r.id
         LEFT JOIN departments d ON u.department_id = d.id
         WHERE u.id = ?`,
        [req.user.id]
      );
    }
    rows.forEach(parseSkills);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /skill-tags
// ═══════════════════════════════════════════════════════════════
router.get('/skill-tags', authenticate, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT id, code, label, department, color FROM skill_tags WHERE is_active = 1 ORDER BY label`
    ).catch(() => [
      { code:'ICU',      label:'Terapia Intensiva', color:'#F44336' },
      { code:'PEDIATRIA',label:'Pediatria',          color:'#9C27B0' },
      { code:'DEA',      label:'Pronto Soccorso',    color:'#FF9800' },
      { code:'BLS_D',    label:'BLS-D',              color:'#FFC107' },
    ]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /roles — lista ruoli disponibili
// ═══════════════════════════════════════════════════════════════
router.get('/roles', authenticate, async (req, res) => {
  try {
    const allowed = CAN_CREATE[req.user.role] || [];
    const rows = await db.all(
      `SELECT id, name, description FROM roles ORDER BY id`
    );
    // Filtra solo i ruoli che questo utente può creare
    const filtered = req.user.role === 'admin'
      ? rows
      : rows.filter(r => allowed.includes(r.name));
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /me — profilo utente corrente (con department e area)
// ═══════════════════════════════════════════════════════════════
router.get('/me', authenticate, async (req, res) => {
  try {
    const row = await db.get(
      `SELECT u.id, u.username, u.email, u.first_name, u.last_name,
              u.skills, u.clinical_role, u.department_id,
              r.name AS role,
              d.name AS department_name,
              ar.id AS area_id, ar.name AS area_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN departments d ON u.department_id = d.id
       LEFT JOIN areas ar ON d.area_id = ar.id
       WHERE u.id = ?`,
      [req.user.id]
    );
    res.json(parseSkills(row));
  } catch (err) {
    res.status(500).json({ error: 'Errore server' });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /  — crea nuovo utente
// Body: { username, email, password, first_name, last_name,
//         role_name, department_id?, clinical_role? }
// ═══════════════════════════════════════════════════════════════
router.post('/', authenticate, async (req, res) => {
  try {
    const { username, email, password, first_name, last_name,
            role_name, department_id, clinical_role } = req.body;

    if (!username || !email || !password || !first_name || !last_name || !role_name)
      return res.status(400).json({ error: 'Campi obbligatori: username, email, password, first_name, last_name, role_name.' });

    // Controlla permessi: chi può creare quale ruolo
    const allowed = CAN_CREATE[req.user.role] || [];
    if (!allowed.includes(role_name))
      return res.status(403).json({ error: `Il ruolo "${req.user.role}" non può creare utenti con ruolo "${role_name}".` });

    // Coordinator: può creare staff solo nel proprio reparto
    if (req.user.role === 'coordinator') {
      const ownDepts = await db.all(
        `SELECT id FROM departments WHERE coordinator_id = ?`, [req.user.id]
      );
      const ownDeptIds = ownDepts.map(d => d.id);
      if (!department_id || !ownDeptIds.includes(+department_id))
        return res.status(403).json({ error: 'Puoi creare staff solo nel tuo reparto.' });
    }

    // Area_manager: può creare coordinator solo in reparti della sua area
    if (req.user.role === 'area_manager' && department_id) {
      const dept = await db.get(
        `SELECT d.id FROM departments d JOIN areas ar ON d.area_id = ar.id
         WHERE d.id = ? AND ar.area_manager_id = ?`,
        [department_id, req.user.id]
      );
      if (!dept)
        return res.status(403).json({ error: 'Il reparto non appartiene alla tua area.' });
    }

    const roleRow = await db.get(`SELECT id FROM roles WHERE name = ?`, [role_name]);
    if (!roleRow) return res.status(400).json({ error: `Ruolo "${role_name}" non trovato.` });

    const hash = await bcrypt.hash(password, 10);
    const ins = await db.run(
      `INSERT INTO users
         (username, email, password_hash, first_name, last_name, role_id, department_id, clinical_role)
       VALUES (?,?,?,?,?,?,?,?)`,
      [username, email, hash, first_name, last_name, roleRow.id,
       department_id || null, clinical_role || null]
    );

    const newUser = await db.get(
      `SELECT u.id, u.username, u.email, u.first_name, u.last_name,
              u.clinical_role, u.department_id,
              r.name AS role, d.name AS department_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.id = ?`,
      [ins.id]
    );
    res.status(201).json(newUser);
  } catch (err) {
    if (err.message?.includes('UNIQUE'))
      return res.status(409).json({ error: 'Username o email già in uso.' });
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

// ═══════════════════════════════════════════════════════════════
// PATCH /:id — aggiorna profilo utente
// ═══════════════════════════════════════════════════════════════
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const targetId = +req.params.id;
    const { first_name, last_name, email, clinical_role, department_id, is_active, password } = req.body;

    // Solo admin o l'utente stesso può aggiornare; coordinator può aggiornare il proprio staff
    const isSelf = req.user.id === targetId;
    const isAdmin = req.user.role === 'admin';
    const isCoordOrAbove = ['coordinator','area_manager','admin'].includes(req.user.role);
    if (!isSelf && !isCoordOrAbove)
      return res.status(403).json({ error: 'Non autorizzato.' });

    const fields = [];
    const values = [];

    if (first_name !== undefined)   { fields.push('first_name=?');   values.push(first_name); }
    if (last_name !== undefined)    { fields.push('last_name=?');    values.push(last_name); }
    if (email !== undefined)        { fields.push('email=?');        values.push(email); }
    if (clinical_role !== undefined){ fields.push('clinical_role=?');values.push(clinical_role); }
    if (department_id !== undefined && isAdmin) { fields.push('department_id=?'); values.push(department_id); }
    if (is_active !== undefined && isAdmin)     { fields.push('is_active=?');     values.push(is_active); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      fields.push('password_hash=?'); values.push(hash);
    }

    if (fields.length === 0) return res.status(400).json({ error: 'Nessun campo da aggiornare.' });

    values.push(targetId);
    await db.run(`UPDATE users SET ${fields.join(',')} WHERE id=?`, values);

    const updated = await db.get(
      `SELECT u.id, u.username, u.email, u.first_name, u.last_name,
              u.is_active, u.skills, u.clinical_role, u.department_id,
              r.name AS role, d.name AS department_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.id = ?`,
      [targetId]
    );
    res.json(parseSkills(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /:id  — singolo utente
// ═══════════════════════════════════════════════════════════════
router.get('/:id', authenticate, async (req, res) => {
  try {
    const row = await db.get(
      `SELECT u.id, u.username, u.email, u.first_name, u.last_name,
              u.is_active, u.skills, u.clinical_role, u.department_id,
              r.name AS role,
              d.name AS department_name,
              ar.id AS area_id, ar.name AS area_name
       FROM users u JOIN roles r ON u.role_id = r.id
       LEFT JOIN departments d ON u.department_id = d.id
       LEFT JOIN areas ar ON d.area_id = ar.id
       WHERE u.id = ?`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Utente non trovato' });
    res.json(parseSkills(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /:id/constraints
// ═══════════════════════════════════════════════════════════════
router.get('/:id/constraints', authenticate, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT uc.id, uc.constraint_type, st.code AS shift_code, st.name AS shift_name
       FROM user_constraints uc
       JOIN shift_types st ON uc.shift_type_id = st.id
       WHERE uc.user_id = ? AND uc.is_active = 1`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Errore server' });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /:id/constraints
// ═══════════════════════════════════════════════════════════════
router.post('/:id/constraints', authenticate, async (req, res) => {
  try {
    const { shift_type_id, constraint_type } = req.body;
    const ins = await db.run(
      `INSERT INTO user_constraints (user_id, shift_type_id, constraint_type) VALUES (?,?,?)`,
      [req.params.id, shift_type_id, constraint_type]
    );
    const row = await db.get(
      `SELECT id, user_id, shift_type_id, constraint_type FROM user_constraints WHERE id = ?`,
      [ins.id]
    );
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: 'Errore server' });
  }
});

// ═══════════════════════════════════════════════════════════════
// PATCH /:id/skills
// ═══════════════════════════════════════════════════════════════
router.patch('/:id/skills', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { skills } = req.body;
    if (!Array.isArray(skills))
      return res.status(400).json({ error: 'skills deve essere un array.' });

    const normalized = [...new Set(skills.map(t => String(t).trim().toUpperCase()))].filter(t => t.length > 0);
    await db.run(
      `UPDATE users SET skills=? WHERE id=?`,
      [normalized.length > 0 ? JSON.stringify(normalized) : null, req.params.id]
    );
    const updated = await db.get(`SELECT id, first_name, last_name, skills FROM users WHERE id=?`, [req.params.id]);
    if (!updated) return res.status(404).json({ error: 'Utente non trovato' });
    res.json(parseSkills(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
