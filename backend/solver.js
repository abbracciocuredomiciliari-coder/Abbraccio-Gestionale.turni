/**
 * OPBGestionale — Constraint Solver per la schedulazione turni
 *
 * Ispirato all'architettura di Google OR-Tools CP-SAT:
 *   - Variabili booleane: x[worker][day][shift] = 0 o 1
 *   - Vincoli hard: devono essere soddisfatti (altrimenti soluzione infeasible)
 *   - Vincoli soft: violazioni penalizzate nella funzione obiettivo
 *   - Ottimizzazione: minimizza la varianza dei carichi (modulo equity.js)
 *
 * Vincoli HARD implementati:
 *   H1 - Copertura turno: ogni turno attivo deve avere esattamente required_staff persone
 *   H2 - Un solo turno al giorno per persona
 *   H3 - Riposo minimo: dopo turno notturno (N/N12) obbligatorio giorno libero
 *   H4 - Indisponibilità: ferie/riposi approvati bloccano la persona
 *   H5 - Vincolo "cannot": la persona non può fare quel turno
 *   H6 - Vincolo "only": la persona può fare SOLO quel turno
 *   H7 - Assenze approvate (absences.js): blocco giornata intera
 *   H8 - Permessi orari parziali (L.104/maternità): blocca turni sovrapposti
 *   H9 - Congedi ricorrenti: blocca giorni da recurrence_rule
 *  H10 - Esonero notturno: blocca categorie turno per flag sul profilo
 *  H11 - Skill individuale: infermiere senza privilegio clinico obbligatorio non
 *         assegnabile al turno (propagate)
 *  H12 - Skill-mix turno: ogni turno deve avere il minimo di infermieri qualificati
 *         per categoria di competenza (greedy — quota riservata ai senior)
 *  H13 - Capo-turno: ogni turno con min_capo_turno>0 deve avere almeno N infermieri
 *         con clinical_role IN ('CAPO_TURNO','RESPONSABILE').
 *         Il solver non nomina mai un CAPO_TURNO — apre capo_turno_pending se assente.
 *  H14 - Massimo giorni consecutivi: blocca l'assegnazione se l'operatore ha già
 *         raggiunto max_consecutive_days giorni lavorativi consecutivi (da work_rules).
 *
 * Vincoli SOFT (via equity.js — minimizzazione varianza):
 *   E1 - Equità carico composito (composite_score storico + intra-mese)
 *   E2 - Equità notti (priorità a chi ne ha meno nello storico)
 *   E3 - Equità weekend (priorità a chi ne ha meno)
 *   S4 - Preferenza "prefer_not" (pena addizionale)
 */

const { chooseBestCandidate, applyAssignment, computeLoads } = require('./equity');
const { getPenalty, isHardBlocked, PENALTIES } = require('./preferences');
const { isFullDayBlocked, isShiftBlocked, getExemptionBlock } = require('./absences');
const { canNurseWorkShift, selectWithSkillMix } = require('./skills');

class ConstraintSolver {
  constructor({ staff, shifts, daysInMonth, year, month, constraints, unavailability, allowOvertime = false, minRestHours = 11, maxConsecutiveDays = 6, shiftWeights = {}, historicAssignments = [], preferenceMap = null, absenceMap = null, skillMap = null, department = null, teamData = null }) {
    this.staff = staff;           // [{id, first_name, last_name}]
    this.shifts = shifts;         // [{id, code, required_staff, duration_hours, is_night}]
    this.days = daysInMonth;
    this.year = year;
    this.month = month;
    this.constraints = constraints;   // {userId: {shiftId: 'cannot'|'prefer_not'|'only'}}
    this.unavailability = unavailability; // Set di "userId_dayIndex"
    // Mappa preferenze/richieste speciali (output di buildPreferencePenalties)
    this.prefMap = preferenceMap;
    // Mappa vincoli hard assenze (output di buildAbsenceConstraints)
    this.absMap = absenceMap;
    // Skill-mix constraints (output di buildSkillMap)
    this.skillMap = skillMap;
    this.department = department;
    // teamData: { activeTeams: Map<shiftId, {teamId, members: [{userId,isCapoTurno}]}> }
    // Fornito da scheduler.js — null se nessun turno ha assignment_mode TEAM/MIXED
    this.teamData = teamData;
    // Flag capo-turno da nominare: generati dal solver, persistiti da scheduler.js
    this.capo_turno_pending = [];
    this.allowOvertime = allowOvertime;
    this.minRestHours = minRestHours;
    this.maxConsecutiveDays = maxConsecutiveDays;
    this.weights = {
      night:      shiftWeights.night      ?? 1.5,
      weekend:    shiftWeights.weekend    ?? 1.2,
      long_shift: shiftWeights.long_shift ?? 1.1,
      normal:     shiftWeights.normal     ?? 1.0,
      overtime:   shiftWeights.overtime   ?? 2.0,
    };

    // Carichi storici inizializzati da historicAssignments (ultimi N mesi)
    // Aggiornati incrementalmente durante il solve() per ogni assegnazione
    this.equityLoads = computeLoads(historicAssignments, this.weights);
    // Assicura che tutti gli staff abbiano un record anche senza storico
    for (const w of staff) {
      if (!this.equityLoads.has(w.id)) {
        this.equityLoads.set(w.id, {
          nurse_id: w.id, nurse_name: `${w.first_name} ${w.last_name}`,
          total_weighted: 0, total_hours: 0,
          nights: 0, weekends: 0, overtime: 0,
          shift_counts: {}, composite_score: 0,
        });
      }
    }

    // Variabili: x[w][d][s] = boolean
    this.x = [];
    // Inizializza tutte le variabili a null (non assegnato)
    for (let w = 0; w < staff.length; w++) {
      this.x[w] = [];
      for (let d = 0; d < daysInMonth; d++) {
        this.x[w][d] = new Array(shifts.length).fill(0);
      }
    }

    this.infeasible = false;
    this.violations = [];
    // overtime_assignments: [{w, d, s}] — turni in straordinario assegnati dal solver
    this.overtime_assignments = [];
    // assignment_log: motivazione per ogni assegnazione (audit trail)
    this.assignment_log = [];
    // out_of_team_assignments: assegnazioni fuori-squadra (per report coordinatore)
    this.out_of_team_assignments = [];
  }

