const { DataTypes } = require('sequelize');

/**
 * ShiftType — tipi di turno configurabili.
 * 
 * Turni standard infermieristici:
 *   M   = Mattina        07:00-15:00  8h
 *   P   = Pomeriggio     15:00-23:00  8h
 *   N   = Notte          23:00-07:00  8h
 *   G12 = Giorno 12h     07:00-19:00  12h
 *   N12 = Notte 12h      19:00-07:00  12h
 *   R   = Riposo         —            0h  (non assegnato automaticamente)
 * 
 * Campi aggiuntivi rispetto allo schema originale:
 *   - category: giorno | notte | festivo (per calcolo pesi automatico)
 *   - required_competencies: JSON array di competency codes obbligatori
 *   - min_experience_months: esperienza minima per poter fare questo turno
 *   - weight_key: chiave nella tabella shift_weights
 */
module.exports = (sequelize) => sequelize.define('ShiftType', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  code: { type: DataTypes.STRING(10), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(100), allowNull: false },

  start_time: { type: DataTypes.STRING(5), allowNull: false, comment: 'HH:MM' },
  end_time:   { type: DataTypes.STRING(5), allowNull: false, comment: 'HH:MM' },

  duration_hours: { type: DataTypes.FLOAT, defaultValue: 8 },
  required_staff: {
    type: DataTypes.INTEGER,
    defaultValue: 2,
    comment: 'Numero minimo infermieri richiesti per questo turno ogni giorno',
  },

  category: {
    type: DataTypes.STRING(20),
    defaultValue: 'giorno',
    validate: { isIn: [['giorno', 'notte', 'festivo', 'riposo']] },
    comment: 'Categoria principale — usata dal solver per applicare i pesi corretti',
  },

  // Vincolo di competenza: JSON array es. ["terapia_intensiva"]
  // Il solver rifiuta infermieri senza almeno una di queste competenze (vincolo hard)
  required_competency_codes: {
    type: DataTypes.TEXT,
    defaultValue: '[]',
    get() {
      const val = this.getDataValue('required_competency_codes');
      try { return JSON.parse(val || '[]'); } catch { return []; }
    },
    set(val) {
      this.setDataValue('required_competency_codes', JSON.stringify(val || []));
    },
    comment: 'JSON array di competency.code richiesti per questo turno',
  },

  min_experience_months: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Mesi di anzianità minima richiesti (0 = nessun vincolo)',
  },

  color:      { type: DataTypes.STRING(7),  defaultValue: '#607D8B' },

  // ── Peso turno ──
  // base_weight: valore numerico DIRETTO (es. notte=2.0, giorno=1.0).
  // Usato dal solver e dal bilancio ore senza dover fare JOIN su shift_weights.
  // Deve essere coerente con shift_weights[weight_key].weight_value.
  base_weight: {
    type: DataTypes.FLOAT,
    defaultValue: 1.0,
    allowNull: false,
    comment: 'Peso diretto del turno per il bilancio: notte=2.0, festivo=1.5, giorno=1.0',
  },

  // weight_key: chiave logica verso la tabella shift_weights (per pesi configurabili via UI)
  weight_key: { type: DataTypes.STRING(30), defaultValue: 'normal' },

  is_active:  { type: DataTypes.BOOLEAN,    defaultValue: true },
}, {
  tableName: 'shift_types',
  timestamps: false,
  indexes: [{ fields: ['is_active'] }, { fields: ['category'] }],
});
