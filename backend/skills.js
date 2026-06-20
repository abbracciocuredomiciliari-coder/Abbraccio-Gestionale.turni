/**
 * OPBGestionale — Modulo Skill-Mix Constraints
 *
 * Gestisce i vincoli di competenza professionale (privilegi clinici) come
 * hard constraint nella schedulazione:
 *
 *   H11 — Esclusione individuale: un infermiere SENZA il privilegio
 *          obbligatorio per un turno/reparto non può essere assegnato
 *          a quel turno (blocco in propagate).
 *
 *   H12 — Skill-mix minimo per turno: ogni turno deve avere ALMENO
 *          N infermieri con la skill richiesta (verificato e forzato
 *          nella fase greedy del solver).
 *
 * ──────────────────────────────────────────────────────────────
 * STRUTTURA DATI
 * ──────────────────────────────────────────────────────────────
 *
 * SkillMap — prodotto da buildSkillMap():
 * {
 *   nurseSkills: Map<nurseId, Set<skillCode>>
 *             → skill attive e valide oggi per ogni infermiere
 *
 *   shiftRequirements: Map<shiftId, Map<department|null, SkillRequirement[]>>
 *             → requisiti minimi per ogni turno (opzionalmente per reparto)
 *
 *   globalRequirements: SkillRequirement[]
 *             → requisiti senza department specifico (valgono per tutti)
 * }
 *
 * SkillRequirement = {
 *   skill_id, skill_code, skill_name,
 *   min_count, max_count,
 *   is_mandatory,          // true = hard constraint (H11/H12)
 *   department
 * }
 *
 * SkillMixViolation = {
 *   type: 'SKILL_MIX_VIOLATION',
 *   day, shift_code, department,
 *   skill_code, skill_name,
 *   required_count, actual_count, deficit
 * }
 * ──────────────────────────────────────────────────────────────
 */

'use strict';

// ─────────────────────────────────────────────────────────────────
// Build: costruisce le strutture dati usate dal solver
// ─────────────────────────────────────────────────────────────────

/**
 * Costruisce la SkillMap da:
 *   @param {Array} nursePrivileges  Righe da nurse_clinical_privileges JOIN clinical_skills
 *     [ { user_id, skill_id, skill_code, skill_name, department,
 *         valid_from, valid_until, is_active } ]
 *
 *   @param {Array} shiftRequirements  Righe da shift_skill_requirements JOIN clinical_skills
 *     [ { shift_type_id, skill_id, skill_code, skill_name,
 *         department, min_count, max_count, is_mandatory, is_active } ]
 *
 *   @param {string} referenceDate  'YYYY-MM-DD' per verificare validità
 *
 * @returns {SkillMap}
 */
function buildSkillMap(nursePrivileges, shiftRequirements, referenceDate) {
  const today = referenceDate || new Date().toISOString().slice(0, 10);

  // ── Nurse skills: filtra per validità e attività ──────────────
  const nurseSkills = new Map();  // nurseId → Set<skillCode>
  const nurseSkillDetails = new Map(); // nurseId → Map<skillCode, privilege>

  for (const p of nursePrivileges) {
    if (!p.is_active) continue;
    if (p.valid_from  && today < p.valid_from)  continue;
    if (p.valid_until && today > p.valid_until) continue;

    if (!nurseSkills.has(p.user_id)) {
      nurseSkills.set(p.user_id, new Set());
      nurseSkillDetails.set(p.user_id, new Map());
    }
    nurseSkills.get(p.user_id).add(p.skill_code);
    nurseSkillDetails.get(p.user_id).set(p.skill_code, p);
  }

  // ── Shift requirements ─────────────────────────────────────────
  // Map<shiftTypeId, requirement[]>
  const shiftReqMap = new Map();

  for (const r of shiftRequirements) {
    if (!r.is_active) continue;
    if (!shiftReqMap.has(r.shift_type_id)) {
      shiftReqMap.set(r.shift_type_id, []);
    }
    shiftReqMap.get(r.shift_type_id).push({
      skill_id:    r.skill_id,
      skill_code:  r.skill_code,
      skill_name:  r.skill_name || r.skill_code,
      department:  r.department || null,
      min_count:   r.min_count  || 1,
      max_count:   r.max_count  || null,
      is_mandatory: Boolean(r.is_mandatory !== false && r.is_mandatory !== 0),
    });
  }

  return { nurseSkills, nurseSkillDetails, shiftReqMap };
}

