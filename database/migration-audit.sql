-- ══════════════════════════════════════════════════════════════
-- MIGRAZIONE: Audit Trail Solver — spiegazione decisioni
-- Versione: 2026-06-20
--
-- Ogni assegnazione generata dal solver viene corredata da:
--   solver_assignment_log  → perché quella persona, quel turno, quel giorno
--   solver_run_log         → metadati dell'intera run (penalità, violations)
-- ══════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;

-- ──────────────────────────────────────────────────────────────
-- 1. Log di ogni singola run del solver
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solver_run_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id         INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    year                INTEGER NOT NULL,
    month               INTEGER NOT NULL,
    generated_by        INTEGER REFERENCES users(id),
    generated_at        TEXT    DEFAULT (datetime('now')),
    assignments_count   INTEGER DEFAULT 0,
    final_penalty       REAL    DEFAULT 0,
    violations_count    INTEGER DEFAULT 0,
    violations_json     TEXT,   -- JSON array delle violations
    is_feasible         INTEGER DEFAULT 1,
    has_skill_warnings  INTEGER DEFAULT 0,
    solver_version      TEXT    DEFAULT '1.0',
    notes               TEXT
);

-- ──────────────────────────────────────────────────────────────
-- 2. Spiegazione per ogni singola assegnazione
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solver_assignment_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id              INTEGER NOT NULL REFERENCES solver_run_log(id) ON DELETE CASCADE,
    schedule_id         INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    assignment_id       INTEGER REFERENCES schedule_assignments(id) ON DELETE SET NULL,
    user_id             INTEGER NOT NULL REFERENCES users(id),
    work_date           TEXT    NOT NULL,
    shift_type_id       INTEGER NOT NULL REFERENCES shift_types(id),
    shift_code          TEXT    NOT NULL,

    -- Rank del candidato al momento della selezione (1 = primo scelto)
    candidate_rank      INTEGER,
    -- Score composito calcolato dal solver (più basso = priorità maggiore)
    equity_score        REAL,
    -- Punteggio storico (ore ponderate nei mesi precedenti)
    historical_score    REAL,
    -- Turni totali nel mese fino a quel momento
    shifts_month_so_far INTEGER,
    -- Notti totali nel mese fino a quel momento
    nights_month_so_far INTEGER,
    -- Giorni consecutivi lavorati prima di questa assegnazione
    consecutive_days    INTEGER,
    -- Flag: il turno era notturno?
    is_night            INTEGER DEFAULT 0,
    -- Flag: weekend?
    is_weekend          INTEGER DEFAULT 0,
    -- Flag: turno straordinario (doppio)?
    is_overtime         INTEGER DEFAULT 0,
    -- Flag: preferenza ignorata (prefer_not/ferie pending)?
    preference_violated INTEGER DEFAULT 0,
    -- Motivo testuale della preferenza ignorata (se applicabile)
    preference_reason   TEXT,
    -- Skill che ha determinato la selezione (se skill-mix attivo)
    qualifying_skill    TEXT,
    -- Vincolo principale che ha motivato l'assegnazione
    -- Valori: 'EQUITY','SKILL_REQUIRED','COVERAGE_ONLY','OVERTIME','PREFERENCE_IGNORED'
    primary_reason      TEXT    NOT NULL DEFAULT 'EQUITY',
    -- Spiegazione in linguaggio naturale leggibile dall'infermiere
    explanation         TEXT    NOT NULL,
    -- Posizione nella coda candidati (totale candidati disponibili quel giorno)
    pool_size           INTEGER,

    created_at          TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sal_user_date     ON solver_assignment_log(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_sal_schedule      ON solver_assignment_log(schedule_id);
CREATE INDEX IF NOT EXISTS idx_sal_run           ON solver_assignment_log(run_id);
