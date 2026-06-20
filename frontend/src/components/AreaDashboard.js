import React, { useState, useEffect } from 'react';
import {
  getAreaDashboard, getAreaGaps, resolveAreaGaps,
  getAreas, createArea, createDepartment, getUsers
} from '../services/api';

function AreaDashboard({ user }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [areas, setAreas] = useState([]);
  const [selectedArea, setSelectedArea] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [gaps, setGaps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [showCreateArea, setShowCreateArea] = useState(false);
  const [newArea, setNewArea] = useState({ name: '', code: '', managerId: '' });
  const [showCreateDept, setShowCreateDept] = useState(false);
  const [newDept, setNewDept] = useState({ name: '', code: '', coordinatorId: '' });
  const [coordinators, setCoordinators] = useState([]);
  const [areaManagers, setAreaManagers] = useState([]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadData(); }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedArea) loadDashboard();
  }, [selectedArea, year, month]);

  async function loadData() {
    try {
      const [a, u] = await Promise.all([getAreas(), getUsers()]);
      setAreas(a.data || []);
      const coords = (u.data || []).filter(x => x.role === 'coordinator');
      setCoordinators(coords);
      const managers = (u.data || []).filter(x => x.role === 'area_manager');
      setAreaManagers(managers);

      // Se l'utente è area_manager, pre-seleziona la sua area
      if (user.role === 'area_manager' && a.data?.length > 0) {
        setSelectedArea(a.data.find(ar => ar.area_manager_id === user.id) || a.data[0]);
      } else if (a.data?.length === 1) {
        setSelectedArea(a.data[0]);
      }
    } catch (e) {
      setError(e.response?.data?.error || 'Errore caricamento dati');
    }
  }

  async function loadDashboard() {
    if (!selectedArea) return;
    setLoading(true);
    setError('');
    try {
      const [dash, gapsRes] = await Promise.all([
        getAreaDashboard(selectedArea.id, year, month),
        getAreaGaps(selectedArea.id, year, month)
      ]);
      setDashboard(dash.data);
      setGaps(gapsRes.data?.gaps || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Errore caricamento dashboard');
    } finally {
      setLoading(false);
    }
  }

  async function handleResolve(dryRun) {
    if (!selectedArea) return;
    setLoading(true);
    setResult(null);
    setError('');
    try {
      const res = await resolveAreaGaps(selectedArea.id, { year, month, dry_run: dryRun });
      setResult(res.data);
      if (!dryRun) await loadDashboard();
    } catch (e) {
      setError(e.response?.data?.error || 'Errore gap-filler');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateArea(e) {
    e.preventDefault();
    setError('');
    try {
      await createArea({
        name: newArea.name,
        code: newArea.code.toUpperCase(),
        area_manager_id: Number(newArea.managerId) || undefined
      });
      setNewArea({ name: '', code: '', managerId: '' });
      setShowCreateArea(false);
      await loadData();
    } catch (e) {
      setError(e.response?.data?.error || 'Errore creazione area');
    }
  }

  async function handleCreateDept(e) {
    e.preventDefault();
    setError('');
    try {
      await createDepartment({
        name: newDept.name,
        code: newDept.code.toUpperCase(),
        coordinator_id: Number(newDept.coordinatorId),
        area_id: selectedArea?.id
      });
      setNewDept({ name: '', code: '', coordinatorId: '' });
      setShowCreateDept(false);
      await loadData();
      if (selectedArea) await loadDashboard();
    } catch (e) {
      setError(e.response?.data?.error || 'Errore creazione reparto');
    }
  }

  const coverageColor = (pct) => pct >= 90 ? '#4caf50' : pct >= 70 ? '#ff9800' : '#f44336';

  return (
    <div>
      <h2>Area Manager</h2>
      {error && <div className="error" style={{ marginBottom: 15 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, marginBottom: 15, flexWrap: 'wrap' }}>
        <select
          value={selectedArea?.id || ''}
          onChange={(e) => setSelectedArea(areas.find(a => a.id === Number(e.target.value)))}
          style={{ padding: 8, minWidth: 220 }}
        >
          <option value="">Seleziona area...</option>
          {areas.map(a => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.code}) — {a.manager_name}
            </option>
          ))}
        </select>

        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 80 }} />
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>
          ))}
        </select>

        <button className="primary" onClick={() => handleResolve(true)} disabled={loading || !selectedArea}>
          Simula gap-filler
        </button>
        <button className="danger" onClick={() => handleResolve(false)} disabled={loading || !selectedArea}>
          Risolvi scoperture
        </button>
      </div>

      {user.role === 'admin' && (
        <div style={{ marginBottom: 15 }}>
          <button onClick={() => setShowCreateArea(!showCreateArea)} style={{ marginRight: 10 }}>
            + Nuova area
          </button>
          <button onClick={() => setShowCreateDept(!showCreateDept)}>
            + Nuovo reparto nell'area
          </button>
        </div>
      )}

      {showCreateArea && (
        <form onSubmit={handleCreateArea} style={{ marginBottom: 15, padding: 15, border: '1px solid #ccc' }}>
          <h4>Crea area</h4>
          <input placeholder="Nome area" value={newArea.name} onChange={(e) => setNewArea({ ...newArea, name: e.target.value })} required style={{ marginRight: 8 }} />
          <input placeholder="Codice" value={newArea.code} onChange={(e) => setNewArea({ ...newArea, code: e.target.value })} required style={{ marginRight: 8 }} />
          <select value={newArea.managerId} onChange={(e) => setNewArea({ ...newArea, managerId: e.target.value })} required style={{ marginRight: 8 }}>
            <option value="">Responsabile area...</option>
            {areaManagers.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
          </select>
          <button className="primary" type="submit">Crea</button>
        </form>
      )}

      {showCreateDept && (
        <form onSubmit={handleCreateDept} style={{ marginBottom: 15, padding: 15, border: '1px solid #ccc' }}>
          <h4>Crea reparto in {selectedArea?.name || 'area selezionata'}</h4>
          <input placeholder="Nome reparto" value={newDept.name} onChange={(e) => setNewDept({ ...newDept, name: e.target.value })} required style={{ marginRight: 8 }} />
          <input placeholder="Codice" value={newDept.code} onChange={(e) => setNewDept({ ...newDept, code: e.target.value })} required style={{ marginRight: 8 }} />
          <select value={newDept.coordinatorId} onChange={(e) => setNewDept({ ...newDept, coordinatorId: e.target.value })} required style={{ marginRight: 8 }}>
            <option value="">Coordinatore...</option>
            {coordinators.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
          </select>
          <button className="primary" type="submit">Crea</button>
        </form>
      )}

      {loading && <div>Caricamento...</div>}

      {result && (
        <div className="card" style={{ marginBottom: 15, background: '#f1f8e9' }}>
          <h4>Risultato gap-filler</h4>
          <p>
            Scoperture totali: <b>{result.total_gaps}</b> —
            Risolte: <b>{result.resolved}</b> —
            Rimanenti: <b>{result.still_uncovered}</b> —
            Copertura: <b>{result.coverage_after}%</b>
            {result.dry_run && <span style={{ color: '#666' }}> (simulazione)</span>}
          </p>
          {result.assignments_added?.length > 0 && (
            <table style={{ width: '100%', fontSize: 14 }}>
              <thead><tr><th>Infermiere</th><th>Reparto</th><th>Giorno</th><th>Turno</th><th>Cross</th></tr></thead>
              <tbody>
                {result.assignments_added.slice(0, 20).map((a, i) => (
                  <tr key={i}>
                    <td>{a.nurse_name}</td>
                    <td>{a.department_name}</td>
                    <td>{a.work_date}</td>
                    <td>{a.shift_code}</td>
                    <td>{a.is_cross ? 'Sì' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {dashboard && (
        <div className="card" style={{ marginBottom: 15 }}>
          <h3>Dashboard {dashboard.area_name || selectedArea?.name} — {month}/{year}</h3>
          <p>
            Reparti: <b>{dashboard.dept_count}</b> —
            Assegnati: <b>{dashboard.total_assigned}</b> —
            Scoperti: <b>{dashboard.total_uncovered}</b>
          </p>
          <table style={{ width: '100%' }}>
            <thead>
              <tr><th>Reparto</th><th>Coordinatore</th><th>Staff</th><th>Stato</th><th>Assegnati</th><th>Scoperti</th><th>Copertura</th></tr>
            </thead>
            <tbody>
              {dashboard.departments.map(d => (
                <tr key={d.department_id}>
                  <td>{d.department_name}</td>
                  <td>{d.coordinator_name}</td>
                  <td>{d.staff_count}</td>
                  <td>{d.schedule_status}</td>
                  <td>{d.assignments_count}</td>
                  <td>{d.uncovered_shifts}</td>
                  <td style={{ color: coverageColor(d.coverage_pct), fontWeight: 'bold' }}>
                    {d.coverage_pct}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gaps.length > 0 && (
        <div className="card">
          <h3>Dettaglio scoperture</h3>
          <table style={{ width: '100%', fontSize: 14 }}>
            <thead>
              <tr><th>Reparto</th><th>Giorno</th><th>Turno</th><th>Necessari</th><th>Assegnati</th><th>Mancanti</th></tr>
            </thead>
            <tbody>
              {gaps.map((g, i) => (
                <tr key={i}>
                  <td>{g.department_name}</td>
                  <td>{String(g.day).padStart(2, '0')}/{String(month).padStart(2, '0')}/{year}</td>
                  <td>{g.shift_code}</td>
                  <td>{g.needed}</td>
                  <td>{g.assigned}</td>
                  <td style={{ color: '#f44336', fontWeight: 'bold' }}>{g.gap}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AreaDashboard;
