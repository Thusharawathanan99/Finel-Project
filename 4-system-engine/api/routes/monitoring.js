import { Router } from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import pool from '../db.js';
import { canAccessResident } from '../middleware/authorization.js';
import { appendAudit, sha256, hasActiveConsent, hasObservationConsent } from '../monitoringService.js';
import { DEFAULT_SETTINGS, parseJSON, isEnabled, validInstant, validatedSettings, validPolygon } from '../monitoringConfig.js';
import { normalizeBaseline } from '../behaviorAnomalies.js';

const router = Router();
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const text = (value, max, optional = false) => optional && (value === undefined || value === null || value === '') ||
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const admin = req => { if (req.user?.role !== 'admin') fail(403, 'Administrator access is required'); };
const staff = req => { if (!['admin', 'caretaker'].includes(req.user?.role)) fail(403, 'Assigned care staff access is required'); };
const resident = (req, id) => { if (!canAccessResident(req, id)) fail(403, 'This resident is not assigned to your care'); };
const handler = fn => async (req, res) => {
  try {
    if (!req.user?.uid || !req.user?.profile) fail(401, 'A registered authenticated account is required');
    await fn(req, res);
  } catch (error) {
    if (!error.status) console.error('[Monitoring]', error.code || 'REQUEST_FAILED');
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Monitoring request could not be completed. Please retry.' });
  }
};
const audit = (connection, req, action, resourceType, resourceId, residentId = null, details = null) =>
  appendAudit(connection, {actorType:'user', actorId:req.user.uid, action, resourceType, resourceId, residentId, details});
async function transaction(fn) {
  const connection = await pool.getConnection();
  try { await connection.beginTransaction(); const result = await fn(connection); await connection.commit(); return result; }
  catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
}
async function deviceAccess(req, id, connection = pool) {
  const [devices] = await connection.execute('SELECT device_id FROM monitoring_devices WHERE device_id = ?', [id]);
  if (!devices.length) fail(404, 'Monitoring device not found');
  if (req.user.role === 'admin') return;
  const [assignments] = await connection.execute('SELECT resident_id FROM monitoring_device_residents WHERE device_id = ? AND unassigned_at IS NULL', [id]);
  if (!assignments.some(row => canAccessResident(req, row.resident_id))) fail(403, 'This camera is not assigned to your residents');
}

