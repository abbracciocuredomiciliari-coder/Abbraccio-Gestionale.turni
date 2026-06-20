import React, { useEffect, useState, useCallback } from 'react';
import {
  getOvertime, createOvertime, deleteOvertime,
  getOvertimeSummaryAll, getRestRecovery, markRestRecovered,
  getUsers, getShifts
} from '../services/api';

const MONTHS = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                 'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

const now = new Date();

function OvertimeLog({ user, isCoordinator }) {
  const [tab, setTab] = useState('summary');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [summary, setSummary] = useState([]);
  const [myOvertime, setMyOvertime] = useState({ entries: [], summary: {} });
  const [myRest, setMyRest] = useState({ entries: [], total_pending_hours: 0, overdue_count: 0 });
  const [users, setUsers] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  // Form aggiunta straordinario
  const [form, setForm] = useState({
    user_id: '', work_date: '', shift_type_id: '', overtime_hours: '', reason: ''
  });

  const showMsg = (text, type) => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (isCoordinator) {
        const [sumRes, usersRes, shiftsRes] = await Promise.all([
          getOvertimeSummaryAll({ year, month }),
          getUsers(),
          getShifts()
        ]);
        setSummary(sumRes.data);
        setUsers(usersRes.data.filter(u => u.role === 'staff'));
        setShifts(shiftsRes.data.filter(s => s.code !== 'R'));
      }
      const [otRes, restRes] = await Promise.all([
        getOvertime({ year, month }),
        getRestRecovery({ year })
      ]);
      setMyOvertime(otRes.data);
      setMyRest(restRes.data);
    } catch (err) {
      showMsg('Errore caricamento: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
      setLoading(false);
    }
  }, [year, month, isCoordinator]);

  useEffect(() => { load(); }, [load]);

  const handleAddOvertime = async (e) => {
    e.preventDefault();
    try {
      const res = await createOvertime({
        ...form,
        user_id: Number(form.user_id),
        shift_type_id: Number(form.shift_type_id),
        overtime_hours: Number(form.overtime_hours)
      });
      const warnings = res.data.warnings;
      showMsg(
        warnings ? `Straordinario registrato ⚠ ${warnings.join('; ')}` : 'Straordinario registrato',
        warnings ? 'warning' : 'success'
      );
      setForm({ user_id: '', work_date: '', shift_type_id: '', overtime_hours: '', reason: '' });
      load();
    } catch (err) {
      showMsg('Errore: ' + (err.response?.data?.error || err.message), 'error');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Eliminare questo straordinario?')) return;
    try {
      await deleteOvertime(id);
      showMsg('Eliminato', 'success');
      load();
    } catch (err) {
      showMsg('Errore eliminazione', 'error');
    }
  };

  const handleMarkRecovered = async (id) => {
    try {
      await markRestRecovered(id, {});
      showMsg('Riposo segnato come recuperato', 'success');
      load();
    } catch (err) {
      showMsg('Errore: ' + (err.response?.data?.error || err.message), 'error');
    }
  };

  // Stili
  const cardStyle = { background: '#fff', borderRadius: '8px', padding: '16px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' };
  const tabBtn = (active) => ({
    padding: '8px 16px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontWeight: 'bold',
    background: active ? '#1976d2' : '#e0e0e0', color: active ? 'white' : '#333', marginRight: '8px'
  });
  const msgStyle = (type) => ({
    padding: '10px 16px', marginBottom: '12px', borderRadius: '6px', fontWeight: 'bold',
    background: type === 'success' ? '#e8f5e9' : type === 'warning' ? '#fff8e1' : '#ffebee',
    color: type === 'success' ? '#2e7d32' : type === 'warning' ? '#e65100' : '#c62828',
    border: `1px solid ${type === 'success' ? '#a5d6a7' : type === 'warning' ? '#ffcc80' : '#ef9a9a'}`
  });
  const badge = (val, max, unit = 'h') => {
    const pct = max ? (val / max) * 100 : 0;
    const color = pct >= 90 ? '#d32f2f' : pct >= 70 ? '#f57c00' : '#388e3c';
    return (
      <span style={{ color, fontWeight: 'bold' }}>
        {val}{unit} / {max}{unit}
      </span>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={tabBtn(tab === 'summary')} onClick={() => setTab('summary')}>
          📊 Riepilogo
        </button>
        <button style={tabBtn(tab === 'overtime')} onClick={() => setTab('overtime')}>
          ⏱ Ore straordinarie
        </button>
        <button style={tabBtn(tab === 'rest')} onClick={() => setTab('rest')}>
          🛌 Riposi da recuperare
          {myRest.overdue_count > 0 && (
            <span style={{ marginLeft: '6px', background: '#d32f2f', color: 'white', borderRadius: '10px', padding: '1px 7px', fontSize: '11px' }}>
              {myRest.overdue_count}
            </span>
          )}
        </button>
        {isCoordinator && (
          <button style={tabBtn(tab === 'add')} onClick={() => setTab('add')}>
            ➕ Aggiungi straordinario
          </button>
        )}

        {/* Selettore anno/mese */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ padding: '6px' }}>
            {MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
          </select>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))}
            style={{ width: '80px', padding: '6px' }} />
        </div>
      </div>

      {msg && <div style={msgStyle(msg.type)}>{msg.text}</div>}
      {loading && <p style={{ color: '#888' }}>Caricamento...</p>}

      {/* ── TAB RIEPILOGO ── */}
      {tab === 'summary' && (
        <div>
          {isCoordinator ? (
            <div style={cardStyle}>
              <h4 style={{ margin: '0 0 12px 0' }}>
                Riepilogo straordinari — {MONTHS[month-1]} {year}
              </h4>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ background: '#f5f5f5' }}>
                      <th style={th}>Infermiere</th>
                      <th style={th}>Ore mese</th>
                      <th style={th}>Ore anno</th>
                      <th style={th}>Riposi pendenti</th>
                      <th style={th}>Limite mensile</th>
                      <th style={th}>Limite annuale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map(p => (
                      <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={td}>{p.last_name} {p.first_name}</td>
                        <td style={td}>{badge(p.overtime_hours_month, p.limit_month)}</td>
                        <td style={td}>{badge(p.overtime_hours_year, p.limit_year)}</td>
                        <td style={td}>
                          <span style={{ color: p.rest_pending_hours > 0 ? '#d32f2f' : '#388e3c', fontWeight: 'bold' }}>
                            {p.rest_pending_hours}h
                          </span>
                        </td>
                        <td style={td}>{p.limit_month}h</td>
                        <td style={td}>{p.limit_year}h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* Vista personale per l'infermiere */
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
              <div style={{ ...cardStyle, background: '#e3f2fd', border: '1px solid #90caf9' }}>
                <div style={{ fontSize: '13px', color: '#1565c0', marginBottom: '4px' }}>Ore straordinarie {MONTHS[month-1]}</div>
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#1976d2' }}>
                  {myOvertime.summary?.total_hours_month || 0}h
                </div>
                <div style={{ fontSize: '12px', color: '#555' }}>
                  limite: {myOvertime.summary?.limit_month || '—'}h
                </div>
              </div>
              <div style={{ ...cardStyle, background: '#fce4ec', border: '1px solid #f48fb1' }}>
                <div style={{ fontSize: '13px', color: '#880e4f', marginBottom: '4px' }}>Ore straordinarie {year}</div>
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#c2185b' }}>
                  {myOvertime.summary?.total_hours_year || 0}h
                </div>
                <div style={{ fontSize: '12px', color: '#555' }}>
                  limite: {myOvertime.summary?.limit_year || '—'}h
                </div>
              </div>
              <div style={{ ...cardStyle, background: '#fff3e0', border: '1px solid #ffcc80' }}>
                <div style={{ fontSize: '13px', color: '#e65100', marginBottom: '4px' }}>Riposi da recuperare</div>
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#f57c00' }}>
                  {myRest.total_pending_hours || 0}h
                </div>
                {myRest.overdue_count > 0 && (
                  <div style={{ fontSize: '12px', color: '#d32f2f', fontWeight: 'bold' }}>
                    ⚠ {myRest.overdue_count} scaduti!
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB ORE STRAORDINARIE ── */}
      {tab === 'overtime' && (
        <div style={cardStyle}>
          <h4 style={{ margin: '0 0 12px 0' }}>
            Ore straordinarie — {MONTHS[month-1]} {year}
          </h4>
          {myOvertime.entries?.length === 0 ? (
            <p style={{ color: '#888' }}>Nessuno straordinario registrato per questo periodo.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: '#f5f5f5' }}>
                  <th style={th}>Data</th>
                  {isCoordinator && <th style={th}>Infermiere</th>}
                  <th style={th}>Turno</th>
                  <th style={th}>Ore</th>
                  <th style={th}>Motivazione</th>
                  <th style={th}>Autorizzato da</th>
                  {isCoordinator && <th style={th}></th>}
                </tr>
              </thead>
              <tbody>
                {myOvertime.entries?.map(e => (
                  <tr key={e.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={td}>{fmtDate(e.work_date)}</td>
                    {isCoordinator && <td style={td}>{e.last_name} {e.first_name}</td>}
                    <td style={td}>
                      <span style={{ background: e.color, color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>
                        {e.shift_code}
                      </span>
                    </td>
                    <td style={{ ...td, fontWeight: 'bold', color: '#e65100' }}>{e.overtime_hours}h</td>
                    <td style={td}>{e.reason || '—'}</td>
                    <td style={td}>{e.auth_first ? `${e.auth_first} ${e.auth_last}` : '—'}</td>
                    {isCoordinator && (
                      <td style={td}>
                        <button onClick={() => handleDelete(e.id)}
                          style={{ background: '#d32f2f', color: 'white', border: 'none', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', fontSize: '12px' }}>
                          Elimina
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#f5f5f5', fontWeight: 'bold' }}>
                  <td style={td} colSpan={isCoordinator ? 3 : 2}>Totale {MONTHS[month-1]}</td>
                  <td style={{ ...td, color: '#e65100' }}>{myOvertime.summary?.total_hours_month || 0}h</td>
                  <td style={td} colSpan={isCoordinator ? 3 : 2}>
                    Anno {year}: {myOvertime.summary?.total_hours_year || 0}h
                    {' / '}{myOvertime.summary?.limit_year || '—'}h limite
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* ── TAB RIPOSI DA RECUPERARE ── */}
      {tab === 'rest' && (
        <div style={cardStyle}>
          <h4 style={{ margin: '0 0 12px 0' }}>
            🛌 Riposi da recuperare — {year}
          </h4>
          <div style={{ marginBottom: '12px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ background: '#e8f5e9', padding: '6px 12px', borderRadius: '20px', fontSize: '13px' }}>
              Totale ore pendenti: <strong>{myRest.total_pending_hours}h</strong>
            </span>
            {myRest.overdue_count > 0 && (
              <span style={{ background: '#ffebee', padding: '6px 12px', borderRadius: '20px', fontSize: '13px', color: '#c62828' }}>
                ⚠ <strong>{myRest.overdue_count}</strong> riposi scaduti
              </span>
            )}
          </div>
          {myRest.entries?.length === 0 ? (
            <p style={{ color: '#888' }}>Nessun riposo da recuperare.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: '#f5f5f5' }}>
                  <th style={th}>Maturato il</th>
                  {isCoordinator && <th style={th}>Infermiere</th>}
                  <th style={th}>Motivazione</th>
                  <th style={th}>Ore dovute</th>
                  <th style={th}>Ore recuperate</th>
                  <th style={th}>Ore residue</th>
                  <th style={th}>Scadenza recupero</th>
                  {isCoordinator && <th style={th}></th>}
                </tr>
              </thead>
              <tbody>
                {myRest.entries?.map(e => {
                  const isOverdue = e.recovery_deadline < new Date().toISOString().split('T')[0] && e.hours_pending > 0;
                  return (
                    <tr key={e.id} style={{ borderBottom: '1px solid #eee', background: isOverdue ? '#fff8f8' : 'white' }}>
                      <td style={td}>{fmtDate(e.accrued_date)}</td>
                      {isCoordinator && <td style={td}>{e.last_name} {e.first_name}</td>}
                      <td style={td}>{e.reason}</td>
                      <td style={{ ...td, fontWeight: 'bold' }}>{e.hours_owed}h</td>
                      <td style={{ ...td, color: '#388e3c' }}>{e.hours_recovered}h</td>
                      <td style={{ ...td, color: e.hours_pending > 0 ? '#d32f2f' : '#388e3c', fontWeight: 'bold' }}>
                        {e.hours_pending}h
                      </td>
                      <td style={{ ...td, color: isOverdue ? '#d32f2f' : '#333' }}>
                        {isOverdue ? '⚠ ' : ''}{fmtDate(e.recovery_deadline)}
                      </td>
                      {isCoordinator && (
                        <td style={td}>
                          {e.hours_pending > 0 && (
                            <button onClick={() => handleMarkRecovered(e.id)}
                              style={{ background: '#388e3c', color: 'white', border: 'none', borderRadius: '4px', padding: '3px 8px', cursor: 'pointer', fontSize: '12px' }}>
                              Segna recuperato
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── TAB AGGIUNGI STRAORDINARIO (coordinatore) ── */}
      {tab === 'add' && isCoordinator && (
        <div style={cardStyle}>
          <h4 style={{ margin: '0 0 16px 0' }}>Registra straordinario manuale</h4>
          <p style={{ color: '#666', fontSize: '13px', marginBottom: '16px' }}>
            Usa questo form per registrare un doppio turno per esigenza di servizio.
            Il sistema verifica automaticamente i limiti mensili/annuali e registra il riposo compensativo.
          </p>
          <form onSubmit={handleAddOvertime} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', maxWidth: '600px' }}>
            <div>
              <label style={labelStyle}>Infermiere *</label>
              <select value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}
                required style={inputStyle}>
                <option value="">Seleziona...</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.last_name} {u.first_name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Data *</label>
              <input type="date" value={form.work_date}
                onChange={e => setForm(f => ({ ...f, work_date: e.target.value }))}
                required style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Turno straordinario *</label>
              <select value={form.shift_type_id}
                onChange={e => setForm(f => ({ ...f, shift_type_id: e.target.value }))}
                required style={inputStyle}>
                <option value="">Seleziona...</option>
                {shifts.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name} ({s.duration_hours}h)</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Ore straordinarie *</label>
              <input type="number" min="1" max="12" step="0.5" value={form.overtime_hours}
                onChange={e => setForm(f => ({ ...f, overtime_hours: e.target.value }))}
                required style={inputStyle} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Motivazione / esigenza di servizio</label>
              <input type="text" value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                placeholder="Es: assenza improvvisa collega, emergenza reparto..."
                style={inputStyle} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <button type="submit" className="primary" style={{ padding: '10px 24px', fontSize: '15px' }}>
                ➕ Registra straordinario
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// Helper stili tabella
const th = { padding: '8px 10px', textAlign: 'left', fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', fontSize: '13px' };
const labelStyle = { display: 'block', fontSize: '13px', color: '#555', marginBottom: '4px', fontWeight: 'bold' };
const inputStyle = { width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc', fontSize: '14px', boxSizing: 'border-box' };

function fmtDate(str) {
  if (!str) return '—';
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default OvertimeLog;
