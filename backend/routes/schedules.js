const express = require('express');
const db = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { generateSchedule } = require('../scheduler');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const rows = await db.all(
      'SELECT id, year, month, status, created_at FROM schedules ORDER BY year DESC, month DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

router.get('/:year/:month', authenticate, async (req, res) => {
  try {
    const { year, month } = req.params;
    const department_id = req.query.department_id || null;

    let schedule;
    if (department_id) {
      schedule = await db.get(
        'SELECT id, year, month, status FROM schedules WHERE year = ? AND month = ? AND department_id = ?',
        [year, month, department_id]
      );
    } else {
      schedule = await db.get(
        'SELECT id, year, month, status FROM schedules WHERE year = ? AND month = ? ORDER BY id DESC LIMIT 1',
        [year, month]
      );
    }

    if (!schedule) {
      return res.status(404).json({ error: 'Planning non trovato' });
    }

    const assignments = await db.all(
      `SELECT sa.id, sa.work_date, sa.user_id, u.first_name, u.last_name, st.code AS shift_code, st.name AS shift_name, st.color
       FROM schedule_assignments sa
       JOIN users u ON sa.user_id = u.id
       JOIN shift_types st ON sa.shift_type_id = st.id
       WHERE sa.schedule_id = ?
       ORDER BY sa.work_date, st.start_time`,
      [schedule.id]
    );

    res.json({ schedule, assignments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

router.post('/generate', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { year, month, department_id } = req.body;

    // Autorizzazione: se department_id fornito, verifica ownership
    if (department_id) {
      const dept = await db.get(
        `SELECT id FROM departments WHERE id = ? AND coordinator_id = ? AND is_active = 1`,
        [department_id, req.user.id]
      );
      if (!dept && req.user.role !== 'admin')
        return res.status(403).json({ error: 'Reparto non trovato o non di tua pertinenza.' });
    }

    // Elimina planning esistente del mese (per quel reparto) se in bozza
    if (department_id) {
      await db.run(
        `DELETE FROM schedules WHERE year = ? AND month = ? AND status = 'draft'
         AND department_id = ?`,
        [year, month, department_id]
      );
    } else {
      await db.run(
        `DELETE FROM schedules WHERE year = ? AND month = ? AND status = 'draft'
         AND department_id IS NULL`,
        [year, month]
      );
    }

    // Genera assegnazioni
    const result = await generateSchedule(year, month, department_id || null);
    const {
      assignments, violations = [], skillAnalysis = {},
      assignment_log = [], capo_turno_pending = [], out_of_team = [],
    } = result;

    // Crea planning
    const scheduleInsert = await db.run(
      `INSERT INTO schedules (year, month, status, created_by, department_id)
       VALUES (?, ?, 'draft', ?, ?)`,
      [year, month, req.user.id, department_id || null]
    );
    const schedule = await db.get(
      `SELECT id, year, month, status, department_id FROM schedules WHERE id = ?`,
      [scheduleInsert.id]
    );

    // Carica regole per calcolo ore straordinario
    let workRules = {};
    try {
      const ruleRows = await db.all(`SELECT rule_key, rule_value FROM work_rules`);
      workRules = Object.fromEntries(ruleRows.map(r => [r.rule_key, r.rule_value]));
    } catch (e) {}
    const normalHours = workRules.max_hours_per_day_normal || 8;
    const expiryMonths = workRules.rest_recovery_expiry_months || 18;

    // Inserisce assegnazioni e registra straordinari
    let overtimeCount = 0;
    for (const a of assignments.filter ? assignments : (assignments || [])) {
      await db.run(
        `INSERT INTO schedule_assignments (schedule_id, user_id, work_date, shift_type_id, is_overtime)
         VALUES (?, ?, ?, ?, ?)`,
        [schedule.id, a.user_id, a.work_date, a.shift_type_id, a.is_overtime || 0]
      );

      if (a.is_overtime) {
        overtimeCount++;
        // Recupera durata del turno straordinario
        const shiftInfo = await db.get(`SELECT duration_hours FROM shift_types WHERE id = ?`, [a.shift_type_id]);
        const otHours = shiftInfo?.duration_hours || normalHours;

        await db.run(
          `INSERT OR IGNORE INTO overtime_assignments
           (user_id, work_date, shift_type_id, overtime_hours, reason, authorized_by, schedule_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [a.user_id, a.work_date, a.shift_type_id, otHours,
           'Generato automaticamente — esigenza di copertura', req.user.id, schedule.id]
        );

        // Registra riposo da recuperare
        const deadline = new Date(a.work_date);
        deadline.setMonth(deadline.getMonth() + expiryMonths);
        await db.run(
          `INSERT INTO rest_recovery (user_id, accrued_date, reason, hours_owed, recovery_deadline)
           VALUES (?, ?, ?, ?, ?)`,
          [a.user_id, a.work_date,
           `Doppio turno del ${a.work_date} — planning ${month}/${year}`,
           normalHours,
           deadline.toISOString().split('T')[0]]
        );
      }
    }

    const assignmentsList = assignments.filter ? assignments : (assignments || []);
    const coverageViolations = violations.filter(v => v.type === 'UNDERCOVERAGE');

    // ── Persiste audit trail solver ────────────────────────────────────────
    let runId = null;
    try {
      const runInsert = await db.run(
        `INSERT INTO solver_run_log
         (schedule_id, year, month, generated_by, assignments_count, final_penalty,
          violations_count, violations_json, is_feasible, has_skill_warnings)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          schedule.id, year, month, req.user.id,
          assignmentsList.length,
          0,
          violations.length,
          JSON.stringify(violations.slice(0, 100)),
          skillAnalysis.is_feasible !== false ? 1 : 0,
          skillAnalysis.has_skill_warnings ? 1 : 0,
        ]
      );
      runId = runInsert.id;

      // Costruisce lookup assegnazione: 'userId_date_shiftId' → assignment_id DB
      const savedAssignments = await db.all(
        `SELECT id, user_id, work_date, shift_type_id FROM schedule_assignments WHERE schedule_id = ?`,
        [schedule.id]
      );
      const assignIdMap = {};
      for (const sa of savedAssignments) {
        assignIdMap[`${sa.user_id}_${sa.work_date}_${sa.shift_type_id}`] = sa.id;
      }

      for (const entry of assignment_log) {
        const aKey = `${entry.user_id}_${entry.work_date}_${entry.shift_type_id}`;
        const aId  = assignIdMap[aKey] || null;
        await db.run(
          `INSERT INTO solver_assignment_log
           (run_id, schedule_id, assignment_id, user_id, work_date, shift_type_id, shift_code,
            candidate_rank, equity_score, historical_score,
            shifts_month_so_far, nights_month_so_far, consecutive_days,
            is_night, is_weekend, is_overtime,
            preference_violated, preference_reason,
            qualifying_skill, primary_reason, explanation, pool_size)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            runId, schedule.id, aId,
            entry.user_id, entry.work_date, entry.shift_type_id, entry.shift_code,
            entry.candidate_rank, entry.equity_score, entry.historical_score,
            entry.shifts_month_so_far, entry.nights_month_so_far, entry.consecutive_days,
            entry.is_night, entry.is_weekend, entry.is_overtime,
            entry.preference_violated, entry.preference_reason || null,
            entry.qualifying_skill || null, entry.primary_reason, entry.explanation,
            entry.pool_size,
          ]
        );
      }
    } catch (auditErr) {
      console.warn('[Audit] Impossibile salvare solver_run_log:', auditErr.message);
    }

    // ── Persiste cross_dept_equity_log per i turni fuori reparto ──────────
    if (department_id && out_of_team.length > 0) {
      for (const oot of out_of_team) {
        try {
          const isWe = new Date(oot.work_date).getDay() % 6 === 0 ? 1 : 0;
          await db.run(
            `INSERT OR IGNORE INTO cross_dept_equity_log
             (user_id, department_id, schedule_id, work_date, shift_type_id, is_weekend, weight)
             VALUES (?,?,?,?,?,?,1.0)`,
            [oot.user_id, department_id, schedule.id, oot.work_date, oot.shift_type_id, isWe]
          );
        } catch (_) {}
      }
    }
    // Persiste anche i turni cross-coverage (infermieri che lavorano in reparto non loro)
    if (department_id) {
      const crossIds = (result.staff_cross || []).map(s => s.id);
      if (crossIds.length > 0) {
        for (const a of assignments) {
          if (!crossIds.includes(a.user_id)) continue;
          try {
            const isWe = new Date(a.work_date).getDay() % 6 === 0 ? 1 : 0;
            await db.run(
              `INSERT OR IGNORE INTO cross_dept_equity_log
               (user_id, department_id, schedule_id, work_date, shift_type_id, is_weekend, weight)
               VALUES (?,?,?,?,?,?,0.5)`,
              [a.user_id, department_id, schedule.id, a.work_date, a.shift_type_id, isWe]
            );
          } catch (_) {}
        }
      }
    }

    // ── Persiste flag capo-turno pending ─────────────────────────────
    for (const ctp of capo_turno_pending) {
      try {
        await db.run(
          `INSERT OR IGNORE INTO capo_turno_pending
           (schedule_id, team_id, work_date, shift_type_id, absent_user_id, status)
           VALUES (?,?,?,?,?,?)`,
          [schedule.id, ctp.team_id, ctp.work_date,
           ctp.shift_type_id, ctp.absent_user_id, 'pending']
        );
      } catch (_) {}
    }

    res.status(201).json({
      schedule,
      assignments_count:      assignmentsList.length,
      overtime_count:         overtimeCount,
      is_feasible:            skillAnalysis.is_feasible !== false,
      has_skill_warnings:     Boolean(skillAnalysis.has_skill_warnings),
      skill_violations:       skillAnalysis.has_skill_warnings ? skillAnalysis : null,
      coverage_violations:    coverageViolations.length > 0 ? coverageViolations : null,
      coordinator_note:       skillAnalysis.coordinator_note || null,
      capo_turno_pending:     capo_turno_pending.length > 0 ? capo_turno_pending : null,
      out_of_team_count:      out_of_team.length,
      out_of_team:            out_of_team.length > 0 ? out_of_team : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

router.post('/:id/publish', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const update = await db.run(
      `UPDATE schedules SET status = 'published' WHERE id = ?`,
      [req.params.id]
    );
    if (update.changes === 0) {
      return res.status(404).json({ error: 'Planning non trovato' });
    }
    const updated = await db.get(
      `SELECT id, status FROM schedules WHERE id = ?`,
      [req.params.id]
    );
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

// ─── Genera planning per tutti i reparti del coordinatore ───────────────────
router.post('/generate-all', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { year, month } = req.body;
    if (!year || !month)
      return res.status(400).json({ error: 'year e month obbligatori.' });

    // Recupera tutti i reparti attivi del coordinatore
    const depts = await db.all(
      `SELECT id, name, code FROM departments
       WHERE coordinator_id = ? AND is_active = 1
       ORDER BY name`,
      [req.user.id]
    );
    if (depts.length === 0)
      return res.status(404).json({ error: 'Nessun reparto trovato per questo coordinatore.' });

    // Determina cross-coverage tra reparti del coordinatore per year/month
    const crossRows = await db.all(
      `SELECT from_dept_id, to_dept_id, user_id
       FROM department_cross_coverage
       WHERE year = ? AND month = ?
         AND from_dept_id IN (SELECT id FROM departments WHERE coordinator_id = ?)
         AND to_dept_id   IN (SELECT id FROM departments WHERE coordinator_id = ?)`,
      [year, month, req.user.id, req.user.id]
    );
    const crossEdges = {}; // to_dept_id -> Set<from_dept_id>
    const crossUsers = {}; // to_dept_id -> Set<user_id>
    for (const c of crossRows) {
      if (!crossEdges[c.to_dept_id]) crossEdges[c.to_dept_id] = new Set();
      crossEdges[c.to_dept_id].add(c.from_dept_id);
      if (!crossUsers[c.to_dept_id]) crossUsers[c.to_dept_id] = new Set();
      crossUsers[c.to_dept_id].add(c.user_id);
    }

    // Ordina i reparti: quelli che non ricevono cross-coverage vengono prima
    const orderedDepts = [...depts].sort((a, b) => {
      const aDepends = crossEdges[a.id]?.size || 0;
      const bDepends = crossEdges[b.id]?.size || 0;
      return aDepends - bDepends;
    });

    // Accumula indisponibilità extra da propagare ai reparti successivi
    const extraUnavailability = new Map(); // to_dept_id -> Set<userId_day>
    const generatedAssignments = {};       // dept_id -> Array<assignments>

    const results = [];
    for (const dept of orderedDepts) {
      try {
        // Rimuovi draft esistente
        await db.run(
          `DELETE FROM schedules WHERE year = ? AND month = ? AND status = 'draft' AND department_id = ?`,
          [year, month, dept.id]
        );

        // Costruisce il set di indisponibilità extra per questo reparto:
        // ogni infermiere in cross-coverage verso questo reparto che ha già
        // un turno in un reparto precedente non può essere riassegnato lo stesso giorno
        const deptExtra = new Set();
        for (const [toDeptId, userIds] of Object.entries(crossUsers)) {
          if (+toDeptId !== dept.id) continue;
          for (const uid of userIds) {
            // Cerca i turni già assegnati in reparti precedenti
            for (const prevDept of orderedDepts) {
              if (prevDept.id === dept.id) break;
              if (!crossEdges[dept.id]?.has(prevDept.id)) continue;
              const prevAssign = generatedAssignments[prevDept.id] || [];
              for (const a of prevAssign) {
                if (a.user_id === uid) {
                  const dayIdx = new Date(a.work_date).getDate() - 1;
                  deptExtra.add(`${uid}_${dayIdx}`);
                }
              }
            }
          }
        }

        const result = await generateSchedule(year, month, dept.id, deptExtra);
        generatedAssignments[dept.id] = result.assignments;

        // Inserisci schedule
        const ins = await db.run(
          `INSERT INTO schedules (year, month, status, created_by, department_id)
           VALUES (?, ?, 'draft', ?, ?)`,
          [year, month, req.user.id, dept.id]
        );
        results.push({
          department_id:   dept.id,
          department_name: dept.name,
          schedule_id:     ins.id,
          assignments:     result.assignments.length,
          capo_pending:    result.capo_turno_pending?.length || 0,
          out_of_team:     result.out_of_team?.length || 0,
          violations:      result.violations?.filter(v=>v.type==='UNDERCOVERAGE').length || 0,
          extra_blocked:   deptExtra.size,
          status: 'ok',
        });
      } catch (e) {
        results.push({
          department_id:   dept.id,
          department_name: dept.name,
          status: 'error',
          error:  e.message,
        });
      }
    }

    const ok  = results.filter(r => r.status === 'ok').length;
    const err = results.filter(r => r.status === 'error').length;
    res.status(err === 0 ? 201 : 207).json({
      year, month,
      departments_processed: depts.length,
      success: ok,
      errors:  err,
      results,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

// DELETE /schedules/:year/:month — cancella planning per anno/mese del reparto
router.delete('/:year/:month', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { year, month } = req.params;
    const department_id = req.query.department_id || null;

    let sch;
    if (department_id) {
      sch = await db.get(
        `SELECT id FROM schedules WHERE year=? AND month=? AND department_id=?`,
        [year, month, department_id]
      );
    } else {
      sch = await db.get(
        `SELECT id FROM schedules WHERE year=? AND month=? ORDER BY id DESC LIMIT 1`,
        [year, month]
      );
    }
    if (!sch) return res.status(404).json({ error: 'Planning non trovato' });

    await db.run(`DELETE FROM schedule_assignments WHERE schedule_id=?`, [sch.id]);
    await db.run(`DELETE FROM schedules WHERE id=?`, [sch.id]);
    res.json({ ok: true, deleted_schedule_id: sch.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

// PATCH /schedules/:scheduleId/assignments — modifica singola cella (coordinatore)
router.patch('/:scheduleId/assignments', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const { user_id, work_date, shift_type_id } = req.body;

    if (!user_id || !work_date) {
      return res.status(400).json({ error: 'user_id e work_date obbligatori' });
    }

    if (!shift_type_id) {
      // Elimina l'assegnazione (giorno libero)
      await db.run(
        `DELETE FROM schedule_assignments WHERE schedule_id = ? AND user_id = ? AND work_date = ?`,
        [scheduleId, user_id, work_date]
      );
    } else {
      // Upsert: aggiorna se esiste, inserisce se no
      const existing = await db.get(
        `SELECT id FROM schedule_assignments WHERE schedule_id = ? AND user_id = ? AND work_date = ?`,
        [scheduleId, user_id, work_date]
      );
      if (existing) {
        await db.run(
          `UPDATE schedule_assignments SET shift_type_id = ? WHERE id = ?`,
          [shift_type_id, existing.id]
        );
      } else {
        await db.run(
          `INSERT INTO schedule_assignments (schedule_id, user_id, work_date, shift_type_id, is_overtime)
           VALUES (?, ?, ?, ?, 0)`,
          [scheduleId, user_id, work_date, shift_type_id]
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore server' });
  }
});

module.exports = router;
