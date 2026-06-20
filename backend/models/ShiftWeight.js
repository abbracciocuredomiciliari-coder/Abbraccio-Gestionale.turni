const { DataTypes } = require('sequelize');

/**
 * ShiftWeight — pesi configurabili per il bilancio ore.
 * 
 * Formula score per assegnazione:
 *   score += duration_hours × MAX(peso_tipo, peso_giorno_settimana)
 * 
 * Chiavi standard:
 *   night, weekend, holiday, long_shift, normal, overtime, window_months
 */
module.exports = (sequelize) => sequelize.define('ShiftWeight', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  weight_key: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  weight_value: {
    type: DataTypes.FLOAT,
    allowNull: false,
  },
  description: { type: DataTypes.TEXT },

  updated_by: {
    type: DataTypes.INTEGER,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
  },
}, {
  tableName: 'shift_weights',
  timestamps: true,
  createdAt: false,
  updatedAt: 'updated_at',
});