// ─────────────────────────────────────────────────────────────────
// H11 — Vincolo individuale: questo infermiere può fare questo turno?
// ─────────────────────────────────────────────────────────────────

/**
 * Restituisce i requisiti che l'infermiere NON soddisfa per il turno
 * (solo quelli is_mandatory = true → hard constraint).
 *
 * @param {SkillMap} skillMap
 * @param {number}   nurseId
 * @param {Object}   shift       { id, code, … }
 * @param {string}   department  reparto attivo (opzionale)
 * @returns {{ allowed: boolean, missing: SkillRequirement[] }}
 */
function canNurseWorkShift(skillMap, nurseId, shift, department = null) {
  const reqs = skillMap.shiftReqMap.get(shift.id) || [];
  if (reqs.length === 0) return { allowed: true, missing: [] };

  const nurseHas = skillMap.nurseSkills.get(nurseId) || new Set();
  const missing  = [];

  for (const req of reqs) {
    if (!req.is_mandatory) continue;

    // Requisito applicabile a questo reparto?
    if (req.department && department &&
        req.department.toLowerCase() !== department.toLowerCase()) continue;

    if (!nurseHas.has(req.skill_code)) {
      missing.push(req);
    }
  }

  return { allowed: missing.length === 0, missing };
}

// ─────────────────────────────────────────────────────────────────
// H12 — Verifica skill-mix dell'intero turno
// ─────────────────────────────────────────────────────────────────

/**
 * Dato un insieme di infermieri assegnati a un turno, verifica
 * che i requisiti di skill-mix siano rispettati.
 *
 * @param {SkillMap} skillMap
 * @param {Object}   shift       { id, code }
 * @param {number[]} assignedNurseIds  lista nurse_id assegnati al turno
 * @param {string}   department  (opzionale)
 * @param {number}   dayNumber   (per reporting violations)
 * @returns {{ valid: boolean, violations: SkillMixViolation[] }}
 */
function validateShiftSkillMix(skillMap, shift, assignedNurseIds, department = null, dayNumber = 0) {
  const reqs = skillMap.shiftReqMap.get(shift.id) || [];
  if (reqs.length === 0) return { valid: true, violations: [] };

  const violations = [];

  for (const req of reqs) {
    if (!req.is_mandatory) continue;

    // Requisito applicabile?
    if (req.department && department &&
        req.department.toLowerCase() !== department.toLowerCase()) continue;

    // Conta quanti dei nurse assegnati hanno questa skill
    const count = assignedNurseIds.filter(nid => {
      const skills = skillMap.nurseSkills.get(nid) || new Set();
      return skills.has(req.skill_code);
    }).length;

    if (count < req.min_count) {
      violations.push({
        type:           'SKILL_MIX_VIOLATION',
        day:            dayNumber,
        shift_id:       shift.id,
        shift_code:     shift.code,
        department:     department || req.department || null,
        skill_code:     req.skill_code,
        skill_name:     req.skill_name,
        required_count: req.min_count,
        actual_count:   count,
        deficit:        req.min_count - count,
        message: [
          `Turno ${shift.code} giorno ${dayNumber}:`,
          `skill "${req.skill_name}" richiede min ${req.min_count},`,
          `presenti ${count} — deficit ${req.min_count - count}`,
        ].join(' '),
      });
    }
  }

  return { valid: violations.length === 0, violations };
}

// ─────────────────────────────────────────────────────────────────
// Utility per il solver: filtra candidati per garantire skill-mix
// ─────────────────────────────────────────────────────────────────

/**
 * Dato un set di candidati (worker indices), li classifica per priorità
 * skill-mix: i qualificati vengono prima. Restituisce due liste:
 *   - qualified:   hanno tutte le skill required per il turno
 *   - unqualified: mancano di almeno una skill (but can fill se quota già coperta)
 *
 * @param {SkillMap}  skillMap
 * @param {Object}    shift
 * @param {Array}     candidates   [ { w, score, nurseId, … } ]
 * @param {string}    department
 * @returns {{ qualified: Array, unqualified: Array }}
 */
