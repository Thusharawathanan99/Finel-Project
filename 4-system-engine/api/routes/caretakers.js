// Caretakers API routes
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

async function isAdminRequest(req) {
  if (req.user?.role === 'admin') {
    return true;
  }

  const email = (req.user?.email || '').toLowerCase();
  if (email === 'admin@careconnect.com') {
    return true;
  }

  const uid = req.user?.uid;
  if (!uid) {
    return false;
  }

  try {
    const [rows] = await pool.execute('SELECT role FROM users WHERE id = ? LIMIT 1', [uid]);
    return rows.length > 0 && rows[0].role === 'admin';
  } catch {
    return false;
  }
}

// GET /api/caretakers — List all caretakers
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT c.*,
        (SELECT JSON_ARRAYAGG(cr.resident_id) FROM caretaker_residents cr WHERE cr.caretaker_id = c.caretaker_id) as assigned_residents
      FROM caretakers c
      ORDER BY c.name
    `);
    res.json(rows);
  } catch (error) {
    console.error('[Caretakers] List error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/caretakers/:id — Get single caretaker
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT c.*,
        (SELECT JSON_ARRAYAGG(cr.resident_id) FROM caretaker_residents cr WHERE cr.caretaker_id = c.caretaker_id) as assigned_residents
      FROM caretakers c
      WHERE c.caretaker_id = ?
    `, [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Caretaker not found' });
    }

    // Get leave requests
    const [leaveRequests] = await pool.execute(
      'SELECT * FROM leave_requests WHERE caretaker_id = ? ORDER BY request_date DESC',
      [req.params.id]
    );

    const caretaker = rows[0];
    caretaker.leaveRequests = leaveRequests;

    res.json(caretaker);
  } catch (error) {
    console.error('[Caretakers] Get error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caretakers — Create a caretaker
router.post('/', async (req, res) => {
  try {
    if (!(await isAdminRequest(req))) {
      return res.status(403).json({ error: 'Only admin can add caretakers' });
    }

    const { caretakerId, name, email, phone, specialization } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'name and email are required' });
    }

    const id = caretakerId || `CT-${Date.now()}`;

    await pool.execute(
      'INSERT INTO caretakers (caretaker_id, name, email, phone, specialization) VALUES (?, ?, ?, ?, ?)',
      [id, name, email || null, phone || null, specialization || null]
    );

    res.status(201).json({ message: 'Caretaker created', caretakerId: id });
  } catch (error) {
    console.error('[Caretakers] Create error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caretakers/:id/assign-resident — Assign a resident to caretaker
router.post('/:id/assign-resident', async (req, res) => {
  try {
    const { residentId } = req.body;

    if (!residentId) {
      return res.status(400).json({ error: 'residentId is required' });
    }

    await pool.execute(
      'INSERT IGNORE INTO caretaker_residents (caretaker_id, resident_id) VALUES (?, ?)',
      [req.params.id, residentId]
    );

    res.status(201).json({
      message: 'Resident assigned to caretaker',
      caretakerId: req.params.id,
      residentId,
    });
  } catch (error) {
    console.error('[Caretakers] Assign resident error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/caretakers/:id — Update caretaker
router.put('/:id', async (req, res) => {
  try {
    const { name, email, phone, specialization, isActive } = req.body;
    const fields = [];
    const values = [];

    if (name) { fields.push('name = ?'); values.push(name); }
    if (email) { fields.push('email = ?'); values.push(email); }
    if (phone) { fields.push('phone = ?'); values.push(phone); }
    if (specialization) { fields.push('specialization = ?'); values.push(specialization); }
    if (isActive !== undefined) { fields.push('is_active = ?'); values.push(isActive); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.id);
    await pool.execute(`UPDATE caretakers SET ${fields.join(', ')} WHERE caretaker_id = ?`, values);

    res.json({ message: 'Caretaker updated' });
  } catch (error) {
    console.error('[Caretakers] Update error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/caretakers/:id — Remove caretaker and related records
router.delete('/:id', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    if (!(await isAdminRequest(req))) {
      connection.release();
      return res.status(403).json({ error: 'Only admin can remove caretakers' });
    }

    const caretakerId = req.params.id;
    const [caretakerRows] = await connection.execute(
      'SELECT caretaker_id, email FROM caretakers WHERE caretaker_id = ? LIMIT 1',
      [caretakerId]
    );

    if (caretakerRows.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Caretaker not found' });
    }

    const caretakerEmail = caretakerRows[0].email || null;

    await connection.beginTransaction();

    await connection.execute('DELETE FROM leave_requests WHERE caretaker_id = ?', [caretakerId]);
    await connection.execute('DELETE FROM caretaker_residents WHERE caretaker_id = ?', [caretakerId]);
    await connection.execute('DELETE FROM caretakers WHERE caretaker_id = ?', [caretakerId]);

    if (caretakerEmail) {
      await connection.execute('DELETE FROM users WHERE LOWER(email) = LOWER(?) AND role = ?', [caretakerEmail, 'caretaker']);
    }

    await connection.commit();
    connection.release();

    res.json({ message: 'Caretaker removed', caretakerId });
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // ignore rollback error
    }
    connection.release();
    console.error('[Caretakers] Delete error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── Leave Requests ──

// GET /api/caretakers/all/leave-requests
router.get('/all/leave-requests', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM leave_requests ORDER BY request_date DESC'
    );
    res.json(rows);
  } catch (error) {
    console.error('[LeaveRequests] Get All error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/caretakers/:id/leave-requests
router.get('/:id/leave-requests', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM leave_requests WHERE caretaker_id = ? ORDER BY request_date DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    console.error('[LeaveRequests] List error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caretakers/:id/leave-requests
router.post('/:id/leave-requests', async (req, res) => {
  try {
    const { startDate, endDate, reason, caretakerName } = req.body;
    const requestId = `LR-${Date.now()}`;
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;

    await pool.execute(
      `INSERT INTO leave_requests (request_id, caretaker_id, caretaker_name, start_date, end_date, number_of_days, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [requestId, req.params.id, caretakerName || '', startDate, endDate, days, reason || '']
    );

    res.status(201).json({ message: 'Leave request created', requestId });
  } catch (error) {
    console.error('[LeaveRequests] Create error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/caretakers/:caretakerId/leave-requests/:requestId
router.put('/:caretakerId/leave-requests/:requestId', async (req, res) => {
  try {
    const { status, reviewedBy, temporaryReplacement } = req.body;

    await pool.execute(
      `UPDATE leave_requests SET status = ?, reviewed_by = ?, review_date = NOW(), temporary_replacement = ?
       WHERE request_id = ? AND caretaker_id = ?`,
      [status, reviewedBy || null, temporaryReplacement || null, req.params.requestId, req.params.caretakerId]
    );

    res.json({ message: 'Leave request updated' });
  } catch (error) {
    console.error('[LeaveRequests] Update error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
