const express = require('express');
const db = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { rankCandidates, buildSubstitution } = require('../substitution');
const { buildAbsenceConstraints } = require('../absences');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────
// Helper: carica dati necessari per il ranking
// ─────────────────────────────────────────────────────────────────
async function loadContextForDate(workDate) {
  const [year, month] = [parseInt(workDate.slice(0,4)), parseInt(workDate.slice(5,7))];
  const dim = new Date(year, month, 0).getDate();
  const pad = n => String(n).padStart(2,'0');
  const monthStart = `${year}-${pad(month)}-01`;
  const monthEnd   = `${year}-${pad(month)}-${pad(dim)}`;

  // 3 mesi precedenti per storico equity
  const histStart = new Date(`${workDate}T00:00:00Z`);
  histStart.setMonth(histStart.getMonth() - 3);
  const histStartStr = histStart.toISOString().slice(0,10);

  const [staff, todayAssignments, monthAssignments, historyAssignments,
         qualifications, constraints, absences] = await Promise.all([
    db.all(`
      SELECT u.id, u.first_name, u.last_name, u.is_active,
             u.night_exemption, u.exemption_scope,
             u.night_exemption_from, u.night_exemption_until
      FROM users u WHERE u.is_active = 1
    `),
    db.all(`
      SELECT sa.user_id, sa.work_date, st.id AS shift_type_id,
             st.code AS shift_code, st.name AS shift_name,
             st.start_time, st.end_time,
             st.duration_hours, st.is_night,
             sa.is_overtime
      FROM schedule_assignments sa
      JOIN shift_types st ON sa.shift_type_id = st.id
      WHERE sa.work_date = ?
    `, [workDate]),
    db.all(`
      SELECT sa.user_id, sa.work_date, st.id AS shift_type_id,
             st.code AS shift_code, st.duration_hours,
             COALESCE(st.is_night, 0) AS is_night,
             COALESCE(sa.is_overtime, 0) AS is_overtime
      FROM schedule_assignments sa
      JOIN shift_types st ON sa.shift_type_id = st.id
      WHERE sa.work_date >= ? AND sa.work_date <= ?
    `, [monthStart, monthEnd]),
    db.all(`
      SELECT sa.user_id,
             sa.work_date,
             st.code AS shift_code,
             st.duration_hours,
             COALESCE(st.is_night, 0) AS is_night,
             COALESCE(sa.is_overtime, 0) AS is_overtime
      FROM schedule_assignments sa
      JOIN shift_types st ON sa.shift_type_id = st.id
      WHERE sa.work_date >= ? AND sa.work_date < ?
    `, [histStartStr, monthStart]),
    db.all(`SELECT * FROM user_qualifications`).catch(() => []),
    db.all(`SELECT * FROM user_constraints WHERE is_active = 1`).catch(() => []),
    db.all(`
      SELECT * FROM absences
      WHERE status = 'approved'
        AND start_date <= ? AND end_date >= ?
    `, [monthEnd, monthStart]),
  ]);

  // Normalizza constraints come mappa { userId: { shiftId: type } }
  const constraintsMap = {};
  for (const c of constraints) {
    if (!constraintsMap[c.user_id]) constraintsMap[c.user_id] = {};
    constraintsMap[c.user_id][c.shift_type_id] = c.constraint_type;
  }

  // Normalizza history per nurse_id (usato da computeLoads)
  const historyNorm = historyAssignments.map(a => ({
    nurse_id:       a.user_id,
    nurse_name:     '',
    work_date:      a.work_date,
    shift_code:     a.shift_code,
    duration_hours: a.duration_hours,
    is_night:       Boolean(a.is_night),
    is_overtime:    Boolean(a.is_overtime),
  }));

  const absenceMap = buildAbsenceConstraints(absences, staff, year, month, dim);

  return {
    staff, todayAssignments, monthAssignments,
    historyAssignments: historyNorm,
    qualifications, constraintsMap, absenceMap,
    year, month, dim,
  };
}

// ─────────────────────────────────────────────────────────────────
/**
 * GET /api/substitutions/suggest
 *
 * Suggerisce i candidati per coprire un turno vacante.
 *
 * Query params:
 *   date          'YYYY-MM-DD'       (obbligatorio)
 *   shift_id      id del turno       (obbligatorio)
 *   absent_id     nurse_id assente   (obbligatorio)
 *   department    reparto            (opzionale)
 *   allow_overtime  true/false       (default true)
 *   allow_recall    true/false       (default true)
 */