function partitionCandidatesBySkill(skillMap, shift, candidates, department = null) {
  const qualified   = [];
  const unqualified = [];

  for (const c of candidates) {
    const { allowed } = canNurseWorkShift(skillMap, c.nurseId, shift, department);
    if (allowed) qualified.push({ ...c, is_qualified: true, missing_skills: [] });
    else {
      const { missing } = canNurseWorkShift(skillMap, c.nurseId, shift, department);
      unqualified.push({ ...c, is_qualified: false, missing_skills: missing });
    }
  }

  return { qualified, unqualified };
}

/**
 * Seleziona i `needed` candidati garantendo che i requisiti di skill-mix
 * siano coperti. Applica la logica "quota minima senior" prima di
 * completare con i non-qualificati se necessario.
 *
 * @param {SkillMap}  skillMap
 * @param {Object}    shift          { id, code, required_staff }
 * @param {Array}     candidates     ordinati per score ASC (già filtrati da propagate)
 * @param {number}    needed         posti da coprire
 * @param {string}    department
 * @returns {{ chosen: Array, skillViolations: SkillMixViolation[] }}
 */
function selectWithSkillMix(skillMap, shift, candidates, needed, department = null, dayNumber = 0) {
  const reqs = skillMap.shiftReqMap.get(shift.id) || [];
  const mandatoryReqs = reqs.filter(r =>
    r.is_mandatory &&
    (!r.department || !department ||
     r.department.toLowerCase() === department.toLowerCase())
  );

  if (mandatoryReqs.length === 0) {
    // Nessun requisito: scelta libera per equity
    return { chosen: candidates.slice(0, needed), skillViolations: [] };
  }

  const { qualified, unqualified } = partitionCandidatesBySkill(skillMap, shift, candidates, department);

  // Per ogni requisito, calcola quanti "slot qualificati" sono necessari
  // Usa la quota massima tra i requisiti (es. min 1 ICU_SENIOR e min 1 BLS_AED
  // → potresti avere infermieri che coprono entrambe: non 2 slot separati)
  const totalMandatory = _computeMandatorySlots(skillMap, shift, mandatoryReqs, qualified, needed);

  const chosen = [];

  // 1. Riserva i slot obbligatori con i qualificati migliori
  const qualifiedChosen = qualified.slice(0, Math.min(totalMandatory, needed));
  chosen.push(...qualifiedChosen);

  // 2. Riempi i restanti posti con chiunque (qualificati rimanenti + non-qualificati)
  const remaining = [
    ...qualified.slice(qualifiedChosen.length),
    ...unqualified,
  ].sort((a, b) => a.score - b.score);

  const stillNeeded = needed - chosen.length;
  chosen.push(...remaining.slice(0, stillNeeded));

  // 3. Verifica skill-mix finale
  const assignedIds = chosen.map(c => c.nurseId);
  const { violations } = validateShiftSkillMix(skillMap, shift, assignedIds, department, dayNumber);

  return { chosen, skillViolations: violations };
}

/**
 * Calcola quanti slot "obbligatori qualificati" servono considerando
 * che uno stesso infermiere può coprire più requisiti.
 * Usa un approccio greedy: assegna i qualificati nell'ordine score,
 * controlla quante skill coprono, si ferma quando tutti i requisiti sono soddisfatti.
 */
function _computeMandatorySlots(skillMap, shift, mandatoryReqs, qualified, needed) {
  // Inizializza contatori per ogni requisito
  const counts = mandatoryReqs.map(r => ({ req: r, count: 0, satisfied: false }));
  let slots = 0;

  for (const c of qualified) {
    if (slots >= needed) break;
    const nurseSkills = skillMap.nurseSkills.get(c.nurseId) || new Set();
    let contributes = false;

    for (const entry of counts) {
      if (entry.satisfied) continue;
      if (nurseSkills.has(entry.req.skill_code)) {
        entry.count++;
        if (entry.count >= entry.req.min_count) entry.satisfied = true;
        contributes = true;
      }
    }

    // Se almeno un requisito non soddisfatto esiste e questo infermiere contribuisce,
    // conta come slot obbligatorio
    const allSatisfied = counts.every(e => e.satisfied);
    if (!allSatisfied) {
      slots++;
    } else if (contributes) {
      slots++;
      break; // tutti i requisiti soddisfatti
    }
  }

  return Math.max(slots, counts.filter(e => !e.satisfied).reduce((s, e) => s + e.req.min_count, 0));
}

