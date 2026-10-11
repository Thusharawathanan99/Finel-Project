// Caretakers API routes
import { Router } from 'express';
import pool from '../db.js';
import { randomUUID } from 'crypto';
import { validDate, validText } from '../validation.js';
import { colomboDay, effectiveResidentIds } from '../careScope.js';
import { appendAudit } from '../monitoringService.js';

const router = Router();

function isAdminRequest(req) {
  return req.user?.role === 'admin';
}

/**
 * Resolve an ID that may be a caretaker_id ("CT001") or Firebase UID to the actual caretaker_id.
 * Returns the caretaker_id string, or null if not found.
 */
async function resolveCaretakerId(id) {
  // 1. Check if it directly matches a caretaker_id
  const [direct] = await pool.execute('SELECT caretaker_id FROM caretakers WHERE caretaker_id = ?', [id]);
  if (direct.length > 0) return direct[0].caretaker_id;

  // 2. Fall back: look up Firebase UID → email → caretaker
  const [userRows] = await pool.execute('SELECT email FROM users WHERE id = ?', [id]);
  if (userRows.length > 0) {
    const [ctRows] = await pool.execute('SELECT caretaker_id FROM caretakers WHERE email = ?', [userRows[0].email]);
    if (ctRows.length > 0) return ctRows[0].caretaker_id;
  }

  return null;
}

