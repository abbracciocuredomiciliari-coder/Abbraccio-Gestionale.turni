import React, { useEffect, useState } from 'react';
import { getSchedule, generateSchedule, publishSchedule, getShifts } from '../services/api';

const MONTHS = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                 'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

function Schedule({ isCoordinator }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [schedule, setSchedule] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState(null);
  const [activeShifts, setActiveShifts] = useState([]);

  useEffect(() => {
    getShifts().then(res => {
      setActiveShifts(res.data.filter(s => s.is_active === 1 && s.code !== 'R'));
    }).catch(() => {});
  }, []);

  const showMsg = (text, type) => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 5000);
  };

  // Carica il planning ogni volta che cambiano anno o mese
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setSchedule(null);
      setAssignments([]);
      try {
        const res = await getSchedule(year, month);
        setSchedule(res.data.schedule);
        setAssignments(res.data.assignments);
      } catch (err) {
        // 404 = nessun planning per questo mese, non è un errore
        if (err.response?.status !== 404) {
          showMsg('Errore caricamento: ' + (err.response?.data?.error || err.message), 'error');
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [year, month]);

  const prevMonth = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setMsg(null);
    try {
      const res = await generateSchedule({ year: Number(year), month: Number(month) });
      showMsg(`Planning ${MONTHS[month-1]} ${year} generato: ${res.data.assignments_count} assegnazioni`, 'success');
      // Ricarica subito le assegnazioni
      const res2 = await getSchedule(year, month);
      setSchedule(res2.data.schedule);
      setAssignments(res2.data.assignments);
    } catch (err) {
      showMsg('Errore: ' + (err.response?.data?.error || err.message), 'error');
      console.error(err);
    } finally {
      setGenerating(false);
    }
  };

  const handlePublish = async () => {
    if (!schedule) return;
    try {
      await publishSchedule(schedule.id);
      showMsg('Planning pubblicato!', 'success');
      setSchedule(s => ({ ...s, status: 'published' }));
    } catch (err) {
      showMsg('Errore pubblicazione: ' + (err.response?.data?.error || err.message), 'error');
    }
  };

  const groupedByDate = assignments.reduce((acc, a) => {
    if (!acc[a.work_date]) acc[a.work_date] = [];
    acc[a.work_date].push(a);
    return acc;
  }, {});
  const dates = Object.keys(groupedByDate).sort();

  const navBtn = { background: 'none', border: '1px solid #ccc', borderRadius: '4px', padding: '4px 12px', cursor: 'pointer', fontSize: '18px' };
  const msgStyle = (type) => ({
    padding: '10px 16px', marginBottom: '16px', borderRadius: '6px', fontWeight: 'bold',
    background: type === 'success' ? '#e8f5e9' : '#ffebee',
    color: type === 'success' ? '#2e7d32' : '#c62828',
    border: `1px solid ${type === 'success' ? '#a5d6a7' : '#ef9a9a'}`
  });

  return (
    <div className="card">
      <h3>Planning turni</h3>

      {/* Barra turni attivi configurati */}
      {activeShifts.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: '#666', marginRight: '4px' }}>Turni attivi:</span>
          {activeShifts.map(s => (
            <span key={s.id} style={{
              padding: '3px 10px', borderRadius: '20px', fontSize: '12px',
              background: s.color, color: 'white', fontWeight: 'bold'
            }}>
              {s.code} {s.required_staff} op.
            </span>
          ))}
          {isCoordinator && (
            <span style={{ fontSize: '12px', color: '#1976d2', marginLeft: '4px' }}>
              — vai in <strong>Turni</strong> per modificare la configurazione
            </span>
          )}
        </div>
      )}

      {/* Navigazione mese */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button style={navBtn} onClick={prevMonth}>&#8592;</button>
        <span style={{ fontSize: '20px', fontWeight: 'bold', minWidth: '180px', textAlign: 'center' }}>
          {MONTHS[month - 1]} {year}
        </span>
        <button style={navBtn} onClick={nextMonth}>&#8594;</button>

        {isCoordinator && (
          <>
            <button
              className="primary"
              onClick={handleGenerate}
              disabled={generating}
              style={{ marginLeft: '16px', minWidth: '160px', padding: '8px 16px', fontSize: '15px' }}
            >
              {generating ? '⏳ Generazione...' : `🗓 Genera ${MONTHS[month-1]}`}
            </button>
            {schedule && schedule.status === 'draft' && (
              <button
                className="success"
                onClick={handlePublish}
                style={{ minWidth: '140px', padding: '8px 16px', fontSize: '15px' }}
              >
                ✅ Pubblica
              </button>
            )}
          </>
        )}

        {schedule && (
          <span style={{
            padding: '4px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: 'bold',
            background: schedule.status === 'published' ? '#4CAF50' : '#FF9800',
            color: 'white'
          }}>
            {schedule.status === 'published' ? 'Pubblicato' : 'Bozza'} — {assignments.length} turni
          </span>
        )}
      </div>

      {/* Messaggi */}
      {msg && <div style={msgStyle(msg.type)}>{msg.type === 'success' ? '✓ ' : '✗ '}{msg.text}</div>}

      {/* Contenuto */}
      {loading && <p style={{ color: '#888' }}>Caricamento...</p>}
      {generating && <p style={{ color: '#1976d2' }}>Generazione planning in corso, attendere...</p>}

      {!loading && !generating && dates.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#888', background: '#f9f9f9', borderRadius: '8px' }}>
          <div style={{ fontSize: '40px', marginBottom: '8px' }}>📅</div>
          <div style={{ fontSize: '16px' }}>
            Nessun planning per {MONTHS[month-1]} {year}
          </div>
          {isCoordinator && (
            <div style={{ marginTop: '8px', fontSize: '13px' }}>
              Clicca <strong>Genera {MONTHS[month-1]}</strong> per crearlo automaticamente
            </div>
          )}
        </div>
      )}

      {!loading && dates.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '8px' }}>
          {dates.map((date) => {
            const d = new Date(date + 'T00:00:00');
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            return (
              <div key={date} style={{
                border: `1px solid ${isWeekend ? '#ffcc80' : '#e0e0e0'}`,
                borderRadius: '6px', padding: '8px',
                background: isWeekend ? '#fff8e1' : '#fafafa'
              }}>
                <div style={{ fontSize: '12px', fontWeight: 'bold', color: isWeekend ? '#e65100' : '#333', marginBottom: '4px' }}>
                  {d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })}
                </div>
                {groupedByDate[date].map((a) => (
                  <div key={a.id} style={{
                    background: a.color, color: 'white',
                    padding: '2px 6px', marginTop: '3px', borderRadius: '3px',
                    fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }} title={`${a.shift_name} — ${a.first_name} ${a.last_name}`}>
                    <strong>{a.shift_code}</strong> {a.first_name} {a.last_name}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Schedule;