  /**
   * Indici helper
   */
  workerIdx(userId) { return this.staff.findIndex(s => s.id === userId); }
  shiftIdx(shiftId) { return this.shifts.findIndex(s => s.id === shiftId); }

  /**
   * Giorno della settimana: 0=Dom, 6=Sab
   */
  dayOfWeek(dayIndex) {
    return new Date(this.year, this.month - 1, dayIndex + 1).getDay();
  }
  isWeekend(dayIndex) {
    const d = this.dayOfWeek(dayIndex);
    return d === 0 || d === 6;
  }

  /**
   * Fase 1: Propagazione vincoli hard
   * Elimina assegnazioni impossibili prima della ricerca
   */
  propagate() {
    // H4: blocca indisponibili
    for (let w = 0; w < this.staff.length; w++) {
      for (let d = 0; d < this.days; d++) {
        const key = `${this.staff[w].id}_${d}`;
        if (this.unavailability.has(key)) {
          this.x[w][d] = new Array(this.shifts.length).fill(-1); // -1 = impossibile
        }
        // Hard blocks da ferie/permessi approvati (via prefMap)
        if (this.prefMap && isHardBlocked(this.prefMap, this.staff[w].id, d)) {
          this.x[w][d] = new Array(this.shifts.length).fill(-1);
        }
      }
    }

    // H5: blocca vincoli "cannot"
    // H6: blocca tutti tranne "only"
    for (let w = 0; w < this.staff.length; w++) {
      const wConstraints = this.constraints[this.staff[w].id] || {};
      const onlyShiftId = Object.entries(wConstraints).find(([, t]) => t === 'only')?.[0];

      for (let d = 0; d < this.days; d++) {
        for (let s = 0; s < this.shifts.length; s++) {
          if (this.x[w][d][s] === -1) continue;
          const shift = this.shifts[s];
          const ctype = wConstraints[shift.id];
          if (ctype === 'cannot') {
            this.x[w][d][s] = -1;
          }
          if (onlyShiftId && String(shift.id) !== String(onlyShiftId)) {
            this.x[w][d][s] = -1;
          }
        }
      }
    }

    // H11: blocco individuale skill — elimina assegnazioni di infermieri
    // non qualificati per turni con requisiti obbligatori
    if (this.skillMap) {
      for (let w = 0; w < this.staff.length; w++) {
        const nurse = this.staff[w];
        for (let s = 0; s < this.shifts.length; s++) {
          const shift = this.shifts[s];
          const { allowed, missing } = canNurseWorkShift(
            this.skillMap, nurse.id, shift, this.department
          );
          if (!allowed) {
            // Blocca questo turno per tutti i giorni del mese
            for (let d = 0; d < this.days; d++) {
              if (this.x[w][d][s] !== -1) this.x[w][d][s] = -1;
            }
          }
        }
      }
    }

    // H7-H10: vincoli hard da absences.js
    if (this.absMap) {
      for (let w = 0; w < this.staff.length; w++) {
        const nurseId = this.staff[w].id;

        for (let d = 0; d < this.days; d++) {
          // H7: assenza giornata intera (ferie, maternità, malattia, formazione…)
          if (isFullDayBlocked(this.absMap, nurseId, d)) {
            this.x[w][d] = new Array(this.shifts.length).fill(-1);
            continue;
          }

          const isWeekendDay = this.isWeekend(d);
          const dayContext   = { is_weekend: isWeekendDay, is_festive: isWeekendDay };

          for (let s = 0; s < this.shifts.length; s++) {
            if (this.x[w][d][s] === -1) continue;
            const shift = this.shifts[s];

            // H8/H9: permesso parziale o congedo → verifica sovrapposizione oraria
            // H10: esonero notturno → verifica categoria turno
            const { blocked, reason } = isShiftBlocked(
              this.absMap, nurseId, d, shift, dayContext
            );
            if (blocked) {
              this.x[w][d][s] = -1;
            }
          }
        }
      }
    }
  }

  /**
   * Fase 2: Ricerca con Local Search (LNS — Large Neighbourhood Search)
   * Approccio simile al CP-SAT di Google: costruisce una soluzione iniziale greedy,
   * poi la migliora con perturbazioni iterative minimizzando la penalità.
   */
  solve() {
    this.propagate();

    // Costruzione soluzione iniziale greedy
    this._greedyConstruct();

    // Ottimizzazione LNS: migliora la soluzione minimizzando le penalità soft
    this._localSearch(500); // max 500 iterazioni

    return this._extractAssignments();
  }

