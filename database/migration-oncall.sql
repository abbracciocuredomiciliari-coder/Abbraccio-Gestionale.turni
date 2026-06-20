-- ══════════════════════════════════════════════════════════════
-- MIGRAZIONE: Reperibilità (ON-CALL)
-- Versione: 2026-06-20
--
-- La reperibilità è una disponibilità "a chiamata": l'infermiere
-- non è fisicamente in servizio, ma deve essere raggiungibile e
-- pronto a intervenire entro un tempo definito.
--
-- Differenze rispetto a un turno attivo:
--   - Non occupa il giorno come "lavorato" ai fini dei vincoli H2/H3
--   - Ha un peso equity ridotto (ONCALL_WEIGHT < NORMAL_WEIGHT)
--   - Può coesistere con un turno attivo nello stesso giorno
--     (es. mattina + reperibilità notturna)
--   - Se scatta l'attivazione (called_in=1), diventa equiparata a un
--     turno straordinario e peso pieno viene contabilizzato
--
-- Tabelle:
--   oncall_slots        → slot di reperibilità definiti dal coordinatore
--   oncall_assignments  → chi è assegnato a quale slot
-- ══════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;

-- ──────────────────────────────────────────────────────────────
-- 1. Slot di reperibilità (definizione degli "slot" mensili)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS oncall_slots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id     INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
    slot_date       TEXT    NOT NULL,           -- 'YYYY-MM-DD'
    start_time      TEXT    NOT NULL DEFAULT '19:00',
    end_time        TEXT    NOT NULL DEFAULT '07:00',
    duration_hours  REAL    NOT NULL DEFAULT 12,
    label           TEXT    DEFAULT 'Reperibilità notturna',
    -- Quanti infermieri servono in reperibilità per questo slot
    required_count  INTEGER NOT NULL DEFAULT 1,
    -- Skill minima richiesta per coprire questo slot (opzionale)
    required_skill  TEXT,
    -- Stato slot
    status          TEXT    NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','covered','partial','cancelled')),
    created_by      INTEGER REFERENCES users(id),
    created_at      TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ocs_date     ON oncall_slots(slot_date);
CREATE INDEX IF NOT EXISTS idx_ocs_schedule ON oncall_slots(schedule_id);

-- ──────────────────────────────────────────────────────────────
-- 2. Assegnazioni di reperibilità
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS oncall_assignments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id         INTEGER NOT NULL REFERENCES oncall_slots(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    slot_date       TEXT    NOT NULL,           -- denormalizzato per query veloci
    start_time      TEXT    NOT NULL,
    end_time        TEXT    NOT NULL,
    duration_hours  REAL    NOT NULL DEFAULT 12,
    -- Flag: il sistema ha chiamato l'infermiere (reperibilità scattata)
    called_in       INTEGER DEFAULT 0,
    called_in_at    TEXT,
    called_in_by    INTEGER REFERENCES users(id),
    -- Ore effettivamente lavorate se chiamato
    actual_hours    REAL    DEFAULT 0,
    -- Peso equità applicato (copiato da oncall_weight al momento dell'assegnazione)
    equity_weight   REAL    NOT NULL DEFAULT 0.3,
    notes           TEXT,
    assigned_by     INTEGER REFERENCES users(id),
    assigned_at     TEXT    DEFAULT (datetime('now')),
    UNIQUE(slot_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_oca_user_date ON oncall_assignments(user_id, slot_date);
CREATE INDEX IF NOT EXISTS idx_oca_slot      ON oncall_assignments(slot_id);

-- ──────────────────────────────────────────────────────────────
-- 3. Aggiunge oncall_weight alla tabella shift_weights (se esiste)
-- ──────────────────────────────────────────────────────────────
INSERT OR IGNORE INTO shift_weights (weight_key, weight_value, description)
VALUES ('oncall', 0.3, 'Peso equità reperibilità (0.3 = 30% di un turno normale)');

-- ──────────────────────────────────────────────────────────────
-- 4. View comoda per report equità reperibilità
-- ──────────────────────────────────────────────────────────────
CREATE VIEW IF NOT EXISTS v_oncall_summary AS
SELECT
    oca.user_id,
    u.first_name || ' ' || u.last_name AS nurse_name,
    strftime('%Y', oca.slot_date)  AS year,
    strftime('%m', oca.slot_date)  AS month,
    COUNT(*)                       AS oncall_count,
    SUM(oca.called_in)             AS activations,
    SUM(oca.duration_hours * oca.equity_weight) AS weighted_oncall_load,
    SUM(CASE WHEN oca.called_in = 1 THEN oca.actual_hours ELSE 0 END) AS activation_hours
FROM oncall_assignments oca
JOIN users u ON oca.user_id = u.id
GROUP BY oca.user_id, strftime('%Y-%m', oca.slot_date);
