import React, { useEffect, useState } from 'react';
import { getShifts, updateShift } from '../services/api';

const DAYS_IN_MONTH = 30;

function ShiftRow({ shift, onSaved }) {
  const [requiredStaff, setRequiredStaff] = useState(shift.required_staff);
  const [durationHours, setDurationHours] = useState(shift.duration_hours);
  const [startTime, setStartTime] = useState(shift.start_time);
  const [endTime, setEndTime] = useState(shift.end_time);
  const [isActive, setIsActive] = useState(shift.is_active === 1);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      await updateShift(shift.id, {
        required_staff: Number(requiredStaff),
        duration_hours: Number(durationHours),
        start_time: startTime,
        end_time: endTime,
        is_active: isActive ? 1 : 0
      });
      setMessage('Salvato!');
      setTimeout(() => setMessage(''), 2500);
      if (onSaved) onSaved();
    } catch (err) {
      console.error(err);
      setMessage('Errore nel salvataggio');
    } finally {
      setSaving(false);
    }
  };

  const tdStyle = { padding: '8px', verticalAlign: 'middle' };

  return (
    <tr style={{ borderBottom: '1px solid #ddd' }}>
      <td style={tdStyle}>
        <span style={{
          display: 'inline-block',
          padding: '3px 8px',
          borderRadius: '4px',
          background: shift.color,
          color: 'white',
          fontWeight: 'bold',
          fontSize: '13px'
        }}>{shift.code}</span>
      </td>
      <td style={tdStyle}>{shift.name}</td>
      <td style={tdStyle}>
        <input
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          style={{ width: '90px', marginRight: '4px' }}
        />
        <span> - </span>
        <input
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          style={{ width: '90px', marginLeft: '4px' }}
        />
      </td>
      <td style={tdStyle}>
        <input
          type="number"
          min="0"
          max="24"
          value={durationHours}
          onChange={(e) => setDurationHours(e.target.value)}
          style={{ width: '60px' }}
        />
      </td>
      <td style={tdStyle}>
        <input
          type="number"
          min="0"
          max="20"
          value={requiredStaff}
          onChange={(e) => setRequiredStaff(e.target.value)}
          style={{ width: '60px' }}
        />
      </td>
      <td style={tdStyle}>
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
        />
      </td>
      <td style={tdStyle}>
        <button
          className="primary"
          onClick={handleSave}
          disabled={saving}
          style={{ minWidth: '70px' }}
        >
          {saving ? '...' : 'Salva'}
        </button>
        {message && (
          <span style={{
            marginLeft: '8px',
            color: message === 'Salvato!' ? '#4CAF50' : '#d32f2f',
            fontSize: '12px',
            fontWeight: 'bold'
          }}>
            {message}
          </span>
        )}
      </td>
    </tr>
  );
}

function ShiftConfig() {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadShifts();
  }, []);

  const loadShifts = async () => {
    try {
      const res = await getShifts();
      setShifts(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div style={{ padding: '20px' }}>Caricamento...</div>;

  const activeShifts = shifts.filter(s => s.is_active === 1 && s.code !== 'R');
  const totalPerDay = activeShifts.reduce((sum, s) => sum + (Number(s.required_staff) || 0), 0);
  const totalPerMonth = totalPerDay * DAYS_IN_MONTH;

  return (
    <div>
      {/* Riepilogo impatto sulla generazione */}
      <div className="card" style={{ background: '#e3f2fd', border: '1px solid #90caf9', marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 10px 0', color: '#1565c0' }}>📊 Riepilogo — cosa verrà generato</h4>
        <p style={{ margin: '0 0 8px 0', color: '#1976d2', fontSize: '14px' }}>
          Turni attivi che verranno assegnati ogni giorno:
        </p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {activeShifts.map(s => (
            <span key={s.id} style={{
              padding: '5px 12px', borderRadius: '20px', fontSize: '13px',
              background: s.color, color: 'white', fontWeight: 'bold'
            }}>
              {s.code} — {s.required_staff} operatori/giorno
            </span>
          ))}
          {activeShifts.length === 0 && (
            <span style={{ color: '#c62828' }}>⚠ Nessun turno attivo! Il planning sarà vuoto.</span>
          )}
        </div>
        <div style={{ fontSize: '13px', color: '#555' }}>
          <strong>{totalPerDay}</strong> assegnazioni/giorno →
          <strong> ~{totalPerMonth}</strong> assegnazioni su 30 giorni
        </div>
      </div>

      <div className="card">
        <h3>Configurazione turni</h3>
        <p style={{ color: '#666', fontSize: '14px' }}>
          Modifica orari, durata e operatori per ogni turno, poi clicca <strong>Salva</strong>. Le modifiche si applicano alla prossima generazione planning.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#eee' }}>
                <th style={{ padding: '8px', textAlign: 'left' }}>Turno</th>
                <th style={{ padding: '8px', textAlign: 'left' }}>Nome</th>
                <th style={{ padding: '8px', textAlign: 'left' }}>Inizio — Fine</th>
                <th style={{ padding: '8px', textAlign: 'left' }}>Ore</th>
                <th style={{ padding: '8px', textAlign: 'left' }}>Operatori/giorno</th>
                <th style={{ padding: '8px', textAlign: 'left' }}>Attivo</th>
                <th style={{ padding: '8px', textAlign: 'left' }}></th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <ShiftRow key={s.id} shift={s} onSaved={loadShifts} />
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ marginTop: '12px', fontSize: '12px', color: '#888' }}>
          💡 Disattiva un turno per escluderlo dalla generazione automatica. Il turno R (Riposo) non viene mai assegnato automaticamente.
        </p>
      </div>
    </div>
  );
}

export default ShiftConfig;
