'use strict';

/**
 * Migration: schema completo per gestionale turni infermieristici
 * Compatibile con PostgreSQL (produzione) e SQLite (sviluppo)
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const isPostgres = queryInterface.sequelize.getDialect() === 'postgres';
    const TEXT = Sequelize.TEXT;
    const NOW  = Sequelize.literal('CURRENT_TIMESTAMP');

    // ─────────────────────────────────────────
    // roles
    // ─────────────────────────────────────────
    await queryInterface.createTable('roles', {
      id:          { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name:        { type: Sequelize.STRING(50),  allowNull: false, unique: true },
      description: { type: TEXT },
    });

    // ─────────────────────────────────────────
    // users
    // ─────────────────────────────────────────
    await queryInterface.createTable('users', {
      id:             { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      username:       { type: Sequelize.STRING(100), allowNull: false, unique: true },
      email:          { type: Sequelize.STRING(255), allowNull: false, unique: true },
      password_hash:  { type: Sequelize.STRING(255), allowNull: false },
      first_name:     { type: Sequelize.STRING(100), allowNull: false },
      last_name:      { type: Sequelize.STRING(100), allowNull: false },
      role_id:        { type: Sequelize.INTEGER, allowNull: false,
                        references: { model: 'roles', key: 'id' } },
      qualification:  { type: Sequelize.STRING(50),  defaultValue: 'infermiere' },
      contract_type:  { type: Sequelize.STRING(20),  defaultValue: 'full_time' },
      contract_hours_week: { type: Sequelize.FLOAT,  defaultValue: 36 },
      ward:           { type: Sequelize.STRING(100) },
      hire_date:      { type: Sequelize.DATEONLY },
      phone:          { type: Sequelize.STRING(20) },
      is_active:      { type: Sequelize.BOOLEAN,     defaultValue: true },
      created_at:     { type: Sequelize.DATE,        defaultValue: NOW },
      updated_at:     { type: Sequelize.DATE,        defaultValue: NOW },
    });
    await queryInterface.addIndex('users', ['role_id']);
    await queryInterface.addIndex('users', ['is_active']);
    await queryInterface.addIndex('users', ['ward']);

    // ─────────────────────────────────────────
    // competencies
    // ─────────────────────────────────────────
    await queryInterface.createTable('competencies', {
      id:                   { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      code:                 { type: Sequelize.STRING(50),  allowNull: false, unique: true },
      name:                 { type: Sequelize.STRING(100), allowNull: false },
      description:          { type: TEXT },
      category:             { type: Sequelize.STRING(50) },
      is_required_for_night:{ type: Sequelize.BOOLEAN, defaultValue: false },
    });

    // ─────────────────────────────────────────
    // nurse_competencies (M:N users ↔ competencies)
    // ─────────────────────────────────────────
    await queryInterface.createTable('nurse_competencies', {
      id:            { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      user_id:       { type: Sequelize.INTEGER, allowNull: false,
                       references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      competency_id: { type: Sequelize.INTEGER, allowNull: false,
                       references: { model: 'competencies', key: 'id' }, onDelete: 'CASCADE' },
      level:         { type: Sequelize.INTEGER, defaultValue: 2 },
      certified_at:  { type: Sequelize.DATEONLY },
      expires_at:    { type: Sequelize.DATEONLY },
      notes:         { type: TEXT },
      created_at:    { type: Sequelize.DATE, defaultValue: NOW },
    });
    await queryInterface.addIndex('nurse_competencies', ['user_id', 'competency_id'], { unique: true });

    // ─────────────────────────────────────────
    // shift_types
    // ─────────────────────────────────────────
    await queryInterface.createTable('shift_types', {
      id:             { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      code:           { type: Sequelize.STRING(10),  allowNull: false, unique: true },
      name:           { type: Sequelize.STRING(100), allowNull: false },
      start_time:     { type: Sequelize.STRING(5),   allowNull: false },
      end_time:       { type: Sequelize.STRING(5),   allowNull: false },
      duration_hours: { type: Sequelize.FLOAT,       defaultValue: 8 },
      required_staff: { type: Sequelize.INTEGER,     defaultValue: 2 },
      category:       { type: Sequelize.STRING(20),  defaultValue: 'giorno' },
      required_competency_codes: { type: TEXT, defaultValue: '[]' },
      min_experience_months:     { type: Sequelize.INTEGER, defaultValue: 0 },
      color:          { type: Sequelize.STRING(7),   defaultValue: '#607D8B' },
      base_weight:    { type: Sequelize.FLOAT,       defaultValue: 1.0, allowNull: false,
                        comment: 'Peso diretto: notte=2.0, festivo=1.5, giorno=1.0' },
      weight_key:     { type: Sequelize.STRING(30),  defaultValue: 'normal' },
      is_active:      { type: Sequelize.BOOLEAN,     defaultValue: true },
    });
    await queryInterface.addIndex('shift_types', ['is_active']);

    // ─────────────────────────────────────────
    // shift_weights
    // ─────────────────────────────────────────
    await queryInterface.createTable('shift_weights', {
      id:           { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      weight_key:   { type: Sequelize.STRING(50), allowNull: false, unique: true },
      weight_value: { type: Sequelize.FLOAT,      allowNull: false },
      description:  { type: TEXT },
      updated_by:   { type: Sequelize.INTEGER,
                      references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      updated_at:   { type: Sequelize.DATE, defaultValue: NOW },
    });

    // ─────────────────────────────────────────
    // work_rules
    // ─────────────────────────────────────────
    await queryInterface.createTable('work_rules', {
      id:          { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      rule_key:    { type: Sequelize.STRING(100), allowNull: false, unique: true },
      rule_value:  { type: Sequelize.FLOAT,       allowNull: false },
      description: { type: TEXT },
      updated_by:  { type: Sequelize.INTEGER,
                     references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      updated_at:  { type: Sequelize.DATE, defaultValue: NOW },
    });

    // ─────────────────────────────────────────
    // user_constraints
    // ─────────────────────────────────────────
    await queryInterface.createTable('user_constraints', {
      id:              { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      user_id:         { type: Sequelize.INTEGER, allowNull: false,
                         references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      shift_type_id:   { type: Sequelize.INTEGER, allowNull: false,
                         references: { model: 'shift_types', key: 'id' }, onDelete: 'CASCADE' },
      constraint_type: { type: Sequelize.STRING(20), allowNull: false },
      valid_from:      { type: Sequelize.DATEONLY },
      valid_until:     { type: Sequelize.DATEONLY },
      reason:          { type: TEXT },
      source:          { type: Sequelize.STRING(20), defaultValue: 'coordinator' },
      is_active:       { type: Sequelize.BOOLEAN, defaultValue: true },
      created_at:      { type: Sequelize.DATE, defaultValue: NOW },
    });
    await queryInterface.addIndex('user_constraints', ['user_id', 'is_active']);

    // ─────────────────────────────────────────
    // request_types / request_statuses
    // ─────────────────────────────────────────
    await queryInterface.createTable('request_types', {
      id:          { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      code:        { type: Sequelize.STRING(50), allowNull: false, unique: true },
      name:        { type: Sequelize.STRING(100), allowNull: false },
      description: { type: TEXT },
    });
    await queryInterface.createTable('request_statuses', {
      id:          { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      code:        { type: Sequelize.STRING(50), allowNull: false, unique: true },
      name:        { type: Sequelize.STRING(100), allowNull: false },
      description: { type: TEXT },
    });

    // ─────────────────────────────────────────
    // requests
    // ─────────────────────────────────────────
    await queryInterface.createTable('requests', {
      id:               { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      user_id:          { type: Sequelize.INTEGER, allowNull: false,
                          references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      request_type_id:  { type: Sequelize.INTEGER, allowNull: false,
                          references: { model: 'request_types', key: 'id' } },
      status_id:        { type: Sequelize.INTEGER, allowNull: false,
                          references: { model: 'request_statuses', key: 'id' } },
      start_date:       { type: Sequelize.DATEONLY, allowNull: false },
      end_date:         { type: Sequelize.DATEONLY, allowNull: false },
      shift_type_id:    { type: Sequelize.INTEGER,
                          references: { model: 'shift_types', key: 'id' }, onDelete: 'SET NULL' },
      swap_with_user_id:{ type: Sequelize.INTEGER,
                          references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      notes:            { type: TEXT },
      approved_by:      { type: Sequelize.INTEGER,
                          references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      approved_at:      { type: Sequelize.DATE },
      rejection_reason: { type: TEXT },
      created_at:       { type: Sequelize.DATE, defaultValue: NOW },
      updated_at:       { type: Sequelize.DATE, defaultValue: NOW },
    });
    await queryInterface.addIndex('requests', ['user_id', 'status_id']);
    await queryInterface.addIndex('requests', ['start_date', 'end_date']);

    // ─────────────────────────────────────────
    // schedules
    // ─────────────────────────────────────────
    await queryInterface.createTable('schedules', {
      id:              { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      year:            { type: Sequelize.INTEGER, allowNull: false },
      month:           { type: Sequelize.INTEGER, allowNull: false },
      status:          { type: Sequelize.STRING(20), defaultValue: 'draft' },
      created_by:      { type: Sequelize.INTEGER, allowNull: false,
                         references: { model: 'users', key: 'id' } },
      solver_metadata: { type: TEXT, defaultValue: '{}' },
      notes:           { type: TEXT },
      created_at:      { type: Sequelize.DATE, defaultValue: NOW },
      updated_at:      { type: Sequelize.DATE, defaultValue: NOW },
    });
    await queryInterface.addIndex('schedules', ['year', 'month'], { unique: true });

    // ─────────────────────────────────────────
    // schedule_assignments
    // ─────────────────────────────────────────
    await queryInterface.createTable('schedule_assignments', {
      id:             { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      schedule_id:    { type: Sequelize.INTEGER, allowNull: false,
                        references: { model: 'schedules', key: 'id' }, onDelete: 'CASCADE' },
      user_id:        { type: Sequelize.INTEGER, allowNull: false,
                        references: { model: 'users', key: 'id' } },
      shift_type_id:  { type: Sequelize.INTEGER, allowNull: false,
                        references: { model: 'shift_types', key: 'id' } },
      work_date:      { type: Sequelize.DATEONLY, allowNull: false },
      duration_hours:  { type: Sequelize.FLOAT,   defaultValue: 8 },
      is_overtime:     { type: Sequelize.BOOLEAN,  defaultValue: false },
      score_weight:    { type: Sequelize.FLOAT,    defaultValue: 1.0, allowNull: false,
                         comment: 'Snapshot MAX(base_weight, weekend_weight) al momento assegnazione' },
      weighted_score:  { type: Sequelize.FLOAT,    defaultValue: 8.0, allowNull: false,
                         comment: 'duration_hours x score_weight — per SUM() diretto nel bilancio' },
      notes:           { type: TEXT },
      created_at:     { type: Sequelize.DATE, defaultValue: NOW },
    });
    await queryInterface.addIndex('schedule_assignments', ['user_id', 'work_date']);
    await queryInterface.addIndex('schedule_assignments', ['work_date']);

    // ─────────────────────────────────────────
    // overtime_assignments
    // ─────────────────────────────────────────
    await queryInterface.createTable('overtime_assignments', {
      id:             { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      user_id:        { type: Sequelize.INTEGER, allowNull: false,
                        references: { model: 'users', key: 'id' } },
      shift_type_id:  { type: Sequelize.INTEGER, allowNull: false,
                        references: { model: 'shift_types', key: 'id' } },
      schedule_id:    { type: Sequelize.INTEGER,
                        references: { model: 'schedules', key: 'id' }, onDelete: 'SET NULL' },
      work_date:      { type: Sequelize.DATEONLY, allowNull: false },
      overtime_hours: { type: Sequelize.FLOAT,   allowNull: false },
      reason:         { type: TEXT },
      authorized_by:  { type: Sequelize.INTEGER,
                        references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      created_at:     { type: Sequelize.DATE, defaultValue: NOW },
      updated_at:     { type: Sequelize.DATE, defaultValue: NOW },
    });
    await queryInterface.addIndex('overtime_assignments', ['user_id', 'work_date']);

    // ─────────────────────────────────────────
    // rest_recovery
    // ─────────────────────────────────────────
    await queryInterface.createTable('rest_recovery', {
      id:                { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      user_id:           { type: Sequelize.INTEGER, allowNull: false,
                           references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      accrued_date:      { type: Sequelize.DATEONLY, allowNull: false },
      reason:            { type: TEXT, allowNull: false },
      hours_owed:        { type: Sequelize.FLOAT, allowNull: false, defaultValue: 8 },
      hours_recovered:   { type: Sequelize.FLOAT, allowNull: false, defaultValue: 0 },
      recovery_deadline: { type: Sequelize.DATEONLY },
      recovered_on:      { type: Sequelize.DATEONLY },
      note:              { type: TEXT },
      created_at:        { type: Sequelize.DATE, defaultValue: NOW },
      updated_at:        { type: Sequelize.DATE, defaultValue: NOW },
    });
    await queryInterface.addIndex('rest_recovery', ['user_id']);
    await queryInterface.addIndex('rest_recovery', ['recovery_deadline']);

    // ─────────────────────────────────────────
    // overtime_limits
    // ─────────────────────────────────────────
    await queryInterface.createTable('overtime_limits', {
      id:               { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      user_id:          { type: Sequelize.INTEGER, allowNull: false,
                          references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      year:             { type: Sequelize.INTEGER, allowNull: false },
      max_hours_month:  { type: Sequelize.FLOAT },
      max_hours_year:   { type: Sequelize.FLOAT },
      note:             { type: TEXT },
      set_by:           { type: Sequelize.INTEGER,
                          references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
      created_at:       { type: Sequelize.DATE, defaultValue: NOW },
    });
    await queryInterface.addIndex('overtime_limits', ['user_id', 'year'], { unique: true });
  },

  async down(queryInterface) {
    const tables = [
      'overtime_limits', 'rest_recovery', 'overtime_assignments',
      'schedule_assignments', 'schedules', 'requests',
      'request_statuses', 'request_types', 'user_constraints',
      'work_rules', 'shift_weights', 'shift_types',
      'nurse_competencies', 'competencies', 'users', 'roles',
    ];
    for (const t of tables) {
      await queryInterface.dropTable(t, { cascade: true }).catch(() => {});
    }
  },
};
