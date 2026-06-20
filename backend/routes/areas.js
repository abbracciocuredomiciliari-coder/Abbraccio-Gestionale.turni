'use strict';
/**
 * routes/areas.js — Aree organizzative (area_manager)
 *
 * Gerarchia:  area_manager → area → departments → coordinators → staff
 *
 * AREE
 *   GET    /api/areas                    → lista aree (area_manager vede le sue, admin tutto)
 *   POST   /api/areas                    → crea area
 *   GET    /api/areas/:id                → dettaglio area
 *   PUT    /api/areas/:id                → aggiorna area
 *   DELETE /api/areas/:id                → disattiva area
 *
 * REPARTI DELL'AREA
 *   GET    /api/areas/:id/departments    → reparti dell'area
 *   PUT    /api/areas/:id/departments/:deptId/assign   → assegna reparto all'area
 *   DELETE /api/areas/:id/departments/:deptId/unassign → rimuove reparto dall'area
 *
 * DASHBOARD
 *   GET    /api/areas/:id/dashboard?year=&month=
 *     → copertura % per ogni reparto, scoperture aggregate, staff totale
 *
 * SCOPERTURE (GAP)
 *   GET    /api/areas/:id/gaps?year=&month=
 *     → lista dettagliata turni scoperti per reparto
 *
 * GAP-FILLER (cuore del livello area)
 *   POST   /api/areas/:id/resolve-gaps
 *     body: { year, month, dry_run? }
 *     → risolve scoperture usando il pool aggregato di tutti gli infermieri dell'area
 *        rispettando H2 (un turno/giorno) e H3 (no turno dopo notte)
 *        ordinando per historical_score ASC (equità cross-area)
 */

const express = require('express');
const db      = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Helper: verifica che l'area appartenga all'area_manager richiedente ──
async function ownsArea(areaId, userId, userRole) {
  if (userRole === 'admin') return true;
  const area = await db.get(
    `SELECT id FROM areas WHERE id = ? AND area_manager_id = ? AND is_active = 1`,
    [areaId, userId]
  );
  return Boolean(area);
}

// ═══════════════════════════════════════════════════════════════
// CRUD AREE
// ═══════════════════════════════════════════════════════════════

