-- ============================================================
-- migration-departments.sql
-- Aggiunge il concetto di REPARTO multi-coordinatore con:
--   - departments            (reparti)
--   - department_shift_config (fabbisogno per reparto × turno)
--   - department_cross_coverage (copertura straordinaria mensile)
--   - cross_dept_equity_log  (tracking equità cross-reparto)
--   - ALTER TABLE users       → department_id
--   - ALTER TABLE teams       → department_id
--   - ALTER TABLE schedules   → department_id
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabella reparti
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  code           TEXT    NOT NULL UNIQUE,
  coordinator_id INTEGER NOT NULL REFERENCES users(id),
  is_active      INTEGER NOT NULL DEFAULT 1,
  notes          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_departments_coordinator
  ON departments(coordinator_id);

-- ------------------------------------------------------------
-- 2. Fabbisogno per reparto × tipo turno
--    Sovrascrive shift_types.required_staff / assignment_mode / min_capo_turno
--    per quel reparto specifico
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS department_shift_config (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id   INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  shift_type_id   INTEGER NOT NULL REFERENCES shift_types(id) ON DELETE CASCADE,
  required_staff  INTEGER NOT NULL DEFAULT 1,
  assignment_mode TEXT    NOT NULL DEFAULT 'FREE'
                  CHECK(assignment_mode IN ('FREE','TEAM','MIXED')),
  min_capo_turno  INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  notes           TEXT,
  UNIQUE(department_id, shift_type_id)
);

CREATE INDEX IF NOT EXISTS idx_dept_shift_config_dept
  ON department_shift_config(department_id);
CREATE INDEX IF NOT EXISTS idx_dept_shift_config_shift
  ON department_shift_config(shift_type_id);

-- ------------------------------------------------------------
-- 3. Reparto principale su users (ALTER TABLE sicuro)
-- ------------------------------------------------------------
ALTER TABLE users ADD COLUMN department_id INTEGER REFERENCES departments(id);

-- ------------------------------------------------------------
-- 4. Copertura straordinaria mensile (infermiere → altro reparto)
--    L'infermiere lavora in to_dept_id per year/month
--    ma rimane nel proprio reparto from_dept_id per i mesi successivi
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS department_cross_coverage (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_dept_id INTEGER NOT NULL REFERENCES departments(id),
  to_dept_id   INTEGER NOT NULL REFERENCES departments(id),
  year         INTEGER NOT NULL,
  month        INTEGER NOT NULL,
  reason       TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, to_dept_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_cross_coverage_user
  ON department_cross_coverage(user_id);
CREATE INDEX IF NOT EXISTS idx_cross_coverage_to_dept
  ON department_cross_coverage(to_dept_id, year, month);

-- ------------------------------------------------------------
-- 5. Log equità cross-reparto
--    Registra i turni fatti in reparti non di appartenenza
--    per calcolare il punteggio equità globale del mese
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cross_dept_equity_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  schedule_id   INTEGER REFERENCES schedules(id) ON DELETE CASCADE,
  work_date     TEXT    NOT NULL,
  shift_type_id INTEGER REFERENCES shift_types(id),
  is_weekend    INTEGER NOT NULL DEFAULT 0,
  weight        REAL    NOT NULL DEFAULT 1.0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cross_equity_user
  ON cross_dept_equity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_cross_equity_dept
  ON cross_dept_equity_log(department_id, work_date);

-- ------------------------------------------------------------
-- 6. Aggiunge department_id su teams
-- ------------------------------------------------------------
ALTER TABLE teams ADD COLUMN department_id INTEGER REFERENCES departments(id);

CREATE INDEX IF NOT EXISTS idx_teams_department
  ON teams(department_id);

-- ------------------------------------------------------------
-- 7. Aggiunge department_id su schedules
-- ------------------------------------------------------------
ALTER TABLE schedules ADD COLUMN department_id INTEGER REFERENCES departments(id);

CREATE INDEX IF NOT EXISTS idx_schedules_department
  ON schedules(department_id);

-- ------------------------------------------------------------
-- 8. Vista: staff attivo per reparto con copertura cross
--    Mostra per ogni reparto chi lavora in quel mese
--    (staff proprio + cross_coverage)
-- ------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_dept_monthly_staff AS
SELECT
  d.id            AS department_id,
  d.name          AS department_name,
  d.coordinator_id,
  u.id            AS user_id,
  u.first_name,
  u.last_name,
  COALESCE(u.clinical_role, 'STAFF') AS clinical_role,
  u.department_id AS home_dept_id,
  CASE WHEN u.department_id = d.id THEN 0 ELSE 1 END AS is_cross_coverage,
  NULL            AS year,
  NULL            AS month
FROM departments d
JOIN users u ON u.department_id = d.id AND u.is_active = 1
UNION ALL
SELECT
  cc.to_dept_id   AS department_id,
  d.name          AS department_name,
  d.coordinator_id,
  u.id            AS user_id,
  u.first_name,
  u.last_name,
  COALESCE(u.clinical_role, 'STAFF') AS clinical_role,
  u.department_id AS home_dept_id,
  1               AS is_cross_coverage,
  cc.year,
  cc.month
FROM department_cross_coverage cc
JOIN departments d ON cc.to_dept_id = d.id
JOIN users u ON cc.user_id = u.id AND u.is_active = 1;

-- ------------------------------------------------------------
-- 9. Vista: fabbisogno effettivo per reparto × turno
--    Usa department_shift_config se esiste, altrimenti
--    fallback su shift_types globale
-- ------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_dept_shift_requirements AS
SELECT
  d.id                                          AS department_id,
  d.name                                        AS department_name,
  d.coordinator_id,
  st.id                                         AS shift_type_id,
  st.code                                       AS shift_code,
  st.name                                       AS shift_name,
  st.duration_hours,
  COALESCE(dsc.required_staff,  st.required_staff)                   AS required_staff,
  COALESCE(dsc.assignment_mode, 'FREE')                              AS assignment_mode,
  COALESCE(dsc.min_capo_turno,  0)                                   AS min_capo_turno,
  COALESCE(dsc.is_active, 1)                                         AS config_active,
  CASE WHEN dsc.id IS NOT NULL THEN 1 ELSE 0 END                     AS has_custom_config
FROM departments d
CROSS JOIN shift_types st
LEFT JOIN department_shift_config dsc
  ON dsc.department_id = d.id AND dsc.shift_type_id = st.id
WHERE d.is_active = 1 AND st.is_active = 1 AND st.code != 'R';
