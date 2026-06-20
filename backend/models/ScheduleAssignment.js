const { DataTypes } = require('sequelize');

/**
 * ScheduleAssignment — singola assegnazione turno nel planning.
 * 
 * Storico assegnazioni: ogni riga rappresenta
 * "L'infermiere X ha lavorato il giorno Y con il turno Z".
 * 
 * È la tabella centrale per:
 *   - visualizzazione planning mensile
 *   - calcolo bilancio ore (cumulative_score)
 *   - rilevamento violazioni contrattuali
 *   - export per buste paga / sistemi HR
 */
module.exports = (sequelize) => sequelize.define('ScheduleAssignment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  schedule_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'schedules', key: 'id' },
    onDelete: 'CASCADE',
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  shift_type_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'shift_types', key: 'id' },
  },

  work_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },

  // Ore effettive (può differire da shift_type.duration_hours in caso di straordinario)
  duration_hours: {
    type: DataTypes.FLOAT,
    defaultValue: 8,
  },

  is_overtime: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'true = secondo turno nella stessa giornata (doppio turno)',
  },

  // score_weight: peso effettivo applicato a questa specifica assegnazione.
  // Formula: MAX(shift_type.base_weight, weekend_weight se sabato/domenica)
  // È uno SNAPSHOT — non cambia se il coordinatore modifica i pesi dopo la generazione.
  // Valori tipici: giorno=1.0, pomeriggio=1.0, notte=2.0, weekend=1.5, straordinario=3.0
  score_weight: {
    type: DataTypes.FLOAT,
    defaultValue: 1.0,
    allowNull: false,
    comment: 'Peso snapshot al momento assegnazione: MAX(base_weight_turno, peso_giorno_settimana)',
  },

  // weighted_score = duration_hours × score_weight
  // Campo calcolato e persistito: permette SUM() diretto senza moltiplicazioni in query.
  // Es: notte 8h × 2.0 = 16.0 pt  |  mattina 8h × 1.0 = 8.0 pt
  weighted_score: {
    type: DataTypes.FLOAT,
    defaultValue: 8.0,
    allowNull: false,
    comment: 'duration_hours × score_weight — usato da SUM() nel calcolo bilancio ore',
  },

  notes: { type: DataTypes.TEXT },
}, {
  tableName: 'schedule_assignments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { unique: true, fields: ['schedule_id', 'user_id', 'work_date'],
      where: { is_overtime: false },
      name: 'unique_normal_assignment' },
    { fields: ['work_date'] },
    { fields: ['user_id', 'work_date'] },
  ],
});
