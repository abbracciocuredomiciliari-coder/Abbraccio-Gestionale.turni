import React, { useEffect, useState } from 'react';
import { getRequests, createRequest, approveRequest, rejectRequest, getUsers } from '../services/api';

const REQUEST_TYPES = [
  { id: 1, label: '🏖️ Ferie' },
  { id: 2, label: '😴 Riposo' },
  { id: 3, label: '📅 Desiderata' },
  { id: 4, label: '🚫 Esonerazione' },
  { id: 5, label: '🌅 Solo mattina' },
  { id: 6, label: '🌙 Non notti' },
];

const STATUS_STYLE = {
  'In attesa':  { bg: '#fef3c7', color: '#92400e', label: '⏳ In attesa' },
  'Approvata':  { bg: '#d1fae5', color: '#065f46', label: '✅ Approvata' },
  'Rifiutata':  { bg: '#fee2e2', color: '#991b1b', label: '❌ Rifiutata' },
};

const EMPTY_FORM = { request_type_id: 1, start_date: '', end_date: '', notes: '', on_behalf_of_user_id: '' };

function Requests({ user, isCoordinator }) {
  const [requests, setRequests]   = useState([]);
  const [operators, setOperators] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg]             = useState(null);
  const [filter, setFilter]       = useState('all'); // 'all' | 'pending'

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [reqRes, usersRes] = await Promise.all([
        getRequests(),
        isCoordinator ? getUsers() : Promise.resolve({ data: [] }),
      ]);
      setRequests(reqRes.data);
      if (isCoordinator) {
        setOperators(usersRes.data.filter(u => u.role === 'staff'));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const showMsg = (text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 4000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.start_date) return;
    setSubmitting(true);
    try {
      const payload = { ...form };
      if (!payload.on_behalf_of_user_id) delete payload.on_behalf_of_user_id;
      await createRequest(payload);
      setForm(EMPTY_FORM);
      const onBehalf = operators.find(o => o.id === Number(form.on_behalf_of_user_id));
      showMsg(onBehalf
        ? `Richiesta inserita per ${onBehalf.first_name} ${onBehalf.last_name} e approvata automaticamente`
        : 'Richiesta inviata con successo');
      loadAll();
    } catch (err) {
      showMsg(err.response?.data?.error || 'Errore invio richiesta', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (id) => {
    try { await approveRequest(id); loadAll(); }
    catch { showMsg('Errore approvazione', 'error'); }
  };

  const handleReject = async (id) => {
    try { await rejectRequest(id); loadAll(); }
    catch { showMsg('Errore rifiuto', 'error'); }
  };

  const filtered = filter === 'pending'
    ? requests.filter(r => r.status === 'In attesa')
    : requests;

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
    </div>
  );

  return (
    <div className="space-y-6">

      {/* Messaggio feedback */}
      {msg && (
        <div className={`p-4 rounded-xl text-sm font-medium flex items-center gap-2 ${
          msg.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'
        }`}>
          {msg.type === 'error' ? '❌' : '✅'} {msg.text}
        </div>
      )}

      {/* Form nuova richiesta */}
      <div className="bg-white rounded-xl shadow-soft p-6">
        <h3 className="text-lg font-bold text-secondary-800 mb-4">
          {isCoordinator ? '📋 Nuova richiesta' : '📋 Invia una richiesta'}
        </h3>
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

            {/* Selezione operatore — solo coordinatore */}
            {isCoordinator && (
              <div className="lg:col-span-3">
                <label className="block text-xs font-semibold text-secondary-600 mb-1 uppercase tracking-wide">
                  Operatore
                </label>
                <select
                  value={form.on_behalf_of_user_id}
                  onChange={e => setForm({ ...form, on_behalf_of_user_id: e.target.value })}
                  className="w-full sm:w-64 px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="">— Me stesso (come coordinatore) —</option>
                  {operators.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.last_name} {o.first_name} — {o.clinical_role || 'Staff'}
                    </option>
                  ))}
                </select>
                {form.on_behalf_of_user_id && (
                  <p className="text-xs text-green-600 mt-1">
                    ✅ La richiesta verrà approvata automaticamente in quanto inserita dal coordinatore
                  </p>
                )}
              </div>
            )}

            {/* Tipo richiesta */}
            <div>
              <label className="block text-xs font-semibold text-secondary-600 mb-1 uppercase tracking-wide">
                Tipo richiesta
              </label>
              <select
                value={form.request_type_id}
                onChange={e => setForm({ ...form, request_type_id: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                {REQUEST_TYPES.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Dal */}
            <div>
              <label className="block text-xs font-semibold text-secondary-600 mb-1 uppercase tracking-wide">
                Dal
              </label>
              <input
                type="date"
                value={form.start_date}
                onChange={e => setForm({ ...form, start_date: e.target.value })}
                required
                className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            {/* Al */}
            <div>
              <label className="block text-xs font-semibold text-secondary-600 mb-1 uppercase tracking-wide">
                Al (opzionale)
              </label>
              <input
                type="date"
                value={form.end_date}
                min={form.start_date}
                onChange={e => setForm({ ...form, end_date: e.target.value })}
                className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>

            {/* Note */}
            <div className="lg:col-span-3">
              <label className="block text-xs font-semibold text-secondary-600 mb-1 uppercase tracking-wide">
                Note
              </label>
              <input
                type="text"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Opzionale..."
                className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              type="submit"
              disabled={submitting || !form.start_date}
              className="px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold rounded-xl shadow-soft transition-all disabled:opacity-50"
            >
              {submitting ? 'Invio...' : isCoordinator && form.on_behalf_of_user_id ? '✅ Inserisci e approva' : '📤 Invia richiesta'}
            </button>
            {(form.start_date || form.notes || form.on_behalf_of_user_id) && (
              <button type="button" onClick={() => setForm(EMPTY_FORM)}
                className="px-4 py-2 text-sm text-secondary-600 hover:text-secondary-800 border border-secondary-300 rounded-xl">
                Annulla
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Elenco richieste */}
      <div className="bg-white rounded-xl shadow-soft overflow-hidden">
        <div className="p-4 border-b border-secondary-200 flex items-center justify-between flex-wrap gap-3">
          <h3 className="text-lg font-bold text-secondary-800">📋 Elenco richieste</h3>
          {isCoordinator && (
            <div className="flex gap-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${filter === 'all' ? 'bg-primary-100 text-primary-700' : 'text-secondary-500 hover:bg-secondary-100'}`}
              >
                Tutte ({requests.length})
              </button>
              <button
                onClick={() => setFilter('pending')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${filter === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'text-secondary-500 hover:bg-secondary-100'}`}
              >
                In attesa ({requests.filter(r => r.status === 'In attesa').length})
              </button>
            </div>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center text-secondary-400">
            <div className="text-4xl mb-3">📭</div>
            <p className="font-medium">Nessuna richiesta</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-secondary-50">
                <tr>
                  {isCoordinator && <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-500 uppercase tracking-wider">Operatore</th>}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-500 uppercase tracking-wider">Tipo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-500 uppercase tracking-wider">Periodo</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-500 uppercase tracking-wider">Note</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-500 uppercase tracking-wider">Stato</th>
                  {isCoordinator && <th className="px-4 py-3 text-left text-xs font-semibold text-secondary-500 uppercase tracking-wider">Azioni</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100">
                {filtered.map((r) => {
                  const st = STATUS_STYLE[r.status] || STATUS_STYLE['In attesa'];
                  return (
                    <tr key={r.id} className="hover:bg-secondary-50 transition-colors">
                      {isCoordinator && (
                        <td className="px-4 py-3 text-sm font-medium text-secondary-800">
                          {r.requester || '—'}
                        </td>
                      )}
                      <td className="px-4 py-3 text-sm text-secondary-700">
                        {REQUEST_TYPES.find(t => t.label.includes(r.request_type))?.label || r.request_type}
                      </td>
                      <td className="px-4 py-3 text-sm text-secondary-700 whitespace-nowrap">
                        {r.start_date}
                        {r.end_date && r.end_date !== r.start_date && (
                          <span className="text-secondary-400"> → {r.end_date}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-secondary-500 max-w-xs truncate">
                        {r.notes || <span className="text-secondary-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span style={{ background: st.bg, color: st.color }}
                          className="px-2.5 py-1 rounded-full text-xs font-semibold">
                          {st.label}
                        </span>
                      </td>
                      {isCoordinator && (
                        <td className="px-4 py-3">
                          {r.status === 'In attesa' ? (
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleApprove(r.id)}
                                className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold rounded-lg transition-all"
                              >
                                ✓ Approva
                              </button>
                              <button
                                onClick={() => handleReject(r.id)}
                                className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-semibold rounded-lg transition-all"
                              >
                                ✗ Rifiuta
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-secondary-400">
                              {r.approver_name ? `da ${r.approver_name}` : 'Gestita'}
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default Requests;
