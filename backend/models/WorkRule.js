const { DataTypes } = require('sequelize');

module.exports = (sequelize) => sequelize.define('WorkRule', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  rule_key:   { type: DataTypes.STRING(100), allowNull: false, unique: true },
  rule_value: { type: DataTypes.FLOAT,       allowNull: false },
  description: { type: DataTypes.TEXT },

  updated_by: {
    type: DataTypes.INTEGER,
    references: { model: 'users', key: 'id' },
    onDelete: 'SET NULL',
  },
}, {
  tableName: 'work_rules',
  timestamps: true,
  createdAt: false,
  updatedAt: 'updated_at',
});
