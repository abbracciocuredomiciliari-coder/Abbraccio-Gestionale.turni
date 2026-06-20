import React, { useEffect, useState } from 'react';
import { getRequests, createRequest, approveRequest, rejectRequest } from '../services/api';

function Requests({ user, isCoordinator }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    request_type_id: 1,
    start_date: '',
    end_date: '',
    notes: ''
  });

  useEffect(() => {
    loadRequests();
  }, []);

  const loadRequests = async () => {
    try {
      const res = await getRequests();
      setRequests(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createRequest(form);
      setForm({ request_type_id: 1, start_date: '', end_date: '', notes: '' });
      loadRequests();
    } catch (err) {
      console.error(err);
      alert('Errore durante l\'invio della richiesta');
    }
  };

  const handleApprove = async (id) => {
    await approveRequest(id);
    loadRequests();
  };

  const handleReject = async (id) => {
    await rejectRequest(id);
    loadRequests();
  };

  if (loading) return <div>Caricamento...</div>;

  return (
    <div>
      <div className="card">
        <h3>Nuova richiesta</h3>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <div>
              <label>Tipo</label><br />
              <select
                value={form.request_type_id}
                onChange={(e) => setForm({ ...form, request_type_id: Number(e.target.value) })}
              >
                <option value={1}>Ferie</option>
                <option value={2}>Riposo</option>
                <option value={3}>Desiderata</option>
                <option value={4}>Esonerazione</option>
                <option value={5}>Solo mattina</option>
                <option value={6}>Non notti</option>
              </select>
            </div>
            <div>
              <label>Dal</label><br />
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                required
              />
            </div>
            <div>
              <label>Al</label><br />
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </div>
            <div>
              <label>Note</label><br />
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>
          <button type="submit" className="primary">Invia richiesta</button>
        </form>
      </div>

      <div className="card">
        <h3>Elenco richieste</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#eee' }}>
              <th style={{ padding: '8px', textAlign: 'left' }}>Tipo</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Periodo</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Note</th>
              <th style={{ padding: '8px', textAlign: 'left' }}>Stato</th>
              {isCoordinator && <th style={{ padding: '8px', textAlign: 'left' }}>Richiedente</th>}
              {isCoordinator && <th style={{ padding: '8px', textAlign: 'left' }}>Azioni</th>}
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '8px' }}>{r.request_type}</td>
                <td style={{ padding: '8px' }}>{r.start_date} {r.end_date && r.end_date !== r.start_date ? `→ ${r.end_date}` : ''}</td>
                <td style={{ padding: '8px' }}>{r.notes || '-'}</td>
                <td style={{ padding: '8px' }}>
                  <span style={{
                    padding: '4px 8px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    color: 'white',
                    background: r.status === 'Approvata' ? '#4CAF50' : r.status === 'Rifiutata' ? '#d32f2f' : '#FFC107'
                  }}>
                    {r.status}
                  </span>
                </td>
                {isCoordinator && <td style={{ padding: '8px' }}>{r.requester}</td>}
                {isCoordinator && (
                  <td style={{ padding: '8px' }}>
                    {r.status === 'In attesa' ? (
                      <div style={{ display: 'flex', gap: '5px' }}>
                        <button className="success" onClick={() => handleApprove(r.id)}>Approva</button>
                        <button className="danger" onClick={() => handleReject(r.id)}>Rifiuta</button>
                      </div>
                    ) : (
                      <span style={{ color: '#999', fontSize: '12px' }}>{r.approver_name || 'Gestita'}</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Requests;
