// Doctors API routes
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// GET /api/doctors — List all doctors
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM doctors ORDER BY name ASC');
    res.json(rows);
  } catch (error) {
    console.error('[Doctors] List error:', error.message);
    res.status(500).json({ error: 'Failed to fetch doctors' });
  }
});

// GET /api/doctors/:id — Get single doctor
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM doctors WHERE doctor_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Doctor not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error('[Doctors] Get error:', error.message);
    res.status(500).json({ error: 'Failed to fetch doctor' });
  }
});

// POST /api/doctors — Create a doctor (admin)
router.post('/', async (req, res) => {
  try {
    const { name, specialization, phone, email, hospital } = req.body;
    if (!name) return res.status(400).json({ error: 'Doctor name is required' });

    const [result] = await pool.execute(
      'INSERT INTO doctors (name, specialization, phone, email, hospital) VALUES (?, ?, ?, ?, ?)',
      [name, specialization || null, phone || null, email || null, hospital || null]
    );

    res.status(201).json({ message: 'Doctor created', doctorId: result.insertId });
  } catch (error) {
    console.error('[Doctors] Create error:', error.message);
    res.status(500).json({ error: 'Failed to create doctor' });
  }
});

// PUT /api/doctors/:id — Update a doctor
router.put('/:id', async (req, res) => {
  try {
    const { name, specialization, phone, email, hospital, is_active } = req.body;
    const fields = [];
    const values = [];

    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (specialization !== undefined) { fields.push('specialization = ?'); values.push(specialization); }
    if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
    if (email !== undefined) { fields.push('email = ?'); values.push(email); }
    if (hospital !== undefined) { fields.push('hospital = ?'); values.push(hospital); }
    if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active); }

    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    values.push(req.params.id);
    await pool.execute(`UPDATE doctors SET ${fields.join(', ')} WHERE doctor_id = ?`, values);

    res.json({ message: 'Doctor updated' });
  } catch (error) {
    console.error('[Doctors] Update error:', error.message);
    res.status(500).json({ error: 'Failed to update doctor' });
  }
});

// DELETE /api/doctors/:id — Delete a doctor
router.delete('/:id', async (req, res) => {
  try {
    await pool.execute('DELETE FROM doctors WHERE doctor_id = ?', [req.params.id]);
    res.json({ message: 'Doctor deleted' });
  } catch (error) {
    console.error('[Doctors] Delete error:', error.message);
    res.status(500).json({ error: 'Failed to delete doctor' });
  }
});

export default router;
