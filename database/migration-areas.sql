-- ============================================================
-- migration-areas.sql
-- Aggiunge il livello Area (area_manager) sopra i reparti:
--   - roles               → area_manager
--   - areas               (aree organizzative)
--   - departments         → area_id
--   - v_area_uncovered_shifts (vista scoperture aggregate)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Ruolo area_manager in roles (se non esiste)
-- ------------------------------------------------------------
INSERT OR IGNORE INTO roles (name, description)
VALUES ('area_manager', 'Responsabile di area — supervisiona più reparti e coordinatori');

-- ------------------------------------------------------------
-- 2. Tabella aree
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS areas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  code            TEXT    NOT NULL UNIQUE,
  area_manager_id INTEGER NOT NULL REFERENCES users(id),
  notes           TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_areas_manager
  ON areas(area_manager_id);

-- ------------------------------------------------------------
-- 3. departments → area_id
-- ------------------------------------------------------------
ALTER TABLE departments ADD COLUMN area_id INTEGER REFERENCES areas(id);

CREATE INDEX IF NOT EXISTS idx_departments_area
  ON departments(area_id);

-- ------------------------------------------------------------
-- 4. Vista: scoperture aggregate per area (anno/mese)
--    Restituisce turni con UNDERCOVERAGE aggregati per reparto
--    Usata dal gap-filler dell'area manager
-- ------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_area_uncovered_shifts AS
SELECT
  ar.id           AS area_id,
  ar.name         AS area_name,
  d.id            AS department_id,
  d.name          AS department_name,
  sc.id           AS schedule_id,
  sc.year,
  sc.month,
  sv.day,
  sv.shift_type_id,
  st.code         AS shift_code,
  st.name         AS shift_name,
  sv.needed,
  sv.assigned,
  (sv.needed - sv.assigned) AS gap
FROM areas ar
JOIN departments d   ON d.area_id    = ar.id
JOIN schedules sc    ON sc.department_id = d.id
JOIN solver_violations sv ON sv.schedule_id = sc.id AND sv.type = 'UNDERCOVERAGE'
JOIN shift_types st  ON sv.shift_type_id = st.id
WHERE sc.status IN ('draft', 'published')
  AND d.is_active = 1
  AND ar.is_active = 1;
