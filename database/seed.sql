-- Dati di esempio per sviluppo e test

-- Utente coordinatore (password: 'password' - solo per sviluppo)
INSERT INTO users (username, email, password_hash, first_name, last_name, role_id)
VALUES (
    'coordinator',
    'coordinator@opbg.local',
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'Mario',
    'Rossi',
    (SELECT id FROM roles WHERE name = 'coordinator')
);

-- Utenti personale di esempio (password: 'password' - solo per sviluppo)
INSERT INTO users (username, email, password_hash, first_name, last_name, role_id) VALUES
('staff1', 'staff1@opbg.local', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Luca', 'Bianchi', (SELECT id FROM roles WHERE name = 'staff')),
('staff2', 'staff2@opbg.local', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Anna', 'Verdi', (SELECT id FROM roles WHERE name = 'staff')),
('staff3', 'staff3@opbg.local', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Giuseppe', 'Neri', (SELECT id FROM roles WHERE name = 'staff')),
('staff4', 'staff4@opbg.local', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Sara', 'Gialli', (SELECT id FROM roles WHERE name = 'staff'));

-- Vincoli di esempio
INSERT INTO user_constraints (user_id, shift_type_id, constraint_type) VALUES
((SELECT id FROM users WHERE username = 'staff1'), (SELECT id FROM shift_types WHERE code = 'N'), 'cannot'),
((SELECT id FROM users WHERE username = 'staff2'), (SELECT id FROM shift_types WHERE code = 'M'), 'only'),
((SELECT id FROM users WHERE username = 'staff3'), (SELECT id FROM shift_types WHERE code = 'N'), 'prefer_not');

-- Richiesta di esempio
INSERT INTO requests (user_id, request_type_id, status_id, start_date, end_date, notes)
VALUES (
    (SELECT id FROM users WHERE username = 'staff1'),
    (SELECT id FROM request_types WHERE code = 'vacation'),
    (SELECT id FROM request_statuses WHERE code = 'approved'),
    '2026-07-15',
    '2026-07-20',
    'Ferie estive'
);
