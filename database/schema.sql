-- OPBGestionale - Schema database
-- Database: PostgreSQL

-- Estensioni
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Ruoli utente
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT
);

-- Utenti (personale e coordinatori)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tipi di turno
CREATE TABLE shift_types (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    color VARCHAR(7) DEFAULT '#000000',
    is_active BOOLEAN DEFAULT TRUE
);

-- Tipi di richiesta (ferie, desiderata, esenzione, ecc.)
CREATE TABLE request_types (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    requires_approval BOOLEAN DEFAULT TRUE
);

-- Stati richiesta
CREATE TABLE request_statuses (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL
);

-- Richieste del personale
CREATE TABLE requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    request_type_id INTEGER NOT NULL REFERENCES request_types(id),
    status_id INTEGER NOT NULL REFERENCES request_statuses(id),
    start_date DATE NOT NULL,
    end_date DATE,
    shift_type_id INTEGER REFERENCES shift_types(id),
    notes TEXT,
    approved_by INTEGER REFERENCES users(id),
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Vincoli/limitazioni del personale (non esonazioni temporanee)
CREATE TABLE user_constraints (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    shift_type_id INTEGER NOT NULL REFERENCES shift_types(id),
    constraint_type VARCHAR(20) NOT NULL CHECK (constraint_type IN ('cannot', 'prefer_not', 'only')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Planning turni mensili
CREATE TABLE schedules (
    id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(year, month)
);

-- Assegnazioni turni giornaliere
CREATE TABLE schedule_assignments (
    id SERIAL PRIMARY KEY,
    schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    work_date DATE NOT NULL,
    shift_type_id INTEGER NOT NULL REFERENCES shift_types(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(schedule_id, user_id, work_date)
);

-- Audit log approvazioni e modifiche
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INTEGER NOT NULL,
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Dati iniziali
INSERT INTO roles (name, description) VALUES
('admin', 'Amministratore di sistema'),
('coordinator', 'Coordinatore turni'),
('staff', 'Personale operativo');

INSERT INTO request_statuses (code, name) VALUES
('pending', 'In attesa'),
('approved', 'Approvata'),
('rejected', 'Rifiutata'),
('cancelled', 'Annullata');

INSERT INTO request_types (code, name, requires_approval) VALUES
('vacation', 'Ferie', true),
('day_off', 'Riposo', true),
('preference', 'Desiderata', false),
('exemption', 'Esonerazione', true),
('only_morning', 'Solo mattina', false),
('no_nights', 'Non notti', false);

INSERT INTO shift_types (code, name, start_time, end_time, color) VALUES
('M', 'Mattina', '07:00', '15:00', '#4CAF50'),
('P', 'Pomeriggio', '15:00', '23:00', '#FFC107'),
('N', 'Notte', '23:00', '07:00', '#3F51B5'),
('R', 'Riposo', '00:00', '00:00', '#9E9E9E');