  /**
   * Costruzione greedy: assegna turni rispettando tutti i vincoli hard
   * Ordine di priorità: copre prima i turni con meno candidati disponibili
   */
  _greedyConstruct() {
    // Contatori per bilanciamento
    const totalShifts = new Array(this.staff.length).fill(0);
    const nightShifts = new Array(this.staff.length).fill(0);
    const weekendShifts = new Array(this.staff.length).fill(0);
    const saturdayShifts = new Array(this.staff.length).fill(0);
    const sundayShifts = new Array(this.staff.length).fill(0);
    const hoursWorked = new Array(this.staff.length).fill(0); // ore totali lavorate nel mese
    // weekendWorked[w] = Set di numeri di settimana ISO in cui l'operatore ha già lavorato nell'altro giorno
    // Serve per evitare che chi fa sabato faccia anche domenica dello stesso weekend
    const workedWeekends = new Array(this.staff.length).fill(null).map(() => new Map()); // w -> { weekKey -> {sat, sun} }
    const shiftTypeCount = {}; // w -> {shiftCode -> count}
    for (let w = 0; w < this.staff.length; w++) shiftTypeCount[w] = {};

    for (let d = 0; d < this.days; d++) {
      // Ordina i turni del giorno per quelli con meno candidati disponibili (Most Constrained Variable)
      const shiftsOrdered = [...this.shifts]
        .filter(sh => sh.code !== 'R')
        .sort((a, b) => {
          const candA = this._countCandidates(d, a, new Set());
          const candB = this._countCandidates(d, b, new Set());
          return candA - candB; // prima i turni più vincolati
        });

      const assignedToday = new Set();   // turno normale
      const doubleShiftToday = new Set(); // già in straordinario oggi

      for (const shift of shiftsOrdered) {
        const s = this.shiftIdx(shift.id);
        const _dow = this.dayOfWeek(d);
        const needed = _dow === 6 && shift.required_staff_saturday != null
          ? shift.required_staff_saturday
          : _dow === 0 && shift.required_staff_sunday != null
          ? shift.required_staff_sunday
          : shift.required_staff || 1;

        // ── Determina modalità assegnazione per questo turno ──────────────
        const assignMode = shift.assignment_mode || 'FREE';
        const minCapo    = shift.min_capo_turno  || 0;

        // Set di userId che appartengono alla squadra attiva (per TEAM/MIXED)
        let teamMemberIds  = new Set();
        let teamCapoIds    = new Set();  // is_capo_turno=1 nella squadra attiva
        let activeTeamId   = null;

        if ((assignMode === 'TEAM' || assignMode === 'MIXED') && this.teamData) {
          const tEntry = this.teamData.activeTeams?.get(shift.id);
          if (tEntry) {
            activeTeamId = tEntry.teamId;
            for (const m of tEntry.members) {
              teamMemberIds.add(m.userId);
              if (m.isCapoTurno) teamCapoIds.add(m.userId);
            }
          }
        }

        // ── Builder candidati con score equity ────────────────────────────
        const _buildCandidate = (w) => {
          const alreadyAssigned = assignedToday.has(w);
          if (alreadyAssigned && !this.allowOvertime) return null;
          if (doubleShiftToday.has(w)) return null;
          if (this.x[w][d][s] === -1) return null;
          if (d > 0 && this._workedNightOn(w, d - 1)) return null;
          // H-CONSEC: blocco hard giorni consecutivi
          if (this._consecutiveDays(w, d) >= this.maxConsecutiveDays) return null;
          // H-REST: riposo minimo inter-giornaliero (minRestHours, default 11h)
          // Verifica che tra la fine del turno di ieri e l'inizio di oggi ci siano >= minRestHours
          if (d > 0) {
            const prevEndHour = this._getWorkerShiftEndHour(w, d - 1);
            if (prevEndHour > 0) {
              const prevEndMin  = prevEndHour * 60;
              const currStartH  = this._getShiftStartHour(shift);
              const currStartMin = currStartH * 60 + 24 * 60; // giorno dopo
              const restMin = currStartMin - prevEndMin;
              if (restMin < this.minRestHours * 60) return null;
            }
          }
          if (alreadyAssigned && this.allowOvertime) {
            const prevEnd   = this._getWorkerShiftEndHour(w, d);
            const nextStart = this._getShiftStartHour(shift);
            const gap = (nextStart + 24 - prevEnd) % 24;
            if (gap < this.minRestHours) return null;
          }

          const nurseId    = this.staff[w].id;
          const wConstraints = this.constraints[nurseId] || {};
          const isPrefNot  = wConstraints[shift.id] === 'prefer_not';
          const load       = this.equityLoads.get(nurseId);
          const isWeekendD = this.isWeekend(d);

          let score = load ? load.composite_score : 0;
          // Equità notti (storico + intra-mese)
          if (shift.is_night) score += ((load?.nights ?? 0) + nightShifts[w]) * 10;
          // Equità weekend storico
          if (isWeekendD) score += (load?.weekends ?? 0) * 15;
          // Bilanciamento sabati vs domeniche: preferisce chi ha meno dell'altro tipo
          // Se oggi è domenica e l'operatore ha già più domeniche che sabati → penalizza
          // Questo garantisce rotazione: chi ha fatto 1 sab e 0 dom è preferito per le domeniche
          if (_dow === 0) {
            // domenica: penalizza se ha già tante domeniche, premia se ha tanti sabati
            score += sundayShifts[w] * 50;
            score -= saturdayShifts[w] * 25; // bonus: ha già fatto sabati, ora tocca domeniche
          }
          if (_dow === 6) {
            // sabato: penalizza se ha già tanti sabati, premia se ha tante domeniche
            score += saturdayShifts[w] * 50;
            score -= sundayShifts[w] * 25; // bonus: ha già fatto domeniche, ora tocca sabati
          }
          // Anti-clustering stesso weekend: penalizza chi ha già lavorato nell'altro giorno
          const weekKey = Math.floor(d / 7);
          const wkEntry = workedWeekends[w].get(weekKey) || { sat: false, sun: false };
          if (_dow === 0 && wkEntry.sat) score += 150;
          if (_dow === 6 && wkEntry.sun) score += 150;
          // Equità ore lavorate nel mese (penalizza chi ha già più ore — bilancia G14 vs M7)
          score += hoursWorked[w] * 1.5;
          // Equità tipo turno intra-mese — peso alto per evitare concentrazione
          // Penalizza chi ha già fatto molte volte QUESTO tipo rispetto alla media degli altri
          const myTypeCount = shiftTypeCount[w][shift.code] || 0;
          const otherCounts = this.staff
            .map((_, ww) => shiftTypeCount[ww][shift.code] || 0)
            .filter((_, ww) => ww !== w);
          const avgOthers = otherCounts.length > 0
            ? otherCounts.reduce((a,b) => a+b, 0) / otherCounts.length
            : 0;
          score += (myTypeCount - avgOthers) * 50; // +50pt per ogni unità sopra la media
          if (isPrefNot)      score += 20;
          score += this._consecutiveDays(w, d) * 8;
          if (alreadyAssigned) score += 100;

          let prefPenalty = 0, prefReasons = [];
          if (this.prefMap) {
            const pp = getPenalty(this.prefMap, nurseId, d, shift.id);
            prefPenalty = pp.penalty;
            prefReasons = pp.reasons;
            score += prefPenalty;
          }

          return { w, nurseId, score, isOvertime: alreadyAssigned, prefPenalty, prefReasons };
        };

        // ── Pool TEAM: divide in prioritario (squadra) e fallback ─────────
        let candidates = [];
        const teamPool    = [];   // membri della squadra attiva
        const fallbackPool = [];  // tutti gli altri

        for (let w = 0; w < this.staff.length; w++) {
          const c = _buildCandidate(w);
          if (!c) continue;
          const userId = this.staff[w].id;
          if ((assignMode === 'TEAM' || assignMode === 'MIXED') && teamMemberIds.size > 0) {
            if (teamMemberIds.has(userId)) {
              teamPool.push({ ...c, inTeam: true });
            } else {
              fallbackPool.push({ ...c, inTeam: false });
            }
          } else {
            candidates.push({ ...c, inTeam: false });
          }
        }

        // Aggiunge jitter piccolo (0-2pt) per rompere i pareggi — garantisce
        // distribuzione uniforme quando tutti i candidati hanno score identico
        for (const c of [...teamPool, ...fallbackPool, ...candidates]) {
          c.score += Math.random() * 2;
        }

        // In TEAM/MIXED: pool squadra ordinato per score, poi fallback per score
        // L'ordine pool-prioritario-prima è preservato: NON riordiniamo globalmente
        if (assignMode === 'TEAM' || assignMode === 'MIXED') {
          teamPool.sort((a, b) => a.score - b.score);
          fallbackPool.sort((a, b) => a.score - b.score);
          candidates = [...teamPool, ...fallbackPool];
        } else {
          candidates.sort((a, b) => a.score - b.score);
        }

        // ── Logica 2-passaggi per le preferenze ──────────────────────
        // Passaggio 1: usa solo chi NON viola preferenze soft significative
        //   (prefPenalty < PENALTIES.FERIE_PENDING = 500)
        // Passaggio 2: se copertura insufficiente, accetta anche i violatori
        //   (segnala la violazione forzata nelle violations)
        const PREF_THRESHOLD = PENALTIES ? 499 : 9999;
        const noViolators  = candidates.filter(c => c.prefPenalty < PREF_THRESHOLD);
        const withViolators = candidates;

        // ── H12: Skill-mix selection ───────────────────────────────────
        // Se skillMap presente: usa selectWithSkillMix per garantire quota
        // senior, poi completa con preferenze.
        let chosen;
        let skillViolations = [];
        const forcedViolators = [];

        if (this.skillMap) {
          const pool = noViolators.length >= needed ? noViolators : withViolators;
          const res  = selectWithSkillMix(
            this.skillMap, shift, pool, needed, this.department, d + 1
          );
          chosen        = res.chosen;
          skillViolations = res.skillViolations;
        } else {
          chosen = noViolators.slice(0, needed);
        }

        if (chosen.length < needed) {
          // Non abbiamo abbastanza candidati rispettando le preferenze
          // Integra con i violatori, ordinati per penalità più bassa
          const remaining = withViolators
            .filter(c => !chosen.find(x => x.w === c.w))
            .sort((a, b) => a.prefPenalty - b.prefPenalty);
          const toForce = remaining.slice(0, needed - chosen.length);
          for (const fc of toForce) {
            chosen.push(fc);
            if (fc.prefPenalty > 0) {
              forcedViolators.push({
                type:       'PREFERENCE_VIOLATION_FORCED',
                day:        d + 1,
                shift:      shift.code,
                worker_idx: fc.w,
                nurse_name: `${this.staff[fc.w].first_name} ${this.staff[fc.w].last_name}`,
                penalty:    fc.prefPenalty,
                reasons:    fc.prefReasons,
                message:    `${this.staff[fc.w].first_name} ${this.staff[fc.w].last_name}: preferenza ignorata per coprire turno ${shift.code} il giorno ${d + 1} (nessuna alternativa disponibile)`,
              });
            }
          }
        }

        // Registra violazioni skill-mix (se il deficit non è recuperabile)
        for (const sv of skillViolations) this.violations.push(sv);

        // Registra violazioni forzate
        for (const fv of forcedViolators) this.violations.push(fv);

        // ── H13: verifica capo-turno nella selezione finale ──────────────
        if (minCapo > 0 && (assignMode === 'TEAM' || assignMode === 'MIXED' || assignMode === 'FREE')) {
          // Conta quanti CAPO_TURNO/RESPONSABILE sono stati scelti
          const chosenCapoCount = chosen.filter(c => {
            const uId = this.staff[c.w].id;
            const cr  = this.staff[c.w].clinical_role || 'STAFF';
            return cr === 'CAPO_TURNO' || cr === 'RESPONSABILE';
          }).length;

          if (chosenCapoCount < minCapo) {
            // Cerca CAPO_TURNO non ancora scelti tra i candidati
            const extraCapo = candidates
              .filter(c => !chosen.find(x => x.w === c.w))
              .filter(c => {
                const cr = this.staff[c.w].clinical_role || 'STAFF';
                return cr === 'CAPO_TURNO' || cr === 'RESPONSABILE';
              })
              .slice(0, minCapo - chosenCapoCount);

            if (extraCapo.length > 0) {
              // Sostituisce l'ultimo STAFF scelto con il CAPO_TURNO trovato
              for (const ec of extraCapo) {
                const replaceIdx = chosen.map(c => this.staff[c.w].clinical_role || 'STAFF')
                  .lastIndexOf('STAFF');
                if (replaceIdx >= 0) chosen.splice(replaceIdx, 1, ec);
                else chosen.push(ec);
              }
            } else {
              // Nessun CAPO_TURNO disponibile → apre pending flag
              // Trova il capo-turno assente dalla squadra
              const absentCapoId = activeTeamId
                ? [...teamCapoIds].find(uid => {
                    const w = this.workerIdx(uid);
                    return w === -1 || this.x[w]?.[d]?.[s] === -1;
                  }) || null
                : null;

              const dateStr = `${this.year}-${String(this.month).padStart(2,'0')}-${String(d+1).padStart(2,'0')}`;
              this.capo_turno_pending.push({
                team_id:        activeTeamId,
                work_date:      dateStr,
                shift_type_id:  shift.id,
                absent_user_id: absentCapoId,
                status:         'pending',
              });
              this.violations.push({
                type:    'CAPO_TURNO_SHORTAGE',
                day:     d + 1,
                shift:   shift.code,
                message: `Turno ${shift.code} del ${dateStr}: nessun capo-turno disponibile — flag aperto per il coordinatore`,
              });
            }
          }
        }

        for (let chosenIdx = 0; chosenIdx < chosen.length; chosenIdx++) {
          const { w, isOvertime, prefPenalty, prefReasons, inTeam } = chosen[chosenIdx];
          this.x[w][d][s] = 1;
          const isWeekendDay = this.isWeekend(d);
          const nurse = this.staff[w];
          const nurseLoad = this.equityLoads.get(nurse.id);
          const consec = this._consecutiveDays(w, d);
          const dateStr = `${this.year}-${String(this.month).padStart(2,'0')}-${String(d+1).padStart(2,'0')}`;

          // ── Flag OUT_OF_TEAM (TEAM/MIXED mode) ────────────────────────
          const isOutOfTeam = (assignMode === 'TEAM' || assignMode === 'MIXED')
            && teamMemberIds.size > 0
            && inTeam === false
            && !isOvertime;

          if (isOutOfTeam) {
            this.out_of_team_assignments.push({
              user_id:       nurse.id,
              work_date:     dateStr,
              shift_type_id: shift.id,
              shift_code:    shift.code,
              team_id:       activeTeamId,
            });
          }

          // ── Determina motivo principale ──────────────────────────────
          let primaryReason, explanation, qualifyingSkill = null;

          if (isOutOfTeam) {
            primaryReason = 'OUT_OF_TEAM';
            explanation = `Turno ${shift.code} del ${dateStr} assegnato a ${nurse.first_name} ${nurse.last_name} fuori dalla squadra assegnata: i membri della squadra non erano sufficienti per garantire la copertura (H1). Assegnazione straordinaria per esigenza di servizio.`;
          } else if (isOvertime) {
            primaryReason = 'OVERTIME';
            explanation = `Turno ${shift.code} del ${dateStr} assegnato in straordinario: necessaria copertura e nessun altro infermiere disponibile.`;
          } else if (prefPenalty > 0) {
            primaryReason = 'PREFERENCE_IGNORED';
            const prefDetail = (prefReasons || []).join('; ') || 'preferenza registrata';
            explanation = `Turno ${shift.code} del ${dateStr} assegnato nonostante ${prefDetail}: l'unica modalità per garantire la copertura minima richiesta (H1).`;
          } else if (this.skillMap && this.skillMap.shiftReqMap.has(shift.id)) {
            const reqs = this.skillMap.shiftReqMap.get(shift.id);
            const nurseSkills = this.skillMap.nurseSkills.get(nurse.id);
            const matchedSkill = reqs.find(r => nurseSkills?.has(r.skill_code));
            if (matchedSkill) {
              primaryReason = 'SKILL_REQUIRED';
              qualifyingSkill = matchedSkill.skill_code;
              explanation = `Turno ${shift.code} del ${dateStr} assegnato perché ${nurse.first_name} ${nurse.last_name} possiede la competenza "${matchedSkill.skill_code}" richiesta da questo turno (H11/H12).`;
            } else {
              primaryReason = 'COVERAGE_ONLY';
              explanation = `Turno ${shift.code} del ${dateStr} assegnato per garantire la copertura minima richiesta (H1): nessun infermiere con la competenza specifica era disponibile.`;
            }
          } else {
            primaryReason = 'EQUITY';
            const scoreRound = Math.round((nurseLoad?.composite_score ?? 0) * 10) / 10;
            const loadRank = chosenIdx + 1;
            let equity_detail = `punteggio di carico ${scoreRound}`;
            if (shift.is_night) equity_detail += `, notti nel mese: ${nightShifts[w]}`;
            if (isWeekendDay)   equity_detail += `, weekend nel mese: ${weekendShifts[w]}`;
            if (consec > 0)     equity_detail += `, ${consec} giorni consecutivi`;
            explanation = `Turno ${shift.code} del ${dateStr} assegnato a ${nurse.first_name} ${nurse.last_name} per bilanciare il carico di lavoro (${equity_detail}). Era il candidato con carico più basso tra ${candidates.length} disponibili.`;
          }

          // ── Salva nel log ──────────────────────────────────────────────
          this.assignment_log.push({
            user_id:             nurse.id,
            work_date:           dateStr,
            shift_type_id:       shift.id,
            shift_code:          shift.code,
            candidate_rank:      chosenIdx + 1,
            equity_score:        Math.round((chosen[chosenIdx].score ?? 0) * 100) / 100,
            historical_score:    Math.round((nurse.historical_score ?? 0) * 100) / 100,
            shifts_month_so_far: totalShifts[w],
            nights_month_so_far: nightShifts[w],
            consecutive_days:    consec,
            is_night:            shift.is_night ? 1 : 0,
            is_weekend:          isWeekendDay ? 1 : 0,
            is_overtime:         isOvertime ? 1 : 0,
            preference_violated: prefPenalty > 0 ? 1 : 0,
            preference_reason:   prefPenalty > 0 ? (prefReasons || []).join('; ') : null,
            qualifying_skill:    qualifyingSkill,
            primary_reason:      primaryReason,
            explanation,
            pool_size:           candidates.length,
          });

          if (isOvertime) {
            doubleShiftToday.add(w);
            this.overtime_assignments.push({ w, d, s });
          } else {
            assignedToday.add(w);
          }
          totalShifts[w]++;
          hoursWorked[w] += shift.duration_hours || 8;
          if (shift.is_night) nightShifts[w]++;
          if (isWeekendDay) weekendShifts[w]++;
          if (_dow === 6) {
            saturdayShifts[w]++;
            const wk = Math.floor(d / 7);
            const e = workedWeekends[w].get(wk) || { sat: false, sun: false };
            workedWeekends[w].set(wk, { ...e, sat: true });
          }
          if (_dow === 0) {
            sundayShifts[w]++;
            const wk = Math.floor(d / 7);
            const e = workedWeekends[w].get(wk) || { sat: false, sun: false };
            workedWeekends[w].set(wk, { ...e, sun: true });
          }
          shiftTypeCount[w][shift.code] = (shiftTypeCount[w][shift.code] || 0) + 1;

          // Aggiorna carico equity in tempo reale (per decisioni future nello stesso solve)
          applyAssignment(this.equityLoads, nurse.id, `${nurse.first_name} ${nurse.last_name}`, {
            duration_hours: shift.duration_hours ?? 8,
            weight:         this._shiftWeight(shift, d),
            is_night:       Boolean(shift.is_night),
            is_weekend:     isWeekendDay,
            is_overtime:    isOvertime,
            shift_code:     shift.code,
          });
        }

        // Se non abbiamo coperto il turno, segnala violation (non è necessariamente infeasible)
        if (chosen.length < needed) {
          this.violations.push({
            type: 'UNDERCOVERAGE',
            day: d + 1,
            shift: shift.code,
            needed,
            assigned: chosen.length
          });
        }
      }
    }
  }

