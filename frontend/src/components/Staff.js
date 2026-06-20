import React, { useEffect, useState } from 'react';
import { getUsers, getRoles, getDepartments, createUser } from '../services/api';

function Staff() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    username: '', email: '', password: '', first_name: '', last_name: '',
    role_name: '', department_id: '', clinical_role: 'STAFF'
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [u, r, d] = await Promise.all([getUsers(), getRoles(), getDepartments()]);
      setUsers(u.data || []);
      setRoles(r.data || []);
      setDepartments(d.data || []);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Errore caricamento');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await createUser({
        ...form,
        department_id: form.department_id ? Number(form.department_id) : undefined
      });
      setSuccess('Utente creato con successo.');
      setForm({
        username: '', email: '', password: '', first_name: '', last_name: '',
        role_name: '', department_id: '', clinical_role: 'STAFF'
      });
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Errore creazione utente');
    }
  };

  const filteredUsers = users.filter(u =>
    filter === '' || u.role === filter ||
    `${u.first_name} ${u.last_name}`.toLowerCase().includes(filter.toLowerCase()) ||
    u.username.toLowerCase().includes(filter.toLowerCase())
  );

  if (loading) return <div>Caricamento...</div>;

  return (
    <div>
      <h2>Gestione utenti</h2>
      {error && <div className="error" style={{ marginBottom: 10 }}>{error}</div>}
      {success && <div className="success" style={{ marginBottom: 10, background: '#e8f5e9', padding: 10 }}>{success}</div>}

      <div style={{ marginBottom: 15 }}>
        <button onClick={() => setShowForm(!showForm)} className="primary">
          {showForm ? 'Annulla' : '+ Nuovo utente'}
        </button>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ marginLeft: 15, padding: 6 }}
        >
          <option value="">Tutti i ruoli</option>
          {roles.map(r => (
            <option key={r.name} value={r.name}>{r.name}</option>
          ))}
        </select>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card" style={{ marginBottom: 20 }}>
          <h4>Nuovo utente</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <input placeholder="Nome" value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} required />
            <input placeholder="Cognome" value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} required />
            <input placeholder="Username" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} required />
            <input placeholder="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
            <input placeholder="Password" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />
            <select value={form.role_name} onChange={e => setForm({ ...form, role_name: e.target.value })} required>
              <option value="">Ruolo...</option>
              {roles.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
            <select value={form.department_id} onChange={e => setForm({ ...form, department_id: e.target.value })}>
              <option value="">Reparto...</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={form.clinical_role} onChange={e => setForm({ ...form, clinical_role: e.target.value })}>
              <option value="STAFF">STAFF</option>
              <option value="CAPO_TURNO">CAPO_TURNO</option>
              <option value="RESPONSABILE">RESPONSABILE</option>
            </select>
          </div>
          <button type="submit" className="primary" style={{ marginTop: 10 }}>Crea utente</button>
        </form>
      )}

      <div className="card">
        <h3>Utenti</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#eee' }}>
              <th style={{ padding: '8px', textAlign: 'left' }}>Nome</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Cognome</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Username</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Email</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Ruolo</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Reparto</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Ruolo clinico</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Attivo</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((u) => (
              <tr key={u.id} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '8px' }}>{u.first_name}</td>
                <td style={{ padding: '8px' }}>{u.last_name}</td>
                <td style={{ padding: '8px' }}>{u.username}</td>
                <td style={{ padding: '8px' }}>{u.email}</td>
                <td style={{ padding: '8px' }}>{u.role}</td>
                <td style={{ padding: '8px' }}>{u.department_name || '-'}</td>
                <td style={{ padding: '8px' }}>{u.clinical_role || '-'}</td>
                <td style={{ padding: '8px' }}>{u.is_active ? 'Sì' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Staff;