router.get('/devices', handler(async (req, res) => {
  staff(req);
  const scope = req.user.role === 'admin' ? null : req.residentScope || [];
  if (scope && !scope.length) return res.json([]);
  const where = scope ? `WHERE EXISTS (SELECT 1 FROM monitoring_device_residents dr WHERE dr.device_id = d.device_id AND dr.unassigned_at IS NULL AND dr.resident_id IN (${scope.map(() => '?').join(',')}))` : '';
  const [rows] = await pool.execute(`SELECT d.device_id,d.name,d.device_type,d.location,d.room_number,d.status,d.enabled,d.camera_state,d.last_seen_at,d.settings,d.last_health,d.created_at,d.updated_at FROM monitoring_devices d ${where} ORDER BY d.name LIMIT 200`, scope || []);
  for (const row of rows) {
    const [assignments] = await pool.execute('SELECT resident_id FROM monitoring_device_residents WHERE device_id = ? AND unassigned_at IS NULL', [row.device_id]);
    row.resident_ids = assignments.map(x => x.resident_id).filter(id => canAccessResident(req, id));
    row.settings = { ...DEFAULT_SETTINGS, ...parseJSON(row.settings) };
    row.last_health = parseJSON(row.last_health);
  }
  await audit(pool, req, 'monitoring_devices_read', 'monitoring_device', null);
  res.json(rows);
}));
router.post('/devices', handler(async (req, res) => {
  admin(req); const b = req.body || {};
  const types = ['browser_camera','ip_camera','raspberry_pi','jetson','simulator'];
  if (!text(b.name,255) || !types.includes(b.deviceType) || !text(b.location,255,true) || !text(b.roomNumber,50,true) || b.deviceId !== undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(b.deviceId)) fail(400,'Provide a valid device name, type and location');
  const deviceId = b.deviceId || `CAM-${randomUUID()}`;
  const token = randomBytes(32).toString('base64url');
  let settings=DEFAULT_SETTINGS;
  try {if(b.settings!==undefined)settings={...DEFAULT_SETTINGS,...validatedSettings(b.settings)};}catch(error){fail(400,error.message);}
  await transaction(async c => {
    await c.execute(`INSERT INTO monitoring_devices (device_id,name,device_type,location,room_number,enabled,camera_state,token_hash,token_rotated_at,settings,created_by_uid) VALUES (?,?,?,?,?,TRUE,'stopped',?,NOW(),?,?)`, [deviceId,b.name.trim(),b.deviceType,b.location || null,b.roomNumber || null,sha256(token),JSON.stringify(settings),req.user.uid]);
    await audit(c, req,'device_registered','monitoring_device',deviceId);
  });
  res.status(201).json({deviceId,device:{device_id:deviceId,name:b.name,camera_state:'stopped'},token});
}));
router.put('/devices/:id', handler(async (req, res) => {
  admin(req); const b = req.body || {}, fields = [], values = [];
  let settingsPatch;
  for (const [key,column,max] of [['name','name',255],['location','location',255],['roomNumber','room_number',50]]) {
    if (b[key] !== undefined) {
      if (!text(b[key],max,key !== 'name')) fail(400,`Invalid ${key}`);
      fields.push(`${column} = ?`); values.push(b[key] || null);
    }
  }
  if (b.enabled !== undefined) { if (typeof b.enabled !== 'boolean') fail(400,'Invalid enabled value'); fields.push('enabled = ?'); values.push(b.enabled); }
  if (b.cameraState !== undefined) { if (!['running','paused','stopped'].includes(b.cameraState)) fail(400,'Invalid camera state'); fields.push('camera_state = ?'); values.push(b.cameraState); }
  if (b.settings !== undefined) {
    try { settingsPatch = validatedSettings(b.settings); } catch (error) { fail(400,error.message); }
  }
  if (!fields.length && settingsPatch === undefined) fail(400,'No device settings provided');
  await transaction(async c => {
    await deviceAccess(req,req.params.id,c);
    if (settingsPatch !== undefined) {
      const [current] = await c.execute('SELECT settings FROM monitoring_devices WHERE device_id=? FOR UPDATE',[req.params.id]);
      if (!current.length) fail(404,'Monitoring device not found');
      fields.push('settings = ?'); values.push(JSON.stringify({...DEFAULT_SETTINGS,...parseJSON(current[0].settings),...settingsPatch}));
    }
    await c.execute(`UPDATE monitoring_devices SET ${fields.join(',')},updated_at=NOW() WHERE device_id=?`,[...values,req.params.id]);
    await audit(c,req,'device_settings_changed','monitoring_device',req.params.id,null,{cameraState:b.cameraState ?? null,enabled:b.enabled ?? null});
  });
  res.json({saved:true,deviceId:req.params.id});
}));
router.post('/devices/:id/rotate-token', handler(async (req,res) => {
  admin(req); const token=randomBytes(32).toString('base64url');
  await transaction(async c => {
    await deviceAccess(req,req.params.id,c);
    await c.execute('UPDATE monitoring_devices SET token_hash=?,token_rotated_at=NOW() WHERE device_id=?',[sha256(token),req.params.id]);
    await audit(c,req,'device_token_rotated','monitoring_device',req.params.id);
  }); res.json({token});
}));
router.put('/devices/:id/residents', handler(async (req,res) => {
  admin(req); const ids=req.body?.residentIds;
  if (!Array.isArray(ids) || ids.length>30 || ids.some(id=>!text(id,50)) || new Set(ids).size!==ids.length) fail(400,'Provide unique resident IDs');
  await transaction(async c=> {
    await c.execute('SELECT device_id FROM monitoring_devices WHERE device_id=? FOR UPDATE',[req.params.id]);
    await deviceAccess(req,req.params.id,c);
    for (const id of ids) { const [r]=await c.execute('SELECT resident_id FROM residents WHERE resident_id=?',[id]); if (!r.length) fail(404,'An assigned resident was not found'); }
    await c.execute('UPDATE monitoring_device_residents SET unassigned_at=NOW() WHERE device_id=? AND unassigned_at IS NULL',[req.params.id]);
    for (const id of ids) await c.execute('INSERT INTO monitoring_device_residents (device_id,resident_id,assigned_by_uid,assigned_at) VALUES (?,?,?,CURRENT_TIMESTAMP(6))',[req.params.id,id,req.user.uid]);
    await audit(c,req,'device_residents_assigned','monitoring_device',req.params.id,null,{residentIds:ids});
  });res.json({saved:true,residentIds:ids});
}));
router.get('/devices/:id/zones',handler(async(req,res)=>{
  staff(req);await deviceAccess(req,req.params.id);
  const [rows]=await pool.execute('SELECT zone_id,name,zone_type,polygon,enabled FROM monitoring_zones WHERE device_id=?',[req.params.id]);
  await audit(pool,req,'monitoring_zones_read','monitoring_device',req.params.id);
  res.json(rows.map(row=>({...row,polygon:parseJSON(row.polygon)})));
}));
router.post('/devices/:id/zones',handler(async(req,res)=>{
  admin(req);const b=req.body||{};
  if (!text(b.name,100)||!['normal','restricted','bed','exit'].includes(b.zoneType)||!validPolygon(b.polygon)) fail(400,'Provide a named normalized polygon with at least three points');
  const zoneId=await transaction(async c=>{
    await deviceAccess(req,req.params.id,c);
    const [r]=await c.execute('INSERT INTO monitoring_zones (device_id,name,zone_type,polygon,created_by_uid) VALUES (?,?,?,?,?)',[req.params.id,b.name,b.zoneType,JSON.stringify(b.polygon),req.user.uid]);
    await audit(c,req,'zone_created','monitoring_zone',String(r.insertId));return r.insertId;
  });res.status(201).json({zoneId});
}));

