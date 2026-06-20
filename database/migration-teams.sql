-- ══════════════════════════════════════════════════════════════
-- MIGRAZIONE: Squadre, Clinical Role, Assignment Mode
-- Versione: 2026-06-20
--
-- Introduce il sistema di squadre fisse per turno.
-- La logica TEAM e la logica FREE coesistono: ogni shift_type
-- ha il proprio assignment_mode e il solver li gestisce in
-- parallelo nello stesso planning.
--
-- Regole business:
--   - Squadra valida finché il coordinatore non la modifica
--   - Capo-turno sempre designato dal coordinatore, mai dal solver
--   - Rotazione: coordinatore inserisce la prima volta, poi il
--     solver prosegue automaticamente dal mese precedente
--   - Coperture extra fuori-squadra → flag OUT_OF_TEAM nell'audit
--   - Se capo-turno assente e nessun sostituto in squadra →
--     record in capo_turno_pending (coordinatore decide)
-- ══════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;

-- ──────────────────────────────────────────────────────────────
-- A. Estensioni tabelle esistenti
-- ──────────────────────────────────────────────────────────────

-- A1. Qualifica clinica permanente dell'infermiere
--     Distinta dal role_id applicativo (admin/coordinator/staff)
ALTER TABLE users ADD COLUMN clinical_role TEXT DEFAULT 'STAFF'
  CHECK (clinical_role IN ('STAFF','CAPO_TURNO','RESPONSABILE'));

-- A2. Modalità assegnazione per tipo turno
ALTER TABLE shift_types ADD COLUMN assignment_mode TEXT DEFAULT 'FREE'
  CHECK (assignment_mode IN ('FREE','TEAM','MIXED'));

-- A3. Numero minimo di CAPO_TURNO/RESPONSABILE richiesti per turno
ALTER TABLE shift_types ADD COLUMN min_capo_turno INTEGER DEFAULT 0;

-- ──────────────────────────────────────────────────────────────
-- B. Squadre
--    Una squadra è legata a un singolo shift_type.
--    rotation_order definisce la posizione nel ciclo mensile.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_type_id   INTEGER NOT NULL REFERENCES shift_types(id),
  name            TEXT    NOT NULL,
  color           TEXT    DEFAULT '#607D8B',
  rotation_order  INTEGER NOT NULL DEFAULT 1,
  is_active       INTEGER DEFAULT 1,
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_teams_shift ON teams(shift_type_id);

-- ──────────────────────────────────────────────────────────────
-- C. Membri squadra
--    Composizione permanente con storico delle variazioni.
--    valid_until NULL = membro attivo senza scadenza.
--    is_capo_turno = 1: designato dal coordinatore, mai dal solver.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id       INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  is_capo_turno INTEGER NOT NULL DEFAULT 0
                CHECK (is_capo_turno IN (0,1)),
  valid_from    TEXT    NOT NULL,    -- 'YYYY-MM-DD'
  valid_until   TEXT,               -- NULL = permanente
  added_by      INTEGER REFERENCES users(id),
  notes         TEXT,
  created_at    TEXT    DEFAULT (datetime('now')),
  UNIQUE(team_id, user_id, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_tm_team       ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_tm_user       ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tm_valid_from ON team_members(valid_from);

-- ──────────────────────────────────────────────────────────────
-- D. Rotazione mensile
--    Il coordinatore inserisce la prima assegnazione (o override).
--    Se per un mese non c'è record, il solver calcola la squadra
--    successiva in rotation_order rispetto al mese precedente.
--    UNIQUE su (shift_type_id derivato via team + year + month)
--    garantisce una sola squadra attiva per turno per mese.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_monthly_rotation (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id         INTEGER NOT NULL REFERENCES teams(id),
  year            INTEGER NOT NULL,
  month           INTEGER NOT NULL,
  is_override     INTEGER NOT NULL DEFAULT 0
                  CHECK (is_override IN (0,1)),
  override_reason TEXT,
  assigned_by     INTEGER REFERENCES users(id),
  created_at      TEXT    DEFAULT (datetime('now')),
  UNIQUE(team_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_tmr_year_month ON team_monthly_rotation(year, month);
CREATE INDEX IF NOT EXISTS idx_tmr_team       ON team_monthly_rotation(team_id);

-- ──────────────────────────────────────────────────────────────
-- E. Flag capo-turno da nominare
--    Creato dal solver quando il capo-turno della squadra è
--    assente e nessun altro CAPO_TURNO è disponibile.
--    Il coordinatore lo risolve nominando un sostituto
--    (status → 'filled') o esonerando il vincolo ('waived').
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS capo_turno_pending (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id         INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  team_id             INTEGER NOT NULL REFERENCES teams(id),
  work_date           TEXT    NOT NULL,
  shift_type_id       INTEGER NOT NULL REFERENCES shift_types(id),
  absent_user_id      INTEGER NOT NULL REFERENCES users(id),
  substitute_user_id  INTEGER REFERENCES users(id),
  nominated_by        INTEGER REFERENCES users(id),
  status              TEXT    NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','filled','waived')),
  resolved_at         TEXT,
  notes               TEXT,
  created_at          TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ctp_schedule  ON capo_turno_pending(schedule_id);
CREATE INDEX IF NOT EXISTS idx_ctp_date      ON capo_turno_pending(work_date);
CREATE INDEX IF NOT EXISTS idx_ctp_status    ON capo_turno_pending(status);

-- ──────────────────────────────────────────────────────────────
-- F. View utili
-- ──────────────────────────────────────────────────────────────

-- Composizione attuale di ogni squadra (senza storico scaduto)
CREATE VIEW IF NOT EXISTS v_team_active_members AS
SELECT
  tm.id          AS membership_id,
  tm.team_id,
  t.name         AS team_name,
  t.shift_type_id,
  st.code        AS shift_code,
  st.name        AS shift_name,
  tm.user_id,
  u.first_name || ' ' || u.last_name AS nurse_name,
  u.clinical_role,
  tm.is_capo_turno,
  tm.valid_from,
  tm.valid_until
FROM team_members tm
JOIN teams      t  ON tm.team_id      = t.id
JOIN shift_types st ON t.shift_type_id = st.id
JOIN users       u  ON tm.user_id      = u.id
WHERE tm.valid_until IS NULL
   OR tm.valid_until >= date('now');

-- Rotazione attiva per mese corrente
CREATE VIEW IF NOT EXISTS v_team_current_month AS
SELECT
  tmr.team_id,
  t.name         AS team_name,
  t.shift_type_id,
  st.code        AS shift_code,
  tmr.year,
  tmr.month,
  tmr.is_override,
  u.first_name || ' ' || u.last_name AS assigned_by_name
FROM team_monthly_rotation tmr
JOIN teams       t  ON tmr.team_id       = t.id
JOIN shift_types st ON t.shift_type_id   = st.id
LEFT JOIN users  u  ON tmr.assigned_by   = u.id
WHERE tmr.year  = CAST(strftime('%Y', 'now') AS INTEGER)
  AND tmr.month = CAST(strftime('%m', 'now') AS INTEGER);