  /**
   * Large Neighbourhood Search: prende una finestra di 3 giorni casuali,
   * deassegna i turni di quella finestra e li riassegna ottimalmente.
   */
  _localSearch(maxIter) {
    let currentPenalty = this._computePenalty();

    for (let iter = 0; iter < maxIter; iter++) {
      // Scegli un giorno di partenza casuale
      const startDay = Math.floor(Math.random() * (this.days - 2));
      const windowDays = [startDay, startDay + 1, startDay + 2].filter(d => d < this.days);

      // Salva lo stato corrente della finestra + violations
      const saved = windowDays.map(d =>
        this.staff.map((_, w) => [...this.x[w][d]])
      );
      const savedViolations = [...this.violations];

      // Deassegna tutti i turni nella finestra (solo quelli assegnati = 1)
      for (const d of windowDays) {
        for (let w = 0; w < this.staff.length; w++) {
          for (let s = 0; s < this.shifts.length; s++) {
            if (this.x[w][d][s] === 1) this.x[w][d][s] = 0;
          }
        }
      }

      // Riassegna la finestra con greedy (può aggiungere violations temporanee)
      this._greedyWindow(windowDays);

      const newPenalty = this._computePenalty();

      // Accetta solo se migliora (hill climbing)
      if (newPenalty >= currentPenalty) {
        // Ripristina stato precedente + violations
        for (let i = 0; i < windowDays.length; i++) {
          const d = windowDays[i];
          for (let w = 0; w < this.staff.length; w++) {
            this.x[w][d] = saved[i][w];
          }
        }
        this.violations = savedViolations;
      } else {
        currentPenalty = newPenalty;
      }
    }
  }

