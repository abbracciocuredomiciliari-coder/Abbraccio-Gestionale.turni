const express = require('express');
const db = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/overtime ── Registro straordinari (filtrabile per user, anno, mese)
router.get('/', authenticate, async (req, res) => {
  try {
    const { user_id, year, month } = req.query;
    const isCoord = req.user.role === 'coordinator' || req.user.role === 'admin';
    const targetUserId = isCoord && user_id ? Number(user_id) : req.user.id;

    let sql = `
      SELECT oa.id, oa.work_date, oa.overtime_hours, oa.reason,
             u.first_name, u.last_name,
             st.code AS shift_code, st.name AS shift_name, st.color,
             auth.first_name AS auth_first, auth.last_name AS auth_last
      FROM overtime_assignments oa
      JOIN users u ON oa.user_id = u.id
      JOIN shift_types st ON oa.shift_type_id = st.id
      LEFT JOIN users auth ON oa.authorized_by = auth.id
      WHERE oa.user_id = ?`;
    const params = [targetUserId];

    if (year) { sql += ' AND strftime("%Y", oa.work_date) = ?'; params.push(String(year)); }
    if (month) { sql += ' AND strftime("%m", oa.work_date) = ?'; params.push(String(month).padStart(2, '0')); }
    sql += ' ORDER BY oa.work_date DESC';

    const rows = await db.all(sql, params);

    // Calcola totali
    const totalHoursMonth = rows
      .filter(r => year && month &&
        r.work_date.startsWith(`${year}-${String(month).padStart(2,'0')}`))
      .reduce((s, r) => s + r.overtime_hours, 0);

    const totalHoursYear = rows
      .filter(r => year && r.work_date.startsWith(String(year)))
      .reduce((s, r) => s + r.overtime_hours, 0);

    // Limiti per questo utente/anno
    const limits = await db.get(
      `SELECT max_hours_month, max_hours_year FROM overtime_limits WHERE user_id = ? AND year = ?`,
      [targetUserId, year || new Date().getFullYear()]
    );
    const rules = await db.all(`SELECT rule_key, rule_value FROM work_rules`);
    const ruleMap = Object.fromEntries(rules.map(r => [r.rule_key, r.rule_value]));

    res.json({
      entries: rows,
      summary: {
        total_hours_month: totalHoursMonth,
        total_hours_year: totalHoursYear,
        limit_month: limits?.max_hours_month ?? ruleMap.max_overtime_hours_month,
        limit_year: limits?.max_hours_year ?? ruleMap.max_overtime_hours_year,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

// ── POST /api/overtime ── Registra straordinario (coordinatore)
router.post('/', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { user_id, work_date, shift_type_id, overtime_hours, reason, schedule_id } = req.body;
    if (!user_id || !work_date || !shift_type_id || !overtime_hours) {
      return res.status(400).json({ error: 'Campi obbligatori: user_id, work_date, shift_type_id, overtime_hours' });
    }

    // Verifica limiti
    const year = new Date(work_date).getFullYear();
    const month = new Date(work_date).getMonth() + 1;
    const rules = await db.all(`SELECT rule_key, rule_value FROM work_rules`);
    const ruleMap = Object.fromEntries(rules.map(r => [r.rule_key, r.rule_value]));
    const limits = await db.get(
      `SELECT max_hours_month, max_hours_year FROM overtime_limits WHERE user_id = ? AND year = ?`,
      [user_id, year]
    );
    const maxMonth = limits?.max_hours_month ?? ruleMap.max_overtime_hours_month;
    const maxYear  = limits?.max_hours_year  ?? ruleMap.max_overtime_hours_year;

    const pad = n => String(n).padStart(2, '0');
    const usedMonth = await db.get(
      `SELECT COALESCE(SUM(overtime_hours),0) AS tot FROM overtime_assignments
       WHERE user_id = ? AND strftime('%Y-%m', work_date) = ?`,
      [user_id, `${year}-${pad(month)}`]
    );
    const usedYear = await db.get(
      `SELECT COALESCE(SUM(overtime_hours),0) AS tot FROM overtime_assignments
       WHERE user_id = ? AND strftime('%Y', work_date) = ?`,
      [user_id, String(year)]
    );

    const warnings = [];
    if (usedMonth.tot + overtime_hours > maxMonth)
      warnings.push(`Supera il limite mensile di ${maxMonth}h (usate ${usedMonth.tot}h)`);
    if (usedYear.tot + overtime_hours > maxYear)
      warnings.push(`Supera il limite annuale di ${maxYear}h (usate ${usedYear.tot}h)`);

    const result = await db.run(
      `INSERT INTO overtime_assignments (user_id, work_date, shift_type_id, overtime_hours, reason, authorized_by, schedule_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user_id, work_date, shift_type_id, overtime_hours, reason || null, req.user.id, schedule_id || null]
    );

    // Se è un giorno di riposo trasformato in straordinario, registra anche il riposo da recuperare
    const recoveryDeadline = new Date(work_date);
    const expiryMonths = ruleMap.rest_recovery_expiry_months || 18;
    recoveryDeadline.setMonth(recoveryDeadline.getMonth() + expiryMonths);

    await db.run(
      `INSERT INTO rest_recovery (user_id, accrued_date, reason, hours_owed, recovery_deadline)
       VALUES (?, ?, ?, ?, ?)`,
      [user_id, work_date,
       `Straordinario del ${work_date} — ${reason || 'esigenza di servizio'}`,
       ruleMap.max_hours_per_day_normal || 8,
       recoveryDeadline.toISOString().split('T')[0]]
    );

    const entry = await db.get(`SELECT * FROM overtime_assignments WHERE id = ?`, [result.id]);
    res.status(201).json({ entry, warnings: warnings.length ? warnings : undefined });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

// ── DELETE /api/overtime/:id ── Rimuove straordinario (coordinatore)
router.delete('/:id', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const r = await db.run(`DELETE FROM overtime_assignments WHERE id = ?`, [req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'Record non trovato' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

// ── GET /api/overtime/rest-recovery ── Riposi da recuperare
router.get('/rest-recovery', authenticate, async (req, res) => {
  try {
    const { user_id, year } = req.query;
    const isCoord = req.user.role === 'coordinator' || req.user.role === 'admin';
    const targetUserId = isCoord && user_id ? Number(user_id) : req.user.id;

    let sql = `
      SELECT rr.id, rr.accrued_date, rr.reason, rr.hours_owed, rr.hours_recovered,
             rr.recovery_deadline, rr.recovered_on, rr.note,
             u.first_name, u.last_name,
             (rr.hours_owed - rr.hours_recovered) AS hours_pending
      FROM rest_recovery rr
      JOIN users u ON rr.user_id = u.id
      WHERE rr.user_id = ?`;
    const params = [targetUserId];
    if (year) { sql += ` AND strftime('%Y', rr.accrued_date) = ?`; params.push(String(year)); }
    sql += ' ORDER BY rr.recovery_deadline ASC';

    const rows = await db.all(sql, params);
    const totalPending = rows.reduce((s, r) => s + (r.hours_owed - r.hours_recovered), 0);
    const overdue = rows.filter(r => r.recovery_deadline < new Date().toISOString().split('T')[0] && r.hours_owed > r.hours_recovered);

    res.json({ entries: rows, total_pending_hours: totalPending, overdue_count: overdue.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

// ── PATCH /api/overtime/rest-recovery/:id ── Segna riposo come recuperato
router.patch('/rest-recovery/:id', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { hours_recovered, recovered_on, note } = req.body;
    const row = await db.get(`SELECT * FROM rest_recovery WHERE id = ?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Record non trovato' });

    const newRecovered = Math.min(row.hours_owed, (row.hours_recovered || 0) + (hours_recovered || row.hours_owed));
    await db.run(
      `UPDATE rest_recovery SET hours_recovered = ?, recovered_on = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [newRecovered, recovered_on || new Date().toISOString().split('T')[0], note || row.note, req.params.id]
    );
    const updated = await db.get(`SELECT * FROM rest_recovery WHERE id = ?`, [req.params.id]);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

// ── GET /api/overtime/summary/all ── Riepilogo tutti gli infermieri (coordinatore)
router.get('/summary/all', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { year, month } = req.query;
    const y = year || new Date().getFullYear();
    const pad = n => String(n).padStart(2, '0');

    const staff = await db.all(
      `SELECT u.id, u.first_name, u.last_name FROM users u
       JOIN roles r ON u.role_id = r.id WHERE r.name = 'staff' AND u.is_active = 1 ORDER BY u.last_name`
    );
    const rules = await db.all(`SELECT rule_key, rule_value FROM work_rules`);
    const ruleMap = Object.fromEntries(rules.map(r => [r.rule_key, r.rule_value]));

    const result = [];
    for (const person of staff) {
      const hoursYear = await db.get(
        `SELECT COALESCE(SUM(overtime_hours),0) AS tot FROM overtime_assignments
         WHERE user_id = ? AND strftime('%Y', work_date) = ?`, [person.id, String(y)]
      );
      let hoursMonth = { tot: 0 };
      if (month) {
        hoursMonth = await db.get(
          `SELECT COALESCE(SUM(overtime_hours),0) AS tot FROM overtime_assignments
           WHERE user_id = ? AND strftime('%Y-%m', work_date) = ?`,
          [person.id, `${y}-${pad(month)}`]
        );
      }
      const restPending = await db.get(
        `SELECT COALESCE(SUM(hours_owed - hours_recovered),0) AS tot FROM rest_recovery
         WHERE user_id = ? AND strftime('%Y', accrued_date) = ?`, [person.id, String(y)]
      );
      const limits = await db.get(
        `SELECT max_hours_month, max_hours_year FROM overtime_limits WHERE user_id = ? AND year = ?`,
        [person.id, y]
      );

      result.push({
        ...person,
        overtime_hours_month: hoursMonth.tot,
        overtime_hours_year: hoursYear.tot,
        rest_pending_hours: restPending.tot,
        limit_month: limits?.max_hours_month ?? ruleMap.max_overtime_hours_month,
        limit_year: limits?.max_hours_year ?? ruleMap.max_overtime_hours_year,
      });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

// ── GET/PUT /api/overtime/limits/:userId ── Limiti individuali
router.get('/limits/:userId', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const row = await db.get(
      `SELECT * FROM overtime_limits WHERE user_id = ? AND year = ?`, [req.params.userId, year]
    );
    res.json(row || null);
  } catch (err) { res.status(500).json({ error: 'Errore server' }); }
});

router.put('/limits/:userId', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { year, max_hours_month, max_hours_year, note } = req.body;
    await db.run(
      `INSERT INTO overtime_limits (user_id, year, max_hours_month, max_hours_year, note, set_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, year) DO UPDATE SET
         max_hours_month = excluded.max_hours_month,
         max_hours_year = excluded.max_hours_year,
         note = excluded.note,
         set_by = excluded.set_by`,
      [req.params.userId, year, max_hours_month, max_hours_year, note || null, req.user.id]
    );
    const updated = await db.get(
      `SELECT * FROM overtime_limits WHERE user_id = ? AND year = ?`, [req.params.userId, year]
    );
    res.json(updated);
  } catch (err) { res.status(500).json({ error: 'Errore server' }); }
});

module.exports = router;