// ─────────────────────────────────────────────────────────────────
// Report: riassunto skill coverage per un calendario generato
// ─────────────────────────────────────────────────────────────────

/**
 * Analizza un insieme di assegnazioni e restituisce il skill-mix report.
 *
 * @param {SkillMap}  skillMap
 * @param {Array}     assignments  output di solver._extractAssignments()
 *   [ { user_id, work_date, shift_type_id, shift_code } ]
 * @param {Object}    shiftsById   { shiftId: shiftObject }
 * @param {string}    department
 * @returns {SkillMixReport}
 */
function generateSkillMixReport(skillMap, assignments, shiftsById, department = null) {
  const byDayShift = new Map(); // "dayShiftId" → nurseId[]

  for (const a of assignments) {
    const key = `${a.work_date}_${a.shift_type_id}`;
    if (!byDayShift.has(key)) byDayShift.set(key, []);
    byDayShift.get(key).push(a.user_id);
  }

  const violations = [];
  const compliantSlots = [];

  for (const [key, nurseIds] of byDayShift.entries()) {
    const [date, shiftIdStr] = key.split('_');
    const shift = shiftsById[parseInt(shiftIdStr)];
    if (!shift) continue;

    const dayNum = parseInt(date.slice(8, 10));
    const { valid, violations: vs } = validateShiftSkillMix(
      skillMap, shift, nurseIds, department, dayNum
    );

    if (!valid) violations.push(...vs);
    else compliantSlots.push(key);
  }

  const totalSlots = byDayShift.size;
  const violatingSlots = new Set(violations.map(v => `${v.day}_${v.shift_id}`)).size;

  return {
    department,
    total_slots:       totalSlots,
    compliant_slots:   totalSlots - violatingSlots,
    violating_slots:   violatingSlots,
    compliance_rate:   totalSlots > 0
      ? Math.round(((totalSlots - violatingSlots) / totalSlots) * 100)
      : 100,
    violations,
    violations_by_skill: _groupViolationsBySkill(violations),
  };
}

function _groupViolationsBySkill(violations) {
  const map = {};
  for (const v of violations) {
    if (!map[v.skill_code]) {
      map[v.skill_code] = { skill_code: v.skill_code, skill_name: v.skill_name, count: 0, total_deficit: 0 };
    }
    map[v.skill_code].count++;
    map[v.skill_code].total_deficit += v.deficit;
  }
  return Object.values(map).sort((a, b) => b.total_deficit - a.total_deficit);
}

// ─────────────────────────────────────────────────────────────────
// buildSkillMapFromTags — modello tag semplice
// Usa users.skills (JSON array) e shift_types.required_skills (JSON array)
// ─────────────────────────────────────────────────────────────────

/**
 * Costruisce una SkillMap dal modello tag semplice:
 *   users.skills            = '["ICU","BLS-D"]'   (colonna sulla tabella users)
 *   shift_types.required_skills = '["ICU"]'        (colonna su shift_types)
 *   shift_types.min_skilled_staff = 1              (quanti qualificati per turno)
 *
 * @param {Array} staff    righe users con campo skills (stringa JSON o null)
 * @param {Array} shifts   righe shift_types con required_skills e min_skilled_staff
 * @returns {SkillMap}     stessa struttura di buildSkillMap() — usabile dal solver
 */