// GET /api/caretakers — List all caretakers
router.get('/', async (req, res) => {
  try {
    // Signup needs names and IDs, never patient assignments or staff contact details.
    if (!req.user || req.user.role === 'unregistered') {
      const [directory] = await pool.execute(
        'SELECT caretaker_id, name, specialization FROM caretakers WHERE is_active = TRUE ORDER BY name'
      );
      return res.json(directory);
    }
    if (req.user.role === 'patient') {
      if (!req.user.profile?.resident_id) return res.json([]);
      const [assigned] = await pool.execute(`
        SELECT c.*,
          JSON_ARRAY(?) as assigned_residents
        FROM caretakers c
        INNER JOIN caretaker_residents cr ON cr.caretaker_id = c.caretaker_id
        WHERE cr.resident_id = ?
        ORDER BY c.name
      `, [req.user.profile.resident_id, req.user.profile.resident_id]);
      return res.json(assigned);
    }
    const own = req.user.role === 'admin' ? null : req.user.caretakerIds;
    if (own && !own.length) return res.json([]);
    const where = own ? `WHERE c.caretaker_id IN (${own.map(() => '?').join(',')})` : '';
    const [rows] = await pool.execute(`
      SELECT c.*,
        (SELECT JSON_ARRAYAGG(cr.resident_id) FROM caretaker_residents cr WHERE cr.caretaker_id = c.caretaker_id) as assigned_residents
      FROM caretakers c
      ${where}
      ORDER BY c.name
    `, own || []);
    for(const row of rows){
      if(req.user.role==='caretaker')row.assigned_residents=await effectiveResidentIds(pool,[row.caretaker_id]);
    }
    res.json(rows);
  } catch (error) {
    console.error('[Caretakers] List error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caretakers — Create a new caretaker (admin)
router.post('/', async (req, res) => {
  let connection;
  try {
    if (!isAdminRequest(req)) return res.status(403).json({ error: 'Only admin can add caretakers' });
    const { name, email, phone, specialization } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Caretaker name and email are required' });
    }
    const caretakerId = `CT-${randomUUID().slice(0, 8).toUpperCase()}`;
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.execute(
      'INSERT INTO caretakers (caretaker_id, name, email, phone, specialization, is_active) VALUES (?, ?, ?, ?, ?, TRUE)',
      [caretakerId, name.trim(), email.trim().toLowerCase(), phone || null, specialization || null]
    );
    const [existing] = await connection.execute('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()]);
    if (!existing.length) {
      const uid = `USER-${randomUUID().slice(0, 12)}`;
      await connection.execute(
        'INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?)',
        [uid, name.trim(), email.trim().toLowerCase(), 'caretaker']
      );
    }
    await connection.commit();
    res.status(201).json({ message: 'Caretaker created', caretakerId, name, email });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('[Caretakers] Create error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    connection?.release();
  }
});

// PUT /api/caretakers/reassign-resident — Reassign a resident from one caretaker to another
router.put('/reassign-resident', async (req, res) => {
  let connection;
  try {
    if (!isAdminRequest(req)) return res.status(403).json({ error: 'Only admin can reassign residents' });
    const { residentId, fromCaretakerId, toCaretakerId } = req.body;
    if (!validText(residentId,50) || toCaretakerId!==null&&!validText(toCaretakerId,50) || fromCaretakerId!==undefined&&!validText(fromCaretakerId,50)) {
      return res.status(400).json({ error: 'Provide a resident and active target caretaker ID, or null to unassign' });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [residents] = await connection.execute('SELECT resident_id FROM residents WHERE resident_id = ? FOR UPDATE', [residentId]);
    const [caretakers] = toCaretakerId===null?[[]]:await connection.execute('SELECT caretaker_id FROM caretakers WHERE caretaker_id = ? AND is_active = TRUE', [toCaretakerId]);
    if (!residents.length || toCaretakerId!==null&&!caretakers.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Resident or active replacement caretaker not found' });
    }
    // Validate the replacement before removing an assignment, and commit both.
    if (fromCaretakerId) {
      await connection.execute(
        'DELETE FROM caretaker_residents WHERE caretaker_id = ? AND resident_id = ?',
        [fromCaretakerId, residentId]
      );
    }
    else if(toCaretakerId===null)await connection.execute('DELETE FROM caretaker_residents WHERE resident_id=?',[residentId]);

    // Create new assignment
    if(toCaretakerId!==null)await connection.execute(
      'INSERT IGNORE INTO caretaker_residents (caretaker_id, resident_id) VALUES (?, ?)',
      [toCaretakerId, residentId]
    );
    await appendAudit(connection,{actorType:'user',actorId:req.user.uid,action:toCaretakerId===null?'resident_unassigned':'resident_reassigned',resourceType:'resident',resourceId:residentId,residentId,details:{fromCaretakerId:fromCaretakerId||null,toCaretakerId}});
    await connection.commit();

    res.json({ message: 'Resident reassigned', residentId, toCaretakerId });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('[Caretakers] Reassign error:', error.message);
    res.status(500).json({ error: 'Could not reassign resident. Existing assignments were preserved.' });
  } finally {
    connection?.release();
  }
});

// GET /api/caretakers/:id — Get single caretaker
// Supports lookup by caretaker_id (e.g. "CT001") OR Firebase UID (falls back to email match)
router.get('/:id', async (req, res) => {
  try {
    const lookupId = req.authorizedCaretakerId || req.params.id;
    // 1. Try direct lookup by caretaker_id
    let [rows] = await pool.execute(`
      SELECT c.*,
        (SELECT JSON_ARRAYAGG(cr.resident_id) FROM caretaker_residents cr WHERE cr.caretaker_id = c.caretaker_id) as assigned_residents
      FROM caretakers c
      WHERE c.caretaker_id = ?
    `, [lookupId]);

    // 2. If not found, the :id might be a Firebase UID — look up user's email, then find caretaker by email
    if (rows.length === 0) {
      const [userRows] = await pool.execute('SELECT email FROM users WHERE id = ?', [lookupId]);
      if (userRows.length > 0) {
        [rows] = await pool.execute(`
          SELECT c.*,
            (SELECT JSON_ARRAYAGG(cr.resident_id) FROM caretaker_residents cr WHERE cr.caretaker_id = c.caretaker_id) as assigned_residents
          FROM caretakers c
          WHERE c.email = ?
        `, [userRows[0].email]);
      }
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Caretaker not found' });
    }

    const caretaker = rows[0];
    if(req.user?.role==='caretaker')caretaker.assigned_residents=await effectiveResidentIds(pool,[caretaker.caretaker_id]);

    // Get leave requests
    const [leaveRequests] = await pool.execute(
      'SELECT l.*,r.name temporary_replacement_name FROM leave_requests l LEFT JOIN caretakers r ON r.caretaker_id=l.temporary_replacement WHERE l.caretaker_id = ? ORDER BY l.request_date DESC',
      [caretaker.caretaker_id]
    );

    caretaker.leaveRequests = leaveRequests;

    res.json(caretaker);
  } catch (error) {
    console.error('[Caretakers] Get error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caretakers/:id/assign-resident — Assign a resident to caretaker
router.post('/:id/assign-resident', async (req, res) => {
  let connection;
  try {
    const { residentId } = req.body;

    if (!residentId) {
      return res.status(400).json({ error: 'residentId is required' });
    }
    const admin = isAdminRequest(req);
    if (!admin && (req.user?.role !== 'patient' || !req.residentScope?.includes(residentId))) {
      return res.status(403).json({ error: 'Only admin or the resident account can select a caretaker' });
    }
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [residents] = await connection.execute('SELECT resident_id FROM residents WHERE resident_id = ? FOR UPDATE', [residentId]);
    const [caretakers] = await connection.execute('SELECT caretaker_id FROM caretakers WHERE caretaker_id = ? AND is_active = TRUE', [req.params.id]);
    if (!residents.length || !caretakers.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Resident or active caretaker not found' });
    }
    if (!admin) {
      const [assignments] = await connection.execute('SELECT caretaker_id FROM caretaker_residents WHERE resident_id = ?', [residentId]);
      if (assignments.length && !assignments.some(row => row.caretaker_id === req.params.id)) {
        await connection.rollback();
        return res.status(403).json({ error: 'Ask an administrator to change your assigned caretaker' });
      }
    }
    await connection.execute(
      'INSERT IGNORE INTO caretaker_residents (caretaker_id, resident_id) VALUES (?, ?)',
      [req.params.id, residentId]
    );
    await connection.commit();

    res.status(201).json({
      message: 'Resident assigned to caretaker',
      caretakerId: req.params.id,
      residentId,
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('[Caretakers] Assign resident error:', error.message);
    res.status(500).json({ error: 'Could not assign caretaker' });
  } finally {
    connection?.release();
  }
});

// PUT /api/caretakers/:id — Update caretaker
router.put('/:id', async (req, res) => {
  let connection;
  try {
    if(!isAdminRequest(req))return res.status(403).json({error:'Only admin can update caretakers'});
    const { name, email, phone, specialization, isActive } = req.body;
    const fields = [];
    const values = [];

    if (name) { fields.push('name = ?'); values.push(name); }
    if (email) { fields.push('email = ?'); values.push(email.trim().toLowerCase()); }
    if (phone) { fields.push('phone = ?'); values.push(phone); }
    if (specialization) { fields.push('specialization = ?'); values.push(specialization); }
    if (isActive !== undefined) { fields.push('is_active = ?'); values.push(isActive); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.id);
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [orig] = await connection.execute('SELECT email FROM caretakers WHERE caretaker_id = ? FOR UPDATE', [req.params.id]);
    if (!orig.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Caretaker not found' });
    }
    const oldEmail = orig[0].email;

    await connection.execute(`UPDATE caretakers SET ${fields.join(', ')} WHERE caretaker_id = ?`, values);

    if (email && oldEmail && email.trim().toLowerCase() !== oldEmail.toLowerCase()) {
      await connection.execute('UPDATE users SET email = ? WHERE LOWER(email) = LOWER(?) AND role = "caretaker"', [email.trim().toLowerCase(), oldEmail.toLowerCase()]);
    }

    await connection.commit();
    res.json({ message: 'Caretaker updated' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('[Caretakers] Update error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    connection?.release();
  }
});

// ── Leave Requests ──

// GET /api/caretakers/all/leave-requests
router.get('/all/leave-requests', async (req, res) => {
  try {
    if(!isAdminRequest(req))return res.status(403).json({error:'Only admin can review all leave requests'});
    const [rows] = await pool.execute(
      'SELECT l.*,c.name caretaker_name,r.name temporary_replacement_name FROM leave_requests l JOIN caretakers c ON c.caretaker_id=l.caretaker_id LEFT JOIN caretakers r ON r.caretaker_id=l.temporary_replacement ORDER BY l.request_date DESC'
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
    const caretakerId = req.authorizedCaretakerId || await resolveCaretakerId(req.params.id);
    if (!caretakerId) return res.status(404).json({ error: 'Caretaker not found' });

    const [rows] = await pool.execute(
      'SELECT l.*,r.name temporary_replacement_name FROM leave_requests l LEFT JOIN caretakers r ON r.caretaker_id=l.temporary_replacement WHERE l.caretaker_id = ? ORDER BY l.request_date DESC',
      [caretakerId]
    );
    res.json(rows);
  } catch (error) {
    console.error('[LeaveRequests] List error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/caretakers/:id/leave-requests
router.post('/:id/leave-requests', async (req, res) => {
  let connection;
  try {
    if(req.user?.role!=='caretaker'||!req.authorizedCaretakerId)return res.status(403).json({error:'Caretakers may submit only their own leave requests'});
    const caretakerId = req.authorizedCaretakerId || await resolveCaretakerId(req.params.id);
    if (!caretakerId) return res.status(404).json({ error: 'Caretaker not found' });

    const { startDate, endDate, reason } = req.body;
    if (!validDate(startDate) || !validDate(endDate) || startDate<colomboDay() || endDate < startDate || !validText(reason, 5000)) {
      return res.status(400).json({ error: 'Provide a reason and valid start/end calendar dates in order' });
    }
    const requestId = `LR-${randomUUID()}`;
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;

    connection=await pool.getConnection();await connection.beginTransaction();
    const [staff]=await connection.execute('SELECT name FROM caretakers WHERE caretaker_id=? AND is_active=TRUE FOR UPDATE',[caretakerId]);
    if(!staff.length){await connection.rollback();return res.status(404).json({error:'Active caretaker not found'});}
    const [overlap]=await connection.execute("SELECT request_id FROM leave_requests WHERE caretaker_id=? AND status IN ('pending','approved') AND start_date<=? AND end_date>=? LIMIT 1",[caretakerId,endDate,startDate]);
    if(overlap.length){await connection.rollback();return res.status(409).json({error:'This period overlaps an existing leave request'});}
    await connection.execute(
      `INSERT INTO leave_requests (request_id, caretaker_id, caretaker_name, start_date, end_date, number_of_days, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [requestId, caretakerId, staff[0].name, startDate, endDate, days, reason.trim()]
    );
    await appendAudit(connection,{actorType:'user',actorId:req.user.uid,action:'leave_requested',resourceType:'leave_request',resourceId:requestId,details:{caretakerId,startDate,endDate,days}});
    await connection.commit();

    res.status(201).json({ message: 'Leave request created', requestId });
  } catch (error) {
    if(connection)await connection.rollback().catch(()=>{});
    console.error('[LeaveRequests] Create error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {connection?.release();}
});

// PUT /api/caretakers/:caretakerId/leave-requests/:requestId
router.put('/:caretakerId/leave-requests/:requestId', async (req, res) => {
  let connection;
  try {
    if(!isAdminRequest(req))return res.status(403).json({error:'Only admin can review leave'});
    const { status, temporaryReplacement } = req.body||{};
    if (!['approved', 'rejected'].includes(status) || status==='approved'&&!validText(temporaryReplacement,50)) return res.status(400).json({ error: 'Approve with an active replacement caretaker ID, or reject the request' });
    connection=await pool.getConnection();await connection.beginTransaction();
    // A stable staff lock order also serializes overlapping replacement approvals.
    const ids=[req.params.caretakerId,...(status==='approved'?[temporaryReplacement]:[])].sort();
    const [staff]=await connection.execute(`SELECT caretaker_id,is_active FROM caretakers WHERE caretaker_id IN (${ids.map(()=>'?').join(',')}) ORDER BY caretaker_id FOR UPDATE`,ids);
    const [requests]=await connection.execute('SELECT * FROM leave_requests WHERE request_id=? AND caretaker_id=? FOR UPDATE',[req.params.requestId,req.params.caretakerId]);
    if(!requests.length){await connection.rollback();return res.status(404).json({error:'Leave request not found'});}
    const request=requests[0],replacement=status==='approved'?temporaryReplacement:null;
    if(request.status===status&&(request.temporary_replacement||null)===replacement){await connection.commit();return res.json({message:'Leave review already saved',replayed:true});}
    if(request.status!=='pending'){await connection.rollback();return res.status(409).json({error:'This leave request has already been reviewed'});}
    if(status==='approved'){
      if(temporaryReplacement===req.params.caretakerId||!staff.some(c=>c.caretaker_id===temporaryReplacement&&Number(c.is_active)===1)){
        await connection.rollback();return res.status(400).json({error:'Choose a different active replacement caretaker'});
      }
      const [overlap]=await connection.execute("SELECT request_id FROM leave_requests WHERE caretaker_id=? AND status='approved' AND start_date<=? AND end_date>=? LIMIT 1",[temporaryReplacement,request.end_date,request.start_date]);
      if(overlap.length){await connection.rollback();return res.status(409).json({error:'The replacement caretaker is on leave during this period'});}
    }
    await connection.execute(
      `UPDATE leave_requests SET status = ?, reviewed_by = ?, review_date = NOW(), temporary_replacement = ?
       WHERE request_id = ? AND caretaker_id = ?`,
      [status, req.user.profile?.name || req.user.email || req.user.uid, replacement, req.params.requestId, req.params.caretakerId]
    );
    await appendAudit(connection,{actorType:'user',actorId:req.user.uid,action:`leave_${status}`,resourceType:'leave_request',resourceId:req.params.requestId,details:{caretakerId:req.params.caretakerId,temporaryReplacement:replacement,startDate:request.start_date,endDate:request.end_date}});
    await connection.commit();

    res.json({ message: 'Leave request updated' });
  } catch (error) {
    if(connection)await connection.rollback().catch(()=>{});
    console.error('[LeaveRequests] Update error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {connection?.release();}
});

// DELETE /api/caretakers/:caretakerId/leave-requests/:requestId — Withdraw/Cancel a pending leave request
router.delete('/:caretakerId/leave-requests/:requestId', async (req, res) => {
  let connection;
  try {
    const caretakerId = req.authorizedCaretakerId || (isAdminRequest(req) ? req.params.caretakerId : await resolveCaretakerId(req.params.caretakerId));
    if (!caretakerId) return res.status(403).json({ error: 'Unauthorized to cancel leave request' });

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [requests] = await connection.execute(
      'SELECT * FROM leave_requests WHERE request_id = ? AND caretaker_id = ? FOR UPDATE',
      [req.params.requestId, caretakerId]
    );
    if (!requests.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Leave request not found' });
    }
    const request = requests[0];
    if (request.status !== 'pending') {
      await connection.rollback();
      return res.status(400).json({ error: 'Only pending leave requests can be cancelled' });
    }
    await connection.execute(
      'DELETE FROM leave_requests WHERE request_id = ? AND caretaker_id = ?',
      [req.params.requestId, caretakerId]
    );
    await appendAudit(connection, {
      actorType: 'user',
      actorId: req.user.uid,
      action: 'leave_cancelled',
      resourceType: 'leave_request',
      resourceId: req.params.requestId,
      details: { caretakerId, startDate: request.start_date, endDate: request.end_date }
    });
    await connection.commit();
    res.json({ message: 'Leave request cancelled successfully' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('[LeaveRequests] Cancel error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    connection?.release();
  }
});

// DELETE /api/caretakers/:id/unassign-resident — Remove a resident from a caretaker
router.delete('/:id/unassign-resident', async (req, res) => {
  try {
    if(!isAdminRequest(req))return res.status(403).json({error:'Only admin can unassign residents'});
    const { residentId } = req.body;
    if (!residentId) {
      return res.status(400).json({ error: 'residentId is required' });
    }

    await pool.execute(
      'DELETE FROM caretaker_residents WHERE caretaker_id = ? AND resident_id = ?',
      [req.params.id, residentId]
    );

    res.json({ message: 'Resident unassigned from caretaker', caretakerId: req.params.id, residentId });
  } catch (error) {
    console.error('[Caretakers] Unassign resident error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Remove the server profile and assignments together, immediately revoking caretaker access.
router.delete('/:id', async (req, res) => {
  let connection;
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admin can delete caretakers' });
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT email FROM caretakers WHERE caretaker_id = ? FOR UPDATE', [req.params.id]);
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ error: 'Caretaker not found' });
    }
    await connection.execute('DELETE FROM users WHERE role = ? AND LOWER(email) = LOWER(?)', ['caretaker', rows[0].email]);
    await connection.execute('DELETE FROM caretakers WHERE caretaker_id = ?', [req.params.id]);
    await connection.commit();
    return res.json({ message: 'Caretaker deleted' });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error('[Caretakers] Delete error:', error.message);
    return res.status(500).json({ error: 'Could not delete caretaker' });
  } finally {
    connection?.release();
  }
});

export default router;