router.get('/', authenticate, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') {
      rows = await db.all(
        `SELECT a.*,
                u.first_name || ' ' || u.last_name AS manager_name,
                (SELECT COUNT(*) FROM departments WHERE area_id = a.id AND is_active = 1) AS dept_count
         FROM areas a JOIN users u ON a.area_manager_id = u.id
         WHERE a.is_active = 1 ORDER BY a.name`
      );
    } else {
      rows = await db.all(
        `SELECT a.*,
                u.first_name || ' ' || u.last_name AS manager_name,
                (SELECT COUNT(*) FROM departments WHERE area_id = a.id AND is_active = 1) AS dept_count
         FROM areas a JOIN users u ON a.area_manager_id = u.id
         WHERE a.area_manager_id = ? AND a.is_active = 1 ORDER BY a.name`,
        [req.user.id]
      );
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    if (!(await ownsArea(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });
    const area = await db.get(
      `SELECT a.*, u.first_name || ' ' || u.last_name AS manager_name
       FROM areas a JOIN users u ON a.area_manager_id = u.id
       WHERE a.id = ? AND a.is_active = 1`,
      [req.params.id]
    );
    if (!area) return res.status(404).json({ error: 'Area non trovata.' });
    res.json(area);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', authenticate, requireRole('area_manager'), async (req, res) => {
  try {
    const { name, code, notes, area_manager_id } = req.body;
    if (!name || !code) return res.status(400).json({ error: 'name e code obbligatori.' });
    // admin può assegnare un area_manager diverso; area_manager crea solo per sé
    const managerId = (req.user.role === 'admin' && area_manager_id)
      ? area_manager_id
      : req.user.id;
    const ins = await db.run(
      `INSERT INTO areas (name, code, area_manager_id, notes) VALUES (?,?,?,?)`,
      [name, code.toUpperCase(), managerId, notes || null]
    );
    const row = await db.get(
      `SELECT a.*, u.first_name || ' ' || u.last_name AS manager_name
       FROM areas a JOIN users u ON a.area_manager_id = u.id WHERE a.id = ?`,
      [ins.id]
    );
    res.status(201).json(row);
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Codice area già esistente.' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticate, requireRole('area_manager'), async (req, res) => {
  try {
    if (!(await ownsArea(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });
    const { name, code, notes, is_active } = req.body;
    await db.run(
      `UPDATE areas SET name=COALESCE(?,name), code=COALESCE(?,code),
         notes=COALESCE(?,notes), is_active=COALESCE(?,is_active) WHERE id=?`,
      [name, code, notes, is_active, req.params.id]
    );
    const row = await db.get(`SELECT * FROM areas WHERE id=?`, [req.params.id]);
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', authenticate, requireRole('area_manager'), async (req, res) => {
  try {
    if (!(await ownsArea(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });
    await db.run(`UPDATE areas SET is_active=0 WHERE id=?`, [req.params.id]);
    res.json({ message: 'Area disattivata.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// REPARTI DELL'AREA
// ═══════════════════════════════════════════════════════════════

router.get('/:id/departments', authenticate, async (req, res) => {
  try {
    if (!(await ownsArea(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });
    const rows = await db.all(
      `SELECT d.*,
              u.first_name || ' ' || u.last_name AS coordinator_name,
              (SELECT COUNT(*) FROM users WHERE department_id = d.id AND is_active = 1) AS staff_count
       FROM departments d JOIN users u ON d.coordinator_id = u.id
       WHERE d.area_id = ? AND d.is_active = 1 ORDER BY d.name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/departments/:deptId/assign', authenticate, requireRole('area_manager'), async (req, res) => {
  try {
    if (!(await ownsArea(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });
    const dept = await db.get(`SELECT id, name FROM departments WHERE id=? AND is_active=1`, [req.params.deptId]);
    if (!dept) return res.status(404).json({ error: 'Reparto non trovato.' });
    await db.run(`UPDATE departments SET area_id=? WHERE id=?`, [req.params.id, req.params.deptId]);
    res.json({ message: `Reparto "${dept.name}" assegnato all'area.`, department_id: +req.params.deptId, area_id: +req.params.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/departments/:deptId/unassign', authenticate, requireRole('area_manager'), async (req, res) => {
  try {
    if (!(await ownsArea(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });
    await db.run(`UPDATE departments SET area_id=NULL WHERE id=? AND area_id=?`, [req.params.deptId, req.params.id]);
    res.json({ message: 'Reparto rimosso dall\'area.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// DASHBOARD (copertura % per reparto)
// ═══════════════════════════════════════════════════════════════

router.get('/:id/dashboard', authenticate, async (req, res) => {
  try {
    if (!(await ownsArea(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ error: 'year e month obbligatori.' });

    const depts = await db.all(
      `SELECT d.id, d.name, d.code,
              u.first_name || ' ' || u.last_name AS coordinator_name,
              (SELECT COUNT(*) FROM users WHERE department_id=d.id AND is_active=1) AS staff_count
       FROM departments d JOIN users u ON d.coordinator_id=u.id
       WHERE d.area_id=? AND d.is_active=1 ORDER BY d.name`,
      [req.params.id]
    );

    const dashboard = [];
    let totalGap = 0, totalScheduled = 0;

    for (const dept of depts) {
      const schedule = await db.get(
        `SELECT id, status FROM schedules WHERE department_id=? AND year=? AND month=?`,
        [dept.id, year, month]
      );

      let assignments = 0, gaps = 0, violations = [];
      if (schedule) {
        const aRows = await db.all(
          `SELECT COUNT(*) AS cnt FROM schedule_assignments WHERE schedule_id=?`,
          [schedule.id]
        );
        assignments = aRows[0]?.cnt || 0;

        // Legge scoperture da solver_violations se esiste la tabella
        try {
          const vRows = await db.all(
            `SELECT day, shift_type_id, needed, assigned, (needed-assigned) AS gap
             FROM solver_violations WHERE schedule_id=? AND type='UNDERCOVERAGE'`,
            [schedule.id]
          );
          gaps = vRows.reduce((s, v) => s + v.gap, 0);
          violations = vRows;
        } catch (_) {}
      }

      totalScheduled += assignments;
      totalGap       += gaps;

      dashboard.push({
        department_id:     dept.id,
        department_name:   dept.name,
        coordinator_name:  dept.coordinator_name,
        staff_count:       dept.staff_count,
        schedule_id:       schedule?.id || null,
        schedule_status:   schedule?.status || 'missing',
        assignments_count: assignments,
        uncovered_shifts:  gaps,
        violations_detail: violations,
        coverage_pct:      gaps === 0 && assignments > 0 ? 100 :
                           assignments > 0 ? Math.round(assignments / (assignments + gaps) * 100) : 0,
      });
    }

    res.json({
      area_id:     +req.params.id,
      year:        +year,
      month:       +month,
      dept_count:  depts.length,
      total_assigned:  totalScheduled,
      total_uncovered: totalGap,
      departments: dashboard,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// SCOPERTURE AGGREGATE
// ═══════════════════════════════════════════════════════════════

router.get('/:id/gaps', authenticate, async (req, res) => {
  try {
    if (!(await ownsArea(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ error: 'year e month obbligatori.' });

    // Cerca scoperture in solver_violations
    let gaps = [];
    try {
      gaps = await db.all(
        `SELECT sv.schedule_id, sv.day, sv.shift_type_id,
                st.code AS shift_code, st.name AS shift_name,
                sv.needed, sv.assigned, (sv.needed - sv.assigned) AS gap,
                d.id AS department_id, d.name AS department_name,
                sc.year, sc.month
         FROM solver_violations sv
         JOIN schedules sc    ON sv.schedule_id  = sc.id
         JOIN departments d   ON sc.department_id = d.id
         JOIN shift_types st  ON sv.shift_type_id = st.id
         WHERE sv.type = 'UNDERCOVERAGE'
           AND d.area_id = ?
           AND sc.year   = ?
           AND sc.month  = ?
           AND sc.status IN ('draft','published')
         ORDER BY d.name, sv.day, st.code`,
        [req.params.id, year, month]
      );
    } catch (_) {}

    // Se la tabella solver_violations non esiste, segnala
    res.json({
      area_id:   +req.params.id,
      year:      +year,
      month:     +month,
      gap_count: gaps.reduce((s, g) => s + g.gap, 0),
      gaps,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// GAP-FILLER — cuore del livello area
// Risolve scoperture usando pool aggregato di tutti gli infermieri
// dell'area rispettando H2, H3, equity cross-area
// ═══════════════════════════════════════════════════════════════

router.post('/:id/resolve-gaps', authenticate, requireRole('area_manager'), async (req, res) => {
  try {
    if (!(await ownsArea(req.params.id, req.user.id, req.user.role)))
      return res.status(403).json({ error: 'Accesso non autorizzato.' });

    const { year, month, dry_run = false } = req.body;
    if (!year || !month) return res.status(400).json({ error: 'year e month obbligatori.' });

    const areaId = +req.params.id;
    const pad = n => String(n).padStart(2,'0');

    // 1. Carica tutti gli infermieri dei reparti dell'area
    const allStaff = await db.all(
      `SELECT u.id, u.first_name, u.last_name,
              COALESCE(u.clinical_role,'STAFF') AS clinical_role,
              u.department_id AS home_dept_id,
              u.skills
       FROM users u
       JOIN roles r ON u.role_id = r.id
       JOIN departments d ON u.department_id = d.id
       WHERE d.area_id = ? AND u.is_active = 1 AND r.name = 'staff'`,
      [areaId]
    );
    if (allStaff.length === 0)
      return res.status(404).json({ error: 'Nessun infermiere trovato nell\'area.' });

    // 2. Carica scoperture (da solver_violations)
    let gaps = [];
    try {
      gaps = await db.all(
        `SELECT sv.id AS violation_id, sv.schedule_id, sv.day, sv.shift_type_id,
                st.code AS shift_code, st.name AS shift_name,
                st.duration_hours, st.is_night,
                sv.needed, sv.assigned, (sv.needed - sv.assigned) AS gap,
                d.id AS department_id, d.name AS department_name,
                sc.year, sc.month
         FROM solver_violations sv
         JOIN schedules sc   ON sv.schedule_id   = sc.id
         JOIN departments d  ON sc.department_id  = d.id
         JOIN shift_types st ON sv.shift_type_id  = st.id
         WHERE sv.type = 'UNDERCOVERAGE'
           AND d.area_id = ?
           AND sc.year   = ?
           AND sc.month  = ?
           AND sc.status IN ('draft','published')
           AND (sv.needed - sv.assigned) > 0
         ORDER BY sv.day, st.code`,
        [areaId, year, month]
      );
    } catch (_) {}

    if (gaps.length === 0)
      return res.json({ message: 'Nessuna scopertura trovata. Tutti i reparti sono coperti!', resolved: 0, still_uncovered: 0, assignments: [] });

    // 3. Carica assegnazioni già esistenti nel mese (per H2/H3)
    const existingAssign = await db.all(
      `SELECT sa.user_id, sa.work_date, st.is_night
       FROM schedule_assignments sa
       JOIN schedules sc   ON sa.schedule_id = sc.id
       JOIN shift_types st ON sa.shift_type_id = st.id
       JOIN departments d  ON sc.department_id = d.id
       WHERE d.area_id = ? AND sc.year = ? AND sc.month = ?`,
      [areaId, year, month]
    );

    // Indici veloci: userId_date → true (occupato), userId_date → true (ha fatto notte ieri)
    const busyDay  = new Set(existingAssign.map(a => `${a.user_id}_${a.work_date}`));
    const nightSet = new Set(existingAssign.filter(a => a.is_night).map(a => `${a.user_id}_${a.work_date}`));

    // 4. Carica historical_score per equità cross-area
    const scoreRows = await db.all(
      `SELECT u.id,
              COALESCE(SUM(
                COALESCE(sa.duration_hours, st.duration_hours, 8)
              ), 0) AS historical_score
       FROM users u
       JOIN departments d ON u.department_id = d.id
       LEFT JOIN schedule_assignments sa ON sa.user_id = u.id
         AND sa.work_date >= date('now', '-3 months')
       LEFT JOIN shift_types st ON sa.shift_type_id = st.id
       WHERE d.area_id = ? AND u.is_active = 1
       GROUP BY u.id`,
      [areaId]
    );
    const scoreMap = Object.fromEntries(scoreRows.map(r => [r.id, r.historical_score || 0]));

    // 5. GAP-FILLER greedy
    const newAssignments = [];
    let resolved = 0, stillUncovered = 0;

    for (const gap of gaps) {
      const workDate = `${year}-${pad(month)}-${pad(gap.day)}`;
      const prevDate = new Date(workDate);
      prevDate.setDate(prevDate.getDate() - 1);
      const prevDateStr = prevDate.toISOString().slice(0,10);

      // Quante unità mancano ancora per questo turno/giorno
      let remaining = gap.gap;

      // Pool candidati: liberi quel giorno + non hanno fatto notte il giorno prima
      const candidates = allStaff
        .filter(s => !busyDay.has(`${s.id}_${workDate}`))      // H2
        .filter(s => !nightSet.has(`${s.id}_${prevDateStr}`))   // H3
        .sort((a, b) => (scoreMap[a.id] || 0) - (scoreMap[b.id] || 0)); // equità

      for (const candidate of candidates) {
        if (remaining <= 0) break;

        if (!dry_run) {
          try {
            await db.run(
              `INSERT INTO schedule_assignments
                 (schedule_id, user_id, shift_type_id, work_date, duration_hours, is_overtime, notes)
               VALUES (?,?,?,?,?,0,'area_gap_filler')`,
              [gap.schedule_id, candidate.id, gap.shift_type_id, workDate,
               gap.duration_hours || 8]
            );
            // Aggiorna solver_violations: decrementa gap
            await db.run(
              `UPDATE solver_violations
               SET assigned = assigned + 1
               WHERE id = ?`,
              [gap.violation_id]
            ).catch(() => {});
            // Log equità cross-area
            const isWe = new Date(workDate).getDay() % 6 === 0 ? 1 : 0;
            await db.run(
              `INSERT OR IGNORE INTO cross_dept_equity_log
                 (user_id, department_id, schedule_id, work_date, shift_type_id, is_weekend, weight)
               VALUES (?,?,?,?,?,?,0.8)`,
              [candidate.id, gap.department_id, gap.schedule_id, workDate, gap.shift_type_id, isWe]
            ).catch(() => {});
          } catch (e) {
            console.warn(`[GapFiller] Inserimento fallito: ${e.message}`);
            continue;
          }
        }

        // Aggiorna indici in memoria
        busyDay.add(`${candidate.id}_${workDate}`);
        if (gap.is_night) nightSet.add(`${candidate.id}_${workDate}`);
        scoreMap[candidate.id] = (scoreMap[candidate.id] || 0) + (gap.duration_hours || 8);

        newAssignments.push({
          user_id:         candidate.id,
          nurse_name:      `${candidate.first_name} ${candidate.last_name}`,
          home_dept_id:    candidate.home_dept_id,
          department_id:   gap.department_id,
          department_name: gap.department_name,
          work_date:       workDate,
          shift_code:      gap.shift_code,
          shift_type_id:   gap.shift_type_id,
          is_cross:        candidate.home_dept_id !== gap.department_id,
        });
        remaining--;
        resolved++;
      }

      stillUncovered += remaining;
    }

    const totalGapUnits = gaps.reduce((s, g) => s + g.gap, 0);
    res.status(dry_run ? 200 : 201).json({
      area_id:         areaId,
      year:            +year,
      month:           +month,
      dry_run:         Boolean(dry_run),
      total_gaps:      totalGapUnits,
      resolved:        resolved,
      still_uncovered: stillUncovered,
      coverage_after:  totalGapUnits > 0 ? Math.round(resolved / totalGapUnits * 100) : 100,
      assignments_added: newAssignments,
    });
  } catch (err) {
    console.error('[resolve-gaps]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
