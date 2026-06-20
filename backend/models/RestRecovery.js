const { DataTypes } = require('sequelize');

/**
 * RestRecovery — tracciamento riposi compensativi non goduti.
 * 
 * Ogni straordinario genera automaticamente un record di riposo da recuperare.
 * La scadenza è configurabile (default 18 mesi dal CCNL).
 * 
 * Stato derivato:
 *   hours_pending = hours_owed - hours_recovered
 *   is_overdue    = recovery_deadline < TODAY && hours_pending > 0
 */
module.exports = (sequelize) => sequelize.define('RestRecovery', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
    onDelete: 'CASCADE',
  },

  accrued_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: 'Data in cui è maturato il riposo (giorno dello straordinario)',
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'Descrizione: es. "Doppio turno 15/01 — assenza collega"',
  },

  hours_owed:      { type: DataTypes.FLOAT, allowNull: false, defaultValue: 8 },
  hours_recovered: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },

  recovery_deadline: {
    type: DataTypes.DATEONLY,
    comment: 'Scadenza entro cui il riposo deve essere goduto (CCNL: 18 mesi)',
  },
  recovered_on: {
    type: DataTypes.DATEONLY,
    comment: 'Data effettiva in cui il riposo è stato goduto',
  },

  note: { type: DataTypes.TEXT },
}, {
  tableName: 'rest_recovery',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['user_id'] },
    { fields: ['recovery_deadline'] },
  ],
});
