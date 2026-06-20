'use strict';
const bcrypt = require('bcryptjs');

module.exports = {
  async up(queryInterface) {
    const NOW = new Date().toISOString();

    // ── Roles ──
    await queryInterface.bulkInsert('roles', [
      { name: 'admin',       description: 'Amministratore di sistema' },
      { name: 'coordinator', description: 'Coordinatore infermieristico' },
      { name: 'staff',       description: 'Infermiere / Personale' },
    ], { ignoreDuplicates: true });

    const roles = await queryInterface.sequelize.query(
      `SELECT id, name FROM roles`, { type: 'SELECT' }
    );
    const roleMap = Object.fromEntries(roles.map(r => [r.name, r.id]));

    // ── Utenti di default ──
    const hash = await bcrypt.hash('password', 10);
    await queryInterface.bulkInsert('users', [
      { username: 'admin',       email: 'admin@opbg.it',       password_hash: hash,
        first_name: 'Admin',     last_name: 'Sistema',
        role_id: roleMap.admin,  qualification: 'admin',
        is_active: true, created_at: NOW, updated_at: NOW },
      { username: 'coordinator', email: 'coord@opbg.it',       password_hash: hash,
        first_name: 'Maria',     last_name: 'Coordinatore',
        role_id: roleMap.coordinator, qualification: 'coordinatore',
        ward: 'Coordinamento',   is_active: true, created_at: NOW, updated_at: NOW },
      { username: 'rossi.mario', email: 'mario.rossi@opbg.it', password_hash: hash,
        first_name: 'Mario',     last_name: 'Rossi',
        role_id: roleMap.staff,  qualification: 'infermiere',
        contract_type: 'full_time', contract_hours_week: 36,
        ward: 'Medicina Generale', hire_date: '2018-03-01',
        is_active: true, created_at: NOW, updated_at: NOW },
      { username: 'bianchi.anna', email: 'anna.bianchi@opbg.it', password_hash: hash,
        first_name: 'Anna',      last_name: 'Bianchi',
        role_id: roleMap.staff,  qualification: 'infermiere',
        contract_type: 'full_time', contract_hours_week: 36,
        ward: 'Medicina Generale', hire_date: '2020-09-15',
        is_active: true, created_at: NOW, updated_at: NOW },
      { username: 'verdi.luca',  email: 'luca.verdi@opbg.it',  password_hash: hash,
        first_name: 'Luca',      last_name: 'Verdi',
        role_id: roleMap.staff,  qualification: 'infermiere',
        contract_type: 'part_time', contract_hours_week: 24,
        ward: 'Pediatria',       hire_date: '2021-01-10',
        is_active: true, created_at: NOW, updated_at: NOW },
    ], { ignoreDuplicates: true });

    // ── Competencies ──
    await queryInterface.bulkInsert('competencies', [
      { code: 'terapia_intensiva', name: 'Terapia Intensiva',    category: 'clinica',    is_required_for_night: true  },
      { code: 'pediatria',         name: 'Pediatria',            category: 'clinica',    is_required_for_night: true  },
      { code: 'emergenza',         name: 'Emergenza / Pronto Soccorso', category: 'emergenza', is_required_for_night: true },
      { code: 'oncologia',         name: 'Oncologia',            category: 'clinica',    is_required_for_night: false },
      { code: 'blocco_operatorio', name: 'Blocco Operatorio',    category: 'tecnica',    is_required_for_night: false },
      { code: 'dialisi',           name: 'Dialisi / Nefrologia', category: 'tecnica',    is_required_for_night: false },
      { code: 'neonatologia',      name: 'Neonatologia / TIN',   category: 'clinica',    is_required_for_night: true  },
      { code: 'bls_d',             name: 'BLS-D (Defibrillatore)',category: 'emergenza', is_required_for_night: true  },
      { code: 'acls',              name: 'ACLS - Supporto Vita Avanzato', category: 'emergenza', is_required_for_night: false },
      { code: 'medicazione_avanzata', name: 'Medicazione Avanzata / Lesioni', category: 'tecnica', is_required_for_night: false },
    ], { ignoreDuplicates: true });

    // ── ShiftTypes ──
    await queryInterface.bulkInsert('shift_types', [
      { code: 'M',   name: 'Mattina',    start_time: '07:00', end_time: '15:00', duration_hours: 8,  required_staff: 2, category: 'giorno', color: '#4CAF50', base_weight: 1.0, weight_key: 'normal',     is_active: true,  required_competency_codes: '[]',                        min_experience_months: 0  },
      { code: 'P',   name: 'Pomeriggio', start_time: '15:00', end_time: '23:00', duration_hours: 8,  required_staff: 2, category: 'giorno', color: '#FF9800', base_weight: 1.0, weight_key: 'normal',     is_active: true,  required_competency_codes: '[]',                        min_experience_months: 0  },
      { code: 'N',   name: 'Notte',      start_time: '23:00', end_time: '07:00', duration_hours: 8,  required_staff: 1, category: 'notte',  color: '#3F51B5', base_weight: 2.0, weight_key: 'night',      is_active: true,  required_competency_codes: '["bls_d"]',                 min_experience_months: 6  },
      { code: 'G12', name: 'Giorno 12h', start_time: '07:00', end_time: '19:00', duration_hours: 12, required_staff: 1, category: 'giorno', color: '#009688', base_weight: 1.5, weight_key: 'long_shift', is_active: false, required_competency_codes: '[]',                        min_experience_months: 12 },
      { code: 'N12', name: 'Notte 12h',  start_time: '19:00', end_time: '07:00', duration_hours: 12, required_staff: 1, category: 'notte',  color: '#673AB7', base_weight: 2.0, weight_key: 'night',      is_active: false, required_competency_codes: '["bls_d","terapia_intensiva"]', min_experience_months: 24 },
      { code: 'R',   name: 'Riposo',     start_time: '00:00', end_time: '00:00', duration_hours: 0,  required_staff: 0, category: 'riposo', color: '#9E9E9E', base_weight: 0.0, weight_key: 'normal',     is_active: true,  required_competency_codes: '[]',                        min_experience_months: 0  },
    ], { ignoreDuplicates: true });

    // ── ShiftWeights ──
    await queryInterface.bulkInsert('shift_weights', [
      { weight_key: 'night',         weight_value: 1.5, description: 'Turno notturno (N, N12)',            updated_at: NOW },
      { weight_key: 'weekend',       weight_value: 1.2, description: 'Turno sabato/domenica',             updated_at: NOW },
      { weight_key: 'holiday',       weight_value: 1.3, description: 'Turno festività nazionale',         updated_at: NOW },
      { weight_key: 'long_shift',    weight_value: 1.1, description: 'Turno lungo ≥12h (G12)',            updated_at: NOW },
      { weight_key: 'normal',        weight_value: 1.0, description: 'Turno giornaliero standard',        updated_at: NOW },
      { weight_key: 'overtime',      weight_value: 2.0, description: 'Straordinario (doppio turno)',      updated_at: NOW },
      { weight_key: 'window_months', weight_value: 3,   description: 'Finestra storica in mesi',          updated_at: NOW },
    ], { ignoreDuplicates: true });

    // ── WorkRules (CCNL Comparto Sanità) ──
    await queryInterface.bulkInsert('work_rules', [
      { rule_key: 'max_hours_per_week',         rule_value: 36,  description: 'Ore massime settimanali (CCNL Comparto Sanità)',    updated_at: NOW },
      { rule_key: 'max_hours_per_day_normal',   rule_value: 8,   description: 'Ore massime turno normale',                        updated_at: NOW },
      { rule_key: 'max_hours_per_day_overtime', rule_value: 12,  description: 'Ore massime con straordinario (doppio turno)',      updated_at: NOW },
      { rule_key: 'min_rest_between_shifts',    rule_value: 11,  description: 'Ore minime riposo tra turni (DLgs 66/2003)',        updated_at: NOW },
      { rule_key: 'max_consecutive_days',       rule_value: 6,   description: 'Giorni lavorativi max consecutivi',                updated_at: NOW },
      { rule_key: 'min_rest_days_per_week',     rule_value: 1,   description: 'Giorni di riposo minimi a settimana',              updated_at: NOW },
      { rule_key: 'max_overtime_hours_month',   rule_value: 25,  description: 'Ore straordinario max mensili (CCNL)',             updated_at: NOW },
      { rule_key: 'max_overtime_hours_year',    rule_value: 250, description: 'Ore straordinario max annuali (CCNL)',             updated_at: NOW },
      { rule_key: 'rest_recovery_expiry_months',rule_value: 18,  description: 'Mesi entro cui recuperare i riposi compensativi',  updated_at: NOW },
    ], { ignoreDuplicates: true });

    // ── RequestTypes / RequestStatuses ──
    await queryInterface.bulkInsert('request_types', [
      { code: 'ferie',        name: 'Ferie',                description: 'Richiesta ferie annuali' },
      { code: 'permesso',     name: 'Permesso',             description: 'Permesso breve' },
      { code: 'recupero',     name: 'Recupero riposo',      description: 'Fruizione riposo compensativo' },
      { code: 'cambio_turno', name: 'Cambio turno',         description: 'Scambio turno con collega' },
      { code: 'preferenza',   name: 'Preferenza turno',     description: 'Soft preference per un turno specifico' },
    ], { ignoreDuplicates: true });

    await queryInterface.bulkInsert('request_statuses', [
      { code: 'pending',  name: 'In attesa',  description: 'In attesa di approvazione' },
      { code: 'approved', name: 'Approvata',  description: 'Approvata dal coordinatore' },
      { code: 'rejected', name: 'Rifiutata',  description: 'Rifiutata dal coordinatore' },
    ], { ignoreDuplicates: true });
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('work_rules',       null, {});
    await queryInterface.bulkDelete('shift_weights',    null, {});
    await queryInterface.bulkDelete('shift_types',      null, {});
    await queryInterface.bulkDelete('competencies',     null, {});
    await queryInterface.bulkDelete('request_statuses', null, {});
    await queryInterface.bulkDelete('request_types',    null, {});
    await queryInterface.bulkDelete('users',            null, {});
    await queryInterface.bulkDelete('roles',            null, {});
  },
};
