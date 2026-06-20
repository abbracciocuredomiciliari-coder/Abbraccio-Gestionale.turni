const { DataTypes } = require('sequelize');

/**
 * NurseCompetency — tabella di join M:N tra User e Competency.
 * 
 * Aggiunge:
 *   - level: livello di padronanza (1=base, 2=autonomo, 3=esperto, 4=formatore)
 *   - certified_at: data conseguimento certificazione/attestato
 *   - expires_at: scadenza (es. BLS, ACLS hanno validità biennale)
 *   - notes: annotazioni del coordinatore
 * 
 * Il solver usa `level` come peso: a parità di candidati, preferisce
 * l'esperto (level=3) per turni in reparti specialistici.
 */
module.exports = (sequelize) => sequelize.define('NurseCompetency', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete: 'CASCADE',
  },
  competency_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'competencies', key: 'id' },
    onDelete: 'CASCADE',
  },

  level: {
    type: DataTypes.INTEGER,
    defaultValue: 2,
    validate: { min: 1, max: 4 },
    comment: '1=base, 2=autonomo, 3=esperto, 4=formatore/referente',
  },
  certified_at: { type: DataTypes.DATEONLY },
  expires_at:   {
    type: DataTypes.DATEONLY,
    comment: 'Null = no scadenza. Se scaduta, la competenza non viene considerata attiva.',
  },
  notes: { type: DataTypes.TEXT },
}, {
  tableName: 'nurse_competencies',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { unique: true, fields: ['user_id', 'competency_id'] },
  ],
});
