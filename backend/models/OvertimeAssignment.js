const { DataTypes } = require('sequelize');

/**
 * OvertimeAssignment — registro ufficiale delle ore straordinarie.
 * 
 * Separato da ScheduleAssignment per:
 *   1. Tracciabilità legale (CCNL richiede registro separato)
 *   2. Query rapide per report mensili/annuali
 *   3. Verifica limiti senza join pesanti
 */
module.exports = (sequelize) => sequelize.define('OvertimeAssignment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  shift_type_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'shift_types', key: 'id' },
  },
  schedule_id: {
    type: DataTypes.INTEGER,
    references: { model: 'schedules', key: 'id' },
    onDelete: 'SET NULL',
  },

  work_date:      { type: DataTypes.DATEONLY, allowNull: false },
  overtime_hours: { type: DataTypes.FLOAT,    allowNull: false },

  reason: {
    type: DataTypes.TEXT,
    comment: 'Motivazione: assenza collega, emergenza reparto, etc.',
  },

  authorized_by: {
    type: DataTypes.INTEGER,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
    comment: 'Coordinatore che ha autorizzato lo straordinario',
  },
}, {
  tableName: 'overtime_assignments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['user_id', 'work_date'] },
    { fields: ['work_date'] },
  ],
});
