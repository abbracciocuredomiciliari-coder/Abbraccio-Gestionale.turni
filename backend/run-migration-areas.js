'use strict';
const path    = require('path');
const fs      = require('fs');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH  = path.join(__dirname, 'data', 'opbgestionale.db');
const SQL_PATH = path.join(__dirname, '..', 'database', 'migration-areas.sql');

if (!fs.existsSync(DB_PATH))  { console.error('DB non trovato:', DB_PATH); process.exit(1); }
if (!fs.existsSync(SQL_PATH)) { console.error('SQL non trovato:', SQL_PATH); process.exit(1); }

const db  = new sqlite3.Database(DB_PATH);
const sql = fs.readFileSync(SQL_PATH, 'utf8');

function execSql(block) {
  return new Promise((resolve, reject) => {
    db.exec(block, (err) => { if (err) reject(err); else resolve(); });
  });
}
function queryAll(stmt) {
  return new Promise((resolve, reject) => {
    db.all(stmt, [], (err, rows) => { if (err) reject(err); else resolve(rows); });
  });
}

function splitBlocks(src) {
  const blocks = [];
  let current = '', depth = 0;
  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('--') || trimmed === '') {
      if (trimmed === '' && current.trim()) { blocks.push(current.trim()); current = ''; }
      continue;
    }
    current += line + '\n';
    depth += (line.match(/\(/g) || []).length;
    depth -= (line.match(/\)/g) || []).length;
    if (depth <= 0 && trimmed.endsWith(';')) { blocks.push(current.trim()); current = ''; depth = 0; }
  }
  if (current.trim()) blocks.push(current.trim());
  return blocks.filter(b => b.length > 0);
}

const blocks = splitBlocks(sql);

async function main() {
  console.log(`\n Applicazione migration-areas.sql (${blocks.length} blocchi)\n`);
  let ok = 0, skip = 0, errors = 0;

  for (const block of blocks) {
    const preview = block.slice(0, 72).replace(/\n/g, ' ');
    try {
      await execSql(block);
      console.log(`  OK   ${preview}...`);
      ok++;
    } catch (e) {
      const skipPatterns = ['already exists', 'duplicate column', 'UNIQUE constraint'];
      if (skipPatterns.some(p => e.message.includes(p))) {
        console.log(`  SKIP (già presente): ${preview}...`);
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
    console.log('\nMigration aree completata.\n');
    const tables = await queryAll(`SELECT name FROM sqlite_master WHERE type='table' AND name='areas'`);
    const views  = await queryAll(`SELECT name FROM sqlite_master WHERE type='view' AND name='v_area_uncovered_shifts'`);
    const role   = await queryAll(`SELECT name FROM roles WHERE name='area_manager'`);
    if (tables.length > 0) console.log('  [tabella] areas ✓');
    if (views.length > 0)  console.log('  [view]    v_area_uncovered_shifts ✓');
    if (role.length > 0)   console.log('  [ruolo]   area_manager ✓');
    const col = await queryAll(`PRAGMA table_info(departments)`);
    const hasAreaId = col.some(c => c.name === 'area_id');
    console.log(`  departments.area_id : ${hasAreaId ? 'OK' : 'MANCANTE'}`);
  } else {
    console.error('\nMigration fallita con errori.\n');
  }

  db.close();
  process.exit(errors === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); db.close(); process.exit(1); });
