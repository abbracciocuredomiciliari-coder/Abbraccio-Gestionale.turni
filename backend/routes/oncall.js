'use strict';
/**
 * routes/oncall.js — Reperibilità (On-Call)
 *
 * Endpoints:
 *   GET  /api/oncall/slots                      → lista slot del mese
 *   POST /api/oncall/slots                      → crea slot (coordinatore)
 *   PUT  /api/oncall/slots/:id                  → aggiorna slot (coordinatore)
 *   DELETE /api/oncall/slots/:id                → elimina slot (coordinatore)
 *
 *   GET  /api/oncall/assignments                → assegnazioni (filtro mese/utente)
 *   POST /api/oncall/assignments                → assegna infermiere a slot (coordinatore)
 *   DELETE /api/oncall/assignments/:id          → rimuove assegnazione (coordinatore)
 *   POST /api/oncall/assignments/:id/activate   → segna "chiamato in servizio"
 *
 *   GET  /api/oncall/equity?year=&month=        → report equità reperibilità
 *   GET  /api/oncall/suggest/:slotId            → candidati consigliati per uno slot
 */

const express = require('express');
const db      = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { computeLoads, rankByPriority, ONCALL_WEIGHT_DEFAULT } = require('../equity');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// SLOT — CRUD
// ═══════════════════════════════════════════════════════════════