  _greedyWindow(days) {
    const totalShifts = new Array(this.staff.length).fill(0);
    const nightShifts = new Array(this.staff.length).fill(0);
    const weekendShifts = new Array(this.staff.length).fill(0);

    // Conta turni già assegnati fuori dalla finestra
    for (let w = 0; w < this.staff.length; w++) {
      for (let d = 0; d < this.days; d++) {
        if (days.includes(d)) continue;
        for (let s = 0; s < this.shifts.length; s++) {
          if (this.x[w][d][s] === 1) {
            totalShifts[w]++;
            if (this.shifts[s].is_night) nightShifts[w]++;
            if (this.isWeekend(d)) weekendShifts[w]++;
          }
        }
      }
    }

    // Traccia chi ha fatto notte in ogni giorno della finestra (per H3 intra-finestra)
    const nightWorkedInWindow = new Map(); // dayIndex → Set<workerIdx>

    for (const d of days) {
      const shiftsOrdered = [...this.shifts]
        .filter(sh => sh.code !== 'R')
        .sort((a, b) => this._countCandidates(d, a, new Set()) - this._countCandidates(d, b, new Set()));

      const assignedToday = new Set();

      for (const shift of shiftsOrdered) {
        const s = this.shiftIdx(shift.id);
        const _dow2 = this.dayOfWeek(d);
        const needed = _dow2 === 6 && shift.required_staff_saturday != null
          ? shift.required_staff_saturday
          : _dow2 === 0 && shift.required_staff_sunday != null
          ? shift.required_staff_sunday
          : shift.required_staff || 1;

        // Determina team pool (identico a _greedyConstruct)
        const assignMode = shift.assignment_mode || 'FREE';
        const minCapo    = shift.min_capo_turno  || 0;
        let teamMemberIds = new Set();
        let teamCapoIds   = new Set();
        let activeTeamId  = null;
        if ((assignMode === 'TEAM' || assignMode === 'MIXED') && this.teamData) {
          const tEntry = this.teamData.activeTeams?.get(shift.id);
          if (tEntry) {
            activeTeamId = tEntry.teamId;
            for (const m of tEntry.members) {
              teamMemberIds.add(m.userId);
              if (m.isCapoTurno) teamCapoIds.add(m.userId);
            }
          }
        }

        const teamPool = [], fallbackPool = [];
        for (let w = 0; w < this.staff.length; w++) {
          if (assignedToday.has(w)) continue;
          if (this.x[w][d][s] === -1) continue;
          // H3: blocca chi ha lavorato notte il giorno precedente
          // Controlla sia lo stato x persistente che le notti assegnate in questa finestra
          if (d > 0 && this._workedNightOn(w, d - 1)) continue;
          if (nightWorkedInWindow.get(d - 1)?.has(w)) continue;
          // H-CONSEC: blocco hard giorni consecutivi
          if (this._consecutiveDays(w, d) >= this.maxConsecutiveDays) continue;
          // H-REST: riposo minimo inter-giornaliero
          if (d > 0) {
            const prevEndHour = this._getWorkerShiftEndHour(w, d - 1);
            if (prevEndHour > 0) {
              const restMin = (this._getShiftStartHour(shift) + 24) * 60 - prevEndHour * 60;
              if (restMin < this.minRestHours * 60) continue;
            }
          }

          const wConstraints = this.constraints[this.staff[w].id] || {};
          const isPrefNot = wConstraints[shift.id] === 'prefer_not';
          let score = totalShifts[w] * 3;
          if (shift.is_night) score += nightShifts[w] * 4;
          if (this.isWeekend(d)) score += weekendShifts[w] * 2;
          if (isPrefNot) score += 8;
          score += this._consecutiveDays(w, d) * 5;
          const userId = this.staff[w].id;
          const entry = { w, score, nurseId: userId, inTeam: false };

          if ((assignMode === 'TEAM' || assignMode === 'MIXED') && teamMemberIds.size > 0) {
            if (teamMemberIds.has(userId)) { entry.inTeam = true; teamPool.push(entry); }
            else fallbackPool.push(entry);
          } else {
            fallbackPool.push(entry);
          }
        }

        teamPool.sort((a, b) => a.score - b.score);
        fallbackPool.sort((a, b) => a.score - b.score);
        const candidates = (assignMode === 'TEAM' || assignMode === 'MIXED')
          ? [...teamPool, ...fallbackPool]
          : fallbackPool;

        let chosen;
        if (this.skillMap) {
          const res = selectWithSkillMix(this.skillMap, shift, candidates, needed, this.department, d + 1);
          chosen = res.chosen;
        } else {
          chosen = candidates.slice(0, needed);
        }

        // H13 nella LNS (solo cerca sostituto, non genera nuovo pending)
        if (minCapo > 0) {
          const capoCnt = chosen.filter(c => {
            const cr = this.staff[c.w].clinical_role || 'STAFF';
            return cr === 'CAPO_TURNO' || cr === 'RESPONSABILE';
          }).length;
          if (capoCnt < minCapo) {
            const extra = candidates
              .filter(c => !chosen.find(x => x.w === c.w))
              .filter(c => { const cr = this.staff[c.w].clinical_role || 'STAFF'; return cr === 'CAPO_TURNO' || cr === 'RESPONSABILE'; })
              .slice(0, minCapo - capoCnt);
            for (const ec of extra) {
              const replaceIdx = chosen.map(c => this.staff[c.w].clinical_role || 'STAFF').lastIndexOf('STAFF');
              if (replaceIdx >= 0) chosen.splice(replaceIdx, 1, ec);
              else chosen.push(ec);
            }
          }
        }

        for (const { w } of chosen) {
          this.x[w][d][s] = 1;
          assignedToday.add(w);
          totalShifts[w]++;
          if (shift.is_night) {
            nightShifts[w]++;
            // Traccia notte assegnata in questo giorno della finestra
            if (!nightWorkedInWindow.has(d)) nightWorkedInWindow.set(d, new Set());
            nightWorkedInWindow.get(d).add(w);
          }
          if (this.isWeekend(d)) weekendShifts[w]++;
        }
      }
    }
  }