router.get('/suggest', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { date, shift_id, absent_id, department,
            allow_overtime = 'true', allow_recall = 'true' } = req.query;

    if (!date || !shift_id || !absent_id) {
      return res.status(400).json({
        error: 'Parametri obbligatori mancanti: date, shift_id, absent_id',
      });
    }

    const vacantShift = await db.get(
      'SELECT id, code, name, start_time, end_time, duration_hours, COALESCE(is_night,0) AS is_night FROM shift_types WHERE id = ?',
      [shift_id]
    );
    if (!vacantShift) return res.status(404).json({ error: 'Turno non trovato' });

    const ctx = await loadContextForDate(date);

    const ranking = rankCandidates({
      workDate:            date,
      vacantShift,
      absentNurseId:       parseInt(absent_id),
      staff:               ctx.staff,
      todayAssignments:    ctx.todayAssignments,
      monthAssignments:    ctx.monthAssignments,
      historyAssignments:  ctx.historyAssignments,
      absenceMap:          ctx.absenceMap,
      qualifications:      ctx.qualifications,
      constraints:         ctx.constraintsMap,
      department:          department || null,
      allowOvertime:       allow_overtime !== 'false',
      allowRecall:         allow_recall  !== 'false',
    });

    res.json(ranking);
  } catch (err) {
    console.error('[substitutions GET /suggest]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
/**
 * POST /api/substitutions/apply
 *
 * Applica la sostituzione: crea l'assegnazione e registra lo storico.
 *
 * Body: {
 *   date, shift_id, absent_id,
 *   substitute_id, absence_reason,
 *   schedule_id,        (opzionale — se esiste il planning del mese)
 *   department,         (opzionale)
 *   notes
 * }
 */
router.post('/apply', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const {
      date, shift_id, absent_id,
      substitute_id, absence_reason = 'malattia_improvvisa',
      schedule_id, department, notes,
    } = req.body;

    if (!date || !shift_id || !absent_id || !substitute_id) {
      return res.status(400).json({
        error: 'Campi obbligatori: date, shift_id, absent_id, substitute_id',
      });
    }

    const vacantShift = await db.get(
      'SELECT id, code, name, start_time, end_time, duration_hours, COALESCE(is_night,0) AS is_night FROM shift_types WHERE id = ?',
      [shift_id]
    );
    if (!vacantShift) return res.status(404).json({ error: 'Turno non trovato' });

    const ctx = await loadContextForDate(date);

    // Ricalcola ranking per ottenere dati candidato
    const ranking = rankCandidates({
      workDate:           date,
      vacantShift,
      absentNurseId:      parseInt(absent_id),
      staff:              ctx.staff,
      todayAssignments:   ctx.todayAssignments,
      monthAssignments:   ctx.monthAssignments,
      historyAssignments: ctx.historyAssignments,
      absenceMap:         ctx.absenceMap,
      qualifications:     ctx.qualifications,
      constraints:        ctx.constraintsMap,
      department:         department || null,
      allowOvertime:      true,
      allowRecall:        true,
    });

    // Costruisce la sostituzione
    const { substitution, scheduleAssignment, isOvertime } =
      buildSubstitution(ranking, parseInt(substitute_id), absence_reason, req.user.id);

    // Trova o crea schedule per questo mese
    let schedId = schedule_id;
    if (!schedId) {
      const existing = await db.get(
        'SELECT id FROM schedules WHERE year = ? AND month = ?',
        [ctx.year, ctx.month]
      );
      schedId = existing?.id || null;
    }

    // Inserisce/aggiorna assegnazione nel calendario
    if (schedId) {
      // Rimuove eventuale assegnazione precedente dell'assente per quel giorno
      await db.run(
        'DELETE FROM schedule_assignments WHERE schedule_id = ? AND user_id = ? AND work_date = ?',
        [schedId, absent_id, date]
      );

      // Aggiunge il sostituto
      await db.run(
        `INSERT OR REPLACE INTO schedule_assignments
           (schedule_id, user_id, work_date, shift_type_id, is_overtime)
         VALUES (?, ?, ?, ?, ?)`,
        [schedId, substitute_id, date, shift_id, scheduleAssignment.is_overtime]
      );
    }

    // Registra straordinario se necessario
    if (isOvertime) {
      await db.run(
        `INSERT OR IGNORE INTO overtime_assignments
           (user_id, work_date, shift_type_id, overtime_hours, reason, authorized_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          substitute_id, date, shift_id,
          vacantShift.duration_hours,
          `Sostituzione emergenza — assente infermiere #${absent_id} (${absence_reason})`,
          req.user.id,
        ]
      ).catch(() => {}); // tabella potrebbe non esistere
    }

    // Salva storico sostituzione
    const insertResult = await db.run(
      `INSERT INTO emergency_substitutions
         (schedule_id, work_date, shift_type_id,
          absent_user_id, absence_reason,
          substitute_user_id, substitution_type, status,
          confirmed_by, confirmed_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'filled', ?, datetime('now'), ?)`,
      [
        schedId || null, date, shift_id,
        absent_id, absence_reason,
        substitute_id, substitution.substitution_type,
        req.user.id, notes || null,
      ]
    );

    const created = await db.get(
      'SELECT * FROM emergency_substitutions WHERE id = ?',
      [insertResult.id]
    );

    res.status(201).json({
      substitution:      created,
      schedule_updated:  Boolean(schedId),
      is_overtime:       isOvertime,
      substitute: ranking.candidates.find(c => c.nurse_id === parseInt(substitute_id)),
    });
  } catch (err) {
    console.error('[substitutions POST /apply]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
/**
 * GET /api/substitutions/history
 *
 * Storico sostituzioni con filtri.
 * Query: user_id, date_from, date_to, status, limit (default 50)
 */
router.get('/history', authenticate, async (req, res) => {
  try {
    const { user_id, date_from, date_to, status, limit = 50 } = req.query;

    let where = [];
    const params = [];

    // Staff vede solo le proprie
    if (req.user.role === 'staff') {
      where.push('(es.absent_user_id = ? OR es.substitute_user_id = ?)');
      params.push(req.user.id, req.user.id);
    } else if (user_id) {
      where.push('(es.absent_user_id = ? OR es.substitute_user_id = ?)');
      params.push(user_id, user_id);
    }

    if (date_from) { where.push('es.work_date >= ?'); params.push(date_from); }
    if (date_to)   { where.push('es.work_date <= ?'); params.push(date_to);   }
    if (status)    { where.push('es.status = ?');     params.push(status);    }

    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
    params.push(parseInt(limit));

    const rows = await db.all(`
      SELECT es.*,
             ua.first_name || ' ' || ua.last_name AS absent_nurse_name,
             us.first_name || ' ' || us.last_name AS substitute_nurse_name,
             uc.first_name || ' ' || uc.last_name AS confirmed_by_name,
             st.code AS shift_code, st.name AS shift_name,
             st.start_time, st.end_time, st.duration_hours
      FROM emergency_substitutions es
      JOIN users ua ON es.absent_user_id = ua.id
      LEFT JOIN users us ON es.substitute_user_id = us.id
      LEFT JOIN users uc ON es.confirmed_by = uc.id
      JOIN shift_types st ON es.shift_type_id = st.id
      ${whereStr}
      ORDER BY es.work_date DESC, es.created_at DESC
      LIMIT ?
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('[substitutions GET /history]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
/**
 * GET /api/substitutions/open
 * Turni ancora vacanti (status='open') — per dashboard coordinatore
 */
router.get('/open', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT es.*,
             ua.first_name || ' ' || ua.last_name AS absent_nurse_name,
             st.code AS shift_code, st.name AS shift_name,
             st.start_time, st.end_time
      FROM emergency_substitutions es
      JOIN users ua ON es.absent_user_id = ua.id
      JOIN shift_types st ON es.shift_type_id = st.id
      WHERE es.status IN ('open','suggested')
      ORDER BY es.work_date ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('[substitutions GET /open]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
/**
 * POST /api/substitutions/open
 * Registra un'assenza improvvisa senza ancora un sostituto.
 *
 * Body: { date, shift_id, absent_id, absence_reason, schedule_id, notes }
 */
router.post('/open', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { date, shift_id, absent_id,
            absence_reason = 'malattia_improvvisa',
            schedule_id, notes } = req.body;

    if (!date || !shift_id || !absent_id) {
      return res.status(400).json({ error: 'date, shift_id, absent_id obbligatori' });
    }

    // Rimuove l'assente dal planning
    if (schedule_id) {
      await db.run(
        'DELETE FROM schedule_assignments WHERE schedule_id = ? AND user_id = ? AND work_date = ?',
        [schedule_id, absent_id, date]
      );
    }

    const result = await db.run(
      `INSERT INTO emergency_substitutions
         (schedule_id, work_date, shift_type_id, absent_user_id,
          absence_reason, status, created_by, notes)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
      [schedule_id || null, date, shift_id, absent_id,
       absence_reason, req.user.id, notes || null]
    );

    const created = await db.get(
      'SELECT * FROM emergency_substitutions WHERE id = ?', [result.id]
    );

    res.status(201).json(created);
  } catch (err) {
    console.error('[substitutions POST /open]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
/**
 * GET /api/substitutions/:id
 */
router.get('/:id', authenticate, async (req, res) => {
  try {
    const row = await db.get(`
      SELECT es.*,
             ua.first_name || ' ' || ua.last_name AS absent_nurse_name,
             us.first_name || ' ' || us.last_name AS substitute_nurse_name,
             st.code AS shift_code, st.name AS shift_name
      FROM emergency_substitutions es
      JOIN users ua ON es.absent_user_id = ua.id
      LEFT JOIN users us ON es.substitute_user_id = us.id
      JOIN shift_types st ON es.shift_type_id = st.id
      WHERE es.id = ?
    `, [req.params.id]);

    if (!row) return res.status(404).json({ error: 'Sostituzione non trovata' });
    res.json(row);
  } catch (err) {
    console.error('[substitutions GET /:id]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
