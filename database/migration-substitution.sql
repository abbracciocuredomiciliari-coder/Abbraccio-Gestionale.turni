-- ══════════════════════════════════════════════════════════════
-- MIGRAZIONE: Dynamic Scheduling — Sostituzione di Emergenza
-- Versione: 2026-06-20
-- ══════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;

-- ──────────────────────────────────────────────────────────────
-- 1. Colonna is_overtime su schedule_assignments (se non esiste)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE schedule_assignments ADD COLUMN is_overtime INTEGER DEFAULT 0;

-- ──────────────────────────────────────────────────────────────
-- 2. Abilitazioni per reparto/categoria turno per infermiere
--    Un infermiere può essere abilitato a reparti multipli
--    o a categorie turno specifiche (es. terapia intensiva)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_qualifications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department      TEXT,                       -- es. 'ICU', 'DEA', 'Chirurgia'
    shift_category  TEXT,                       -- es. 'night', 'G12', 'N12'
    valid_from      TEXT,
    valid_until     TEXT,
    notes           TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, department, shift_category)
);

-- ──────────────────────────────────────────────────────────────
-- 3. Storico sostituzioni di emergenza
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emergency_substitutions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Turno lasciato vacante
    schedule_id         INTEGER REFERENCES schedules(id),
    work_date           TEXT    NOT NULL,
    shift_type_id       INTEGER NOT NULL REFERENCES shift_types(id),

    -- Chi si assenta
    absent_user_id      INTEGER NOT NULL REFERENCES users(id),
    absence_reason      TEXT    NOT NULL
                        CHECK (absence_reason IN (
                            'malattia_improvvisa',
                            'emergenza_familiare',
                            'infortunio',
                            'altro'
                        )),

    -- Chi copre
    substitute_user_id  INTEGER REFERENCES users(id),   -- NULL se non ancora assegnato
    substitution_type   TEXT    DEFAULT 'voluntary'
                        CHECK (substitution_type IN (
                            'voluntary',    -- disponibile volontariamente
                            'overtime',     -- straordinario
                            'recall',       -- richiamato dal riposo
                            'external'      -- risorsa esterna / agenzia
                        )),

    -- Stato del processo di sostituzione
    status              TEXT    DEFAULT 'open'
                        CHECK (status IN (
                            'open',         -- turno vacante, nessun sostituto ancora
                            'suggested',    -- candidati suggeriti, in attesa conferma
                            'filled',       -- turno coperto
                            'uncoverable'   -- turno non coperto (nessun disponibile)
                        )),

    -- Score equità al momento della sostituzione
    equity_score_before REAL,
    equity_score_after  REAL,

    notes               TEXT,
    created_by          INTEGER REFERENCES users(id),
    confirmed_by        INTEGER REFERENCES users(id),
    created_at          TEXT DEFAULT (datetime('now')),
    confirmed_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_emerg_sub_date
    ON emergency_substitutions(work_date, shift_type_id);

CREATE INDEX IF NOT EXISTS idx_emerg_sub_absent
    ON emergency_substitutions(absent_user_id);

-- ──────────────────────────────────────────────────────────────
-- 4. Aggiorna request_types con tipo assenza emergenza
-- ──────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO request_types (code, name, description, requires_approval) VALUES
('malattia_improvvisa', 'Malattia improvvisa', 'Assenza non programmata per malattia acuta', 0),
('emergenza',           'Emergenza personale', 'Assenza non programmata per emergenza',       0);
