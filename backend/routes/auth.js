const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username e password richiesti' });

    const user = await db.get(
      `SELECT u.id, u.username, u.email, u.first_name, u.last_name,
              u.clinical_role, u.department_id,
              r.name AS role,
              d.name  AS department_name,
              ar.id   AS area_id,
              ar.name AS area_name,
              u.password_hash
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN departments d ON u.department_id = d.id
       LEFT JOIN areas ar ON d.area_id = ar.id
       WHERE u.username = ? AND u.is_active = 1`,
      [username]
    );

    if (!user) return res.status(401).json({ error: 'Credenziali non valide' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenziali non valide' });

    // Rimuovi password_hash dalla risposta
    const { password_hash, ...userOut } = user;

    const token = jwt.sign(
      {
        id:            user.id,
        username:      user.username,
        role:          user.role,
        department_id: user.department_id || null,
        area_id:       user.area_id       || null,
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, user: userOut });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

module.exports = router;