function buildSkillMapFromTags(staff, shifts) {
  // ── Nurse skills ─────────────────────────────────────────────
  const nurseSkills    = new Map();
  const nurseSkillDetails = new Map();

  for (const nurse of staff) {
    let tags = [];
    if (nurse.skills) {
      try { tags = typeof nurse.skills === 'string' ? JSON.parse(nurse.skills) : nurse.skills; }
      catch (_) { tags = []; }
    }
    if (tags.length > 0) {
      nurseSkills.set(nurse.id, new Set(tags));
      nurseSkillDetails.set(nurse.id, new Map(tags.map(t => [t, { skill_code: t, valid_from: null, valid_until: null }])));
    }
  }

  // ── Shift requirements ────────────────────────────────────────
  const shiftReqMap = new Map();

  for (const shift of shifts) {
    let reqTags = [];
    if (shift.required_skills) {
      try { reqTags = typeof shift.required_skills === 'string' ? JSON.parse(shift.required_skills) : shift.required_skills; }
      catch (_) { reqTags = []; }
    }
    if (reqTags.length === 0) continue;

    const minCount = shift.min_skilled_staff ?? 1;
    const reqs = reqTags.map(tag => ({
      skill_id:    null,
      skill_code:  tag,
      skill_name:  tag,
      department:  null,
      min_count:   minCount,
      max_count:   null,
      is_mandatory: true,
    }));
    shiftReqMap.set(shift.id, reqs);
  }

  return { nurseSkills, nurseSkillDetails, shiftReqMap };
}

/**
 * Analizza il risultato del solver e produce un riepilogo delle
 * skill_violations, classificando ogni violazione come:
 *   - severity: 'critical' (turno completamente scoperto di skill)
 *               'warning'  (almeno 1 qualificato ma sotto il minimo)
 *
 * Usato da scheduler.js per il response al coordinatore.
 *
 * @param {Array}  violations  solver.violations filtrate per SKILL_MIX_VIOLATION
 * @param {Array}  staff       lista infermieri
 * @param {Array}  shifts      lista turni
 * @returns {Object}  { is_feasible, has_skill_warnings, summary, details }
 */
function analyzeSkillViolations(violations, staff, shifts) {
  const skillViolations = violations.filter(v => v.type === 'SKILL_MIX_VIOLATION');

  if (skillViolations.length === 0) {
    return { is_feasible: true, has_skill_warnings: false, summary: [], details: [] };
  }

  const staffById  = Object.fromEntries(staff.map(s => [s.id, s]));
  const shiftsById = Object.fromEntries(shifts.map(s => [s.id, s]));

  // Raggruppa per skill_code + turno
  const grouped = {};
  for (const v of skillViolations) {
    const key = `${v.skill_code}__${v.shift_code || v.shift_id}`;
    if (!grouped[key]) {
      grouped[key] = {
        skill_code:     v.skill_code,
        skill_name:     v.skill_name || v.skill_code,
        shift_code:     v.shift_code,
        department:     v.department,
        required_count: v.required_count,
        days_affected:  [],
        total_deficit:  0,
        severity:       'warning',
      };
    }
    grouped[key].days_affected.push(v.day);
    grouped[key].total_deficit += v.deficit;
    if (v.actual_count === 0) grouped[key].severity = 'critical';
  }

  const summary = Object.values(grouped).sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return b.total_deficit - a.total_deficit;
  });

  const hasCritical = summary.some(s => s.severity === 'critical');

  return {
    is_feasible:        !hasCritical,
    has_skill_warnings: true,
    coordinator_note:   hasCritical
      ? 'Il calendario è stato generato ma alcuni turni non hanno la copertura di competenza minima richiesta. Il coordinatore deve validare manualmente o riallocare le risorse.'
      : 'Sono presenti avvisi di skill-mix: la copertura minima di competenza non è pienamente garantita in alcuni turni.',
    summary,
    details: skillViolations.map(v => ({
      day:            v.day,
      shift_code:     v.shift_code,
      skill_code:     v.skill_code,
      skill_name:     v.skill_name || v.skill_code,
      required_count: v.required_count,
      actual_count:   v.actual_count,
      deficit:        v.deficit,
      severity:       v.actual_count === 0 ? 'critical' : 'warning',
      message:        v.message,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────
module.exports = {
  buildSkillMap,
  buildSkillMapFromTags,
  analyzeSkillViolations,
  canNurseWorkShift,
  validateShiftSkillMix,
  partitionCandidatesBySkill,
  selectWithSkillMix,
  generateSkillMixReport,
};