router.get('/residents/:id/consents',handler(async(req,res)=>{
  resident(req,req.params.id);
  const [rows]=await pool.execute('SELECT * FROM monitoring_consents WHERE resident_id=? ORDER BY effective_at DESC,consent_id DESC LIMIT 100',[req.params.id]);
  const active={};for(const scope of ['camera','activity','emotion','research']) active[scope]=await hasActiveConsent(pool,req.params.id,scope);
  await audit(pool,req,'consent_read','monitoring_consent',null,req.params.id);
  res.json(rows.map(row=>({...row,active:active[row.scope] && row === rows.find(x=>x.scope===row.scope)})));
}));
router.post('/residents/:id/consents',handler(async(req,res)=>{
  resident(req,req.params.id);const b=req.body||{};
  if (!['camera','activity','emotion','research'].includes(b.scope)||!['granted','withdrawn'].includes(b.status)||!['en','ta','si'].includes(b.language)||!['resident','guardian','administrator'].includes(b.subjectRole)||!text(b.notes,1000,true)||!text(b.guardianName,255,true)) fail(400,'Invalid consent record');
  if (req.user.role==='patient' && b.subjectRole!=='resident') fail(403,'Patients may record only their own consent');
  if (b.status==='granted' && (b.confirmed!==true || (req.user.role!=='patient' && !text(b.notes,1000)) || (b.subjectRole==='guardian' && !text(b.guardianName,255)))) fail(400,'Confirm informed consent and record its written reference; guardian consent requires a guardian name');
  if (b.expiresAt!==undefined && b.expiresAt!==null && (!validInstant(b.expiresAt)||Date.parse(b.expiresAt)<=Date.now())) fail(400,'Consent expiry must be a future timestamp with timezone');
  const id=await transaction(async c=>{
    // Serialize grant/withdrawal with event recording using the same device locks.
    await c.execute('SELECT d.device_id FROM monitoring_devices d JOIN monitoring_device_residents a ON a.device_id=d.device_id WHERE a.resident_id=? AND a.unassigned_at IS NULL ORDER BY d.device_id FOR UPDATE',[req.params.id]);
    const [r]=await c.execute('INSERT INTO monitoring_consents (resident_id,scope,status,granted_by_uid,subject_role,guardian_name,language,notes,expires_at) VALUES (?,?,?,?,?,?,?,?,?)',[req.params.id,b.scope,b.status,req.user.uid,b.subjectRole,b.guardianName||null,b.language,b.notes||null,b.expiresAt?new Date(b.expiresAt):null]);
    await audit(c,req,`consent_${b.status}`,'monitoring_consent',String(r.insertId),req.params.id,{scope:b.scope,language:b.language});return r.insertId;
  });res.status(201).json({consentId:id,saved:true});
}));

