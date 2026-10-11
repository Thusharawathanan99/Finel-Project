import { Router } from 'express';
import { randomUUID } from 'crypto';
import pool from '../db.js';
import { synchronizeRole } from '../middleware/roleClaims.js';

const router = Router();
const roles = new Set(['patient', 'caretaker', 'admin']);
const normalized = value => String(value || '').trim().toLowerCase();
const validText = (value, maximum) => typeof value === 'string' && Boolean(value.trim()) && value.length <= maximum;
const validEmail = value => validText(value, 255) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

async function validateResidentLink(connection, residentId, uid) {
  if (!residentId) return null;
  if (!validText(residentId, 50)) return { status: 400, error: 'Invalid resident ID' };
  // Lock the resident before checking its account link so concurrent admin
  // requests cannot attach two accounts to the same patient records.
  const [residents] = await connection.execute('SELECT resident_id FROM residents WHERE resident_id = ? FOR UPDATE', [residentId]);
  if (!residents.length) return { status: 400, error: 'Resident not found' };
  const [links] = await connection.execute('SELECT id FROM users WHERE resident_id = ? AND id <> ?', [residentId, uid]);
  return links.length ? { status: 409, error: 'Resident is already linked to another account' } : null;
}

// Register a patient's records together, so retries cannot steal/relink an existing resident.
router.post('/register-patient', async (req, res) => {
  let connection;
  try {
    const { name, email, caretakerId, residentId } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.length > 255 || !req.user.email) {
      return res.status(400).json({ error: 'A name and authenticated email are required' });
    }
    if (email && normalized(email) !== normalized(req.user.email)) {
      return res.status(403).json({ error: 'The email must match your authenticated account' });
    }
    if (req.user.role !== 'unregistered' && req.user.role !== 'patient') {
      return res.status(403).json({ error: 'This account is not a patient account' });
    }
    const id = String(residentId || `R-${randomUUID()}`).trim();
    if (!id || id.length > 50) return res.status(400).json({ error: 'Invalid resident ID' });
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [existing] = await connection.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [req.user.uid]);
    if (existing.length) {
      await connection.rollback();
      const user = existing[0];
      if (user.role !== 'patient' || !user.resident_id ||
        (residentId && residentId !== user.resident_id)) {
        return res.status(409).json({ error: 'This account already has a profile. Its role and resident link were preserved.' });
      }
      return res.json({ uid: req.user.uid, residentId: user.resident_id, role: 'patient', existing: true });
    }
    const [residents] = await connection.execute('SELECT resident_id FROM residents WHERE resident_id = ? FOR UPDATE', [id]);
    if (residents.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'This resident ID already exists. Ask an administrator to link an existing resident.' });
    }
    if (caretakerId) {
      const [caretakers] = await connection.execute(
        'SELECT caretaker_id FROM caretakers WHERE caretaker_id = ? AND is_active = TRUE', [caretakerId]
      );
      if (!caretakers.length) {
        await connection.rollback();
        return res.status(400).json({ error: 'The selected caretaker is not available' });
      }
    }
    await connection.execute('INSERT INTO residents (resident_id, name) VALUES (?, ?)', [id, name.trim()]);
    await connection.execute(
      'INSERT INTO users (id, name, email, role, resident_id) VALUES (?, ?, ?, ?, ?)',
      [req.user.uid, name.trim(), normalized(req.user.email), 'patient', id]
    );
    if (caretakerId) await connection.execute(
      'INSERT INTO caretaker_residents (caretaker_id, resident_id) VALUES (?, ?)', [caretakerId, id]
    );
    await connection.commit();
    return res.status(201).json({ uid: req.user.uid, residentId: id, role: 'patient' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('[Users] Patient registration failed:', error.message);
    return res.status(error.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ error: 'Patient registration could not be completed. Existing records were preserved.' });
  } finally {
    connection?.release();
  }
});

