// Residents API routes
import { Router } from 'express';
import pool from '../db.js';

const router = Router();

// GET /api/residents — List all residents
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT r.*,
        (SELECT JSON_ARRAYAGG(cr.caretaker_id) FROM caretaker_residents cr WHERE cr.resident_id = r.resident_id) as assigned_caretakers
      FROM residents r
      ORDER BY r.name
    `);
    res.json(rows);
  } catch (error) {
    console.error('[Residents] List error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/residents/:id — Get single resident with prescriptions & emotions
router.get('/:id', async (req, res) => {
  try {
    const [residents] = await pool.execute('SELECT * FROM residents WHERE resident_id = ?', [req.params.id]);

    if (residents.length === 0) {
      return res.status(404).json({ error: 'Resident not found' });
    }

    const resident = residents[0];

    // Get prescriptions with medications
    const [prescriptions] = await pool.execute(
      'SELECT * FROM prescriptions WHERE resident_id = ? ORDER BY date_issued DESC',
      [req.params.id]
    );

    for (const rx of prescriptions) {
      const [meds] = await pool.execute(
        'SELECT * FROM medications WHERE prescription_id = ?',
        [rx.prescription_id]
      );
      rx.medications = meds;
    }

    // Get recent emotional states
    const [emotions] = await pool.execute(
      'SELECT * FROM emotional_states WHERE resident_id = ? ORDER BY recorded_at DESC LIMIT 50',
      [req.params.id]
    );

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS finished_medications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        resident_id VARCHAR(50) NOT NULL,
        prescription_id VARCHAR(50) NOT NULL,
        drug_name VARCHAR(255) NOT NULL,
        dosage VARCHAR(100) DEFAULT NULL,
        frequency VARCHAR(255) DEFAULT NULL,
        finished_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (resident_id) REFERENCES residents(resident_id) ON DELETE CASCADE,
        FOREIGN KEY (prescription_id) REFERENCES prescriptions(prescription_id) ON DELETE CASCADE,
        INDEX idx_finished_resident_time (resident_id, finished_at)
      )
    `);

    // Get finished medication history
    const [finishedMedications] = await pool.execute(
      'SELECT * FROM finished_medications WHERE resident_id = ? ORDER BY finished_at DESC',
      [req.params.id]
    );

    resident.prescriptions = prescriptions;
    resident.emotionalStates = emotions;
    resident.finishedMedications = finishedMedications;

    res.json(resident);
  } catch (error) {
    console.error('[Residents] Get error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/residents/:id/caretakers — Get assigned caretaker(s) for a resident
router.get('/:id/caretakers', async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT c.caretaker_id, c.name, c.email, c.phone, c.specialization, c.is_active
      FROM caretakers c
      INNER JOIN caretaker_residents cr ON cr.caretaker_id = c.caretaker_id
      WHERE cr.resident_id = ?
      ORDER BY c.name
    `, [req.params.id]);

    res.json(rows);
  } catch (error) {
    console.error('[Residents] Get caretakers error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      residentId, name, age, dateOfBirth, address, city, state, zipCode,
      emergencyContactName, emergencyContactPhone, emergencyContactRelation,
      children, roomNumber, floorNumber, admissionDate, medicalHistory,
      allergies, dietaryRestrictions
    } = req.body;

    const id = residentId || `R-${Date.now()}`;

    await pool.execute(
      `INSERT INTO residents (resident_id, name, age, date_of_birth, address, city, state, zip_code,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
        children, room_number, floor_number, admission_date, medical_history, allergies, dietary_restrictions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, name, age || null, dateOfBirth || null, address || null, city || null,
        state || null, zipCode || null, emergencyContactName || null,
        emergencyContactPhone || null, emergencyContactRelation || null,
        children ? JSON.stringify(children) : null,
        roomNumber || null, floorNumber || null, admissionDate || null,
        medicalHistory || null,
        allergies ? JSON.stringify(allergies) : null,
        dietaryRestrictions ? JSON.stringify(dietaryRestrictions) : null
      ]
    );

    res.status(201).json({ message: 'Resident created', residentId: id });
  } catch (error) {
    console.error('[Residents] Create error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/residents/:id — Update resident details
router.put('/:id', async (req, res) => {
  try {
    const {
      name, age, dateOfBirth, address, city, state, zipCode,
      emergencyContactName, emergencyContactPhone, emergencyContactRelation,
      children, roomNumber, floorNumber, admissionDate, medicalHistory,
      allergies, dietaryRestrictions
    } = req.body;

    const fields = [];
    const values = [];

    if (name) { fields.push('name = ?'); values.push(name); }
    if (age !== undefined) { fields.push('age = ?'); values.push(age); }
    if (dateOfBirth) { fields.push('date_of_birth = ?'); values.push(dateOfBirth); }
    if (address) { fields.push('address = ?'); values.push(address); }
    if (city) { fields.push('city = ?'); values.push(city); }
    if (state) { fields.push('state = ?'); values.push(state); }
    if (zipCode) { fields.push('zip_code = ?'); values.push(zipCode); }
    if (emergencyContactName) { fields.push('emergency_contact_name = ?'); values.push(emergencyContactName); }
    if (emergencyContactPhone) { fields.push('emergency_contact_phone = ?'); values.push(emergencyContactPhone); }
    if (emergencyContactRelation) { fields.push('emergency_contact_relation = ?'); values.push(emergencyContactRelation); }
    if (children) { fields.push('children = ?'); values.push(JSON.stringify(children)); }
    if (roomNumber) { fields.push('room_number = ?'); values.push(roomNumber); }
    if (floorNumber) { fields.push('floor_number = ?'); values.push(floorNumber); }
    if (admissionDate) { fields.push('admission_date = ?'); values.push(admissionDate); }
    if (medicalHistory !== undefined) { fields.push('medical_history = ?'); values.push(medicalHistory); }
    if (allergies) { fields.push('allergies = ?'); values.push(JSON.stringify(allergies)); }
    if (dietaryRestrictions) { fields.push('dietary_restrictions = ?'); values.push(JSON.stringify(dietaryRestrictions)); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.id);
    await pool.execute(`UPDATE residents SET ${fields.join(', ')} WHERE resident_id = ?`, values);

    res.json({ message: 'Resident updated' });
  } catch (error) {
    console.error('[Residents] Update error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/residents/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.execute('DELETE FROM residents WHERE resident_id = ?', [req.params.id]);
    res.json({ message: 'Resident deleted' });
  } catch (error) {
    console.error('[Residents] Delete error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