router.get('/incidents',handler(async(req,res)=>{
  staff(req);const scope=req.user.role==='admin'?null:req.residentScope||[];
  if(scope&&!scope.length)return res.json([]);
  const clauses=[],values=[];
  if(req.query.all!=='true')clauses.push("i.status IN ('open','acknowledged')");
  if(req.query.residentId){resident(req,req.query.residentId);clauses.push('COALESCE(i.corrected_resident_id,i.resident_id)=?');values.push(req.query.residentId);}
  if(scope){clauses.push(`(COALESCE(i.corrected_resident_id,i.resident_id) IN (${scope.map(()=>'?').join(',')}) OR COALESCE(i.corrected_resident_id,i.resident_id) IS NULL AND EXISTS (SELECT 1 FROM monitoring_device_residents a WHERE a.device_id=i.device_id AND a.unassigned_at IS NULL AND a.resident_id IN (${scope.map(()=>'?').join(',')})))`);values.push(...scope,...scope);}
  const [rows]=await pool.execute(`SELECT i.*,r.name resident_name,d.name device_name,d.location,u.name acknowledged_by_name,CASE WHEN i.acknowledged_at>=i.detected_at THEN TIMESTAMPDIFF(SECOND,i.detected_at,i.acknowledged_at) ELSE NULL END response_time_seconds FROM monitoring_incidents i LEFT JOIN residents r ON r.resident_id=COALESCE(i.corrected_resident_id,i.resident_id) JOIN monitoring_devices d ON d.device_id=i.device_id LEFT JOIN users u ON u.id=i.acknowledged_by_uid ${clauses.length?'WHERE '+clauses.join(' AND '):''} ORDER BY i.detected_at DESC LIMIT 100`,values);
  await audit(pool,req,'incidents_read','monitoring_incident',null);
  res.json(rows);
}));
router.get('/incidents/:id/actions',handler(async(req,res)=>{
  staff(req);const [rows]=await pool.execute('SELECT * FROM monitoring_incidents WHERE incident_id=?',[req.params.id]);
  if(!rows.length)fail(404,'Incident not found');
  const row=rows[0],residentId=row.corrected_resident_id||row.resident_id;if(residentId)resident(req,residentId);else await deviceAccess(req,row.device_id);
  const [actions]=await pool.execute('SELECT a.*,u.name actor_name FROM monitoring_incident_actions a LEFT JOIN users u ON u.id=a.actor_uid WHERE a.incident_id=? ORDER BY a.action_id',[req.params.id]);
  await audit(pool,req,'incident_actions_read','monitoring_incident',req.params.id,residentId);res.json(actions);
}));
router.post('/incidents/:id/actions',handler(async(req,res)=>{
  staff(req);const b=req.body||{};
  if(!/^\d{1,15}$/.test(req.params.id)||!['acknowledged','emergency_contacted','false_alarm','resolved','resident_corrected','note'].includes(b.action)||!text(b.notes,2000,true))fail(400,'Invalid incident action');
  if(['false_alarm','resolved','resident_corrected','note'].includes(b.action)&&!text(b.notes,2000))fail(400,'Provide the verification or resolution reason');
  const saved=await transaction(async c=>{
    const [rows]=await c.execute('SELECT * FROM monitoring_incidents WHERE incident_id=? FOR UPDATE',[req.params.id]);if(!rows.length)fail(404,'Incident not found');const row=rows[0];
    const currentResidentId=row.corrected_resident_id||row.resident_id;
    if(currentResidentId)resident(req,currentResidentId);else await deviceAccess(req,row.device_id,c);
    if(row.status===b.action && ['resolved','false_alarm'].includes(b.action) && row.resolution_notes===b.notes)return {...row,saved:true,replayed:true};
    if(['resolved','false_alarm'].includes(row.status)&&!['note'].includes(b.action))fail(409,'This incident is already closed');
    if(b.action==='resident_corrected'){
      resident(req,b.residentId);
      if(currentResidentId===b.residentId)return {...row,saved:true,replayed:true};
      // This device lock also serializes consent withdrawal and reassignment.
      await c.execute('SELECT device_id FROM monitoring_devices WHERE device_id=? FOR UPDATE',[row.device_id]);
      const [a]=await c.execute('SELECT resident_id,assigned_at FROM monitoring_device_residents WHERE device_id=? AND resident_id=? AND unassigned_at IS NULL',[row.device_id,b.residentId]);
      const observedAt=new Date(row.detected_at);
      if(!a.length || !Number.isFinite(observedAt.getTime()) || new Date(a[0].assigned_at).getTime()>observedAt.getTime())fail(403,'Corrected resident must have been assigned to this camera at capture');
      if(!await hasObservationConsent(c,b.residentId,observedAt))fail(403,'Corrected resident requires camera and activity consent at capture and correction');
      await c.execute('UPDATE monitoring_incidents SET corrected_resident_id=? WHERE incident_id=?',[b.residentId,row.incident_id]);
      if(row.event_id)await c.execute('UPDATE activity_events SET resident_id=? WHERE event_id=?',[b.residentId,row.event_id]);
    }else if(b.action==='acknowledged'){
      if(row.status==='acknowledged')return {...row,saved:true,replayed:true};
      await c.execute("UPDATE monitoring_incidents SET status='acknowledged',acknowledged_by_uid=?,acknowledged_at=NOW(3) WHERE incident_id=?",[req.user.uid,row.incident_id]);
    }else if(b.action==='emergency_contacted'){
      if(row.emergency_contacted_at)return {...row,saved:true,replayed:true};
      await c.execute('UPDATE monitoring_incidents SET emergency_contacted_at=NOW(3) WHERE incident_id=?',[row.incident_id]);
    }else if(['false_alarm','resolved'].includes(b.action)){
      await c.execute('UPDATE monitoring_incidents SET status=?,resolved_by_uid=?,resolved_at=NOW(3),resolution_notes=?,acknowledged_at=COALESCE(acknowledged_at,NOW(3)),acknowledged_by_uid=COALESCE(acknowledged_by_uid,?) WHERE incident_id=?',[b.action,req.user.uid,b.notes,req.user.uid,row.incident_id]);
      if(row.event_id)await c.execute('UPDATE activity_events SET review_status=?,reviewed_by_uid=?,reviewed_at=NOW() WHERE event_id=?',[b.action==='false_alarm'?'false_positive':'confirmed',req.user.uid,row.event_id]);
    }
    await c.execute('INSERT INTO monitoring_incident_actions (incident_id,action,actor_uid,notes,metadata) VALUES (?,?,?,?,?)',[row.incident_id,b.action,req.user.uid,b.notes||null,b.action==='resident_corrected'?JSON.stringify({residentId:b.residentId,previousResidentId:row.corrected_resident_id||row.resident_id}):null]);
    await audit(c,req,`incident_${b.action}`,'monitoring_incident',String(row.incident_id),b.action==='resident_corrected'?b.residentId:currentResidentId);
    const [updated]=await c.execute('SELECT * FROM monitoring_incidents WHERE incident_id=?',[row.incident_id]);return {...updated[0],saved:true};
  });res.json(saved);
}));

