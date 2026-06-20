const { DataTypes } = require('sequelize');

module.exports = (sequelize) => sequelize.define('OvertimeLimit', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete: 'CASCADE',
  },
  year: { type: DataTypes.INTEGER, allowNull: false },

  max_hours_month: {
    type: DataTypes.FLOAT,
    comment: 'Override individuale del limite mensile (null = usa work_rules globale)',
  },
  max_hours_year: {
    type: DataTypes.FLOAT,
    comment: 'Override individuale del limite annuale (null = usa work_rules globale)',
  },

  note: { type: DataTypes.TEXT },

  set_by: {
    type: DataTypes.INTEGER,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
    comment: 'Coordinatore che ha impostato il limite individuale',
  },
}, {
  tableName: 'overtime_limits',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { unique: true, fields: ['user_id', 'year'] },
  ],
});
