const { DataTypes } = require('sequelize');

/**
 * UserConstraint — vincoli contrattuali/personali per turno.
 * 
 * constraint_type:
 *   cannot     → vincolo hard: l'infermiere NON può fare questo turno
 *                (es. esonero medico da turni notturni)
 *   prefer_not → vincolo soft: evita se possibile, ma può in emergenza
 *   only       → vincolo hard: l'infermiere può fare SOLO questo turno
 *                (es. part-time solo mattina)
 * 
 * Esempi reali:
 *   - Infermiera in gravidanza: cannot su N e N12
 *   - Part-time 18h: only su M (solo mattina)
 *   - Infermiere con problemi schiena: prefer_not su G12
 */
module.exports = (sequelize) => sequelize.define('UserConstraint', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete: 'CASCADE',
  },
  shift_type_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'shift_types', key: 'id' },
    onDelete: 'CASCADE',
  },

  constraint_type: {
    type: DataTypes.STRING(20),
    allowNull: false,
    validate: { isIn: [['cannot', 'prefer_not', 'only']] },
  },

  // Periodo di validità del vincolo (null = permanente)
  valid_from: { type: DataTypes.DATEONLY },
  valid_until: {
    type: DataTypes.DATEONLY,
    comment: 'Null = nessuna scadenza (es. vincolo contrattuale permanente)',
  },

  reason: {
    type: DataTypes.TEXT,
    comment: 'Motivazione: medica, contrattuale, organizzativa',
  },
  source: {
    type: DataTypes.STRING(20),
    defaultValue: 'coordinator',
    validate: { isIn: [['coordinator', 'contract', 'medical', 'request']] },
  },

  is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  tableName: 'user_constraints',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['user_id', 'is_active'] },
    { fields: ['shift_type_id'] },
  ],
});
