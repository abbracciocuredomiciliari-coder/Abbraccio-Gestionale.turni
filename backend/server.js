require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const requestsRoutes = require('./routes/requests');
const schedulesRoutes = require('./routes/schedules');
const shiftsRoutes = require('./routes/shifts');
const overtimeRoutes = require('./routes/overtime');
const workRulesRoutes = require('./routes/work-rules');
const balanceRoutes  = require('./routes/balance');
const validateRoutes = require('./routes/validate');
const equityRoutes   = require('./routes/equity');
const reportsRoutes   = require('./routes/reports');
const absencesRoutes       = require('./routes/absences');
const substitutionsRoutes  = require('./routes/substitutions');
const skillsRoutes         = require('./routes/skills');
const auditRoutes          = require('./routes/audit');
const oncallRoutes         = require('./routes/oncall');
const teamsRoutes          = require('./routes/teams');
const departmentsRoutes    = require('./routes/departments');
const areasRoutes          = require('./routes/areas');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/requests', requestsRoutes);
app.use('/api/schedules', schedulesRoutes);
app.use('/api/shifts', shiftsRoutes);
app.use('/api/overtime', overtimeRoutes);
app.use('/api/work-rules', workRulesRoutes);
app.use('/api/balance',   balanceRoutes);
app.use('/api/validate',  validateRoutes);
app.use('/api/equity',    equityRoutes);
app.use('/api/reports',   reportsRoutes);
app.use('/api/absences',       absencesRoutes);
app.use('/api/substitutions',  substitutionsRoutes);
app.use('/api/skills',         skillsRoutes);
app.use('/api/audit',          auditRoutes);
app.use('/api/oncall',         oncallRoutes);
app.use('/api/teams',          teamsRoutes);
app.use('/api/departments',    departmentsRoutes);
app.use('/api/areas',          areasRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server OPBGestionale in ascolto su porta ${PORT}`);
});
