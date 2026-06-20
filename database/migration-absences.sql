-- ══════════════════════════════════════════════════════════════
-- MIGRAZIONE: Gestione avanzata assenze hard-constraint
-- Versione: 2026-06-20
-- ══════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;

-- ──────────────────────────────────────────────────────────────
-- 1. FLAG ESONERO NOTTURNO sul profilo utente
--    night_exemption = 1 → il solver non assegnerà MAI:
--      - turni notturni (is_night = true)
--      - turni doppi / straordinari
--      - turni pomeriggio (a seconda di exemption_scope)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN night_exemption INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN night_exemption_reason TEXT;         -- es. "Legge 104 art.33", "Maternità"
ALTER TABLE users ADD COLUMN night_exemption_from  TEXT;          -- data inizio esonero
ALTER TABLE users ADD COLUMN night_exemption_until TEXT;          -- data fine esonero (NULL = permanente)
ALTER TABLE users ADD COLUMN exemption_scope TEXT DEFAULT 'night'
  CHECK (exemption_scope IN ('night', 'night_afternoon', 'night_overtime', 'all_festive'));
-- scope valori:
--   night             → solo notti bloccate
--   night_afternoon   → notti + pomeriggi bloccati
--   night_overtime    → notti + straordinari bloccati (default L.104)
--   all_festive       → notti + weekend + festivi (maternità/congedo parentale)

-- ──────────────────────────────────────────────────────────────
-- 2. TABELLA ASSENZE (sostituisce/estende la logica in requests)
--    Gestisce le 4 categorie di assenza come vincoli hard
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS absences (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    absence_type    TEXT    NOT NULL
                    CHECK (absence_type IN (
                        'ferie',            -- ferie programmate (blocca tutto il giorno)
                        'permesso_104',     -- Legge 104: giornata intera o ore
                        'maternita',        -- congedo maternità/paternità
                        'congedo_straordinario', -- eventi puntuali/ricorrenti
                        'malattia',         -- assenza per malattia
                        'sciopero',         -- sciopero
                        'formazione'        -- corso/formazione (blocca il giorno)
                    )),

    -- Date
    start_date      TEXT    NOT NULL,       -- 'YYYY-MM-DD'
    end_date        TEXT    NOT NULL,       -- 'YYYY-MM-DD' (= start_date per assenze 1gg)

    -- Gestione ORARIA (per permesso 104 a ore, uscita anticipata, ingresso posticipato)
    is_partial_day  INTEGER DEFAULT 0,      -- 0=giornata intera, 1=ore parziali
    partial_hours   REAL,                   -- ore di assenza (es. 2.0 per 2h permesso 104)
    partial_start   TEXT,                   -- orario inizio assenza parziale 'HH:MM' (NULL se da inizio turno)
    partial_end     TEXT,                   -- orario fine assenza parziale 'HH:MM' (NULL se a fine turno)
    partial_type    TEXT
                    CHECK (partial_type IN (
                        'full',             -- giornata intera
                        'morning_exit',     -- uscita anticipata dal mattino
                        'afternoon_late',   -- ingresso posticipato al pomeriggio
                        'hours_only'        -- solo X ore (non legate a inizio/fine turno)
                    )),

    -- Ricorrenza (per congedi ricorrenti, es. permesso 104 ogni lunedì)
    is_recurring    INTEGER DEFAULT 0,
    recurrence_rule TEXT,                   -- 'WEEKLY:MON', 'MONTHLY:1', ecc.
    recurrence_end  TEXT,                   -- data fine ricorrenza

    -- Metadati
    notes           TEXT,
    approved_by     INTEGER REFERENCES users(id),
    approved_at     TEXT,
    status          TEXT    DEFAULT 'approved'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    created_at      TEXT    DEFAULT (datetime('now')),
    updated_at      TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_absences_user_date
    ON absences(user_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_absences_date_range
    ON absences(start_date, end_date);

-- ──────────────────────────────────────────────────────────────
-- 3. Aggiunge nuovi codici a request_types (retrocompatibilità)
-- ──────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO request_types (code, name, description, requires_approval) VALUES
('permesso_104',           'Permesso Legge 104',        'Permesso assistenza disabili art. 3 c.3 L.104/92', 1),
('maternita',              'Maternità / Congedo par.',  'Congedo obbligatorio o facoltativo',                1),
('congedo_straordinario',  'Congedo straordinario',     'Congedo per gravi motivi familiari',                1),
('malattia',               'Malattia',                  'Assenza per malattia certificata',                  0),
('formazione',             'Formazione / ECM',          'Corso di aggiornamento obbligatorio',               1);

-- ──────────────────────────────────────────────────────────────
-- 4. Vista di comodo per il solver: assenze attive per mese
-- ──────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS v_absences_for_solver;
CREATE VIEW v_absences_for_solver AS
SELECT
    a.id,
    a.user_id,
    u.first_name || ' ' || u.last_name AS nurse_name,
    a.absence_type,
    a.start_date,
    a.end_date,
    a.is_partial_day,
    a.partial_hours,
    a.partial_start,
    a.partial_end,
    a.partial_type,
    a.is_recurring,
    a.recurrence_rule,
    a.recurrence_end,
    a.status,
    u.night_exemption,
    u.exemption_scope,
    u.night_exemption_from,
    u.night_exemption_until
FROM absences a
JOIN users u ON a.user_id = u.id
WHERE a.status = 'approved';
