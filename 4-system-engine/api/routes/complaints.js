// Complaints routes — patient → admin complaint system
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// ─── GET /residents/:residentId/complaints ───
// Patient fetches their own complaints
router.get('/residents/:residentId/complaints', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM complaints WHERE resident_id = ? ORDER BY created_at DESC',
      [req.params.residentId]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET complaints for resident error:', err);
    res.status(500).json({ error: 'Failed to fetch complaints' });
  }
});

// ─── GET /complaints ───
// Admin fetches all complaints (optional ?status=pending filter)
router.get('/complaints', async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM complaints ORDER BY created_at DESC';
    let params = [];
    if (status) {
      query = 'SELECT * FROM complaints WHERE status = ? ORDER BY created_at DESC';
      params = [status];
    }
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('GET all complaints error:', err);
    res.status(500).json({ error: 'Failed to fetch complaints' });
  }
});

// ─── POST /complaints ───
// Patient submits a new complaint
router.post('/complaints', async (req, res) => {
  try {
    const { residentId, residentName, subject, message } = req.body;
    if (!residentId || !subject || !message) {
      return res.status(400).json({ error: 'residentId, subject, and message are required' });
    }

    const [result] = await pool.query(
      'INSERT INTO complaints (resident_id, resident_name, subject, message) VALUES (?, ?, ?, ?)',
      [residentId, residentName || null, subject, message]
    );

    res.status(201).json({
      id: result.insertId,
      residentId,
      subject,
      message,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('POST complaint error:', err);
    res.status(500).json({ error: 'Failed to submit complaint' });
  }
});

// ─── PUT /complaints/:id ───
// Admin responds to / resolves a complaint
router.put('/complaints/:id', async (req, res) => {
  try {
    const { status, adminResponse } = req.body;
    const fields = [];
    const values = [];

    if (status) { fields.push('status = ?'); values.push(status); }
    if (adminResponse !== undefined) { fields.push('admin_response = ?'); values.push(adminResponse); }
    const verifiedResponder = req.user?.profile?.name || req.user?.email || req.user?.uid || 'Administrator';
    fields.push('responded_by = ?'); values.push(verifiedResponder);
    if (status === 'reviewed' || status === 'resolved') {
      fields.push('responded_at = NOW()');
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.id);
    await pool.query(`UPDATE complaints SET ${fields.join(', ')} WHERE id = ?`, values);

    res.json({ message: 'Complaint updated successfully' });
  } catch (err) {
    console.error('PUT complaint error:', err);
    res.status(500).json({ error: 'Failed to update complaint' });
  }
});

export default router;