  /**
   * Funzione di penalità totale (obiettivo da minimizzare)
   */
  _computePenalty() {
    let penalty = 0;

    // S1: varianza turni totali tra lavoratori
    const totals = this.staff.map((_, w) => {
      let cnt = 0;
      for (let d = 0; d < this.days; d++)
        for (let s = 0; s < this.shifts.length; s++)
          if (this.x[w][d][s] === 1) cnt++;
      return cnt;
    });
    const avgTotal = totals.reduce((a, b) => a + b, 0) / totals.length;
    penalty += totals.reduce((sum, t) => sum + Math.abs(t - avgTotal), 0) * 10;

    // S1b: varianza ore lavorate (bilancia G14 vs M7)
    const hoursArr = this.staff.map((_, w) => {
      let h = 0;
      for (let d = 0; d < this.days; d++)
        for (let s = 0; s < this.shifts.length; s++)
          if (this.x[w][d][s] === 1) h += this.shifts[s].duration_hours || 8;
      return h;
    });
    const avgHours = hoursArr.reduce((a, b) => a + b, 0) / hoursArr.length;
    penalty += hoursArr.reduce((sum, h) => sum + Math.abs(h - avgHours), 0) * 8;

    // S1c: varianza per tipo turno (penalizza concentrazione G su stessa persona)
    const shiftTypeCounts = this.shifts.filter(sh => sh.code !== 'R').map(sh => {
      const sIdx = this.shiftIdx(sh.id);
      const counts = this.staff.map((_, w) => {
        let cnt = 0;
        for (let d = 0; d < this.days; d++) if (this.x[w][d][sIdx] === 1) cnt++;
        return cnt;
      });
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
      return counts.reduce((sum, c) => sum + Math.abs(c - avg), 0) * 25;
    });
    penalty += shiftTypeCounts.reduce((a, b) => a + b, 0);

    // S2: varianza turni notturni
    const nights = this.staff.map((_, w) => {
      let cnt = 0;
      for (let d = 0; d < this.days; d++)
        for (let s = 0; s < this.shifts.length; s++)
          if (this.x[w][d][s] === 1 && this.shifts[s].is_night) cnt++;
      return cnt;
    });
    const avgNight = nights.reduce((a, b) => a + b, 0) / nights.length;
    penalty += nights.reduce((sum, n) => sum + Math.abs(n - avgNight), 0) * 15;

    // S3: varianza weekend
    const weekends = this.staff.map((_, w) => {
      let cnt = 0;
      for (let d = 0; d < this.days; d++)
        if (this.isWeekend(d))
          for (let s = 0; s < this.shifts.length; s++)
            if (this.x[w][d][s] === 1) cnt++;
      return cnt;
    });
    const avgWeekend = weekends.reduce((a, b) => a + b, 0) / weekends.length;
    penalty += weekends.reduce((sum, wk) => sum + Math.abs(wk - avgWeekend), 0) * 12;

    // S4: penalità prefer_not
    for (let w = 0; w < this.staff.length; w++) {
      const wConstraints = this.constraints[this.staff[w].id] || {};
      for (let d = 0; d < this.days; d++) {
        for (let s = 0; s < this.shifts.length; s++) {
          if (this.x[w][d][s] === 1 && wConstraints[this.shifts[s].id] === 'prefer_not') {
            penalty += 8;
          }
        }
      }
    }

    // S5: turni consecutivi > 5
    for (let w = 0; w < this.staff.length; w++) {
      let consec = 0;
      for (let d = 0; d < this.days; d++) {
        const worked = this.shifts.some((_, s) => this.x[w][d][s] === 1);
        if (worked) {
          consec++;
          if (consec > 5) penalty += 20 * (consec - 5);
        } else {
          consec = 0;
        }
      }
    }

    // H1 violazioni: copertura insufficiente (penalità altissima)
    for (let d = 0; d < this.days; d++) {
      const _dowP = this.dayOfWeek(d);
      for (const shift of this.shifts) {
        if (shift.code === 'R') continue;
        const s = this.shiftIdx(shift.id);
        const assigned = this.staff.filter((_, w) => this.x[w][d][s] === 1).length;
        const needed = _dowP === 6 && shift.required_staff_saturday != null
          ? shift.required_staff_saturday
          : _dowP === 0 && shift.required_staff_sunday != null
          ? shift.required_staff_sunday
          : shift.required_staff || 1;
        if (assigned < needed) penalty += 1000 * (needed - assigned);
      }
    }

    // H3 violazioni: lavora il giorno dopo una notte (penalità > qualsiasi soft)
    for (let w = 0; w < this.staff.length; w++) {
      for (let d = 1; d < this.days; d++) {
        if (this._workedNightOn(w, d - 1)) {
          const workedToday = this.shifts.some((_, s) => this.x[w][d][s] === 1);
          if (workedToday) penalty += 5000;
        }
      }
    }

    // H-REST violazioni: riposo inter-giornaliero < minRestHours
    for (let w = 0; w < this.staff.length; w++) {
      for (let d = 1; d < this.days; d++) {
        const prevEndHour = this._getWorkerShiftEndHour(w, d - 1);
        if (prevEndHour === 0) continue;
        for (let s = 0; s < this.shifts.length; s++) {
          if (this.x[w][d][s] !== 1) continue;
          const restMin = (this._getShiftStartHour(this.shifts[s]) + 24) * 60 - prevEndHour * 60;
          if (restMin < this.minRestHours * 60) {
            penalty += 3000;
            this.violations.push({
              type: 'REST_VIOLATION',
              day: d + 1,
              worker: this.staff[w].id,
              shift: this.shifts[s].code,
              rest_hours: restMin / 60,
            });
          }
        }
      }
    }

    return penalty;
  }

