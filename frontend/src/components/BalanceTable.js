import React, { useEffect, useState } from 'react';
import api from '../services/api';

const WEIGHT_LABELS = {
  night:         { label: 'Turno notturno (N, N12)',           icon: '🌙', color: '#3F51B5' },
  weekend:       { label: 'Turno sabato / domenica',           icon: '📅', color: '#FF9800' },
  holiday:       { label: 'Turno festività nazionale',         icon: '🎉', color: '#E91E63' },
  long_shift:    { label: 'Turno lungo ≥12h (G12)',            icon: '⏳', color: '#009688' },
  normal:        { label: 'Turno giornaliero standard',        icon: '☀️', color: '#4CAF50' },
  overtime:      { label: 'Straordinario (doppio turno)',       icon: '⚡', color: '#d32f2f' },
  window_months: { label: 'Finestra storica (mesi)',           icon: '📆', color: '#607D8B' },
};

function BalanceTable({ isCoordinator }) {
  const [balance, setBalance] = useState({ staff: [], window_months: 3 });
  const [weights, setWeights] = useState([]);
  const [editingW, setEditingW] = useState({});
  const [savingW, setSavingW] = useState({});
  const [savedW, setSavedW] = useState({});
  const [detail, setDetail] = useState(null);   // { user, entries }
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [balRes, wRes] = await Promise.all([
        api.get('/balance'),
        api.get('/balance/weights')
      ]);
      setBalance(balRes.data);
      setWeights(wRes.data);
    } catch (err) {
      setMsg({ text: 'Errore caricamento: ' + (err.response?.data?.error || err.message), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSaveWeight = async (key) => {
    const val = editingW[key];
    if (val === undefined) return;
    setSavingW(s => ({ ...s, [key]: true }));
    try {
      await api.put(`/balance/weights/${key}`, { weight_value: Number(val) });
      setSavedW(s => ({ ...s, [key]: true }));
      setTimeout(() => setSavedW(s => { const n={...s}; delete n[key]; return n; }), 2000);
      setEditingW(e => { const n={...e}; delete n[key]; return n; });
      load(); // ricarica per aggiornare la classifica
    } catch {
      setMsg({ text: 'Errore salvataggio', type: 'error' });
    } finally {
      setSavingW(s => ({ ...s, [key]: false }));
    }
  };

  const loadDetail = async (person) => {
    try {
      const res = await api.get(`/balance/detail/${person.id}`);
      setDetail({ user: person, ...res.data });
    } catch (err) {
      setMsg({ text: 'Errore dettaglio', type: 'error' });
    }
  };

  // Range per barra visuale
  const scores = balance.staff.map(s => s.cumulative_score);
  const maxScore = Math.max(...scores, 1);

  const msgStyle = (type) => ({
    padding: '10px 16px', marginBottom: '12px', borderRadius: '6px', fontWeight: 'bold',
    background: type === 'success' ? '#e8f5e9' : '#ffebee',
    color: type === 'success' ? '#2e7d32' : '#c62828',
  });

  const cardStyle = { background: '#fff', borderRadius: '8px', padding: '16px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' };

  return (
    <div>
      {msg && <div style={msgStyle(msg.type)}>{msg.text}</div>}

      {/* ── Classifica bilancio ── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h4 style={{ margin: 0 }}>⚖️ Bilancio ore — Classifica punteggio cumulativo</h4>
            <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#666' }}>
              Finestra storica: <strong>{balance.window_months} mesi</strong> · Punteggio basso = priorità sui turni gravosi
            </p>
          </div>
          <button onClick={load} style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid #ccc', cursor: 'pointer', background: '#f5f5f5' }}>
            🔄 Aggiorna
          </button>
        </div>

        {loading && <p style={{ color: '#888' }}>Caricamento...</p>}

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={th}>Rank</th>
              <th style={th}>Infermiere</th>
              <th style={th}>Punteggio cumulativo</th>
              <th style={th}>Turni tot.</th>
              <th style={th}>🌙 Notti</th>
              <th style={th}>📅 Weekend</th>
              <th style={th}>Ore tot.</th>
              {isCoordinator && <th style={th}>Dettaglio</th>}
            </tr>
          </thead>
          <tbody>
            {balance.staff.map((p) => {
              const pct = maxScore > 0 ? (p.cumulative_score / maxScore) * 100 : 0;
              const barColor = p.rank <= 3 ? '#4CAF50' : p.rank <= Math.ceil(balance.staff.length / 2) ? '#FF9800' : '#d32f2f';
              const isSelected = detail?.user?.id === p.id;

              return (
                <tr key={p.id} style={{ borderBottom: '1px solid #eee', background: isSelected ? '#e3f2fd' : 'white' }}>
                  <td style={{ ...td, fontWeight: 'bold', color: p.rank === 1 ? '#4CAF50' : p.rank === 2 ? '#FF9800' : '#333' }}>
                    {p.rank === 1 ? '🥇' : p.rank === 2 ? '🥈' : p.rank === 3 ? '🥉' : `#${p.rank}`}
                  </td>
                  <td style={{ ...td, fontWeight: 'bold' }}>{p.last_name} {p.first_name}</td>
                  <td style={{ ...td, minWidth: '200px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flex: 1, height: '12px', background: '#e0e0e0', borderRadius: '6px', overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: '6px', transition: 'width 0.3s' }} />
                      </div>
                      <span style={{ minWidth: '50px', fontWeight: 'bold', color: barColor }}>
                        {p.cumulative_score.toFixed(1)} pt
                      </span>
                    </div>
                  </td>
                  <td style={td}>{p.total_shifts}</td>
                  <td style={td}>{p.night_count}</td>
                  <td style={td}>{p.weekend_count}</td>
                  <td style={td}>{p.total_hours}h</td>
                  {isCoordinator && (
                    <td style={td}>
                      <button onClick={() => loadDetail(p)}
                        style={{ padding: '3px 10px', borderRadius: '4px', border: '1px solid #1976d2', background: isSelected ? '#1976d2' : 'white', color: isSelected ? 'white' : '#1976d2', cursor: 'pointer', fontSize: '12px' }}>
                        {isSelected ? '▲ Chiudi' : '▼ Vedi'}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        {balance.staff.length === 0 && !loading && (
          <p style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
            Nessun dato disponibile. Genera almeno un planning per vedere il bilancio.
          </p>
        )}
      </div>

      {/* ── Dettaglio turni persona ── */}
      {detail && (
        <div style={cardStyle}>
          <h4 style={{ margin: '0 0 12px 0' }}>
            📋 Dettaglio — {detail.user.last_name} {detail.user.first_name}
            <span style={{ fontSize: '13px', color: '#888', fontWeight: 'normal', marginLeft: '8px' }}>
              (ultimi {detail.window_months} mesi)
            </span>
            <button onClick={() => setDetail(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px' }}>✕</button>
          </h4>
          {detail.entries.length === 0 ? (
            <p style={{ color: '#888' }}>Nessun turno nel periodo selezionato.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f5f5f5' }}>
                  <th style={th}>Data</th>
                  <th style={th}>Turno</th>
                  <th style={th}>Ore</th>
                  <th style={th}>Tipo</th>
                  <th style={th}>Peso × Ore</th>
                </tr>
              </thead>
              <tbody>
                {detail.entries.map((e, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={td}>{fmtDate(e.work_date)} {isWeekend(e.work_date) ? '📅' : ''}</td>
                    <td style={td}>
                      <span style={{ background: e.color, color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>
                        {e.shift_code}
                      </span>
                      {e.is_overtime ? <span style={{ marginLeft: '4px', fontSize: '11px', color: '#d32f2f' }}>⚡ STR</span> : ''}
                    </td>
                    <td style={td}>{e.hours}h</td>
                    <td style={td}>
                      <span style={{ fontSize: '12px', color: '#666' }}>
                        {WEIGHT_LABELS[e.is_overtime ? 'overtime' : e.weight_key]?.label || e.weight_key}
                      </span>
                    </td>
                    <td style={{ ...td, fontWeight: 'bold', color: '#1976d2' }}>
                      {e.score_contribution} pt
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#e3f2fd', fontWeight: 'bold' }}>
                  <td style={td} colSpan={4}>Totale punteggio periodo</td>
                  <td style={{ ...td, color: '#1976d2', fontSize: '16px' }}>
                    {detail.entries.reduce((s, e) => s + e.score_contribution, 0).toFixed(1)} pt
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* ── Configurazione pesi (coordinatore) ── */}
      {isCoordinator && (
        <div style={cardStyle}>
          <h4 style={{ margin: '0 0 4px 0' }}>⚙️ Configurazione pesi turno</h4>
          <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#666' }}>
            I pesi determinano quanto ogni tipo di turno incide sul punteggio cumulativo.
            Modifica e salva — la classifica si aggiorna automaticamente.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={th}>Tipo turno</th>
                <th style={th}>Peso attuale</th>
                <th style={th}>Modifica</th>
                <th style={th}>Effetto</th>
              </tr>
            </thead>
            <tbody>
              {weights.map(w => {
                const meta = WEIGHT_LABELS[w.weight_key] || {};
                const isEditing = editingW[w.weight_key] !== undefined;
                return (
                  <tr key={w.weight_key} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={td}>
                      <span style={{ marginRight: '6px' }}>{meta.icon}</span>
                      <strong>{meta.label || w.weight_key}</strong>
                    </td>
                    <td style={{ ...td, fontWeight: 'bold', fontSize: '18px', color: meta.color || '#333' }}>
                      ×{w.weight_value}
                      {w.first_name && (
                        <span style={{ fontSize: '11px', color: '#999', display: 'block', fontWeight: 'normal' }}>
                          mod. {w.first_name} {w.last_name}
                        </span>
                      )}
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <input
                          type="number" min="0.1" max="5" step="0.1"
                          value={isEditing ? editingW[w.weight_key] : w.weight_value}
                          onChange={e => setEditingW(prev => ({ ...prev, [w.weight_key]: e.target.value }))}
                          style={{ width: '70px', padding: '5px', borderRadius: '4px', border: '1px solid #ccc' }}
                        />
                        {isEditing && (
                          <button onClick={() => handleSaveWeight(w.weight_key)}
                            disabled={savingW[w.weight_key]}
                            style={{ padding: '5px 12px', background: '#1976d2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                            {savingW[w.weight_key] ? '...' : 'Salva'}
                          </button>
                        )}
                        {savedW[w.weight_key] && <span style={{ color: '#4CAF50', fontSize: '18px' }}>✓</span>}
                      </div>
                    </td>
                    <td style={{ ...td, fontSize: '12px', color: '#666' }}>
                      {w.weight_key === 'window_months'
                        ? `Considera i turni degli ultimi ${w.weight_value} mesi`
                        : `Turno da 8h = ${(8 * w.weight_value).toFixed(1)} pt`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = { padding: '8px 10px', textAlign: 'left', fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', fontSize: '13px' };

function fmtDate(str) {
  if (!str) return '—';
  return new Date(str + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function isWeekend(str) {
  if (!str) return false;
  const d = new Date(str + 'T00:00:00').getDay();
  return d === 0 || d === 6;
}

export default BalanceTable;
