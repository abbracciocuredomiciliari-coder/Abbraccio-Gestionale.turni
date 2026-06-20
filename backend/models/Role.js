const { DataTypes } = require('sequelize');

module.exports = (sequelize) => sequelize.define('Role', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    validate: { isIn: [['admin', 'coordinator', 'staff']] },
  },
  description: { type: DataTypes.TEXT },
}, {
  tableName: 'roles',
  timestamps: false,
});
