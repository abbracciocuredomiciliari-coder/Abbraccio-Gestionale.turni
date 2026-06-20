-- ══════════════════════════════════════════════════════════════
-- MIGRAZIONE: Skill-Mix Constraints — Privilegi Clinici
-- Versione: 2026-06-20
-- ══════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;

-- ──────────────────────────────────────────────────────────────
-- 1. Catalogo skill / privilegi clinici
--    Es: ICU_SENIOR, PEDIATRIA_CERTIFICATA, TRIAGE_DEA, BLS_AVANZATO
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clinical_skills (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            TEXT    NOT NULL UNIQUE,  -- es. 'ICU_SENIOR'
    name            TEXT    NOT NULL,          -- es. 'Infermiere senior Terapia Intensiva'
    department      TEXT,                      -- es. 'ICU', 'DEA', 'Pediatria'
    category        TEXT    NOT NULL           -- 'certification' | 'seniority' | 'role' | 'qualification'
                    CHECK (category IN ('certification','seniority','role','qualification')),
    description     TEXT,
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT    DEFAULT (datetime('now'))
);

-- ──────────────────────────────────────────────────────────────
-- 2. Privilegi clinici per infermiere
--    Ogni infermiere può avere più skill con data validità
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nurse_clinical_privileges (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_id        INTEGER NOT NULL REFERENCES clinical_skills(id) ON DELETE CASCADE,
    granted_by      INTEGER REFERENCES users(id),
    granted_at      TEXT    DEFAULT (datetime('now')),
    valid_from      TEXT    NOT NULL DEFAULT (date('now')),
    valid_until     TEXT,                       -- NULL = nessuna scadenza
    certificate_ref TEXT,                       -- numero certificato / protocollo
    notes           TEXT,
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT    DEFAULT (datetime('now')),
    UNIQUE(user_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_ncp_user   ON nurse_clinical_privileges(user_id);
CREATE INDEX IF NOT EXISTS idx_ncp_skill  ON nurse_clinical_privileges(skill_id);

-- ──────────────────────────────────────────────────────────────
-- 3. Requisiti skill-mix per turno
--    Ogni turno (shift_type) in un certo reparto ha requisiti minimi:
--    Es: turno N di ICU richiede ALMENO 1 infermiere con skill ICU_SENIOR
--        turno M di DEA richiede ALMENO 1 con TRIAGE_DEA e 2 con BLS_BASE
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shift_skill_requirements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_type_id   INTEGER NOT NULL REFERENCES shift_types(id) ON DELETE CASCADE,
    skill_id        INTEGER NOT NULL REFERENCES clinical_skills(id) ON DELETE CASCADE,
    department      TEXT,                       -- NULL = qualsiasi reparto
    min_count       INTEGER NOT NULL DEFAULT 1, -- minimo infermieri con questa skill per turno
    max_count       INTEGER,                    -- NULL = nessun massimo
    is_mandatory    INTEGER DEFAULT 1,          -- 0 = preferibile ma non hard
    notes           TEXT,
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT    DEFAULT (datetime('now')),
    UNIQUE(shift_type_id, skill_id, department)
);

CREATE INDEX IF NOT EXISTS idx_ssr_shift ON shift_skill_requirements(shift_type_id);

-- ──────────────────────────────────────────────────────────────
-- 4. Audit log skill violations (per report coordinatore)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_mix_violations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id     INTEGER REFERENCES schedules(id),
    work_date       TEXT    NOT NULL,
    shift_type_id   INTEGER NOT NULL REFERENCES shift_types(id),
    skill_id        INTEGER NOT NULL REFERENCES clinical_skills(id),
    required_count  INTEGER NOT NULL,
    actual_count    INTEGER NOT NULL,
    resolved        INTEGER DEFAULT 0,
    notes           TEXT,
    created_at      TEXT    DEFAULT (datetime('now'))
);

-- ──────────────────────────────────────────────────────────────
-- 5. Dati seed: skill cliniche comuni ospedaliere
-- ──────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO clinical_skills (code, name, department, category, description) VALUES
('ICU_SENIOR',       'Infermiere Senior Terapia Intensiva',   'ICU',       'seniority',     'Almeno 2 anni di esperienza in TI + formazione specifica'),
('ICU_BASE',         'Infermiere Base Terapia Intensiva',     'ICU',       'qualification', 'Formazione di base per TI'),
('TRIAGE_DEA',       'Triage Pronto Soccorso',                'DEA',       'certification', 'Certificazione triage PS (codice colore)'),
('DEA_SENIOR',       'Infermiere Senior DEA/PS',              'DEA',       'seniority',     'Esperienza minima 18 mesi in PS'),
('PEDIATRIA_CERT',   'Assistenza Pediatrica Certificata',     'Pediatria', 'certification', 'Corso ECM assistenza neonatologica e pediatrica'),
('BLS_AED',          'BLS-D con uso defibrillatore',          NULL,        'certification', 'Certificazione BLS-D in corso di validità'),
('ACLS',             'Advanced Cardiac Life Support',         NULL,        'certification', 'Certificazione ACLS American Heart Association'),
('BLSD_ISTRUTTORE',  'Istruttore BLS-D',                      NULL,        'role',          'Abilitazione all'insegnamento BLS-D'),
('WOUND_CARE',       'Wound Care Avanzato',                   NULL,        'certification', 'Certificazione medicazioni avanzate e piaghe'),
('ONCO_CERT',        'Infermieristica Oncologica',            'Oncologia', 'certification', 'Corso ECM oncologia clinica'),
('CHEMIO_CERT',      'Gestione Chemioterapia',                'Oncologia', 'certification', 'Abilitazione somministrazione farmaci citostatici'),
('COORD_TURNO',      'Coordinatore di Turno',                 NULL,        'role',          'Infermiere con funzione di coordinamento del turno');

-- ──────────────────────────────────────────────────────────────
-- 6. Seed requisiti turno (esempio ICU e DEA)
--    Turni N e G12 richiedono almeno 1 ICU_SENIOR
--    Turni M richiedono almeno 1 COORD_TURNO e BLS_AED
-- ──────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO shift_skill_requirements
    (shift_type_id, skill_id, department, min_count, is_mandatory, notes)
SELECT st.id, sk.id, 'ICU', 1, 1, 'Turno notte ICU: obbligatorio almeno 1 senior TI'
FROM shift_types st, clinical_skills sk
WHERE st.code IN ('N','N12') AND sk.code = 'ICU_SENIOR';

INSERT OR IGNORE INTO shift_skill_requirements
    (shift_type_id, skill_id, department, min_count, is_mandatory, notes)
SELECT st.id, sk.id, 'DEA', 1, 1, 'Ogni turno DEA: obbligatorio almeno 1 triage certificato'
FROM shift_types st, clinical_skills sk
WHERE st.code IN ('M','P','N') AND sk.code = 'TRIAGE_DEA';

INSERT OR IGNORE INTO shift_skill_requirements
    (shift_type_id, skill_id, department, min_count, is_mandatory, notes)
SELECT st.id, sk.id, NULL, 1, 1, 'Ogni turno: obbligatorio almeno 1 BLS-D certificato'
FROM shift_types st, clinical_skills sk
WHERE st.code NOT IN ('R') AND sk.code = 'BLS_AED';
