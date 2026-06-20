require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

/**
 * Configurazione Sequelize dual-mode:
 *   development / test → SQLite (zero config, sviluppo locale)
 *   production         → PostgreSQL (DB_* da variabili d'ambiente)
 */
module.exports = {
  development: {
    dialect: 'sqlite',
    storage: './data/opbgestionale.db',
    logging: false,
  },
  test: {
    dialect: 'sqlite',
    storage: ':memory:',
    logging: false,
  },
  production: {
    dialect: 'postgres',
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME     || 'opbgestionale',
    username: process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
    logging:  false,
    pool: {
      max: 10,
      min: 2,
      acquire: 30000,
      idle: 10000,
    },
    dialectOptions: isProd ? {
      ssl: { require: true, rejectUnauthorized: false },
    } : {},
  },
};
