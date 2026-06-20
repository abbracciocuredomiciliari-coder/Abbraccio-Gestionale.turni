const { DataTypes } = require('sequelize');

/**
 * Request — richieste del personale infermieristico.
 * 
 * Tipi supportati:
 *   ferie        → ferie annuali (giorni da scalare dal monte ferie)
 *   permesso     → permesso breve (ore)
 *   recupero     → fruizione di un riposo compensativo maturato
 *   cambio_turno → richiesta di scambio turno con un collega
 *   preferenza   → preferenza su turno specifico (soft constraint)
 */
module.exports = (sequelize) => sequelize.define('Request', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete: 'CASCADE',
  },
  request_type_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'request_types', key: 'id' },
  },
  status_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'request_statuses', key: 'id' },
  },

  start_date: { type: DataTypes.DATEONLY, allowNull: false },
  end_date:   { type: DataTypes.DATEONLY, allowNull: false },

  // Per richieste di cambio turno o preferenza su turno specifico
  shift_type_id: {
    type: DataTypes.INTEGER,
    references: { model: 'shift_types', key: 'id' },
    onDelete: 'SET NULL',
  },

  // Per cambio turno: l'altro infermiere coinvolto
  swap_with_user_id: {
    type: DataTypes.INTEGER,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
  },

  notes: { type: DataTypes.TEXT },

  approved_by: {
    type: DataTypes.INTEGER,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
  },
  approved_at: { type: DataTypes.DATE },
  rejection_reason: { type: DataTypes.TEXT },
}, {
  tableName: 'requests',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['user_id', 'status_id'] },
    { fields: ['start_date', 'end_date'] },
  ],
});
