const { DataTypes } = require('sequelize');

module.exports = (sequelize) => sequelize.define('RequestType', {
  id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  code:        { type: DataTypes.STRING(50), allowNull: false, unique: true },
  name:        { type: DataTypes.STRING(100), allowNull: false },
  description: { type: DataTypes.TEXT },
}, {
  tableName: 'request_types',
  timestamps: false,
});