router.get('/slots', authenticate, async (req, res) => {
  try {
    const { year, month, schedule_id } = req.query;
    let where = '1=1';
    const params = [];

    if (year && month) {
      const pad = n => String(n).padStart(2, '0');
      where += ` AND ocs.slot_date LIKE ?`;
      params.push(`${year}-${pad(month)}-%`);
    }
    if (schedule_id) {
      where += ` AND ocs.schedule_id = ?`;
      params.push(schedule_id);
    }

    const rows = await db.all(
      `SELECT
         ocs.*,
         COUNT(oca.id) AS assigned_count,
         u.first_name || ' ' || u.last_name AS created_by_name
       FROM oncall_slots ocs
       LEFT JOIN oncall_assignments oca ON oca.slot_id = ocs.id
       LEFT JOIN users u ON ocs.created_by = u.id
       WHERE ${where}
       GROUP BY ocs.id
       ORDER BY ocs.slot_date, ocs.start_time`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/slots', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const {
      slot_date, start_time = '19:00', end_time = '07:00',
      duration_hours = 12, label = 'Reperibilità notturna',
      required_count = 1, required_skill = null, schedule_id = null,
    } = req.body;

    if (!slot_date) return res.status(400).json({ error: 'slot_date obbligatorio.' });

    const ins = await db.run(
      `INSERT INTO oncall_slots
       (schedule_id, slot_date, start_time, end_time, duration_hours,
        label, required_count, required_skill, created_by)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [schedule_id, slot_date, start_time, end_time, duration_hours,
       label, required_count, required_skill, req.user.id]
    );
    const row = await db.get(`SELECT * FROM oncall_slots WHERE id = ?`, [ins.id]);
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/slots/:id', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const {
      slot_date, start_time, end_time, duration_hours,
      label, required_count, required_skill, status,
    } = req.body;

    const upd = await db.run(
      `UPDATE oncall_slots SET
         slot_date      = COALESCE(?, slot_date),
         start_time     = COALESCE(?, start_time),
         end_time       = COALESCE(?, end_time),
         duration_hours = COALESCE(?, duration_hours),
         label          = COALESCE(?, label),
         required_count = COALESCE(?, required_count),
         required_skill = COALESCE(?, required_skill),
         status         = COALESCE(?, status)
       WHERE id = ?`,
      [slot_date, start_time, end_time, duration_hours,
       label, required_count, required_skill, status, req.params.id]
    );
    if (upd.changes === 0) return res.status(404).json({ error: 'Slot non trovato.' });

    const row = await db.get(`SELECT * FROM oncall_slots WHERE id = ?`, [req.params.id]);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/slots/:id', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const upd = await db.run(`DELETE FROM oncall_slots WHERE id = ?`, [req.params.id]);
    if (upd.changes === 0) return res.status(404).json({ error: 'Slot non trovato.' });
    res.json({ message: 'Slot eliminato.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ASSEGNAZIONI
// ═══════════════════════════════════════════════════════════════

router.get('/assignments', authenticate, async (req, res) => {
  try {
    const { year, month, user_id } = req.query;
    const params = [];
    let where = '1=1';

    // Infermieri vedono solo i propri (a meno che non siano coordinatori)
    const isCoord = ['coordinator', 'admin'].includes(req.user.role);
    const targetUser = isCoord ? (user_id || null) : req.user.id;
    if (targetUser) { where += ' AND oca.user_id = ?'; params.push(targetUser); }

    if (year && month) {
      const pad = n => String(n).padStart(2, '0');
      where += ' AND oca.slot_date LIKE ?';
      params.push(`${year}-${pad(month)}-%`);
    }

    const rows = await db.all(
      `SELECT
         oca.*,
         u.first_name || ' ' || u.last_name AS nurse_name,
         ocs.label AS slot_label,
         ocs.required_count,
         ocs.required_skill
       FROM oncall_assignments oca
       JOIN users u        ON oca.user_id = u.id
       JOIN oncall_slots ocs ON oca.slot_id = ocs.id
       WHERE ${where}
       ORDER BY oca.slot_date, oca.start_time`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/assignments', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { slot_id, user_id } = req.body;
    if (!slot_id || !user_id) {
      return res.status(400).json({ error: 'slot_id e user_id obbligatori.' });
    }

    const slot = await db.get(`SELECT * FROM oncall_slots WHERE id = ?`, [slot_id]);
    if (!slot) return res.status(404).json({ error: 'Slot non trovato.' });

    // Legge peso oncall configurato
    let oncallWeight = ONCALL_WEIGHT_DEFAULT;
    try {
      const w = await db.get(`SELECT weight_value FROM shift_weights WHERE weight_key = 'oncall'`);
      if (w) oncallWeight = w.weight_value;
    } catch (_) {}

    const ins = await db.run(
      `INSERT INTO oncall_assignments
       (slot_id, user_id, slot_date, start_time, end_time, duration_hours, equity_weight, assigned_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [slot_id, user_id, slot.slot_date, slot.start_time, slot.end_time,
       slot.duration_hours, oncallWeight, req.user.id]
    );

    // Aggiorna status slot
    const covered = await db.get(
      `SELECT COUNT(*) AS cnt FROM oncall_assignments WHERE slot_id = ?`, [slot_id]
    );
    const newStatus = covered.cnt >= slot.required_count ? 'covered' : 'partial';
    await db.run(`UPDATE oncall_slots SET status = ? WHERE id = ?`, [newStatus, slot_id]);

    const row = await db.get(
      `SELECT oca.*, u.first_name || ' ' || u.last_name AS nurse_name
       FROM oncall_assignments oca
       JOIN users u ON oca.user_id = u.id
       WHERE oca.id = ?`,
      [ins.id]
    );
    res.status(201).json(row);
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Questo infermiere è già assegnato a questo slot.' });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/assignments/:id', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const assignment = await db.get(
      `SELECT slot_id FROM oncall_assignments WHERE id = ?`, [req.params.id]
    );
    if (!assignment) return res.status(404).json({ error: 'Assegnazione non trovata.' });

    await db.run(`DELETE FROM oncall_assignments WHERE id = ?`, [req.params.id]);

    // Ricalcola status slot
    const slot    = await db.get(`SELECT * FROM oncall_slots WHERE id = ?`, [assignment.slot_id]);
    const covered = await db.get(
      `SELECT COUNT(*) AS cnt FROM oncall_assignments WHERE slot_id = ?`, [assignment.slot_id]
    );
    const newStatus = covered.cnt === 0 ? 'open'
      : covered.cnt >= slot.required_count ? 'covered' : 'partial';
    await db.run(`UPDATE oncall_slots SET status = ? WHERE id = ?`, [newStatus, assignment.slot_id]);

    res.json({ message: 'Assegnazione rimossa.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ATTIVAZIONE — infermiere "chiamato in servizio"
// ═══════════════════════════════════════════════════════════════

router.post('/assignments/:id/activate', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const { actual_hours, notes } = req.body;
    const assignment = await db.get(
      `SELECT oca.*, u.first_name, u.last_name
       FROM oncall_assignments oca
       JOIN users u ON oca.user_id = u.id
       WHERE oca.id = ?`,
      [req.params.id]
    );
    if (!assignment) return res.status(404).json({ error: 'Assegnazione non trovata.' });
    if (assignment.called_in) return res.status(409).json({ error: 'Già attivata.' });

    await db.run(
      `UPDATE oncall_assignments
       SET called_in = 1, called_in_at = datetime('now'),
           called_in_by = ?, actual_hours = COALESCE(?, duration_hours),
           notes = COALESCE(?, notes)
       WHERE id = ?`,
      [req.user.id, actual_hours, notes, req.params.id]
    );

    // Registra le ore di attivazione come straordinario nel balance
    const hrs = actual_hours ?? assignment.duration_hours;
    try {
      const expiryRes = await db.get(`SELECT rule_value FROM work_rules WHERE rule_key = 'rest_recovery_expiry_months'`);
      const expiryM = expiryRes?.rule_value ?? 18;
      const deadline = new Date(assignment.slot_date);
      deadline.setMonth(deadline.getMonth() + expiryM);

      await db.run(
        `INSERT OR IGNORE INTO overtime_assignments
         (user_id, work_date, overtime_hours, reason, authorized_by)
         VALUES (?,?,?,?,?)`,
        [assignment.user_id, assignment.slot_date, hrs,
         `Reperibilità attivata il ${assignment.slot_date}`, req.user.id]
      );
      await db.run(
        `INSERT INTO rest_recovery (user_id, accrued_date, reason, hours_owed, recovery_deadline)
         VALUES (?,?,?,?,?)`,
        [assignment.user_id, assignment.slot_date,
         `Reperibilità attivata ${assignment.slot_date}`, hrs,
         deadline.toISOString().split('T')[0]]
      );
    } catch (_) {}

    const updated = await db.get(
      `SELECT oca.*, u.first_name || ' ' || u.last_name AS nurse_name
       FROM oncall_assignments oca JOIN users u ON oca.user_id = u.id
       WHERE oca.id = ?`,
      [req.params.id]
    );
    res.json({ message: 'Reperibilità attivata.', assignment: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// EQUITY REPORT reperibilità
// ═══════════════════════════════════════════════════════════════

router.get('/equity', authenticate, async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ error: 'year e month obbligatori.' });

    const pad = n => String(n).padStart(2, '0');
    const dateFrom = `${year}-${pad(month)}-01`;
    const dateTo   = `${year}-${pad(month)}-31`;

    // Carica reperibilità del mese come "assegnazioni pseudo"
    const oncallRows = await db.all(
      `SELECT
         oca.user_id      AS nurse_id,
         u.first_name || ' ' || u.last_name AS nurse_name,
         oca.slot_date    AS work_date,
         oca.duration_hours,
         oca.equity_weight,
         oca.called_in,
         oca.actual_hours,
         1                AS is_oncall
       FROM oncall_assignments oca
       JOIN users u ON oca.user_id = u.id
       WHERE oca.slot_date >= ? AND oca.slot_date <= ?`,
      [dateFrom, dateTo]
    );

    if (oncallRows.length === 0) {
      return res.json({
        period: { year: +year, month: +month },
        message: 'Nessuna reperibilità registrata in questo periodo.',
        summary: [],
      });
    }

    // Costruisce loads solo con dati oncall
    const loads = computeLoads(oncallRows, { oncall: ONCALL_WEIGHT_DEFAULT }, 1);

    // Arricchisce con conteggi diretti
    const summary = await db.all(
      `SELECT
         oca.user_id,
         u.first_name || ' ' || u.last_name AS nurse_name,
         COUNT(*)                  AS oncall_count,
         SUM(oca.called_in)        AS activations,
         SUM(oca.duration_hours)   AS total_oncall_hours,
         SUM(oca.duration_hours * oca.equity_weight) AS weighted_load
       FROM oncall_assignments oca
       JOIN users u ON oca.user_id = u.id
       WHERE oca.slot_date >= ? AND oca.slot_date <= ?
       GROUP BY oca.user_id
       ORDER BY oncall_count DESC`,
      [dateFrom, dateTo]
    );

    const ranked = rankByPriority(loads, 'oncall');

    res.json({
      period: { year: +year, month: +month },
      summary,
      equity_ranking: ranked,
      equity_score:   ranked.length > 0
        ? Math.round((1 - ranked.reduce((s,r) => s + Math.abs(r.gap_from_mean), 0) /
            (ranked.length * (ranked[ranked.length-1].composite_score + 1))) * 100)
        : 100,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SUGGERIMENTI candidati per uno slot
// ═══════════════════════════════════════════════════════════════

router.get('/suggest/:slotId', authenticate, requireRole('coordinator'), async (req, res) => {
  try {
    const slot = await db.get(`SELECT * FROM oncall_slots WHERE id = ?`, [req.params.slotId]);
    if (!slot) return res.status(404).json({ error: 'Slot non trovato.' });

    // Carica già assegnati a questo slot
    const alreadyAssigned = await db.all(
      `SELECT user_id FROM oncall_assignments WHERE slot_id = ?`, [req.params.slotId]
    );
    const assignedIds = new Set(alreadyAssigned.map(a => a.user_id));

    // Carica tutte le reperibilità degli ultimi 3 mesi per il ranking
    const cutoff = new Date(slot.slot_date);
    cutoff.setMonth(cutoff.getMonth() - 3);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const historicOncall = await db.all(
      `SELECT
         oca.user_id AS nurse_id,
         u.first_name || ' ' || u.last_name AS nurse_name,
         oca.slot_date AS work_date,
         oca.duration_hours,
         oca.equity_weight,
         1 AS is_oncall
       FROM oncall_assignments oca
       JOIN users u ON oca.user_id = u.id
       WHERE oca.slot_date >= ?`,
      [cutoffStr]
    );

    const loads = computeLoads(historicOncall, {}, 3);

    // Staff attivo
    const staff = await db.all(
      `SELECT u.id, u.first_name, u.last_name, u.skills
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE r.name = 'staff' AND u.is_active = 1`
    );

    // Assicura che tutti abbiano un record nel loads
    for (const s of staff) {
      if (!loads.has(s.id)) {
        loads.set(s.id, {
          nurse_id: s.id,
          nurse_name: `${s.first_name} ${s.last_name}`,
          total_weighted: 0, total_hours: 0,
          nights: 0, weekends: 0, overtime: 0, oncalls: 0,
          shift_counts: {}, composite_score: 0,
        });
      }
    }

    // Verifica indisponibilità nel giorno dello slot
    const unavailIds = new Set();
    const unavailRows = await db.all(
      `SELECT r.user_id
       FROM requests r
       JOIN request_statuses rs ON r.status_id = rs.id
       WHERE rs.code = 'approved'
         AND r.start_date <= ? AND r.end_date >= ?`,
      [slot.slot_date, slot.slot_date]
    );
    for (const r of unavailRows) unavailIds.add(r.user_id);

    // Controlla skill se richiesta
    const candidates = [];
    for (const s of staff) {
      if (assignedIds.has(s.id)) continue;

      const skills = s.skills
        ? (typeof s.skills === 'string' ? JSON.parse(s.skills) : s.skills)
        : [];
      const hasSkill = !slot.required_skill ||
        skills.map(sk => sk.toUpperCase()).includes(slot.required_skill.toUpperCase());

      const load = loads.get(s.id);
      candidates.push({
        user_id:         s.id,
        nurse_name:      `${s.first_name} ${s.last_name}`,
        oncall_count:    load.oncalls,
        composite_score: load.composite_score,
        has_required_skill: hasSkill,
        is_unavailable:  unavailIds.has(s.id),
        skills,
        priority: !unavailIds.has(s.id) && hasSkill ? 'disponibile'
          : unavailIds.has(s.id) ? 'indisponibile'
          : 'skill_mancante',
      });
    }

    // Ordina: disponibili e con meno reperibilità prima
    candidates.sort((a, b) => {
      if (a.is_unavailable !== b.is_unavailable) return a.is_unavailable ? 1 : -1;
      if (a.has_required_skill !== b.has_required_skill) return a.has_required_skill ? -1 : 1;
      if (a.oncall_count !== b.oncall_count) return a.oncall_count - b.oncall_count;
      return a.composite_score - b.composite_score;
    });

    res.json({
      slot,
      candidates,
      recommendation: candidates.find(c => c.priority === 'disponibile') || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
