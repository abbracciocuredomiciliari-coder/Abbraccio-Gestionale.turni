const db = require('./config/database');
const { ConstraintSolver } = require('./solver');
const { buildSkillMapFromTags, analyzeSkillViolations } = require('./skills');

/**
 * Bridge DB → ConstraintSolver → assignments
 * Carica tutti i dati necessari dal database e li passa al solver CP.
 *
 * @param {number} year
 * @param {number} month
 * @param {number|null} departmentId  - Se fornito, genera solo per quel reparto
 *                                      (staff + config specifici del reparto)
 */
async function generateSchedule(year, month, departmentId = null, extraUnavailability = new Set()) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const pad = (n) => String(n).padStart(2, '0');
  const monthStart = `${year}-${pad(month)}-01`;
  const monthEnd   = `${year}-${pad(month)}-${pad(daysInMonth)}`;

  // --- Carica dati dal DB ---

  // ── Staff: se departmentId → staff del reparto + cross-coverage del mese
  let staff;
  if (departmentId) {
    // Verifica che il reparto esista
    const dept = await db.get(
      `SELECT id, name, coordinator_id FROM departments WHERE id = ? AND is_active = 1`,
      [departmentId]
    );
    if (!dept) throw new Error(`Reparto ${departmentId} non trovato o non attivo.`);

    // Staff principale del reparto
    const homeStaff = await db.all(
      `SELECT u.id, u.first_name, u.last_name, u.skills,
              COALESCE(u.clinical_role, 'STAFF') AS clinical_role,
              u.department_id AS home_dept_id, 0 AS is_cross_coverage
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.department_id = ? AND u.is_active = 1 AND r.name = 'staff'`,
      [departmentId]
    );
    // Staff in cross-coverage per questo mese
    const crossStaff = await db.all(
      `SELECT u.id, u.first_name, u.last_name, u.skills,
              COALESCE(u.clinical_role, 'STAFF') AS clinical_role,
              u.department_id AS home_dept_id, 1 AS is_cross_coverage
       FROM department_cross_coverage cc
       JOIN users u ON cc.user_id = u.id
       JOIN roles r ON u.role_id = r.id
       WHERE cc.to_dept_id = ? AND cc.year = ? AND cc.month = ?
         AND u.is_active = 1 AND r.name = 'staff'`,
      [departmentId, year, month]
    );
    // Deduplicazione (cross-coverage non aggiunge chi è già home)
    const homeIds = new Set(homeStaff.map(s => s.id));
    staff = [...homeStaff, ...crossStaff.filter(s => !homeIds.has(s.id))];
    console.log(`[Scheduler] Reparto ${dept.name}: ${homeStaff.length} staff propri + ${crossStaff.filter(s=>!homeIds.has(s.id)).length} in cross-coverage`);
  } else {
    staff = await db.all(
      `SELECT u.id, u.first_name, u.last_name, u.skills,
              COALESCE(u.clinical_role, 'STAFF') AS clinical_role,
              u.department_id AS home_dept_id, 0 AS is_cross_coverage
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.name = 'staff' AND u.is_active = 1`
    );
  }
  if (staff.length === 0) throw new Error('Nessun personale attivo trovato per questo reparto.');

  // ── Turni: se departmentId → usa department_shift_config (con fallback su shift_types)
  let shifts;
  if (departmentId) {
    shifts = await db.all(
      `SELECT
         st.id, st.code, st.name, st.duration_hours,
         (st.code IN ('N','N12')) AS is_night,
         st.required_skills, st.min_skilled_staff,
         COALESCE(dsc.required_staff,  st.required_staff)  AS required_staff,
         COALESCE(dsc.assignment_mode, 'FREE')             AS assignment_mode,
         COALESCE(dsc.min_capo_turno, 0)                  AS min_capo_turno,
         COALESCE(dsc.is_active, 1)                       AS config_active
       FROM shift_types st
       LEFT JOIN department_shift_config dsc
         ON dsc.department_id = ? AND dsc.shift_type_id = st.id
       WHERE st.is_active = 1
         AND COALESCE(dsc.is_active, 1) = 1`,
      [departmentId]
    );
  } else {
    shifts = await db.all(
      `SELECT id, code, name, duration_hours, required_staff,
              (code IN ('N','N12')) AS is_night,
              required_skills, min_skilled_staff,
              COALESCE(assignment_mode, 'FREE') AS assignment_mode,
              COALESCE(min_capo_turno, 0)       AS min_capo_turno
       FROM shift_types
       WHERE is_active = 1`
    );
  }
  const workShifts = shifts.filter(s => s.code !== 'R');
  if (workShifts.length === 0) throw new Error('Nessun turno attivo configurato.');

  const constraintRows = await db.all(
    `SELECT user_id, shift_type_id, constraint_type
     FROM user_constraints WHERE is_active = 1`
  );
  const constraints = {};
  for (const c of constraintRows) {
    if (!constraints[c.user_id]) constraints[c.user_id] = {};
    constraints[c.user_id][c.shift_type_id] = c.constraint_type;
  }

  const requests = await db.all(
    `SELECT r.user_id, r.start_date, r.end_date
     FROM requests r
     JOIN request_statuses rs ON r.status_id = rs.id
     WHERE rs.code = 'approved'
       AND r.start_date <= ? AND r.end_date >= ?`,
    [monthEnd, monthStart]
  );

  // Costruisce il Set delle indisponibilità: "userId_dayIndex" (0-based)
  const unavailability = new Set();
  for (const req of requests) {
    const start = new Date(req.start_date + 'T00:00:00');
    const end   = new Date(req.end_date   + 'T00:00:00');
    for (let d = 0; d < daysInMonth; d++) {
      const date = new Date(year, month - 1, d + 1);
      if (date >= start && date <= end) {
        unavailability.add(`${req.user_id}_${d}`);
      }
    }
  }

  // Unisce indisponibilità extra (es. turni già assegnati in altri reparti per cross-coverage)
  if (extraUnavailability && extraUnavailability.size > 0) {
    console.log(`[Scheduler] Unisce ${extraUnavailability.size} indisponibilità extra (cross-reparto)`);
    for (const key of extraUnavailability) unavailability.add(key);
  }

  // --- Carica regole di lavoro ---
  let workRules = {};
  try {
    const ruleRows = await db.all(`SELECT rule_key, rule_value FROM work_rules`);
    workRules = Object.fromEntries(ruleRows.map(r => [r.rule_key, r.rule_value]));
  } catch (e) {
    // tabella potrebbe non esistere in ambienti non migrati
  }
  const minRestHours = workRules.min_rest_between_shifts ?? 11;

  // --- Carica start_time/end_time e weight_key per i turni ---
  const shiftDetails = await db.all(`SELECT id, start_time, end_time, weight_key FROM shift_types`);
  const shiftDetailMap = Object.fromEntries(shiftDetails.map(s => [s.id, s]));
  for (const ws of workShifts) {
    ws.start_time = shiftDetailMap[ws.id]?.start_time || '00:00';
    ws.end_time   = shiftDetailMap[ws.id]?.end_time   || '00:00';
    ws.weight_key = shiftDetailMap[ws.id]?.weight_key || 'normal';
  }

  // --- Carica pesi turno e finestra storica ---
  let shiftWeights = { night: 1.5, weekend: 1.2, long_shift: 1.1, normal: 1.0, overtime: 2.0, window_months: 3 };
  try {
    const wRows = await db.all(`SELECT weight_key, weight_value FROM shift_weights`);
    shiftWeights = Object.fromEntries(wRows.map(r => [r.weight_key, r.weight_value]));
  } catch (e) {}

  // --- Carica punteggio cumulativo storico per ogni infermiere ---
  // Include anche le reperibilità storiche (peso ridotto)
  const windowMonths = shiftWeights.window_months || 3;
  const oncallWeight = shiftWeights.oncall ?? 0.3;

  // Carica reperibilità storiche e aggiungile come assegnazioni pseudo-equity
  let oncallRows = [];
  try {
    oncallRows = await db.all(`
      SELECT oca.user_id AS nurse_id, oca.slot_date AS work_date,
             oca.duration_hours, oca.equity_weight, 1 AS is_oncall,
             u.first_name || ' ' || u.last_name AS nurse_name
      FROM oncall_assignments oca
      JOIN users u ON oca.user_id = u.id
      WHERE oca.slot_date >= date('now', '-' || ? || ' months')
    `, [windowMonths]);
  } catch (_) {}

  const scoreRows = await db.all(`
    SELECT
      u.id,
      COALESCE(SUM(
        COALESCE(sa.duration_hours, st.duration_hours, 8) *
        CASE
          WHEN sa.is_overtime = 1 THEN ?
          ELSE MAX(
            CASE
              WHEN st.weight_key = 'night'      THEN ?
              WHEN st.duration_hours >= 12       THEN ?
              ELSE                                    ?
            END,
            CASE WHEN strftime('%w', sa.work_date) IN ('0','6') THEN ? ELSE 0 END
          )
        END
      ), 0) AS historical_score
    FROM users u
    JOIN roles r ON u.role_id = r.id
    LEFT JOIN schedule_assignments sa
      ON sa.user_id = u.id
      AND sa.work_date >= date('now', '-' || ? || ' months')
    LEFT JOIN shift_types st ON sa.shift_type_id = st.id
    WHERE r.name = 'staff' AND u.is_active = 1
    GROUP BY u.id
  `, [
    shiftWeights.overtime, shiftWeights.night,
    shiftWeights.long_shift, shiftWeights.normal,
    shiftWeights.weekend, windowMonths
  ]);
  const historicalScore = Object.fromEntries(scoreRows.map(r => [r.id, r.historical_score || 0]));

  // Aggiunge il contributo delle reperibilità storiche allo score (peso ridotto)
  for (const oc of oncallRows) {
    const eqW = oc.equity_weight ?? oncallWeight;
    historicalScore[oc.nurse_id] = (historicalScore[oc.nurse_id] || 0) + (oc.duration_hours * eqW);
  }

  // ── Equity cross-reparto: aggiunge i turni fatti in altri reparti (peso 0.5)
  // Protegge l'infermiere: chi ha già lavorato festivi in un altro reparto
  // non viene preferito per i festivi in questo reparto
  const crossDeptWeight = 0.5;
  if (departmentId) {
    try {
      const crossLogs = await db.all(`
        SELECT cdel.user_id, cdel.weight, cdel.is_weekend,
               COALESCE(st.duration_hours, 8) AS duration_hours
        FROM cross_dept_equity_log cdel
        LEFT JOIN shift_types st ON cdel.shift_type_id = st.id
        WHERE cdel.department_id != ?
          AND cdel.work_date >= date('now', '-' || ? || ' months')
      `, [departmentId, windowMonths]);
      for (const cl of crossLogs) {
        const contrib = (cl.duration_hours * cl.weight * crossDeptWeight);
        historicalScore[cl.user_id] = (historicalScore[cl.user_id] || 0) + contrib;
      }
      if (crossLogs.length > 0)
        console.log(`[Scheduler] Cross-dept equity: ${crossLogs.length} turni da altri reparti inclusi (peso ${crossDeptWeight})`);
    } catch (_) {}
  }

  // Arricchisce staff con historical_score
  for (const s of staff) s.historical_score = historicalScore[s.id] || 0;

  console.log(`[Solver] Score storico (finestra ${windowMonths} mesi):`);
  if (oncallRows.length > 0)
    console.log(`[Solver] Reperibilità storiche incluse: ${oncallRows.length} slot`);
  [...staff].sort((a,b) => a.historical_score - b.historical_score).forEach(s =>
    console.log(`  ${s.last_name} ${s.first_name}: ${s.historical_score.toFixed(1)} pt`)
  );

  // --- Carica squadra attiva del mese (TEAM/MIXED) ---
  // Se departmentId: carica solo i team di quel reparto
  const teamData = await _buildTeamData(db, year, month, workShifts, departmentId);
  if (teamData && teamData.activeTeams.size > 0) {
    console.log(`[Solver] Team mode attivo per ${teamData.activeTeams.size} turni`);
    for (const [shiftId, t] of teamData.activeTeams) {
      const sh = workShifts.find(s => s.id === shiftId);
      console.log(`  Turno ${sh?.code}: squadra "${t.teamName}" (${t.members.length} membri, capo: ${t.members.filter(m=>m.isCapoTurno).map(m=>m.userName).join(',') || 'nessuno'})`);
    }
  }

  // --- Costruisce skill map dai tag (users.skills + shift_types.required_skills) ---
  const skillMap = buildSkillMapFromTags(staff, workShifts);

  const hasSkillReqs = workShifts.some(s => s.required_skills);
  if (hasSkillReqs) {
    const tagSummary = staff.map(s => `${s.last_name}: [${s.skills || 'nessuna'}]`);
    console.log(`[Solver] Skill-mix attivo. Competenze staff: ${tagSummary.join(' | ')}`);
  }

  // --- Avvia il Constraint Solver ---
  const solver = new ConstraintSolver({
    staff,
    shifts: workShifts,
    daysInMonth,
    year,
    month,
    constraints,
    unavailability,
    allowOvertime: false,
    minRestHours,
    shiftWeights,
    skillMap: hasSkillReqs ? skillMap : null,
    teamData,
  });

  const assignments = solver.solve();

  // Log diagnostico
  const penalty = solver._computePenalty();
  const violations = solver.violations;
  console.log(`[Solver] ${year}/${pad(month)} — ${assignments.length} assegnazioni | penalità finale: ${penalty.toFixed(0)}`);

  const coverageViolations = violations.filter(v => v.type === 'UNDERCOVERAGE');
  if (coverageViolations.length > 0) {
    console.warn(`[Solver] ${coverageViolations.length} violazioni di copertura:`);
    coverageViolations.forEach(v =>
      console.warn(`  Giorno ${v.day} turno ${v.shift}: servivano ${v.needed}, assegnati ${v.assigned}`)
    );
  }

  // --- Analisi skill-mix violations ---
  const skillAnalysis = analyzeSkillViolations(violations, staff, workShifts);
  if (skillAnalysis.has_skill_warnings) {
    const level = skillAnalysis.is_feasible ? 'WARN' : 'CRIT';
    console.warn(`[Solver][${level}] Skill-mix: ${skillAnalysis.details.length} violazioni`);
    skillAnalysis.summary.forEach(s =>
      console.warn(`  [${s.severity.toUpperCase()}] Skill "${s.skill_code}" turno ${s.shift_code}: ${s.total_deficit} deficit su ${s.days_affected.length} giorni`)
    );
  }

  return {
    assignments,
    violations,
    skillAnalysis,
    assignment_log:        solver.assignment_log,
    capo_turno_pending:    solver.capo_turno_pending,
    out_of_team:           solver.out_of_team_assignments,
    department_id:         departmentId,
  };
}

