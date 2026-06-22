import React, { useEffect, useState } from 'react';
import { getUsers, getRoles, getDepartments, getAreas, createArea, createDepartment, createUser, updateUser, deleteUser, generateLogin } from '../services/api';

const CAN_CREATE = {
  admin:        ['admin', 'area_manager', 'coordinator', 'staff'],
  area_manager: ['coordinator'],
  coordinator:  ['staff'],
};

function Staff({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deptMode, setDeptMode] = useState('select'); // 'select' | 'new'
  const [newDeptName, setNewDeptName] = useState('');
  const [areaMode, setAreaMode] = useState('select'); // 'select' | 'new'
  const [newAreaName, setNewAreaName] = useState('');
  const [loginModal, setLoginModal] = useState(null); // utente target
  const [loginForm, setLoginForm] = useState({ username: '', password: '', confirm: '' });
  const [loginError, setLoginError] = useState('');
  const [loginSuccess, setLoginSuccess] = useState('');
  const [editModal, setEditModal] = useState(null); // utente in modifica
  const [editForm, setEditForm] = useState({});
  const [editError, setEditError] = useState('');
  const [form, setForm] = useState({
    username: '', email: '', password: '', first_name: '', last_name: '',
    role_name: '', department_id: '', area_id: '', clinical_role: 'INFERMIERE'
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [u, r, d, a] = await Promise.all([getUsers(), getRoles(), getDepartments(), getAreas()]);
      setUsers(u.data || []);
      setRoles(r.data || []);
      setDepartments(d.data || []);
      setAreas(a.data || []);
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
      // Se l'utente vuole creare una nuova area, la crea prima
      let resolvedAreaId = form.area_id ? Number(form.area_id) : undefined;
      if (areaMode === 'new' && newAreaName.trim()) {
        const areaRes = await createArea({ name: newAreaName.trim() });
        resolvedAreaId = areaRes.data.id;
      }

      let deptId = form.department_id ? Number(form.department_id) : undefined;
      // Se l'utente ha scelto di creare un nuovo reparto
      if (deptMode === 'new' && newDeptName.trim()) {
        const deptRes = await createDepartment({
          name: newDeptName.trim(),
          area_id: resolvedAreaId
        });
        deptId = deptRes.data.id;
      }
      await createUser({
        ...form,
        role_name: isCoordinator ? 'staff' : form.role_name,
        department_id: deptId,
        area_id: undefined
      });
      setSuccess('Utente creato con successo.');
      setForm({
        username: '', email: '', password: '', first_name: '', last_name: '',
        role_name: '', department_id: '', area_id: '', clinical_role: 'INFERMIERE'
      });
      setDeptMode('select');
      setNewDeptName('');
      setAreaMode('select');
      setNewAreaName('');
      setShowForm(false);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Errore creazione utente');
    }
  };

  const canManage = currentUser?.role === 'admin' || currentUser?.role === 'area_manager' || currentUser?.role === 'coordinator';
  const canDelete = currentUser?.role === 'admin' || currentUser?.role === 'area_manager';

  const handleToggleActive = async (u) => {
    const action = u.is_active ? 'dimettere' : 'riattivare';
    if (!window.confirm(`Confermi di voler ${action} ${u.first_name} ${u.last_name}?`)) return;
    setError('');
    try {
      await updateUser(u.id, { is_active: u.is_active ? 0 : 1 });
      setSuccess(u.is_active ? `${u.first_name} ${u.last_name} dimesso dall'organico.` : `${u.first_name} ${u.last_name} riattivato.`);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Errore aggiornamento');
    }
  };

  const isCoordinator = currentUser?.role === 'coordinator';

  const openEdit = (u) => {
    setEditModal(u);
    setEditError('');
    setEditForm({
      first_name: u.first_name || '',
      last_name:  u.last_name  || '',
      email:      u.email      || '',
      clinical_role: u.clinical_role || 'INFERMIERE',
    });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setEditError('');
    try {
      await updateUser(editModal.id, editForm);
      setSuccess(`Dati di ${editModal.first_name} ${editModal.last_name} aggiornati.`);
      setEditModal(null);
      await loadData();
    } catch (err) {
      setEditError(err.response?.data?.error || 'Errore aggiornamento');
    }
  };

  const handleGenerateLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    if (loginForm.password !== loginForm.confirm) {
      setLoginError('Le password non coincidono.'); return;
    }
    try {
      await generateLogin(loginModal.id, { username: loginForm.username, password: loginForm.password });
      setLoginSuccess(`Accesso configurato per ${loginModal.first_name} ${loginModal.last_name}.`);
      setLoginModal(null);
      setLoginForm({ username: '', password: '', confirm: '' });
      await loadData();
    } catch (err) {
      setLoginError(err.response?.data?.error || 'Errore configurazione accesso');
    }
  };

  const handleDelete = async (u) => {
    if (!window.confirm(`ATTENZIONE: eliminare definitivamente ${u.first_name} ${u.last_name}? L'operazione è irreversibile.`)) return;
    setError('');
    try {
      await deleteUser(u.id);
      setSuccess(`${u.first_name} ${u.last_name} eliminato definitivamente.`);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Errore eliminazione');
    }
  };

  const filteredUsers = users.filter(u =>
    filter === '' || u.role === filter ||
    `${u.first_name} ${u.last_name}`.toLowerCase().includes(filter.toLowerCase()) ||
    u.username.toLowerCase().includes(filter.toLowerCase())
  );

  const getRoleBadgeColor = (role) => {
    switch (role) {
      case 'admin': return 'badge-error';
      case 'area_manager': return 'badge-warning';
      case 'coordinator': return 'badge-primary';
      case 'staff': return 'badge-success';
      default: return 'badge-secondary';
    }
  };

  if (loading) {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="loading-spinner w-8 h-8 mr-3"></div>
      <span className="text-secondary-600">Caricamento utenti...</span>
    </div>
  );
}

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-soft p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-secondary-800">👥 Gestione Utenti</h2>
            <p className="text-secondary-600 mt-1">
              {filteredUsers.length} utenti totali
            </p>
          </div>

          <div className="flex items-center space-x-3">
            {/* Filtro ruolo */}
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="input min-w-[150px]"
            >
              <option value="">Tutti i ruoli</option>
              {roles.map(r => (
                <option key={r.name} value={r.name}>{r.name}</option>
              ))}
            </select>

            {/* Nuovo utente */}
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold rounded-xl shadow-soft transition-all"
            >
              <span className="flex items-center">
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                {showForm ? 'Annulla' : 'Nuovo Utente'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Messaggi */}
      {error && (
        <div className="bg-error-50 border border-error-200 text-error-800 p-4 rounded-lg flex items-center">
          <svg className="w-5 h-5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="font-medium">{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-success-50 border border-success-200 text-success-800 p-4 rounded-lg flex items-center">
          <svg className="w-5 h-5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="font-medium">{success}</span>
        </div>
      )}

      {/* Form modale */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-soft p-6 animate-slide-down">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-secondary-900">Nuovo Utente</h3>
            <button
              onClick={() => setShowForm(false)}
              className="text-secondary-400 hover:text-secondary-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleCreate} className="space-y-6">
            {/* Banner info per il coordinatore */}
            {isCoordinator && (
              <div className="bg-primary-50 border border-primary-200 rounded-xl p-4 text-sm text-primary-700">
                <strong>Modalità coordinatore:</strong> inserisci solo i dati anagrafici dell'operatore.
                Potrai configurare le credenziali di accesso in un secondo momento dalla lista utenti.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label htmlFor="first_name" className="label">Nome *</label>
                <input
                  id="first_name"
                  type="text"
                  value={form.first_name}
                  onChange={e => setForm({ ...form, first_name: e.target.value })}
                  className="input"
                  placeholder="Nome"
                  required
                />
              </div>

              <div>
                <label htmlFor="last_name" className="label">Cognome *</label>
                <input
                  id="last_name"
                  type="text"
                  value={form.last_name}
                  onChange={e => setForm({ ...form, last_name: e.target.value })}
                  className="input"
                  placeholder="Cognome"
                  required
                />
              </div>

              <div>
                <label htmlFor="email" className="label">Email</label>
                <input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="input"
                  placeholder="email@esempio.com"
                />
              </div>

              {/* Username e password solo per admin/area_manager */}
              {!isCoordinator && (
                <>
                  <div>
                    <label htmlFor="username" className="label">Username</label>
                    <input
                      id="username"
                      type="text"
                      value={form.username}
                      onChange={e => setForm({ ...form, username: e.target.value })}
                      className="input"
                      placeholder="Lascia vuoto per aggiungere dopo"
                    />
                  </div>
                  <div>
                    <label htmlFor="password" className="label">Password</label>
                    <input
                      id="password"
                      type="password"
                      value={form.password}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                      className="input"
                      placeholder="Lascia vuoto per aggiungere dopo"
                    />
                  </div>
                </>
              )}

              {/* Ruolo sistema — nascosto per coordinator (fisso su staff) */}
              {isCoordinator ? (
                <input type="hidden" value="staff" readOnly />
              ) : (
                <div>
                  <label htmlFor="role_name" className="label">Ruolo sistema *</label>
                  <select
                    id="role_name"
                    value={form.role_name}
                    onChange={e => setForm({ ...form, role_name: e.target.value })}
                    className="input"
                    required
                  >
                    <option value="">Seleziona ruolo...</option>
                    {roles
                      .filter(r => (CAN_CREATE[currentUser?.role] || []).includes(r.name))
                      .map(r => (
                        <option key={r.name} value={r.name}>{r.name}</option>
                      ))}
                  </select>
                </div>
              )}

              {/* Reparto — sola lettura per coordinator, selezionabile per admin/area_manager */}
              {isCoordinator ? (
                <div>
                  <label className="label">Reparto</label>
                  <div className="input bg-secondary-50 text-secondary-700 flex items-center gap-2 cursor-not-allowed">
                    <svg className="w-4 h-4 text-primary-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    <span>{currentUser?.department_name || 'Reparto non assegnato'}</span>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="label">Reparto</label>
                  <div className="flex gap-2 mb-1">
                    <button type="button"
                      onClick={() => { setDeptMode('select'); setNewDeptName(''); }}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                        deptMode === 'select' ? 'bg-primary-500 text-white border-primary-500' : 'bg-white text-secondary-600 border-secondary-300 hover:border-primary-400'
                      }`}>
                      Scegli esistente
                    </button>
                    <button type="button"
                      onClick={() => { setDeptMode('new'); setForm({...form, department_id: ''}); }}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                        deptMode === 'new' ? 'bg-primary-500 text-white border-primary-500' : 'bg-white text-secondary-600 border-secondary-300 hover:border-primary-400'
                      }`}>
                      + Crea nuovo
                    </button>
                  </div>
                  {deptMode === 'select' ? (
                    <select
                      value={form.department_id}
                      onChange={e => setForm({ ...form, department_id: e.target.value })}
                      className="input"
                    >
                      <option value="">Seleziona reparto...</option>
                      {departments.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.name}{d.area_name ? ` — ${d.area_name}` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={newDeptName}
                      onChange={e => setNewDeptName(e.target.value)}
                      className="input"
                      placeholder="Nome nuovo reparto..."
                      required={deptMode === 'new'}
                    />
                  )}
                </div>
              )}

              {/* Area — sola lettura per coordinator */}
              {isCoordinator ? (
                <div>
                  <label className="label">Area organizzativa</label>
                  <div className="input bg-secondary-50 text-secondary-700 flex items-center gap-2 cursor-not-allowed">
                    <svg className="w-4 h-4 text-primary-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                    <span>{currentUser?.area_name || 'Nessuna area assegnata'}</span>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="label">Area organizzativa</label>
                  <div className="flex gap-2 mb-1">
                    <button type="button"
                      onClick={() => { setAreaMode('select'); setNewAreaName(''); }}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                        areaMode === 'select' ? 'bg-primary-500 text-white border-primary-500' : 'bg-white text-secondary-600 border-secondary-300 hover:border-primary-400'
                      }`}>
                      Scegli esistente
                    </button>
                    <button type="button"
                      onClick={() => { setAreaMode('new'); setForm({...form, area_id: ''}); }}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                        areaMode === 'new' ? 'bg-primary-500 text-white border-primary-500' : 'bg-white text-secondary-600 border-secondary-300 hover:border-primary-400'
                      }`}>
                      + Crea nuova
                    </button>
                  </div>
                  {areaMode === 'select' ? (
                    <select
                      value={form.area_id}
                      onChange={e => setForm({ ...form, area_id: e.target.value })}
                      className="input"
                    >
                      <option value="">Nessuna area / da assegnare</option>
                      {areas.map(a => (
                        <option key={a.id} value={a.id}>{a.name}{a.manager_name ? ` (${a.manager_name})` : ''}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={newAreaName}
                      onChange={e => setNewAreaName(e.target.value)}
                      className="input"
                      placeholder="Nome nuova area organizzativa..."
                      required={areaMode === 'new'}
                    />
                  )}
                  {deptMode === 'new' && areaMode === 'new' && (
                    <p className="text-xs text-primary-500 mt-1">✓ L'area verrà creata e abbinata al nuovo reparto</p>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="clinical_role" className="label">
                  {isCoordinator ? 'Ruolo *' : 'Ruolo Clinico'}
                </label>
                <select
                  id="clinical_role"
                  value={form.clinical_role}
                  onChange={e => setForm({ ...form, clinical_role: e.target.value })}
                  className="input"
                  required={isCoordinator}
                >
                  <option value="INFERMIERE">Infermiere</option>
                  <option value="INFERMIERE_SENIOR">Infermiere Senior</option>
                  <option value="OSS">OSS</option>
                  <option value="MEDICO">Medico</option>
                  <option value="TECNICO">Tecnico</option>
                  <option value="CAPO_TURNO">Capo Turno</option>
                  <option value="RESPONSABILE">Responsabile</option>
                  <option value="STAFF">Altro / Staff</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="btn btn-secondary"
              >
                Annulla
              </button>
              <button
                type="submit"
                className="flex items-center px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold rounded-xl shadow-soft transition-all"
              >
                <span className="flex items-center">
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Crea Utente
                </span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tabella utenti */}
      <div className="bg-white rounded-xl shadow-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-secondary-50 border-b border-secondary-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 uppercase tracking-wider">
                  Utente
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 uppercase tracking-wider">
                  Username
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 uppercase tracking-wider">
                  Ruolo
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 uppercase tracking-wider">
                  Reparto
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 uppercase tracking-wider">
                  Ruolo Clinico
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 uppercase tracking-wider">
                  Stato
                </th>
                {canManage && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-secondary-500 uppercase tracking-wider">
                    Azioni
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary-200">
              {filteredUsers.map((u) => (
                <tr key={u.id} className={`hover:bg-secondary-50 transition-colors ${!u.is_active ? 'opacity-60' : ''}`}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${u.is_active ? 'bg-primary-100' : 'bg-secondary-100'}`}>
                        <span className={`text-sm font-bold ${u.is_active ? 'text-primary-600' : 'text-secondary-400'}`}>
                          {u.first_name?.[0]?.toUpperCase()}{u.last_name?.[0]?.toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-secondary-900">
                          {u.first_name} {u.last_name}
                        </div>
                        {!u.is_active && (
                          <div className="text-xs text-error-500 font-medium">Dimesso</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {(!u.username || u.username.startsWith('_pending_'))
                      ? <span className="text-secondary-400 italic text-xs">— utenza non configurata</span>
                      : <span className="text-secondary-900">{u.username}</span>
                    }
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary-600">
                    {u.email}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`badge ${getRoleBadgeColor(u.role)} text-xs`}>
                      {u.role?.replace('_', ' ').toUpperCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary-600">
                    {u.department_name || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-secondary-600">
                    {u.clinical_role?.replace(/_/g, ' ') || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${u.is_active ? 'bg-success-100 text-success-700' : 'bg-secondary-100 text-secondary-500'}`}>
                      {u.is_active ? '● Attivo' : '○ Dimesso'}
                    </span>
                  </td>
                  {canManage && (
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Genera utenza login — visibile se l'operatore non ha ancora utenza reale */}
                        {(!u.username || u.username.startsWith('_pending_')) && u.id !== currentUser.id && (
                          <button
                            onClick={() => { setLoginModal(u); setLoginError(''); setLoginForm({ username: '', password: '', confirm: '' }); }}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all bg-primary-50 text-primary-600 hover:bg-primary-100 border border-primary-200"
                            title="Configura accesso al sistema"
                          >
                            🔑 Genera utenza
                          </button>
                        )}
                        {u.id !== currentUser.id && (
                          <>
                            <button
                              onClick={() => openEdit(u)}
                              className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all bg-secondary-50 text-secondary-600 hover:bg-secondary-100 border border-secondary-200"
                              title="Modifica dati"
                            >
                              ✏️ Modifica
                            </button>
                            <button
                              onClick={() => handleToggleActive(u)}
                              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                                u.is_active
                                  ? 'bg-warning-50 text-warning-700 hover:bg-warning-100 border border-warning-200'
                                  : 'bg-success-50 text-success-600 hover:bg-success-100 border border-success-200'
                              }`}
                            >
                              {u.is_active ? 'Dimetti' : 'Riattiva'}
                            </button>
                            {canDelete && (
                              <button
                                onClick={() => handleDelete(u)}
                                className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all bg-error-50 text-error-600 hover:bg-error-100 border border-error-200"
                                title="Elimina definitivamente"
                              >
                                Elimina
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredUsers.length === 0 && (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-secondary-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-secondary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-secondary-900 mb-2">Nessun utente trovato</h3>
            <p className="text-secondary-600">
              {filter ? 'Prova a cambiare i filtri di ricerca' : 'Nessun utente registrato nel sistema'}
            </p>
          </div>
        )}
      </div>
      {loginSuccess && (
        <div className="bg-success-50 border border-success-200 text-success-800 p-4 rounded-lg flex items-center">
          <svg className="w-5 h-5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="font-medium">{loginSuccess}</span>
          <button onClick={() => setLoginSuccess('')} className="ml-auto text-success-600 hover:text-success-800">✕</button>
        </div>
      )}

      {/* Modale Modifica dati utente */}
      {editModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-large w-full max-w-lg animate-slide-down">
            <div className="flex items-center justify-between p-6 border-b border-secondary-100">
              <div>
                <h3 className="text-lg font-bold text-secondary-900">✏️ Modifica dati</h3>
                <p className="text-sm text-secondary-500 mt-0.5">
                  {editModal.first_name} {editModal.last_name} — <span className="font-medium">{editModal.role?.replace('_',' ').toUpperCase()}</span>
                </p>
              </div>
              <button onClick={() => setEditModal(null)} className="text-secondary-400 hover:text-secondary-600 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
              {editError && (
                <div className="bg-error-50 border border-error-200 text-error-700 text-sm p-3 rounded-lg">{editError}</div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Nome *</label>
                  <input type="text" value={editForm.first_name}
                    onChange={e => setEditForm({...editForm, first_name: e.target.value})}
                    className="input" required />
                </div>
                <div>
                  <label className="label">Cognome *</label>
                  <input type="text" value={editForm.last_name}
                    onChange={e => setEditForm({...editForm, last_name: e.target.value})}
                    className="input" required />
                </div>
              </div>

              <div>
                <label className="label">Email</label>
                <input type="email" value={editForm.email}
                  onChange={e => setEditForm({...editForm, email: e.target.value})}
                  className="input" placeholder="email@esempio.com" />
              </div>

              {/* Ruolo clinico — non mostrato per coordinator */}
              {editModal.role !== 'coordinator' && editModal.role !== 'area_manager' && editModal.role !== 'admin' && (
                <div>
                  <label className="label">Ruolo</label>
                  <select value={editForm.clinical_role}
                    onChange={e => setEditForm({...editForm, clinical_role: e.target.value})}
                    className="input">
                    <option value="INFERMIERE">Infermiere</option>
                    <option value="INFERMIERE_SENIOR">Infermiere Senior</option>
                    <option value="OSS">OSS</option>
                    <option value="MEDICO">Medico</option>
                    <option value="TECNICO">Tecnico</option>
                    <option value="CAPO_TURNO">Capo Turno</option>
                    <option value="RESPONSABILE">Responsabile</option>
                    <option value="STAFF">Altro / Staff</option>
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setEditModal(null)}
                  className="px-4 py-2 text-sm font-medium text-secondary-600 bg-secondary-100 hover:bg-secondary-200 rounded-xl transition-all">
                  Annulla
                </button>
                <button type="submit"
                  className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 hover:bg-primary-600 rounded-xl shadow-soft transition-all">
                  Salva modifiche
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modale Genera utenza login */}
      {loginModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-large w-full max-w-md animate-slide-down">
            <div className="flex items-center justify-between p-6 border-b border-secondary-100">
              <div>
                <h3 className="text-lg font-bold text-secondary-900">🔑 Genera utenza di accesso</h3>
                <p className="text-sm text-secondary-500 mt-0.5">
                  {loginModal.first_name} {loginModal.last_name}
                </p>
              </div>
              <button
                onClick={() => setLoginModal(null)}
                className="text-secondary-400 hover:text-secondary-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleGenerateLogin} className="p-6 space-y-4">
              {loginError && (
                <div className="bg-error-50 border border-error-200 text-error-700 text-sm p-3 rounded-lg">
                  {loginError}
                </div>
              )}

              <div>
                <label className="label">Username *</label>
                <input
                  type="text"
                  value={loginForm.username}
                  onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
                  className="input"
                  placeholder="es. mario.rossi"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="label">Password *</label>
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                  className="input"
                  placeholder="Minimo 6 caratteri"
                  required
                />
              </div>

              <div>
                <label className="label">Conferma password *</label>
                <input
                  type="password"
                  value={loginForm.confirm}
                  onChange={e => setLoginForm({ ...loginForm, confirm: e.target.value })}
                  className="input"
                  placeholder="Ripeti la password"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setLoginModal(null)}
                  className="px-4 py-2 text-sm font-medium text-secondary-600 bg-secondary-100 hover:bg-secondary-200 rounded-xl transition-all"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold text-white bg-primary-500 hover:bg-primary-600 rounded-xl shadow-soft transition-all"
                >
                  Crea accesso
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Staff;
