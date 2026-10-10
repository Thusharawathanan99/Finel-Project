// Residents API routes
import { Router } from 'express';
import pool from '../db.js';
import { randomUUID } from 'crypto';
import { validDate, validText } from '../validation.js';
import { appendAudit } from '../monitoringService.js';

const router = Router();
const patientFields=new Set(['address','city','state','zipCode','emergencyContactName','emergencyContactPhone','emergencyContactRelation']);
function validResidentFields(body){
  const lengths={name:255,address:5000,city:100,state:50,zipCode:20,emergencyContactName:255,emergencyContactPhone:50,emergencyContactRelation:100,roomNumber:20,floorNumber:10,medicalHistory:10000};
  for(const [key,max]of Object.entries(lengths))if(body[key]!==undefined&&!validText(body[key],max,key!=='name'))return false;
  if(body.age!==undefined&&body.age!==null&&(!Number.isInteger(body.age)||body.age<0||body.age>130))return false;
  for(const key of ['dateOfBirth','admissionDate'])if(body[key]!==undefined&&body[key]!==null&&body[key]!==''&&!validDate(body[key]))return false;
  for(const key of ['allergies','dietaryRestrictions','children'])if(body[key]!==undefined&&body[key]!==null&&(!Array.isArray(body[key])||body[key].length>100))return false;
  return true;
}

// GET /api/residents — List all residents
router.get('/', async (req, res) => {
  try {
    const scope = req.user?.role === 'admin' ? null : (req.residentScope || []);
    if (scope && !scope.length) return res.json([]);
    const where = scope ? `WHERE r.resident_id IN (${scope.map(() => '?').join(',')})` : '';
    const [rows] = await pool.execute(`
      SELECT r.*,
        (SELECT COUNT(*) FROM prescriptions p WHERE p.resident_id=r.resident_id) prescription_count,
        (SELECT COUNT(*) FROM medications m JOIN prescriptions p ON p.prescription_id=m.prescription_id WHERE p.resident_id=r.resident_id) medication_count,
        (SELECT e.state_score FROM emotional_states e WHERE e.resident_id=r.resident_id ORDER BY e.recorded_at DESC,e.id DESC LIMIT 1) latest_wellness_score,
        (SELECT JSON_ARRAYAGG(cr.caretaker_id) FROM caretaker_residents cr WHERE cr.resident_id = r.resident_id) as assigned_caretakers
      FROM residents r
      ${where}
      ORDER BY r.name
    `, scope || []);
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
    if(req.user?.role!=='admin')return res.status(403).json({error:'Only admin can add residents'});
    if(!validText(req.body?.name,255)||!validResidentFields(req.body)||req.body.residentId!==undefined&&!validText(req.body.residentId,50))return res.status(400).json({error:'Provide a name and valid resident form fields'});
    const {
      residentId, name, age, dateOfBirth, address, city, state, zipCode,
      emergencyContactName, emergencyContactPhone, emergencyContactRelation,
      children, roomNumber, floorNumber, admissionDate, medicalHistory,
      allergies, dietaryRestrictions
    } = req.body;

    const id = residentId || `R-${randomUUID()}`;

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
    if(req.user?.role==='patient'&&Object.keys(req.body||{}).some(key=>!patientFields.has(key)))return res.status(403).json({error:'Patients may update only their address and emergency contacts'});
    if(!validResidentFields(req.body||{}))return res.status(400).json({error:'Invalid resident form fields'});
    const {
      name, age, dateOfBirth, address, city, state, zipCode,
      emergencyContactName, emergencyContactPhone, emergencyContactRelation,
      children, roomNumber, floorNumber, admissionDate, medicalHistory,
      allergies, dietaryRestrictions
    } = req.body;

    const fields = [];
    const values = [];

    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (age !== undefined) { fields.push('age = ?'); values.push(age); }
    if (dateOfBirth !== undefined) { fields.push('date_of_birth = ?'); values.push(dateOfBirth); }
    if (address !== undefined) { fields.push('address = ?'); values.push(address); }
    if (city !== undefined) { fields.push('city = ?'); values.push(city); }
    if (state !== undefined) { fields.push('state = ?'); values.push(state); }
    if (zipCode !== undefined) { fields.push('zip_code = ?'); values.push(zipCode); }
    if (emergencyContactName !== undefined) { fields.push('emergency_contact_name = ?'); values.push(emergencyContactName); }
    if (emergencyContactPhone !== undefined) { fields.push('emergency_contact_phone = ?'); values.push(emergencyContactPhone); }
    if (emergencyContactRelation !== undefined) { fields.push('emergency_contact_relation = ?'); values.push(emergencyContactRelation); }
    if (children) { fields.push('children = ?'); values.push(JSON.stringify(children)); }
    if (roomNumber !== undefined) { fields.push('room_number = ?'); values.push(roomNumber); }
    if (floorNumber !== undefined) { fields.push('floor_number = ?'); values.push(floorNumber); }
    if (admissionDate !== undefined) { fields.push('admission_date = ?'); values.push(admissionDate); }
    if (medicalHistory !== undefined) { fields.push('medical_history = ?'); values.push(medicalHistory); }
    if (allergies) { fields.push('allergies = ?'); values.push(JSON.stringify(allergies)); }
    if (dietaryRestrictions) { fields.push('dietary_restrictions = ?'); values.push(JSON.stringify(dietaryRestrictions)); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.id);
    const [updated]=await pool.execute(`UPDATE residents SET ${fields.join(', ')} WHERE resident_id = ?`, values);
    if(updated.affectedRows===0)return res.status(404).json({error:'Resident not found'});
    await appendAudit(pool,{actorType:'user',actorId:req.user.uid,action:'resident_profile_updated',resourceType:'resident',resourceId:req.params.id,residentId:req.params.id,details:{fields:Object.keys(req.body)}});

    res.json({ message: 'Resident updated' });
  } catch (error) {
    console.error('[Residents] Update error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/residents/:id
router.delete('/:id', async (req, res) => {
  let connection;
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admin can delete residents' });
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.execute('DELETE FROM residents WHERE resident_id = ?', [req.params.id]);
    await connection.execute('UPDATE users SET resident_id = NULL WHERE resident_id = ?', [req.params.id]);
    await connection.commit();
    res.json({ message: 'Resident deleted' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('[Residents] Delete error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    connection?.release();
  }
});

export default router;