/**
 * Determina la squadra attiva per ogni turno TEAM/MIXED nel mese dato.
 * Logica:
 *   1. Cerca in team_monthly_rotation (year, month) — inserimento manuale coordinatore
 *   2. Se assente: prende l'ultima rotazione registrata e avanza al prossimo rotation_order
 *   3. Restituisce Map<shiftId, {teamId, teamName, members:[{userId,userName,isCapoTurno}]}>
 */
async function _buildTeamData(db, year, month, workShifts, departmentId = null) {
  const teamShifts = workShifts.filter(s =>
    s.assignment_mode === 'TEAM' || s.assignment_mode === 'MIXED'
  );
  if (teamShifts.length === 0) return { activeTeams: new Map() };

  const activeTeams = new Map();
  const today = `${year}-${String(month).padStart(2,'0')}-01`;

  for (const shift of teamShifts) {
    // 1. Cerca rotazione esplicita per questo mese
    // Se departmentId specificato: cerca solo team di quel reparto
    const deptFilter = departmentId ? 'AND t.department_id = ?' : '';
    const deptParams = departmentId ? [departmentId] : [];
    const explicit = await db.get(
      `SELECT tmr.team_id, t.name AS team_name, t.rotation_order
       FROM team_monthly_rotation tmr
       JOIN teams t ON tmr.team_id = t.id
       WHERE t.shift_type_id = ? AND tmr.year = ? AND tmr.month = ? ${deptFilter}`,
      [shift.id, year, month, ...deptParams]
    );

    let teamId, teamName;

    if (explicit) {
      teamId   = explicit.team_id;
      teamName = explicit.team_name;
    } else {
      // 2. Prende l'ultima rotazione registrata per questo shift
      const lastRot = await db.get(
        `SELECT tmr.team_id, tmr.year, tmr.month, t.rotation_order, t.name AS team_name
         FROM team_monthly_rotation tmr
         JOIN teams t ON tmr.team_id = t.id
         WHERE t.shift_type_id = ? ${deptFilter}
         ORDER BY tmr.year DESC, tmr.month DESC
         LIMIT 1`,
        [shift.id, ...deptParams]
      );

      if (!lastRot) {
        // Nessuna rotazione mai inserita: usa la prima squadra attiva
        const first = await db.get(
          `SELECT id, name FROM teams
           WHERE shift_type_id = ? AND is_active = 1 ${deptFilter}
           ORDER BY rotation_order ASC LIMIT 1`,
          [shift.id, ...deptParams]
        );
        if (!first) continue;
        teamId   = first.id;
        teamName = first.name;
      } else {
        // Calcola quanti mesi sono passati dall'ultima rotazione
        const lastDate  = new Date(lastRot.year, lastRot.month - 1, 1);
        const currDate  = new Date(year, month - 1, 1);
        const monthsDiff = (currDate.getFullYear() - lastDate.getFullYear()) * 12
          + (currDate.getMonth() - lastDate.getMonth());

        // Conta squadre attive per questo turno
        const teams = await db.all(
          `SELECT id, name, rotation_order FROM teams
           WHERE shift_type_id = ? AND is_active = 1 ${deptFilter}
           ORDER BY rotation_order ASC`,
          [shift.id, ...deptParams]
        );
        if (teams.length === 0) continue;

        // Avanza di monthsDiff posizioni nel ciclo
        const lastIdx = teams.findIndex(t => t.id === lastRot.team_id);
        const nextIdx = ((lastIdx === -1 ? 0 : lastIdx) + monthsDiff) % teams.length;
        teamId   = teams[nextIdx].id;
        teamName = teams[nextIdx].name;
      }
    }

    // Carica membri attivi della squadra alla data del mese
    const members = await db.all(
      `SELECT tm.user_id, tm.is_capo_turno,
              u.first_name || ' ' || u.last_name AS user_name
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = ?
         AND tm.valid_from <= ?
         AND (tm.valid_until IS NULL OR tm.valid_until >= ?)`,
      [teamId, today, today]
    );

    activeTeams.set(shift.id, {
      teamId,
      teamName,
      members: members.map(m => ({
        userId:      m.user_id,
        userName:    m.user_name,
        isCapoTurno: Boolean(m.is_capo_turno),
      })),
    });
  }

  return { activeTeams };
}

module.exports = { generateSchedule };
