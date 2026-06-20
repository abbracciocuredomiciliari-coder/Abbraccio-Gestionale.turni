require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.SQLITE_PATH || path.join(dataDir, 'opbgestionale.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Errore apertura database SQLite:', err.message);
  } else {
    console.log('Connesso al database SQLite:', dbPath);
  }
});

// Inizializza schema e dati se il database è vuoto
db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", (err, row) => {
  if (err) {
    console.error(err);
    return;
  }
  if (!row) {
    const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'schema-sqlite.sql'), 'utf8');
    const seed = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'seed-sqlite.sql'), 'utf8');
    db.exec(schema + '\n' + seed, (execErr) => {
      if (execErr) {
        console.error('Errore inizializzazione database:', execErr.message);
      } else {
        console.log('Database inizializzato con schema e dati di esempio');
      }
    });
  }
});

const dbAsync = {
  all: (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  }),
  get: (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  }),
  run: (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  }),
  exec: (sql) => new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  })
};

module.exports = dbAsync;
