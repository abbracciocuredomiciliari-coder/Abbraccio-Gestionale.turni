const { DataTypes } = require('sequelize');

/**
 * Schedule — planning mensile generato dal constraint solver.
 * 
 * Stati:
 *   draft     → generato ma non ancora pubblicato (modificabile)
 *   published → pubblicato al personale (visibile a tutti)
 *   archived  → mese passato, storico immutabile
 * 
 * solver_metadata: JSON con statistiche della run del solver:
 *   { penalty, violations, runtime_ms, window_months, staff_count }
 */
module.exports = (sequelize) => sequelize.define('Schedule', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  year:  { type: DataTypes.INTEGER, allowNull: false },
  month: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 12 },
  },

  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'draft',
    validate: { isIn: [['draft', 'published', 'archived']] },
  },

  created_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },

  solver_metadata: {
    type: DataTypes.TEXT,
    defaultValue: '{}',
    get() {
      try { return JSON.parse(this.getDataValue('solver_metadata') || '{}'); }
      catch { return {}; }
    },
    set(val) {
      this.setDataValue('solver_metadata', JSON.stringify(val || {}));
    },
    comment: 'JSON: { penalty, violations_count, runtime_ms, assignments_count }',
  },

  notes: { type: DataTypes.TEXT },
}, {
  tableName: 'schedules',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['year', 'month'] },
    { fields: ['status'] },
  ],
});
