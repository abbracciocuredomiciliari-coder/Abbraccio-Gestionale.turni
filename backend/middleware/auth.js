const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token mancante' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token non valido' });
  }
}

// Gerarchia ruoli: admin > area_manager > coordinator > staff
const ROLE_HIERARCHY = { admin: 4, area_manager: 3, coordinator: 2, staff: 1 };

function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non autenticato' });
    if (allowed.includes(req.user.role)) return next();
    // admin bypassa sempre
    if (req.user.role === 'admin') return next();
    return res.status(403).json({ error: 'Accesso negato: ruolo insufficiente' });
  };
}

function requireMinRole(minRole) {
  const minLevel = ROLE_HIERARCHY[minRole] || 0;
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Non autenticato' });
    const level = ROLE_HIERARCHY[req.user.role] || 0;
    if (level >= minLevel) return next();
    return res.status(403).json({ error: 'Accesso negato: ruolo insufficiente' });
  };
}

module.exports = { authenticate, requireRole, requireMinRole, JWT_SECRET, ROLE_HIERARCHY };
