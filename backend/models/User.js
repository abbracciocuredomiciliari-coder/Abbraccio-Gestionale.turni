const { DataTypes } = require('sequelize');

/**
 * Modello Nurse/User — rappresenta l'infermiere o il coordinatore.
 * 
 * Campi aggiuntivi rispetto allo schema SQLite originale:
 *   - contract_type: tipo contratto (full_time, part_time, per_diem)
 *   - contract_hours_week: ore contrattuali settimanali (es. 36 per full-time)
 *   - hire_date: data assunzione (per calcolo anzianità)
 *   - qualification: qualifica professionale (infermiere, OTA, OSS, etc.)
 *   - ward: reparto di assegnazione principale
 *   - phone: recapito per emergenze
 */
module.exports = (sequelize) => sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  username:       { type: DataTypes.STRING(100), allowNull: false, unique: true },
  email:          { type: DataTypes.STRING(255), allowNull: false, unique: true },
  password_hash:  { type: DataTypes.STRING(255), allowNull: false },

  first_name: { type: DataTypes.STRING(100), allowNull: false },
  last_name:  { type: DataTypes.STRING(100), allowNull: false },

  role_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'roles', key: 'id' },
  },

  // Dati professionali infermieristici
  qualification: {
    type: DataTypes.STRING(50),
    defaultValue: 'infermiere',
    comment: 'infermiere, OTA, OSS, infermiere_specializzato, coordinatore',
  },
  contract_type: {
    type: DataTypes.STRING(20),
    defaultValue: 'full_time',
    validate: { isIn: [['full_time', 'part_time', 'per_diem', 'temporary']] },
    comment: 'full_time=36h/sett, part_time=18-24h, per_diem=a chiamata',
  },
  contract_hours_week: {
    type: DataTypes.FLOAT,
    defaultValue: 36,
    comment: 'Ore contrattuali settimanali — vincola il solver sul massimo turni',
  },
  ward: {
    type: DataTypes.STRING(100),
    comment: 'Reparto di assegnazione principale (es. Terapia Intensiva, Pediatria)',
  },
  hire_date: {
    type: DataTypes.DATEONLY,
    comment: 'Data di assunzione — usata per calcolo seniority e ferie maturate',
  },
  phone: { type: DataTypes.STRING(20) },

  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  tableName: 'users',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['role_id'] },
    { fields: ['ward'] },
    { fields: ['is_active'] },
  ],
});
