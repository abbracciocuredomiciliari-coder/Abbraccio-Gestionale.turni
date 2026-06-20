'use strict';
/**
 * routes/audit.js — Audit Trail Solver
 *
 * Endpoints:
 *   GET /api/audit/assignment/:assignmentId   → spiegazione di una singola assegnazione
 *   GET /api/audit/nurse/:userId              → report motivazioni per un infermiere (mese/anno)
 *   GET /api/audit/schedule/:scheduleId       → riepilogo run solver per un planning
 *   GET /api/audit/schedule/:scheduleId/runs  → elenco run (rigenerazioni)
 */

const express  = require('express');
const db       = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════
// GET /api/audit/assignment/:assignmentId
// Spiegazione dettagliata di UNA singola assegnazione
// Accessibile: infermiere stesso (own data) o coordinatore/admin
// ═══════════════════════════════════════════════════════════════════
router.get('/assignment/:assignmentId', authenticate, async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const row = await db.get(
      `SELECT
         sal.id,
         sal.user_id,
         sal.work_date,
         sal.shift_code,
         sal.shift_type_id,
         sal.candidate_rank,
         sal.equity_score,
         sal.historical_score,
         sal.shifts_month_so_far,
         sal.nights_month_so_far,
         sal.consecutive_days,
         sal.is_night,
         sal.is_weekend,
         sal.is_overtime,
         sal.preference_violated,
         sal.preference_reason,
         sal.qualifying_skill,
         sal.primary_reason,
         sal.explanation,
         sal.pool_size,
         sal.created_at,
         u.first_name,
         u.last_name,
         st.name      AS shift_name,
         st.start_time,
         st.end_time,
         st.duration_hours,
         srl.final_penalty,
         srl.violations_count,
         srl.generated_at
       FROM solver_assignment_log sal
       JOIN users u       ON sal.user_id       = u.id
       JOIN shift_types st ON sal.shift_type_id = st.id
       LEFT JOIN solver_run_log srl ON sal.run_id = srl.id
       WHERE sal.assignment_id = ?`,
      [assignmentId]
    );

    if (!row) {
      return res.status(404).json({
        error: 'Nessuna spiegazione disponibile per questa assegnazione.',
        hint:  'La spiegazione è disponibile solo per planning generati dopo l\'introduzione dell\'audit trail.',
      });
    }

    // Verifica accesso: l'infermiere può leggere solo i propri dati
    const isOwn = req.user.id === row.user_id;
    const isCoord = ['coordinator', 'admin'].includes(req.user.role);
    if (!isOwn && !isCoord) {
      return res.status(403).json({ error: 'Accesso negato.' });
    }

    const primaryReasonLabel = {
      EQUITY:             'Bilanciamento carico di lavoro',
      SKILL_REQUIRED:     'Competenza clinica richiesta',
      COVERAGE_ONLY:      'Copertura minima turno',
      OVERTIME:           'Straordinario — copertura emergenza',
      PREFERENCE_IGNORED: 'Preferenza ignorata per necessità di copertura',
    };

    res.json({
      assignment: {
        user_id:    row.user_id,
        nurse_name: `${row.first_name} ${row.last_name}`,
        work_date:  row.work_date,
        shift:      { code: row.shift_code, name: row.shift_name, start: row.start_time, end: row.end_time, hours: row.duration_hours },
        is_night:   Boolean(row.is_night),
        is_weekend: Boolean(row.is_weekend),
        is_overtime: Boolean(row.is_overtime),
      },
      decision: {
        primary_reason:       row.primary_reason,
        primary_reason_label: primaryReasonLabel[row.primary_reason] || row.primary_reason,
        explanation:          row.explanation,
        qualifying_skill:     row.qualifying_skill || null,
        preference_violated:  Boolean(row.preference_violated),
        preference_reason:    row.preference_reason || null,
      },
      metrics_at_assignment: {
        equity_score:        row.equity_score,
        historical_score:    row.historical_score,
        shifts_this_month:   row.shifts_month_so_far,
        nights_this_month:   row.nights_month_so_far,
        consecutive_days:    row.consecutive_days,
        candidate_rank:      row.candidate_rank,
        pool_size:           row.pool_size,
        rank_note:           row.pool_size > 0
          ? `Scelto come ${row.candidate_rank}° su ${row.pool_size} candidati disponibili.`
          : null,
      },
      run_context: {
        generated_at:     row.generated_at,
        final_penalty:    row.final_penalty,
        violations_count: row.violations_count,
      },
    });
  } catch (err) {
    console.error('[audit GET /assignment]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/audit/nurse/:userId?year=2026&month=8
// Report completo motivazioni per un infermiere in un dato mese
// ═══════════════════════════════════════════════════════════════════
router.get('/nurse/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { year, month } = req.query;

    const isOwn  = String(req.user.id) === String(userId);
    const isCoord = ['coordinator', 'admin'].includes(req.user.role);
    if (!isOwn && !isCoord) {
      return res.status(403).json({ error: 'Accesso negato.' });
    }

    if (!year || !month) {
      return res.status(400).json({ error: 'Parametri year e month obbligatori.' });
    }

    const monthPad = String(month).padStart(2, '0');
    const dateFrom = `${year}-${monthPad}-01`;
    const dateTo   = `${year}-${monthPad}-31`;

    const nurse = await db.get(
      `SELECT id, first_name, last_name FROM users WHERE id = ?`, [userId]
    );
    if (!nurse) return res.status(404).json({ error: 'Infermiere non trovato.' });

    const entries = await db.all(
      `SELECT
         sal.id,
         sal.assignment_id,
         sal.work_date,
         sal.shift_code,
         sal.shift_type_id,
         sal.is_night,
         sal.is_weekend,
         sal.is_overtime,
         sal.preference_violated,
         sal.preference_reason,
         sal.qualifying_skill,
         sal.primary_reason,
         sal.explanation,
         sal.equity_score,
         sal.historical_score,
         sal.shifts_month_so_far,
         sal.nights_month_so_far,
         sal.consecutive_days,
         sal.candidate_rank,
         sal.pool_size,
         st.name AS shift_name,
         st.start_time,
         st.end_time
       FROM solver_assignment_log sal
       JOIN shift_types st ON sal.shift_type_id = st.id
       WHERE sal.user_id = ?
         AND sal.work_date >= ?
         AND sal.work_date <= ?
       ORDER BY sal.work_date, st.start_time`,
      [userId, dateFrom, dateTo]
    );

    if (entries.length === 0) {
      return res.status(404).json({
        error: `Nessuna spiegazione disponibile per ${nurse.first_name} ${nurse.last_name} nel mese ${month}/${year}.`,
        hint:  'Le spiegazioni sono disponibili solo per planning generati con il sistema di audit trail attivo.',
      });
    }

    // Statistiche aggregate
    const stats = {
      total_shifts:      entries.length,
      night_shifts:      entries.filter(e => e.is_night).length,
      weekend_shifts:    entries.filter(e => e.is_weekend).length,
      overtime_shifts:   entries.filter(e => e.is_overtime).length,
      pref_violated:     entries.filter(e => e.preference_violated).length,
      by_reason: {},
    };
    for (const e of entries) {
      stats.by_reason[e.primary_reason] = (stats.by_reason[e.primary_reason] || 0) + 1;
    }

    // Raggruppa avvisi di trasparenza (turni "scomodi")
    const alerts = [];
    const nightEntries = entries.filter(e => e.is_night);
    if (nightEntries.length > 0) {
      alerts.push({
        type: 'NIGHT_SHIFTS',
        count: nightEntries.length,
        message: `${nightEntries.length} turni notturni assegnati questo mese.`,
        dates: nightEntries.map(e => e.work_date),
      });
    }
    const prefViolated = entries.filter(e => e.preference_violated);
    if (prefViolated.length > 0) {
      alerts.push({
        type: 'PREFERENCE_IGNORED',
        count: prefViolated.length,
        message: `${prefViolated.length} turni assegnati nonostante una preferenza registrata: la copertura minima non era altrimenti garantita.`,
        dates: prefViolated.map(e => e.work_date),
        reasons: [...new Set(prefViolated.map(e => e.preference_reason).filter(Boolean))],
      });
    }
    const otEntries = entries.filter(e => e.is_overtime);
    if (otEntries.length > 0) {
      alerts.push({
        type: 'OVERTIME',
        count: otEntries.length,
        message: `${otEntries.length} turni in straordinario: era necessaria la copertura e non erano disponibili alternative.`,
        dates: otEntries.map(e => e.work_date),
      });
    }

    res.json({
      nurse:   { id: nurse.id, name: `${nurse.first_name} ${nurse.last_name}` },
      period:  { year: parseInt(year), month: parseInt(month) },
      stats,
      alerts,
      assignments: entries.map(e => ({
        log_id:       e.id,
        assignment_id: e.assignment_id,
        work_date:    e.work_date,
        shift:        { code: e.shift_code, name: e.shift_name, start: e.start_time, end: e.end_time },
        is_night:     Boolean(e.is_night),
        is_weekend:   Boolean(e.is_weekend),
        is_overtime:  Boolean(e.is_overtime),
        primary_reason: e.primary_reason,
        explanation:  e.explanation,
        preference_violated: Boolean(e.preference_violated),
        preference_reason:   e.preference_reason || null,
        qualifying_skill:    e.qualifying_skill || null,
        metrics: {
          equity_score:      e.equity_score,
          shifts_so_far:     e.shifts_month_so_far,
          nights_so_far:     e.nights_month_so_far,
          consecutive_days:  e.consecutive_days,
          rank:              e.candidate_rank,
          pool_size:         e.pool_size,
        },
      })),
    });
  } catch (err) {
    console.error('[audit GET /nurse]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/audit/schedule/:scheduleId
// Riepilogo run solver per un planning (per coordinatore)
// ═══════════════════════════════════════════════════════════════════
router.get('/schedule/:scheduleId', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { scheduleId } = req.params;

    const run = await db.get(
      `SELECT
         srl.*,
         u.first_name || ' ' || u.last_name AS generated_by_name
       FROM solver_run_log srl
       LEFT JOIN users u ON srl.generated_by = u.id
       WHERE srl.schedule_id = ?
       ORDER BY srl.generated_at DESC
       LIMIT 1`,
      [scheduleId]
    );

    if (!run) {
      return res.status(404).json({
        error: 'Nessun log di run disponibile per questo planning.',
        hint: 'L\'audit trail è disponibile solo per planning generati dopo l\'attivazione del sistema.',
      });
    }

    // Statistiche per tipo di motivazione
    const reasonStats = await db.all(
      `SELECT primary_reason, COUNT(*) AS count,
              SUM(is_night) AS nights, SUM(is_overtime) AS overtimes,
              SUM(preference_violated) AS pref_violated
       FROM solver_assignment_log
       WHERE schedule_id = ?
       GROUP BY primary_reason
       ORDER BY count DESC`,
      [scheduleId]
    );

    // Infermieri con più violazioni preferenza
    const prefViolations = await db.all(
      `SELECT sal.user_id,
              u.first_name || ' ' || u.last_name AS nurse_name,
              COUNT(*) AS violations_count,
              GROUP_CONCAT(sal.work_date, ', ') AS dates
       FROM solver_assignment_log sal
       JOIN users u ON sal.user_id = u.id
       WHERE sal.schedule_id = ? AND sal.preference_violated = 1
       GROUP BY sal.user_id
       ORDER BY violations_count DESC`,
      [scheduleId]
    );

    // Overtime
    const overtimes = await db.all(
      `SELECT sal.user_id,
              u.first_name || ' ' || u.last_name AS nurse_name,
              COUNT(*) AS ot_count,
              GROUP_CONCAT(sal.work_date, ', ') AS dates
       FROM solver_assignment_log sal
       JOIN users u ON sal.user_id = u.id
       WHERE sal.schedule_id = ? AND sal.is_overtime = 1
       GROUP BY sal.user_id
       ORDER BY ot_count DESC`,
      [scheduleId]
    );

    run.violations_json = run.violations_json ? JSON.parse(run.violations_json) : [];

    res.json({
      run: {
        id:               run.id,
        schedule_id:      run.schedule_id,
        generated_at:     run.generated_at,
        generated_by:     run.generated_by_name,
        assignments_count: run.assignments_count,
        final_penalty:    run.final_penalty,
        violations_count: run.violations_count,
        is_feasible:      Boolean(run.is_feasible),
        has_skill_warnings: Boolean(run.has_skill_warnings),
        violations:       run.violations_json,
      },
      reason_breakdown: reasonStats,
      preference_violations: prefViolations,
      overtime_assignments:  overtimes,
    });
  } catch (err) {
    console.error('[audit GET /schedule]', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/audit/schedule/:scheduleId/nurse/:userId
// Report compatto: "Perché ho questi turni?" — vista infermiere su planning specifico
// ═══════════════════════════════════════════════════════════════════
router.get('/schedule/:scheduleId/nurse/:userId', authenticate, async (req, res) => {
  try {
    const { scheduleId, userId } = req.params;

    const isOwn  = String(req.user.id) === String(userId);
    const isCoord = ['coordinator', 'admin'].includes(req.user.role);
    if (!isOwn && !isCoord) {
      return res.status(403).json({ error: 'Accesso negato.' });
    }

    const nurse = await db.get(
      `SELECT id, first_name, last_name FROM users WHERE id = ?`, [userId]
    );
    if (!nurse) return res.status(404).json({ error: 'Infermiere non trovato.' });

    const entries = await db.all(
      `SELECT
         sal.assignment_id,
         sal.work_date,
         sal.shift_code,
         sal.is_night,
         sal.is_weekend,
         sal.is_overtime,
         sal.preference_violated,
         sal.preference_reason,
         sal.qualifying_skill,
         sal.primary_reason,
         sal.explanation,
         sal.candidate_rank,
         sal.pool_size,
         sal.equity_score,
         sal.nights_month_so_far,
         st.name AS shift_name,
         st.start_time,
         st.end_time
       FROM solver_assignment_log sal
       JOIN shift_types st ON sal.shift_type_id = st.id
       WHERE sal.schedule_id = ? AND sal.user_id = ?
       ORDER BY sal.work_date`,
      [scheduleId, userId]
    );

    if (entries.length === 0) {
      return res.status(404).json({
        error: `Nessuna spiegazione trovata per ${nurse.first_name} ${nurse.last_name} in questo planning.`,
      });
    }

    const schedule = await db.get(
      `SELECT year, month, status FROM schedules WHERE id = ?`, [scheduleId]
    );

    res.json({
      nurse:    { id: nurse.id, name: `${nurse.first_name} ${nurse.last_name}` },
      schedule: schedule,
      summary: {
        total:    entries.length,
        nights:   entries.filter(e => e.is_night).length,
        weekends: entries.filter(e => e.is_weekend).length,
        overtime: entries.filter(e => e.is_overtime).length,
        pref_violated: entries.filter(e => e.preference_violated).length,
      },
      shifts: entries.map(e => ({
        assignment_id: e.assignment_id,
        date:   e.work_date,
        shift:  `${e.shift_code} (${e.shift_name}, ${e.start_time}–${e.end_time})`,
        flags:  [
          e.is_night    ? 'NOTTURNO'    : null,
          e.is_weekend  ? 'WEEKEND'     : null,
          e.is_overtime ? 'STRAORDINARIO' : null,
          e.preference_violated ? 'PREFERENZA IGNORATA' : null,
        ].filter(Boolean),
        reason:      e.primary_reason,
        explanation: e.explanation,
        detail: e.candidate_rank && e.pool_size
          ? `Scelto come ${e.candidate_rank}° su ${e.pool_size} candidati disponibili quel giorno.`
          : null,
      })),
    });
  } catch (err) {
    console.error('[audit GET /schedule/:id/nurse]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