// Register a new Facility Administrator account
router.post('/register-admin', async (req, res) => {
  let connection;
  try {
    const { name, email } = req.body;
    const targetName = String(name || '').trim();
    const targetEmail = normalized(email || req.user?.email);
    const uid = req.user?.uid;

    if (!targetName || !targetEmail) {
      return res.status(400).json({ error: 'Full name and email are required to register an administrator' });
    }
    if (!uid) {
      return res.status(401).json({ error: 'Authentication token required' });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existing] = await connection.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [uid]);
    if (existing.length) {
      const user = existing[0];
      if (user.role === 'admin') {
        await connection.commit();
        return res.json({ uid, name: user.name, email: user.email, role: 'admin', existing: true });
      }
      await connection.rollback();
      return res.status(409).json({ error: `This account is already registered as a ${user.role}.` });
    }

    // Check if email already exists
    const [emailMatch] = await connection.execute('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [targetEmail]);
    if (emailMatch.length && emailMatch[0].id !== uid) {
      if (emailMatch[0].role === 'admin') {
        await connection.execute('UPDATE users SET id = ?, name = ? WHERE email = ?', [uid, targetName, targetEmail]);
        await connection.commit();
        return res.json({ uid, name: targetName, email: targetEmail, role: 'admin', updated: true });
      }
      await connection.rollback();
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    await connection.execute(
      'INSERT INTO users (id, name, email, role, resident_id) VALUES (?, ?, ?, "admin", NULL)',
      [uid, targetName, targetEmail]
    );

    try {
      await synchronizeRole(uid, 'admin', targetEmail);
    } catch (claimErr) {
      console.warn('[Users] Admin claim sync skipped:', claimErr.message);
    }

    await connection.commit();
    return res.status(201).json({ uid, name: targetName, email: targetEmail, role: 'admin' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('[Users] Admin registration failed:', error.message);
    return res.status(error.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ error: 'Admin registration could not be completed' });
  } finally {
    connection?.release();
  }
});

// Admin creates Firebase identity first; the database role and caretaker are committed together.
router.post('/register-caretaker', async (req, res) => {
  let connection;
  let restoreClaims;
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admin can register caretakers' });
    const { uid, name, email, phone, specialization, caretakerId } = req.body;
    if (!uid || !String(name || '').trim() || !normalized(email)) return res.status(400).json({ error: 'uid, name and email are required' });
    const id = caretakerId || `CT-${randomUUID()}`;
    if (String(id).length > 50) return res.status(400).json({ error: 'Invalid caretaker ID' });
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [profiles] = await connection.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [uid]);
    if (profiles.length) {
      const [caretakers] = await connection.execute('SELECT caretaker_id FROM caretakers WHERE LOWER(email) = LOWER(?)', [email]);
      await connection.rollback();
      if (profiles[0].role === 'caretaker' && normalized(profiles[0].email) === normalized(email) && caretakers.length) {
        return res.json({ uid, caretakerId: caretakers[0].caretaker_id, role: 'caretaker', existing: true });
      }
      return res.status(409).json({ error: 'This account already has a different profile' });
    }
    const [emailMatch] = await connection.execute('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [normalized(email)]);
    if (emailMatch.length && emailMatch[0].id !== uid) {
      await connection.rollback();
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    await connection.execute('INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)', [uid, name.trim(), normalized(email), 'caretaker']);
    await connection.execute(
      'INSERT INTO caretakers (caretaker_id, name, email, phone, specialization) VALUES (?, ?, ?, ?, ?)',
      [id, name.trim(), normalized(email), phone || null, specialization || null]
    );
    try {
      restoreClaims = await synchronizeRole(uid, 'caretaker', normalized(email));
    } catch (claimErr) {
      console.warn('[Users] Caretaker claim sync skipped:', claimErr.message);
    }
    await connection.commit();
    return res.status(201).json({ uid, caretakerId: id, role: 'caretaker' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (restoreClaims) await restoreClaims().catch(() => console.error('[Users] Claim restoration failed; administrator inspection required.'));
    console.error('[Users] Caretaker registration failed:', error.message);
    return res.status(error.code === 'ER_DUP_ENTRY' ? 409 : 500).json({
      error: error.code === 'ER_DUP_ENTRY' ? 'An account with this email already exists' : 'Caretaker registration could not be completed'
    });
  } finally {
    connection?.release();
  }
});

// Admin creates Firebase identity first; the database role and resident are committed together.
router.post('/register-resident', async (req, res) => {
  let connection;
  let restoreClaims;
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admin can register residents' });
    const {
      uid, name, email, residentId, age, dateOfBirth, address, city, state, zipCode,
      emergencyContactName, emergencyContactPhone, emergencyContactRelation,
      children, roomNumber, floorNumber, admissionDate, medicalHistory,
      allergies, dietaryRestrictions, caretakerId
    } = req.body;
    if (!uid || !String(name || '').trim() || !normalized(email)) {
      return res.status(400).json({ error: 'uid, name and email are required' });
    }
    const id = residentId || `R-${randomUUID()}`;
    if (String(id).length > 50) return res.status(400).json({ error: 'Invalid resident ID' });

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [profiles] = await connection.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [uid]);
    if (profiles.length) {
      const [residents] = await connection.execute('SELECT resident_id FROM residents WHERE resident_id = ?', [profiles[0].resident_id]);
      await connection.rollback();
      if (profiles[0].role === 'patient' && normalized(profiles[0].email) === normalized(email) && residents.length) {
        return res.json({ uid, residentId: profiles[0].resident_id, role: 'patient', existing: true });
      }
      return res.status(409).json({ error: 'This account already has a different profile' });
    }

    const [emailMatch] = await connection.execute('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [normalized(email)]);
    if (emailMatch.length) {
      await connection.rollback();
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const [existingResident] = await connection.execute('SELECT resident_id FROM residents WHERE resident_id = ? FOR UPDATE', [id]);
    if (!existingResident.length) {
      await connection.execute(
        `INSERT INTO residents (resident_id, name, age, date_of_birth, address, city, state, zip_code,
          emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
          children, room_number, floor_number, admission_date, medical_history, allergies, dietary_restrictions)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, name.trim(), age || null, dateOfBirth || null, address || null, city || null,
          state || null, zipCode || null, emergencyContactName || null,
          emergencyContactPhone || null, emergencyContactRelation || null,
          children ? (typeof children === 'string' ? children : JSON.stringify(children)) : null,
          roomNumber || null, floorNumber || null,
          admissionDate || new Date().toISOString().split('T')[0],
          medicalHistory || null,
          allergies ? (typeof allergies === 'string' ? allergies : JSON.stringify(allergies)) : null,
          dietaryRestrictions ? (typeof dietaryRestrictions === 'string' ? dietaryRestrictions : JSON.stringify(dietaryRestrictions)) : null
        ]
      );
    } else {
      const [existingLink] = await connection.execute('SELECT id FROM users WHERE resident_id = ?', [id]);
      if (existingLink.length) {
        await connection.rollback();
        return res.status(409).json({ error: 'Resident is already linked to another account' });
      }
    }

    await connection.execute(
      'INSERT INTO users (id, name, email, role, resident_id) VALUES (?, ?, ?, ?, ?)',
      [uid, name.trim(), normalized(email), 'patient', id]
    );

    if (caretakerId) {
      const [existingCareLink] = await connection.execute(
        'SELECT * FROM caretaker_residents WHERE caretaker_id = ? AND resident_id = ?',
        [caretakerId, id]
      );
      if (!existingCareLink.length) {
        await connection.execute(
          'INSERT INTO caretaker_residents (caretaker_id, resident_id) VALUES (?, ?)',
          [caretakerId, id]
        );
      }
    }

    try {
      restoreClaims = await synchronizeRole(uid, 'patient', normalized(email));
    } catch (claimErr) {
      console.warn('[Users] Resident claim sync skipped:', claimErr.message);
    }
    await connection.commit();
    return res.status(201).json({ uid, residentId: id, name: name.trim(), email: normalized(email), role: 'patient' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (restoreClaims) await restoreClaims().catch(() => console.error('[Users] Claim restoration failed; administrator inspection required.'));
    console.error('[Users] Resident registration failed:', error.message);
    return res.status(error.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ error: 'Resident registration could not be completed' });
  } finally {
    connection?.release();
  }
});

// Profile creation/role assignment is an administrator operation.
router.post('/', async (req, res) => {
  let connection;
  let restoreClaims;
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admin can provision user profiles' });
    const { uid, name, email, role, residentId } = req.body;
    if (!validText(uid, 128) || !validText(name, 255) || !validEmail(email) || !roles.has(role)) {
      return res.status(400).json({ error: 'uid, name, email and a valid role are required' });
    }
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [profiles] = await connection.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [uid]);
    if (profiles.length && profiles[0].id !== uid) {
      await connection.rollback();
      return res.status(409).json({ error: 'This UID conflicts with a different account' });
    }
    const linkError = await validateResidentLink(connection, residentId, uid);
    if (linkError) {
      await connection.rollback();
      return res.status(linkError.status).json({ error: linkError.error });
    }
    // ON DUPLICATE KEY UPDATE also matches a different UID's unique email.
    // Update only the requested UID; email conflicts must roll back instead.
    if (profiles.length) await connection.execute(
      'UPDATE users SET name = ?, email = ?, role = ?, resident_id = ? WHERE id = ?',
      [name.trim(), normalized(email), role, residentId || null, uid]
    );
    else await connection.execute(
      'INSERT INTO users (id, name, email, role, resident_id) VALUES (?, ?, ?, ?, ?)',
      [uid, name.trim(), normalized(email), role, residentId || null]
    );
    if (!profiles.length || profiles[0].role !== role || normalized(profiles[0].email) !== normalized(email)) restoreClaims = await synchronizeRole(uid, role, normalized(email));
    await connection.commit();
    return res.status(profiles.length ? 200 : 201).json({ message: profiles.length ? 'User updated' : 'User created', uid });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (restoreClaims) await restoreClaims().catch(() => console.error('[Users] Claim restoration failed; administrator inspection required.'));
    console.error('[Users] Create error:', error.message);
    return res.status(error.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ error: 'Could not create user profile. Existing accounts were preserved.' });
  } finally {
    connection?.release();
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.params.id !== req.user.uid) return res.status(403).json({ error: 'Access denied' });
    const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    return res.json(rows[0]);
  } catch (error) {
    console.error('[Users] Get error:', error.message);
    return res.status(500).json({ error: 'Could not fetch user profile' });
  }
});

router.put('/:id', async (req, res) => {
  let connection;
  let restoreClaims;
  try {
    const admin = req.user.role === 'admin';
    if (!admin && req.params.id !== req.user.uid) return res.status(403).json({ error: 'Access denied' });
    const { name, email, role, residentId } = req.body;
    if ((name !== undefined && !validText(name, 255)) || (email !== undefined && !validEmail(email))) {
      return res.status(400).json({ error: 'A valid name and email are required' });
    }
    if (role !== undefined && !roles.has(role)) return res.status(400).json({ error: 'Invalid role' });
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!rows.length || rows[0].id !== req.params.id) {
      await connection.rollback();
      return res.status(404).json({ error: 'User not found' });
    }
    if (!admin && ((role !== undefined && role !== rows[0].role) ||
      (residentId !== undefined && residentId !== rows[0].resident_id) ||
      (email !== undefined && normalized(email) !== normalized(req.user.email)))) {
      await connection.rollback();
      return res.status(403).json({ error: 'Only an administrator can change account roles or resident links' });
    }
    if (admin && residentId) {
      const linkError = await validateResidentLink(connection, residentId, req.params.id);
      if (linkError) {
        await connection.rollback();
        return res.status(linkError.status).json({ error: linkError.error });
      }
    }
    const fields = [], values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name.trim()); }
    if (email !== undefined) { fields.push('email = ?'); values.push(normalized(email)); }
    if (admin && role !== undefined) { fields.push('role = ?'); values.push(role); }
    if (admin && residentId !== undefined) { fields.push('resident_id = ?'); values.push(residentId); }
    if (!fields.length) {
      await connection.rollback();
      return res.status(400).json({ error: 'No fields to update' });
    }
    values.push(req.params.id);
    await connection.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    if (admin && (role !== undefined && role !== rows[0].role || email !== undefined && normalized(email) !== normalized(rows[0].email))) {
      restoreClaims = await synchronizeRole(req.params.id, role || rows[0].role, email || rows[0].email);
    }
    await connection.commit();
    return res.json({ message: 'User updated' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (restoreClaims) await restoreClaims().catch(() => console.error('[Users] Claim restoration failed; administrator inspection required.'));
    console.error('[Users] Update error:', error.message);
    return res.status(error.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ error: 'Could not update user profile' });
  } finally {
    connection?.release();
  }
});

router.delete('/:id', async (req, res) => {
  let connection, restoreClaims;
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admin can delete user profiles' });
    connection = await pool.getConnection(); await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!rows.length || rows[0].id !== req.params.id) { await connection.rollback(); return res.status(404).json({ error: 'User not found' }); }
    await connection.execute('DELETE FROM users WHERE id = ?', [req.params.id]);
    restoreClaims = await synchronizeRole(req.params.id, null);
    await connection.commit();
    // Medical records are retained. Deleting them is a separate admin-only operation.
    return res.json({ message: 'User profile deleted' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    if (restoreClaims) await restoreClaims().catch(() => console.error('[Users] Claim restoration failed; administrator inspection required.'));
    console.error('[Users] Delete error:', error.message);
    return res.status(500).json({ error: 'Could not delete user profile' });
  } finally { connection?.release(); }
});

export default router;
