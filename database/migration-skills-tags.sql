-- ══════════════════════════════════════════════════════════════
-- MIGRAZIONE: Skill-tag su users e required_skills su shift_types
-- Versione: 2026-06-20
--
-- Approccio "tag semplice": JSON array di stringhe
--   users.skills           = '["ICU","Pediatria","BLS-D"]'
--   shift_types.required_skills = '["ICU"]'    ← minimo 1 infermiere
--   shift_types.min_skilled_staff = 1          ← quota obbligatoria
-- ══════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;

-- ──────────────────────────────────────────────────────────────
-- 1. Aggiunge campo skills alla tabella users
--    Valore: array JSON di tag es. '["ICU","BLS-D","Pediatria"]'
--    NULL = nessun privilegio speciale (infermiere generico)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN skills TEXT DEFAULT NULL;

-- ──────────────────────────────────────────────────────────────
-- 2. Aggiunge campi di competenza alla tabella shift_types
--    required_skills   : array JSON tag richiesti (almeno 1 per turno)
--    min_skilled_staff : quanti infermieri qualificati ci vogliono
--                        (default 1, NULL = nessun requisito)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE shift_types ADD COLUMN required_skills   TEXT    DEFAULT NULL;
ALTER TABLE shift_types ADD COLUMN min_skilled_staff INTEGER DEFAULT 1;

-- ──────────────────────────────────────────────────────────────
-- 3. Catalogo tag disponibili (per UI picker e validazione)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_tags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,  -- es. 'ICU'
    label       TEXT NOT NULL,          -- es. 'Terapia Intensiva'
    department  TEXT,                   -- reparto di riferimento (opzionale)
    color       TEXT DEFAULT '#607D8B', -- colore badge UI
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now'))
);

-- ──────────────────────────────────────────────────────────────
-- 4. Seed tag clinici
-- ──────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO skill_tags (code, label, department, color) VALUES
('ICU',           'Terapia Intensiva',           'ICU',       '#F44336'),
('NEONATOLOGIA',  'Neonatologia',                'Neonatologia','#E91E63'),
('PEDIATRIA',     'Pediatria',                   'Pediatria', '#9C27B0'),
('DEA_TRIAGE',    'Triage Pronto Soccorso',      'DEA',       '#FF5722'),
('DEA',           'Pronto Soccorso',             'DEA',       '#FF9800'),
('ONCOLOGIA',     'Oncologia',                   'Oncologia', '#3F51B5'),
('CHEMIO',        'Chemioterapia',               'Oncologia', '#2196F3'),
('CARDIOLOGIA',   'Cardiologia',                 'Cardiologia','#00BCD4'),
('DIALISI',       'Dialisi / Nefrologia',        'Dialisi',   '#009688'),
('SALA_OPERATORIA','Sala Operatoria',            'CBO',       '#4CAF50'),
('ENDOSCOPIA',    'Endoscopia',                  'Endoscopia','#8BC34A'),
('BLS_D',         'BLS-D Defibrillatore',        NULL,        '#FFC107'),
('ACLS',          'ACLS Supporto Avanzato',      NULL,        '#FF5722'),
('WOUND_CARE',    'Wound Care Avanzato',         NULL,        '#795548'),
('COORD_TURNO',   'Coordinatore di Turno',       NULL,        '#607D8B');