  /**
   * Helper: conta candidati disponibili per un turno in un giorno
   */
  _countCandidates(d, shift, assignedToday) {
    const s = this.shiftIdx(shift.id);
    let count = 0;
    for (let w = 0; w < this.staff.length; w++) {
      if (assignedToday.has(w)) continue;
      if (this.x[w][d][s] === -1) continue;
      if (d > 0 && this._workedNightOn(w, d - 1)) continue;
      count++;
    }
    return count;
  }

  /**
   * Helper: ha lavorato un turno notturno nel giorno d?
   */
  _workedNightOn(w, d) {
    return this.shifts.some((sh, s) => sh.is_night && this.x[w][d][s] === 1);
  }

  /**
   * Helper: quanti giorni consecutivi ha lavorato arrivando al giorno d?
   */
  _consecutiveDays(w, d) {
    let count = 0;
    for (let i = d - 1; i >= 0; i--) {
      const worked = this.shifts.some((_, s) => this.x[w][i][s] === 1);
      if (worked) count++;
      else break;
    }
    return count;
  }

  /**
   * Helper: calcola il peso effettivo di un turno in un dato giorno
   * (stesso algoritmo del MAX usato in SQL)
   */
  _shiftWeight(shift, d) {
    const typeWeight = shift.is_night ? this.weights.night
      : (shift.duration_hours >= 12)  ? this.weights.long_shift
      : this.weights.normal;
    const dayWeight = this.isWeekend(d) ? this.weights.weekend : 0;
    return Math.max(typeWeight, dayWeight);
  }

