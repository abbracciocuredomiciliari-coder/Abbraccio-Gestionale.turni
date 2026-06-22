import React, { useEffect, useState } from 'react';
import { getShifts, updateShift } from '../services/api';

const DAYS_IN_MONTH = 30;

function ShiftRow({ shift, onSaved }) {
  const [requiredStaff, setRequiredStaff] = useState(shift.required_staff);
  const [requiredStaffSaturday, setRequiredStaffSaturday] = useState(
    shift.required_staff_saturday != null ? shift.required_staff_saturday : ''
  );
  const [requiredStaffSunday, setRequiredStaffSunday] = useState(
    shift.required_staff_sunday != null ? shift.required_staff_sunday : ''
  );
  const [requiredStaffHoliday, setRequiredStaffHoliday] = useState(
    shift.required_staff_holiday != null ? shift.required_staff_holiday : ''
  );
  const [shiftCode, setShiftCode] = useState(shift.code);
  const [shiftName, setShiftName] = useState(shift.name);
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
        code: shiftCode.trim().toUpperCase(),
        name: shiftName.trim(),
        required_staff: Number(requiredStaff),
        required_staff_saturday: requiredStaffSaturday !== '' ? Number(requiredStaffSaturday) : null,
        required_staff_sunday:   requiredStaffSunday   !== '' ? Number(requiredStaffSunday)   : null,
        required_staff_holiday:  requiredStaffHoliday  !== '' ? Number(requiredStaffHoliday)  : null,
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
  const numInputStyle = { width: '55px', textAlign: 'center' };
  const placeholderStyle = { color: '#aaa', fontSize: '11px' };

  return (
    <tr style={{ borderBottom: '1px solid #ddd' }}>
      <td style={tdStyle}>
        <input
          value={shiftCode}
          onChange={e => setShiftCode(e.target.value)}
          style={{ width: '52px', textAlign: 'center', fontWeight: 'bold', textTransform: 'uppercase', background: shift.color, color: 'white', border: 'none', borderRadius: '4px', padding: '3px 6px', fontSize: '13px' }}
          maxLength={6}
          title="Sigla turno"
        />
      </td>
      <td style={tdStyle}>
        <input
          value={shiftName}
          onChange={e => setShiftName(e.target.value)}
          style={{ width: '130px' }}
          title="Nome turno"
        />
      </td>
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
          type="number" min="0" max="24"
          value={durationHours}
          onChange={(e) => setDurationHours(e.target.value)}
          style={{ width: '60px' }}
        />
      </td>
      {/* Operatori feriale */}
      <td style={tdStyle}>
        <input
          type="number" min="0" max="20"
          value={requiredStaff}
          onChange={(e) => setRequiredStaff(e.target.value)}
          style={numInputStyle}
          title="Operatori richiesti nei giorni feriali"
        />
      </td>
      {/* Operatori sabato */}
      <td style={tdStyle}>
        <input
          type="number" min="0" max="20"
          value={requiredStaffSaturday}
          onChange={(e) => setRequiredStaffSaturday(e.target.value)}
          style={numInputStyle}
          placeholder="="
          title="Lascia vuoto per usare lo stesso valore dei feriali"
        />
        {requiredStaffSaturday === '' && (
          <div style={placeholderStyle}>come feriale</div>
        )}
      </td>
      {/* Operatori domenica */}
      <td style={tdStyle}>
        <input
          type="number" min="0" max="20"
          value={requiredStaffSunday}
          onChange={(e) => setRequiredStaffSunday(e.target.value)}
          style={numInputStyle}
          placeholder="="
          title="Lascia vuoto per usare lo stesso valore dei feriali"
        />
        {requiredStaffSunday === '' && (
          <div style={placeholderStyle}>come feriale</div>
        )}
      </td>
      {/* Operatori festivi */}
      <td style={tdStyle}>
        <input
          type="number" min="0" max="20"
          value={requiredStaffHoliday}
          onChange={(e) => setRequiredStaffHoliday(e.target.value)}
          style={numInputStyle}
          placeholder="="
          title="Lascia vuoto per usare lo stesso valore dei feriali"
        />
        {requiredStaffHoliday === '' && (
          <div style={placeholderStyle}>come feriale</div>
        )}
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
  const totalFeriale  = activeShifts.reduce((sum, s) => sum + (Number(s.required_staff) || 0), 0);
  const totalSaturday = activeShifts.reduce((sum, s) => sum + (Number(s.required_staff_saturday ?? s.required_staff) || 0), 0);
  const totalSunday   = activeShifts.reduce((sum, s) => sum + (Number(s.required_staff_sunday   ?? s.required_staff) || 0), 0);
  const totalFestivo  = activeShifts.reduce((sum, s) => sum + (Number(s.required_staff_holiday  ?? s.required_staff) || 0), 0);

  return (
    <div>
      {/* Riepilogo impatto sulla generazione */}
      <div className="card" style={{ background: '#e3f2fd', border: '1px solid #90caf9', marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 10px 0', color: '#1565c0' }}>📊 Riepilogo — cosa verrà generato</h4>

        {/* Feriale */}
        <p style={{ margin: '0 0 6px 0', color: '#1976d2', fontSize: '13px', fontWeight: 'bold' }}>
          📅 Giorni feriali
        </p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
          {activeShifts.map(s => (
            <span key={s.id} style={{
              padding: '4px 10px', borderRadius: '20px', fontSize: '13px',
              background: s.color, color: 'white', fontWeight: 'bold'
            }}>
              {s.code} — {s.required_staff} op.
            </span>
          ))}
          {activeShifts.length === 0 && <span style={{ color: '#c62828' }}>⚠ Nessun turno attivo!</span>}
        </div>

        {/* Sabato */}
        <p style={{ margin: '0 0 6px 0', color: '#6a1b9a', fontSize: '13px', fontWeight: 'bold' }}>
          📅 Sabato
        </p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
          {activeShifts.map(s => {
            const n = s.required_staff_saturday != null ? s.required_staff_saturday : s.required_staff;
            return (
              <span key={s.id} style={{
                padding: '4px 10px', borderRadius: '20px', fontSize: '13px',
                background: s.color, color: 'white', fontWeight: 'bold',
                opacity: s.required_staff_saturday == null ? 0.65 : 1
              }}>
                {s.code} — {n} op.{s.required_staff_saturday == null ? ' (=feriale)' : ''}
              </span>
            );
          })}
        </div>

        {/* Domenica */}
        <p style={{ margin: '0 0 6px 0', color: '#4527a0', fontSize: '13px', fontWeight: 'bold' }}>
          📅 Domenica
        </p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
          {activeShifts.map(s => {
            const n = s.required_staff_sunday != null ? s.required_staff_sunday : s.required_staff;
            return (
              <span key={s.id} style={{
                padding: '4px 10px', borderRadius: '20px', fontSize: '13px',
                background: s.color, color: 'white', fontWeight: 'bold',
                opacity: s.required_staff_sunday == null ? 0.65 : 1
              }}>
                {s.code} — {n} op.{s.required_staff_sunday == null ? ' (=feriale)' : ''}
              </span>
            );
          })}
        </div>

        {/* Festivi */}
        <p style={{ margin: '0 0 6px 0', color: '#bf360c', fontSize: '13px', fontWeight: 'bold' }}>
          🎉 Giorni festivi
        </p>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
          {activeShifts.map(s => {
            const n = s.required_staff_holiday != null ? s.required_staff_holiday : s.required_staff;
            return (
              <span key={s.id} style={{
                padding: '4px 10px', borderRadius: '20px', fontSize: '13px',
                background: s.color, color: 'white', fontWeight: 'bold',
                opacity: s.required_staff_holiday == null ? 0.65 : 1
              }}>
                {s.code} — {n} op.{s.required_staff_holiday == null ? ' (=feriale)' : ''}
              </span>
            );
          })}
        </div>

        <div style={{ fontSize: '12px', color: '#555', borderTop: '1px solid #b3d4f5', paddingTop: '8px', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          <span>Feriale: <strong>{totalFeriale}</strong> op/giorno</span>
          <span>Sabato: <strong>{totalSaturday}</strong> op/giorno</span>
          <span>Domenica: <strong>{totalSunday}</strong> op/giorno</span>
          <span>Festivo: <strong>{totalFestivo}</strong> op/giorno</span>
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
                <th style={{ padding: '8px', textAlign: 'center' }}>Op. Feriale</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>Op. Sabato</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>Op. Domenica</th>
                <th style={{ padding: '8px', textAlign: 'center' }}>Op. Festivi</th>
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
