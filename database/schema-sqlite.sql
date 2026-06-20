-- OPBGestionale - Schema database SQLite (prototipo)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shift_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    duration_hours INTEGER DEFAULT 8,
    required_staff INTEGER DEFAULT 2,
    color TEXT DEFAULT '#000000',
    is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS request_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    requires_approval INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS request_statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    request_type_id INTEGER NOT NULL REFERENCES request_types(id),
    status_id INTEGER NOT NULL REFERENCES request_statuses(id),
    start_date TEXT NOT NULL,
    end_date TEXT,
    shift_type_id INTEGER REFERENCES shift_types(id),
    notes TEXT,
    approved_by INTEGER REFERENCES users(id),
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_constraints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    shift_type_id INTEGER NOT NULL REFERENCES shift_types(id),
    constraint_type TEXT NOT NULL CHECK (constraint_type IN ('cannot', 'prefer_not', 'only')),
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(year, month)
);

CREATE TABLE IF NOT EXISTS schedule_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    work_date TEXT NOT NULL,
    shift_type_id INTEGER NOT NULL REFERENCES shift_types(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(schedule_id, user_id, work_date)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Dati iniziali
INSERT OR IGNORE INTO roles (name, description) VALUES
('admin', 'Amministratore di sistema'),
('coordinator', 'Coordinatore turni'),
('staff', 'Personale operativo');

INSERT OR IGNORE INTO request_statuses (code, name) VALUES
('pending', 'In attesa'),
('approved', 'Approvata'),
('rejected', 'Rifiutata'),
('cancelled', 'Annullata');

INSERT OR IGNORE INTO request_types (code, name, requires_approval) VALUES
('vacation', 'Ferie', 1),
('day_off', 'Riposo', 1),
('preference', 'Desiderata', 0),
('exemption', 'Esonerazione', 1),
('only_morning', 'Solo mattina', 0),
('no_nights', 'Non notti', 0);

INSERT OR IGNORE INTO shift_types (code, name, start_time, end_time, duration_hours, required_staff, color) VALUES
('M', 'Mattina', '07:00', '15:00', 8, 2, '#4CAF50'),
('P', 'Pomeriggio', '15:00', '23:00', 8, 2, '#FFC107'),
('N', 'Notte', '23:00', '07:00', 8, 1, '#3F51B5'),
('G12', 'Giorno 12h', '07:00', '19:00', 12, 2, '#009688'),
('N12', 'Notte 12h', '19:00', '07:00', 12, 1, '#673AB7'),
('R', 'Riposo', '00:00', '00:00', 0, 0, '#9E9E9E');
