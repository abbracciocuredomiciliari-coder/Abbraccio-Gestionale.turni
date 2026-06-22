import React, { useEffect, useState } from 'react';
import { getSchedule, generateSchedule, publishSchedule, getShifts, patchAssignment, deleteSchedule } from '../services/api';

const MONTHS = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                 'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

const SHIFT_COLORS = {
  'M':   { bg: '#dbeafe', color: '#1e40af' },
  'P':   { bg: '#dcfce7', color: '#166534' },
  'MP':  { bg: '#fef9c3', color: '#854d0e' },
  'N':   { bg: '#ede9fe', color: '#5b21b6' },
  'N1':  { bg: '#f3e8ff', color: '#6b21a8' },
  'N12': { bg: '#f3e8ff', color: '#6b21a8' },
  'G':   { bg: '#ffedd5', color: '#9a3412' },
  'G12': { bg: '#ffedd5', color: '#9a3412' },
  'S':   { bg: '#fef3c7', color: '#92400e' },
  'R':   { bg: '#f1f5f9', color: '#94a3b8' },
  'CO':  { bg: '#d1fae5', color: '#065f46' },
  'CS':  { bg: '#fce7f3', color: '#9d174d' },
};

function Schedule({ isCoordinator, user }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [schedule, setSchedule] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState(null);
  const [activeShifts, setActiveShifts] = useState([]);
  const [allShifts, setAllShifts] = useState([]);
  const [editCell, setEditCell] = useState(null); // {op, dateStr, assignmentId}

  useEffect(() => {
    getShifts().then(res => {
      setAllShifts(res.data.filter(s => s.is_active === 1));
      setActiveShifts(res.data.filter(s => s.is_active === 1 && s.code !== 'R'));
    }).catch(() => {});
  }, []);

  const showMsg = (text, type) => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 5000);
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setSchedule(null);
      setAssignments([]);
      try {
        const res = await getSchedule(year, month, user?.department_id);
        setSchedule(res.data.schedule);
        setAssignments(res.data.assignments);
      } catch (err) {
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
    try {
      const res = await generateSchedule({ year: Number(year), month: Number(month), department_id: user?.department_id || undefined });
      showMsg(`Planning generato: ${res.data.assignments_count} assegnazioni`, 'success');
      const res2 = await getSchedule(year, month, user?.department_id);
      setSchedule(res2.data.schedule);
      setAssignments(res2.data.assignments);
    } catch (err) {
      showMsg('Errore generazione: ' + (err.response?.data?.error || err.message), 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Cancellare il planning di ${MONTHS[month-1]} ${year}? L'operazione è irreversibile.`)) return;
    try {
      await deleteSchedule(year, month, user?.department_id);
      setSchedule(null);
      setAssignments([]);
      showMsg('Planning cancellato', 'success');
    } catch (err) {
      showMsg('Errore cancellazione: ' + (err.response?.data?.error || err.message), 'error');
    }
  };

  const handlePublish = async () => {
    try {
      await publishSchedule(schedule.id);
      setSchedule(s => ({ ...s, status: 'published' }));
      showMsg('Planning pubblicato', 'success');
    } catch (err) {
      showMsg('Errore pubblicazione: ' + (err.response?.data?.error || err.message), 'error');
    }
  };

  const handleCellChange = async (op, dateStr, newShiftId) => {
    if (!schedule) return;
    try {
      await patchAssignment(schedule.id, {
        user_id: op.id,
        work_date: dateStr,
        shift_type_id: newShiftId || null,
      });
      // Aggiorna localmente
      const key = `${op.id}_${dateStr}`;
      if (!newShiftId) {
        setAssignments(prev => prev.filter(a => !(a.user_id === op.id && a.work_date === dateStr)));
      } else {
        const newShift = allShifts.find(s => s.id === Number(newShiftId));
        setAssignments(prev => {
          const filtered = prev.filter(a => !(a.user_id === op.id && a.work_date === dateStr));
          return [...filtered, {
            user_id: op.id, work_date: dateStr,
            shift_code: newShift?.code, shift_name: newShift?.name,
            first_name: op.first_name, last_name: op.last_name,
          }];
        });
      }
    } catch (err) {
      showMsg('Errore salvataggio: ' + (err.response?.data?.error || err.message), 'error');
    }
    setEditCell(null);
  };

  const daysInMonth = new Date(year, month, 0).getDate();

  // Ricava lista operatori univoci dalle assegnazioni
  const operators = [...new Map(
    assignments.map(a => [a.user_id, { id: a.user_id, first_name: a.first_name, last_name: a.last_name }])
  ).values()].sort((a, b) => a.last_name?.localeCompare(b.last_name));

  // Mappa user_id+data → turno
  const assignmentMap = {};
  assignments.forEach(a => {
    assignmentMap[`${a.user_id}_${a.work_date}`] = a;
  });

  return (
    <div className="space-y-6">
      {/* Header con controlli */}
      <div className="bg-white rounded-xl shadow-soft p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-secondary-800">📅 Planning Turni</h2>
            <p className="text-secondary-600 mt-1">
              {schedule ? (
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${schedule.status === 'published' ? 'bg-success-100 text-success-700' : 'bg-warning-100 text-warning-700'}`}>
                  {schedule.status === 'published' ? 'Pubblicato' : 'Bozza'}
                </span>
              ) : (
                <span className="text-secondary-500">Nessun planning</span>
              )}
            </p>
          </div>

          <div className="flex items-center space-x-3">
            {/* Navigazione mese */}
            <div className="flex items-center bg-secondary-100 rounded-lg p-1">
              <button
                onClick={prevMonth}
                className="p-2 rounded-md hover:bg-white transition-colors"
                title="Mese precedente"
              >
                <svg className="w-5 h-5 text-secondary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="px-4 py-1">
                <span className="font-semibold text-secondary-900">
                  {MONTHS[month - 1]} {year}
                </span>
              </div>
              <button
                onClick={nextMonth}
                className="p-2 rounded-md hover:bg-white transition-colors"
                title="Mese successivo"
              >
                <svg className="w-5 h-5 text-secondary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* Azioni coordinator */}
            {isCoordinator && (
              <div className="flex space-x-2">
                <button
                  onClick={handleGenerate}
                  disabled={generating || loading}
                  className="flex items-center px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold rounded-xl shadow-soft transition-all disabled:opacity-50"
                >
                  {generating ? (
                    <span className="flex items-center">
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Generazione...
                    </span>
                  ) : (
                    <span className="flex items-center">
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Genera
                    </span>
                  )}
                </button>
                {schedule && schedule.status !== 'published' && (
                  <button
                    onClick={handlePublish}
                    className="flex items-center px-4 py-2 bg-success-500 hover:bg-success-600 text-white text-sm font-semibold rounded-xl shadow-soft transition-all"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Pubblica
                  </button>
                )}
                {schedule && (
                  <button
                    onClick={handleDelete}
                    className="flex items-center px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-xl shadow-soft transition-all"
                    title="Cancella il planning del mese selezionato"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Cancella
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messaggi */}
      {msg && (
        <div className={`p-4 rounded-lg flex items-center ${
          msg.type === 'error' 
            ? 'bg-error-50 border border-error-200 text-error-800' 
            : 'bg-success-50 border border-success-200 text-success-800'
        }`}>
          <svg className="w-5 h-5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {msg.type === 'error' ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            )}
          </svg>
          <span className="font-medium">{msg.text}</span>
        </div>
      )}

      {/* Calendario */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-soft p-12">
          <div className="flex flex-col items-center justify-center">
            <div className="loading-spinner w-8 h-8 mb-4"></div>
            <p className="text-secondary-600">Caricamento planning...</p>
          </div>
        </div>
      ) : !schedule ? (
        <div className="bg-white rounded-xl shadow-soft p-12">
          <div className="text-center">
            <div className="w-16 h-16 bg-secondary-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-secondary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-secondary-900 mb-2">Nessun planning disponibile</h3>
            <p className="text-secondary-600 mb-6">
              Non esiste un planning per {MONTHS[month - 1]} {year}
            </p>
            {isCoordinator && (
              <button onClick={handleGenerate} disabled={generating} className="px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold rounded-xl shadow-soft transition-all disabled:opacity-50">
                Genera planning
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-soft overflow-hidden">

          {/* Legenda */}
          <div className="border-b border-secondary-200 p-3">
            <div className="flex flex-wrap gap-2">
              {[...activeShifts,
                { code: 'R',  name: 'Riposo'  },
                { code: 'CO', name: 'Ferie'   },
                { code: 'CS', name: 'Congedo' }
              ].map(shift => {
                const c = SHIFT_COLORS[shift.code] || { bg: '#f1f5f9', color: '#64748b' };
                return (
                  <span key={shift.code}
                    style={{ background: c.bg, color: c.color, border: `1px solid ${c.color}55` }}
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold">
                    {shift.code}
                    <span className="font-normal ml-1 opacity-75">— {shift.name}</span>
                  </span>
                );
              })}
            </div>
          </div>

          {/* Griglia stile Excel: operatori × giorni */}
          <div className="overflow-x-auto">
            <table style={{ borderCollapse: 'collapse', fontSize: '12px', minWidth: '100%' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {/* Intestazione colonna nomi */}
                  <th style={{
                    position: 'sticky', left: 0, zIndex: 2,
                    background: '#f8fafc', minWidth: '140px',
                    padding: '5px 10px', textAlign: 'left',
                    borderRight: '2px solid #e2e8f0',
                    borderBottom: '2px solid #e2e8f0',
                    fontSize: '11px', color: '#64748b',
                    textTransform: 'uppercase', letterSpacing: '0.05em'
                  }}>
                    Operatore
                  </th>
                  {/* Intestazione ogni giorno */}
                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                    const date = new Date(year, month - 1, day);
                    const dow = date.getDay();
                    const isSat = dow === 6;
                    const isSun = dow === 0;
                    const isToday = date.getDate() === now.getDate() &&
                      date.getMonth() === now.getMonth() &&
                      date.getFullYear() === now.getFullYear();
                    return (
                      <th key={day} style={{
                        minWidth: '30px', width: '30px', padding: '3px 1px',
                        textAlign: 'center',
                        borderBottom: '2px solid #e2e8f0',
                        borderLeft: '1px solid #e2e8f0',
                        background: isToday ? '#dbeafe' : isSun ? '#fce7f3' : isSat ? '#ede9fe' : '#f8fafc',
                        color: isToday ? '#1d4ed8' : isSun ? '#be185d' : isSat ? '#7c3aed' : '#64748b',
                        fontWeight: isToday ? '800' : '600',
                      }}>
                        <div style={{ fontSize: '9px', lineHeight: 1 }}>
                          {['D','L','M','M','G','V','S'][dow]}
                        </div>
                        <div style={{ fontSize: '11px', lineHeight: 1.5 }}>{day}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {operators.length === 0 ? (
                  <tr>
                    <td colSpan={daysInMonth + 1}
                      style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
                      Nessun operatore nel planning
                    </td>
                  </tr>
                ) : operators.map((op, opIdx) => {
                  const rowBg = opIdx % 2 === 0 ? '#ffffff' : '#f8fafc';
                  return (
                    <tr key={op.id} style={{ background: rowBg }}>
                      {/* Nome operatore — colonna fissa */}
                      <td style={{
                        position: 'sticky', left: 0, zIndex: 1,
                        background: rowBg,
                        padding: '4px 10px',
                        borderRight: '2px solid #e2e8f0',
                        borderBottom: '1px solid #f1f5f9',
                        fontWeight: '600', color: '#1e293b',
                        whiteSpace: 'nowrap', minWidth: '140px',
                      }}>
                        {op.last_name} {op.first_name?.charAt(0)}.
                      </td>
                      {/* Cella turno per ogni giorno */}
                      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                        const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                        const asgn = assignmentMap[`${op.id}_${dateStr}`];
                        const code = asgn?.shift_code || '';
                        const c = SHIFT_COLORS[code] || null;
                        const date = new Date(year, month - 1, day);
                        const dow = date.getDay();
                        const isToday = date.getDate() === now.getDate() &&
                          date.getMonth() === now.getMonth() &&
                          date.getFullYear() === now.getFullYear();
                        const isEditing = editCell?.opId === op.id && editCell?.dateStr === dateStr;
                        return (
                          <td key={day} style={{
                            textAlign: 'center', padding: '2px 1px',
                            borderBottom: '1px solid #f1f5f9',
                            borderLeft: '1px solid #f1f5f9',
                            background: isToday ? '#eff6ff44'
                              : dow === 0 ? '#fce7f322'
                              : dow === 6 ? '#ede9fe22'
                              : 'transparent',
                            position: 'relative',
                          }}>
                            {isCoordinator && isEditing ? (
                              <select
                                autoFocus
                                defaultValue={allShifts.find(s => s.code === code)?.id || ''}
                                onChange={e => handleCellChange(op, dateStr, e.target.value)}
                                onBlur={() => setEditCell(null)}
                                style={{
                                  fontSize: '11px', border: '2px solid #3b82f6',
                                  borderRadius: '4px', padding: '1px 2px',
                                  background: '#fff', cursor: 'pointer',
                                  minWidth: '52px', zIndex: 10,
                                }}
                              >
                                <option value="">— libero —</option>
                                {allShifts.map(s => (
                                  <option key={s.id} value={s.id}>{s.code} – {s.name}</option>
                                ))}
                              </select>
                            ) : (
                              <span
                                onClick={() => isCoordinator && setEditCell({ opId: op.id, dateStr })}
                                title={isCoordinator ? 'Clicca per cambiare turno' : ''}
                                style={{
                                  display: 'inline-block',
                                  padding: '1px 3px',
                                  borderRadius: '3px',
                                  background: c?.bg || (code ? '#f1f5f9' : 'transparent'),
                                  color: c?.color || '#64748b',
                                  fontWeight: code ? '700' : '400',
                                  fontSize: '11px',
                                  lineHeight: '16px',
                                  minWidth: '22px',
                                  cursor: isCoordinator ? 'pointer' : 'default',
                                }}>
                                {code || <span style={{ color: '#e2e8f0' }}>·</span>}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="border-t border-secondary-200 p-3 bg-secondary-50">
            <div className="flex flex-wrap gap-6 text-xs text-secondary-600">
              <span><span className="font-medium">Operatori:</span> {operators.length}</span>
              <span><span className="font-medium">Assegnazioni:</span> {assignments.length}</span>
              <span><span className="font-medium">Giorni:</span> {daysInMonth}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Schedule;
