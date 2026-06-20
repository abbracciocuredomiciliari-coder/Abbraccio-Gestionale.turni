'use strict';
/**
 * run-migration-departments.js
 * Applica la migration per reparti multi-coordinatore.
 *
 * Esecuzione: node run-migration-departments.js
 */

const path   = require('path');
const fs     = require('fs');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH  = path.join(__dirname, 'data', 'opbgestionale.db');
const SQL_PATH = path.join(__dirname, '..', 'database', 'migration-departments.sql');

if (!fs.existsSync(DB_PATH)) {
  console.error('❌ Database non trovato:', DB_PATH);
  process.exit(1);
}
if (!fs.existsSync(SQL_PATH)) {
  console.error('❌ SQL migration non trovato:', SQL_PATH);
  process.exit(1);
}

const db  = new sqlite3.Database(DB_PATH);
const sql = fs.readFileSync(SQL_PATH, 'utf8');

// Helper: esegue uno statement sqlite3 come Promise
function runStmt(stmt) {
  return new Promise((resolve, reject) => {
    db.run(stmt, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
// Helper: query SELECT come Promise
function queryAll(stmt) {
  return new Promise((resolve, reject) => {
    db.all(stmt, [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Helper: esegue db.exec (blocco SQL intero) come Promise
function execSql(block) {
  return new Promise((resolve, reject) => {
    db.exec(block, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Divide il file SQL in blocchi logici separati da righe vuote dopo ;
// Ogni blocco è uno statement completo (CREATE TABLE, ALTER TABLE, CREATE INDEX, CREATE VIEW)
function splitBlocks(src) {
  const blocks = [];
  let current = '';
  let depth = 0;
  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--')) continue;      // commento
    if (trimmed === '') {
      if (current.trim()) {
        blocks.push(current.trim());
        current = '';
      }
      continue;
    }
    current += line + '\n';
    depth += (line.match(/\(/g) || []).length;
    depth -= (line.match(/\)/g) || []).length;
    if (depth <= 0 && trimmed.endsWith(';')) {
      blocks.push(current.trim());
      current = '';
      depth = 0;
    }
  }
  if (current.trim()) blocks.push(current.trim());
  return blocks.filter(b => b.length > 0);
}

const blocks = splitBlocks(sql);

async function main() {
  console.log(`\n Applicazione migration-departments.sql (${blocks.length} blocchi)\n`);

  let ok = 0, skip = 0, errors = 0;

  for (const block of blocks) {
    const preview = block.slice(0, 72).replace(/\n/g, ' ');
    try {
      await execSql(block);
      console.log(`  OK   ${preview}...`);
      ok++;
    } catch (e) {
      const skipPatterns = [
        'already exists',
        'duplicate column',
        'UNIQUE constraint',
      ];
      if (skipPatterns.some(p => e.message.includes(p))) {
        console.log(`  SKIP (gia presente): ${preview}...`);
        skip++;
      } else {
        console.error(`  ERRORE: ${e.message}`);
        console.error(`  Blocco : ${preview}`);
        errors++;
      }
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  OK: ${ok}  |  SKIP: ${skip}  |  ERR: ${errors}`);

  if (errors === 0) {
    console.log('\nMigration completata con successo.\n');

    // Verifica tabelle
    const tables = await queryAll(
      `SELECT name FROM sqlite_master WHERE type='table'
       AND name IN ('departments','department_shift_config',
                    'department_cross_coverage','cross_dept_equity_log')
       ORDER BY name`
    );
    console.log('Tabelle presenti nel DB:');
    for (const t of tables) console.log(`  [tabella] ${t.name}`);

    const views = await queryAll(
      `SELECT name FROM sqlite_master WHERE type='view'
       AND name IN ('v_dept_monthly_staff','v_dept_shift_requirements')
       ORDER BY name`
    );
    console.log('Viste presenti nel DB:');
    for (const v of views) console.log(`  [view] ${v.name}`);

    // Verifica colonne
    const userCols  = await queryAll(`PRAGMA table_info(users)`);
    const teamCols  = await queryAll(`PRAGMA table_info(teams)`);
    const schedCols = await queryAll(`PRAGMA table_info(schedules)`);

    console.log(`\n  users.department_id     : ${userCols.some(c=>c.name==='department_id')  ? 'OK' : 'MANCANTE'}`);
    console.log(`  teams.department_id     : ${teamCols.some(c=>c.name==='department_id')  ? 'OK' : 'MANCANTE'}`);
    console.log(`  schedules.department_id : ${schedCols.some(c=>c.name==='department_id') ? 'OK' : 'MANCANTE'}`);
    console.log('');
  } else {
    console.error('\nMigration fallita con errori.\n');
    process.exit(1);
  }

  db.close();
}

main().catch(e => {
  console.error('Errore fatale:', e.message);
  db.close();
  process.exit(1);
});
