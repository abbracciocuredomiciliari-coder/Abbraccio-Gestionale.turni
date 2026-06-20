import React, { useEffect, useState } from 'react';
import { getWorkRules, updateWorkRule } from '../services/api';

const RULE_LABELS = {
  max_hours_per_week:          { label: 'Ore max settimanali',                unit: 'h',  note: 'CCNL Comparto Sanità: 36h' },
  max_hours_per_day_normal:    { label: 'Ore max turno normale',              unit: 'h',  note: 'Standard 8h' },
  max_hours_per_day_overtime:  { label: 'Ore max con straordinario (giorno)', unit: 'h',  note: 'Doppio turno massimo: 12h' },
  min_rest_between_shifts:     { label: 'Riposo minimo tra turni',            unit: 'h',  note: 'DLgs 66/2003: minimo 11h' },
  max_consecutive_days:        { label: 'Giorni lavorativi max consecutivi',  unit: 'gg', note: 'Dopo questo numero scatta riposo obbligatorio' },
  min_rest_days_per_week:      { label: 'Giorni di riposo minimi a settimana',unit: 'gg', note: 'Di norma 1 giorno/settimana' },
  max_overtime_hours_month:    { label: 'Ore straordinario max al mese',      unit: 'h',  note: 'CCNL: 25h/mese' },
  max_overtime_hours_year:     { label: 'Ore straordinario max annuali',      unit: 'h',  note: 'CCNL: 250h/anno' },
  rest_recovery_expiry_months: { label: 'Mesi per recuperare riposi',         unit: 'mesi', note: 'Entro questo periodo i riposi compensativi devono essere goduti' },
};

const GROUPS = [
  {
    title: '⏰ Orario di lavoro (CCNL Comparto Sanità)',
    keys: ['max_hours_per_week', 'max_hours_per_day_normal', 'max_hours_per_day_overtime', 'min_rest_between_shifts', 'max_consecutive_days', 'min_rest_days_per_week']
  },
  {
    title: '📋 Limiti straordinari (indicazione datore di lavoro)',
    keys: ['max_overtime_hours_month', 'max_overtime_hours_year']
  },
  {
    title: '🛌 Recupero riposi',
    keys: ['rest_recovery_expiry_months']
  }
];

function WorkRules() {
  const [rules, setRules] = useState([]);
  const [editing, setEditing] = useState({}); // key -> valore in editing
  const [saving, setSaving] = useState({});
  const [msgs, setMsgs] = useState({});

  useEffect(() => {
    getWorkRules().then(res => setRules(res.data)).catch(console.error);
  }, []);

  const ruleMap = Object.fromEntries(rules.map(r => [r.rule_key, r]));

  const handleEdit = (key, val) => {
    setEditing(e => ({ ...e, [key]: val }));
  };

  const handleSave = async (key) => {
    const val = editing[key];
    if (val === undefined || val === '') return;
    setSaving(s => ({ ...s, [key]: true }));
    try {
      await updateWorkRule(key, Number(val));
      setRules(prev => prev.map(r => r.rule_key === key ? { ...r, rule_value: Number(val) } : r));
      setEditing(e => { const n = { ...e }; delete n[key]; return n; });
      setMsgs(m => ({ ...m, [key]: 'success' }));
      setTimeout(() => setMsgs(m => { const n = { ...m }; delete n[key]; return n; }), 2000);
    } catch (err) {
      setMsgs(m => ({ ...m, [key]: 'error' }));
    } finally {
      setSaving(s => ({ ...s, [key]: false }));
    }
  };

  const cardStyle = { background: '#fff', borderRadius: '8px', padding: '16px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' };

  return (
    <div>
      <div style={{ background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px' }}>
        <strong>⚠ Attenzione:</strong> queste impostazioni regolano la pianificazione dei turni e il calcolo degli straordinari per tutto il personale infermieristico.
        Modificarle ha effetto immediato sulle prossime generazioni di planning e sui controlli dei limiti.
        I valori di default rispettano il <strong>CCNL Comparto Sanità</strong> e il <strong>DLgs 66/2003</strong>.
      </div>

      {GROUPS.map(group => (
        <div key={group.title} style={cardStyle}>
          <h4 style={{ margin: '0 0 16px 0', color: '#1565c0' }}>{group.title}</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f5f5f5' }}>
                <th style={th}>Parametro</th>
                <th style={th}>Valore attuale</th>
                <th style={th}>Modifica</th>
                <th style={th}>Note</th>
              </tr>
            </thead>
            <tbody>
              {group.keys.map(key => {
                const rule = ruleMap[key];
                if (!rule) return null;
                const meta = RULE_LABELS[key] || {};
                const isEditing = editing[key] !== undefined;
                const isSaving = saving[key];
                const msgState = msgs[key];

                return (
                  <tr key={key} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={td}>
                      <div style={{ fontWeight: 'bold', fontSize: '13px' }}>{meta.label || key}</div>
                    </td>
                    <td style={{ ...td, fontWeight: 'bold', color: '#1976d2', fontSize: '16px' }}>
                      {rule.rule_value} <span style={{ fontSize: '12px', color: '#888' }}>{meta.unit}</span>
                      {rule.first_name && (
                        <div style={{ fontSize: '11px', color: '#999' }}>
                          Modificato da {rule.first_name} {rule.last_name}
                        </div>
                      )}
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={isEditing ? editing[key] : rule.rule_value}
                          onChange={e => handleEdit(key, e.target.value)}
                          style={{ width: '80px', padding: '6px', borderRadius: '4px', border: '1px solid #ccc', fontSize: '14px' }}
                        />
                        <span style={{ fontSize: '12px', color: '#888' }}>{meta.unit}</span>
                        {isEditing && (
                          <button
                            onClick={() => handleSave(key)}
                            disabled={isSaving}
                            style={{ background: '#1976d2', color: 'white', border: 'none', borderRadius: '4px', padding: '6px 12px', cursor: 'pointer', fontSize: '13px' }}
                          >
                            {isSaving ? '...' : 'Salva'}
                          </button>
                        )}
                        {msgState === 'success' && <span style={{ color: '#388e3c', fontSize: '18px' }}>✓</span>}
                        {msgState === 'error' && <span style={{ color: '#d32f2f', fontSize: '18px' }}>✗</span>}
                      </div>
                    </td>
                    <td style={{ ...td, fontSize: '12px', color: '#666', fontStyle: 'italic' }}>
                      {meta.note}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

const th = { padding: '8px 10px', textAlign: 'left', fontWeight: 'bold', fontSize: '13px' };
const td = { padding: '10px' };

export default WorkRules;
