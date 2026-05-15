// Appointments API routes
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// GET /api/appointments — List all appointments
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM appointments ORDER BY appointment_date DESC, appointment_time DESC'
    );
    res.json(rows);
  } catch (error) {
    console.error('[Appointments] List error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/residents/:residentId/appointments — List appointments for a resident
router.get('/residents/:residentId/appointments', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM appointments WHERE resident_id = ? ORDER BY appointment_date DESC',
      [req.params.residentId]
    );
    res.json(rows);
  } catch (error) {
    console.error('[Appointments] List for resident error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/appointments — Create an appointment
router.post('/', async (req, res) => {
  try {
    const { residentId, residentName, doctorName, specialization, appointmentDate, appointmentTime, reason } = req.body;
    const appointmentId = `APT-${Date.now()}`;

    await pool.execute(
      `INSERT INTO appointments (appointment_id, resident_id, resident_name, doctor_name, specialization, appointment_date, appointment_time, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [appointmentId, residentId, residentName || '', doctorName || '', specialization || '', appointmentDate, appointmentTime || '', reason || '']
    );

    // Auto-create notification for the patient
    try {
      await pool.execute(
        `INSERT INTO notifications (resident_id, title, message, type, related_id) VALUES (?, ?, ?, ?, ?)`,
        [
          residentId,
          `Appointment Booked with Dr. ${doctorName}`,
          `You have an appointment on ${appointmentDate}${appointmentTime ? ' at ' + appointmentTime : ''}.${specialization ? ' (' + specialization + ')' : ''}${reason ? ' Reason: ' + reason : ''}`,
          'appointment',
          appointmentId,
        ]
      );
    } catch (notifErr) {
      console.warn('[Appointments] Notification insert failed:', notifErr.message);
    }

    res.status(201).json({ message: 'Appointment created', appointmentId });
  } catch (error) {
    console.error('[Appointments] Create error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/appointments/:id — Update appointment (reschedule, cancel, complete)
router.put('/:id', async (req, res) => {
  try {
    const { status, appointmentDate, appointmentTime, notes } = req.body;
    const fields = [];
    const values = [];

    if (status) { fields.push('status = ?'); values.push(status); }
    if (appointmentDate) { fields.push('appointment_date = ?'); values.push(appointmentDate); }
    if (appointmentTime) { fields.push('appointment_time = ?'); values.push(appointmentTime); }
    if (notes !== undefined) { fields.push('notes = ?'); values.push(notes); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.id);
    await pool.execute(`UPDATE appointments SET ${fields.join(', ')} WHERE appointment_id = ?`, values);

    res.json({ message: 'Appointment updated' });
  } catch (error) {
    console.error('[Appointments] Update error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/appointments/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.execute('DELETE FROM appointments WHERE appointment_id = ?', [req.params.id]);
    res.json({ message: 'Appointment deleted' });
  } catch (error) {
    console.error('[Appointments] Delete error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