router.get('/residents/:id/events',handler(async(req,res)=>{
  resident(req,req.params.id);const [rows]=await pool.execute('SELECT a.*,i.incident_id FROM activity_events a LEFT JOIN monitoring_incidents i ON i.event_id=a.event_id WHERE a.resident_id=? ORDER BY a.observed_at DESC LIMIT 200',[req.params.id]);
  await audit(pool,req,'activity_events_read','activity_event',null,req.params.id);res.json(rows);
}));
router.post('/residents/:id/events/:eventId/review',handler(async(req,res)=>{
  staff(req);resident(req,req.params.id);const b=req.body||{};
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.eventId)||
      !['confirmed','false_positive'].includes(b.status)||!text(b.notes,2000))fail(400,'Provide a valid observation, review decision and verification reason');
  const saved=await transaction(async c=>{
    const [found]=await c.execute('SELECT device_id FROM activity_events WHERE event_id=? AND resident_id=?',[req.params.eventId,req.params.id]);
    if(!found.length)fail(404,'Observation not found');
    // Match capture/consent lock ordering so withdrawal cannot race this review.
    await c.execute('SELECT device_id FROM monitoring_devices WHERE device_id=? FOR UPDATE',[found[0].device_id]);
    const [events]=await c.execute('SELECT event_id,resident_id,device_id,observed_at,review_status FROM activity_events WHERE event_id=? AND resident_id=? FOR UPDATE',[req.params.eventId,req.params.id]);
    if(!events.length)fail(404,'Observation no longer belongs to this resident');
    const event=events[0];
    const [incidents]=await c.execute('SELECT incident_id FROM monitoring_incidents WHERE event_id=? LIMIT 1',[event.event_id]);
    if(incidents.length)fail(409,'Review this emergency observation through its incident workflow');
    if(event.review_status===b.status)return {eventId:event.event_id,residentId:event.resident_id,reviewStatus:b.status,saved:true,replayed:true};
    if(!await hasObservationConsent(c,event.resident_id,new Date(event.observed_at)))fail(403,'Camera and activity consent are required at capture and review');
    await c.execute('UPDATE activity_events SET review_status=?,reviewed_by_uid=?,reviewed_at=NOW() WHERE event_id=?',[b.status,req.user.uid,event.event_id]);
    await audit(c,req,'activity_observation_reviewed','activity_event',event.event_id,event.resident_id,{status:b.status,notes:b.notes});
    return {eventId:event.event_id,residentId:event.resident_id,reviewStatus:b.status,saved:true,replayed:false};
  });res.json(saved);
}));
router.get('/residents/:id/baseline',handler(async(req,res)=>{
  resident(req,req.params.id);const [rows]=await pool.execute('SELECT * FROM activity_baselines WHERE resident_id=?',[req.params.id]);
  await audit(pool,req,'resident_care_plan_read','activity_baseline',req.params.id,req.params.id);
  res.json(rows.length?{...rows[0],baseline:parseJSON(rows[0].baseline)}:{resident_id:req.params.id,baseline:null,sample_count:0});
}));
router.put('/residents/:id/baseline',handler(async(req,res)=>{
  staff(req);resident(req,req.params.id);let baseline;try{baseline=normalizeBaseline(req.body?.baseline);}catch(error){fail(400,error.message);}
  await transaction(async c=>{
    await c.execute('SELECT d.device_id FROM monitoring_devices d JOIN monitoring_device_residents a ON a.device_id=d.device_id WHERE a.resident_id=? AND a.unassigned_at IS NULL ORDER BY d.device_id FOR UPDATE',[req.params.id]);
    await c.execute("INSERT INTO activity_baselines (resident_id,baseline,sample_count,model_version) VALUES (?,?,0,'care-plan-rules-v1') ON DUPLICATE KEY UPDATE baseline=VALUES(baseline),sample_count=0,model_version=VALUES(model_version)",[req.params.id,JSON.stringify(baseline)]);
    await audit(c,req,'resident_care_plan_configured','activity_baseline',req.params.id,req.params.id,{baseline});
  });res.json({saved:true,baseline,source:'care_staff_configured',clinicallyValidated:false});
}));
router.get('/residents/:id/record',handler(async(req,res)=>{
  resident(req,req.params.id);const [people]=await pool.execute('SELECT * FROM residents WHERE resident_id=?',[req.params.id]);if(!people.length)fail(404,'Resident not found');
  const sections={};for(const [name,sql] of Object.entries({
    prescriptions:'SELECT * FROM prescriptions WHERE resident_id=? ORDER BY date_issued DESC LIMIT 100',
    medications:'SELECT m.* FROM medications m JOIN prescriptions p ON p.prescription_id=m.prescription_id WHERE p.resident_id=?',
    appointments:'SELECT * FROM appointments WHERE resident_id=? ORDER BY appointment_date DESC LIMIT 100',
    careNotes:'SELECT * FROM care_notes WHERE resident_id=? ORDER BY created_at DESC LIMIT 100',
    medicationHistory:'SELECT * FROM medication_events WHERE resident_id=? ORDER BY recorded_at DESC LIMIT 200',
    emergencies:'SELECT * FROM sos_alerts WHERE resident_id=? ORDER BY created_at DESC LIMIT 100',
  })) { const [rows]=await pool.execute(sql,[req.params.id]);sections[name]=rows; }
  await audit(pool,req,'medical_record_read','resident',req.params.id,req.params.id);res.json({resident:people[0],...sections});
}));
router.post('/residents/:id/care-notes',handler(async(req,res)=>{
  staff(req);resident(req,req.params.id);if(!text(req.body?.note,4000))fail(400,'Provide a care note');
  const id=await transaction(async c=>{const [r]=await c.execute('INSERT INTO care_notes (resident_id,note,recorded_by_uid) VALUES (?,?,?)',[req.params.id,req.body.note,req.user.uid]);await audit(c,req,'care_note_added','care_note',String(r.insertId),req.params.id);return r.insertId;});res.status(201).json({noteId:id,saved:true});
}));
router.get('/report',handler(async(req,res)=>{
  admin(req);const [rows]=await pool.execute(`SELECT incident_type,COUNT(*) incident_count,SUM(status='false_alarm') false_alarm_count,AVG(CASE WHEN acknowledged_at>=detected_at THEN TIMESTAMPDIFF(SECOND,detected_at,acknowledged_at) ELSE NULL END) average_response_seconds,SUM(CASE WHEN acknowledged_at<detected_at THEN 1 ELSE 0 END) clock_skew_count,SUM(status IN ('open','acknowledged')) open_count FROM monitoring_incidents GROUP BY incident_type`);
  await audit(pool,req,'incident_report_exported','monitoring_incident',null);res.json({generatedAt:new Date().toISOString(),metrics:rows,responseTimeNote:'Response-time averages exclude acknowledgements earlier than detection; these cases are counted as clock skew.',accuracy:'Requires labeled held-out evaluation; operational counts do not measure model accuracy.'});
}));
router.get('/audit',handler(async(req,res)=>{
  admin(req);const [rows]=await pool.execute('SELECT * FROM audit_events ORDER BY audit_id DESC LIMIT 500');
  await audit(pool,req,'audit_report_read','audit_event',null);res.json(rows);
}));

export default router;
