const { DataTypes } = require('sequelize');

/**
 * Competency — abilità/specializzazioni cliniche degli infermieri.
 * 
 * Esempi:
 *   terapia_intensiva, pediatria, oncologia, emergenza, blocco_operatorio,
 *   dialisi, neonatologia, psichiatria, medicazione_avanzata, prelievi
 * 
 * Il solver usa le competenze per:
 *   1. Vincolo hard: un turno che richiede competenza X non può essere
 *      assegnato a un infermiere senza quella competenza
 *   2. Vincolo soft: preferisce assegnare turni specialistici a chi ha
 *      il livello di competenza più alto
 */
module.exports = (sequelize) => sequelize.define('Competency', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    comment: 'Identificatore univoco, es: terapia_intensiva',
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Nome leggibile, es: Terapia Intensiva',
  },
  description: { type: DataTypes.TEXT },

  category: {
    type: DataTypes.STRING(50),
    comment: 'Categoria: clinica, tecnica, gestionale, emergenza',
  },
  is_required_for_night: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Se true, almeno un infermiere con questa competenza deve essere presente in ogni turno notturno',
  },
}, {
  tableName: 'competencies',
  timestamps: false,
});