  /**
   * Helper: ora di fine del turno che un lavoratore ha assegnato oggi (index d)
   */
  _getWorkerShiftEndHour(w, d) {
    for (let s = 0; s < this.shifts.length; s++) {
      if (this.x[w][d][s] === 1) {
        return this._getShiftEndHour(this.shifts[s]);
      }
    }
    return 0;
  }

  /**
   * Helper: ora di inizio turno (es. '07:00' → 7)
   */
  _getShiftStartHour(shift) {
    if (!shift.start_time) return 0;
    return parseInt(shift.start_time.split(':')[0], 10);
  }

  /**
   * Helper: ora di fine turno (es. '15:00' → 15)
   */
  _getShiftEndHour(shift) {
    if (!shift.end_time) return (this._getShiftStartHour(shift) + (shift.duration_hours || 8)) % 24;
    return parseInt(shift.end_time.split(':')[0], 10);
  }

  /**
   * Estrae le assegnazioni finali in formato [{user_id, work_date, shift_type_id, is_overtime}]
   */
  _extractAssignments() {
    const overtimeSet = new Set(
      this.overtime_assignments.map(o => `${o.w}_${o.d}_${o.s}`)
    );
    const assignments = [];
    for (let w = 0; w < this.staff.length; w++) {
      for (let d = 0; d < this.days; d++) {
        for (let s = 0; s < this.shifts.length; s++) {
          if (this.x[w][d][s] === 1) {
            const day = d + 1;
            const dateStr = `${this.year}-${String(this.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            assignments.push({
              user_id: this.staff[w].id,
              work_date: dateStr,
              shift_type_id: this.shifts[s].id,
              is_overtime: overtimeSet.has(`${w}_${d}_${s}`) ? 1 : 0
            });
          }
        }
      }
    }
    return assignments;
  }
}

module.exports = { ConstraintSolver };
