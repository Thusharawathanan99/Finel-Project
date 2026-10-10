import pool from '../db.js';

export function canAccessResident(req, residentId) {
  return Boolean(residentId) && (req.user?.role === 'admin' || req.residentScope?.includes(residentId));
}

// This runs before any router, covering resident records and their subresources.
// IDs in the URL/body never grant access; identity, server roles and assignments do.
export async function authorizationMiddleware(req, res, next) {
  try {
    // Match route boundaries before decoding IDs. An encoded slash is part of an
    // Express parameter and must never become a different authorization route.
    const path = req.path.replace(/\/+$/, '') || '/';
    const matchPath = pattern => {
      const match = pattern.exec(path);
      if (match?.[1]) match[1] = decodeURIComponent(match[1]);
      return match;
    };
    const method = req.method;
    const admin = req.user?.role === 'admin';
    const registered = Boolean(req.user?.profile) || admin;
    const denied = () => res.status(403).json({ error: 'You do not have permission to access this resource' });
    const resident = id => canAccessResident(req, id) ? next() : denied();
    const careStaff = admin || req.user?.role === 'caretaker';
    const ownCaretaker = id => {
      if (req.user?.role !== 'caretaker') return false;
      const ids = req.user.caretakerIds || [];
      // Canonical IDs come from authenticated assignments. A Firebase UID can
      // collide with somebody else's caretaker_id and must not be resolved first.
      const canonical = id === req.user.uid ? ids[0] : ids.find(value => value === id);
      if (!canonical) return false;
      req.authorizedCaretakerId = canonical;
      return true;
    };
    const ownedRecord = async (table, column, id, staffOnly = false) => {
      if (staffOnly && !careStaff) return denied();
      const [rows] = await pool.execute(`SELECT resident_id FROM ${table} WHERE ${column} = ? LIMIT 1`, [id]);
      if (!rows.length) return res.status(404).json({ error: 'Record not found' });
      return resident(rows[0].resident_id);
    };

    if (path === '/caretakers' && method === 'GET') return next();
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    if (path.startsWith('/users')) {
      if (path === '/users/register-patient' && method === 'POST') return next();
      if (path === '/users/register-caretaker' && method === 'POST') return admin ? next() : denied();
      if (path === '/users' && method === 'POST') return admin ? next() : denied();
      if (method === 'DELETE') return admin ? next() : denied();
      const match = matchPath(/^\/users\/([^/]+)$/);
      return match && (admin || match[1] === req.user.uid) ? next() : denied();
    }
    if (!registered) return denied();

    // Product role boundaries apply to direct API requests as well as screens.
    const patientEmotion = ['/emotions','/emotions/analyze-image','/emotions/wellness-alert','/emotions/face-status'];
    if (patientEmotion.includes(path)) {
      if (req.user.role !== 'patient') return denied();
      if (path === '/emotions/face-status') return method === 'GET' ? next() : denied();
      if (method !== 'POST') return denied();
      return path === '/emotions/analyze-image' ? next() : resident(req.body?.residentId);
    }
    if (admin && (path.startsWith('/ai/') || ['/analyze-prescription','/generate-meal-plan'].includes(path) ||
        path === '/prescriptions' && method === 'POST' || /^\/residents\/[^/]+\/meal-plan$/.test(path) && method !== 'GET')) return denied();
    const storage=matchPath(/^\/storage\/prescriptions\/([^/]+)\/access$/);
    if(storage)return method==='POST'&&['patient','caretaker'].includes(req.user.role)?resident(storage[1]):denied();

    // These routers perform device/incident ownership checks on each operation.
    if (path.startsWith('/monitoring/')) return next();
    if (path === '/push-devices' && ['GET','POST','DELETE'].includes(method)) return next();

    if (path === '/residents') {
      if (method === 'GET') return next(); // Listing query is restricted to req.residentScope.
      return admin ? next() : denied();
    }
    let match = matchPath(/^\/residents\/([^/]+)(?:\/.*)?$/);
    if (match) {
      if (method === 'DELETE' && /^\/residents\/[^/]+$/.test(path)) return admin ? next() : denied();
      return resident(match[1]);
    }
    if (path === '/prescriptions' && method === 'POST') return resident(req.body?.residentId);
    match = matchPath(/^\/prescriptions\/([^/]+)(?:\/medications)?$/);
    if (match) return ownedRecord('prescriptions', 'prescription_id', match[1]);

    if (path === '/appointments' || path === '/') {
      if (method === 'GET') return next();
      if (method === 'POST') return resident(req.body?.residentId);
    }
    match = matchPath(/^\/appointments\/([^/]+)$/);
    if (match) return ownedRecord('appointments', 'appointment_id', match[1]);

    if (path === '/complaints') {
      if (method === 'GET') return admin ? next() : denied();
      if (method === 'POST') return resident(req.body?.residentId);
    }
    if (/^\/complaints\/[^/]+$/.test(path)) return admin ? next() : denied();

    if (path === '/sos-alerts') {
      if (method === 'GET') return next(); // Listing is scoped below in its router.
      if (method === 'POST') return resident(req.body?.residentId);
    }
    if(path==='/sos-alerts/stream')return method==='GET'&&careStaff?next():denied();
    match = matchPath(/^\/sos-alerts\/([^/]+)\/resolve$/);
    if (match) return ownedRecord('sos_alerts', 'id', match[1], true);

    match = matchPath(/^\/notifications\/read-all\/([^/]+)$/);
    if (match) return resident(match[1]);
    match = matchPath(/^\/notifications\/([^/]+)\/read$/);
    if (match) return ownedRecord('notifications', 'notification_id', match[1]);

    if (path === '/emotions' || path === '/emotions/wellness-alert') return resident(req.body?.residentId);
    if (path === '/emotions/face-status') return method === 'GET' && req.user.uid && req.user.profile ? next() : denied();
    if (path === '/emotions/wellness-alerts' && method === 'GET') return admin ? next() : denied();
    match = matchPath(/^\/emotions\/wellness-alerts\/([^/]+)\/acknowledge$/);
    if (match) return ownedRecord('wellness_alerts', 'id', match[1], true);
    match = matchPath(/^\/emotions\/wellness-alerts\/([^/]+)$/);
    if (match) return admin || ownCaretaker(match[1]) ? next() : denied();
    if (['/emotions/analyze-image', '/analyze-prescription', '/generate-meal-plan', '/ai/generate', '/ai/cloud-nlp', '/ai/donut/health', '/ai/donut/predict'].includes(path)) return next();

    if (path.startsWith('/system/components')) return method === 'GET' || admin ? next() : denied();
    if (path.startsWith('/doctors')) return method === 'GET' || admin ? next() : denied();

    if (path.startsWith('/caretakers')) {
      if (admin) return next();
      // A patient can select a caretaker only for their own resident, with no prior assignment.
      match = matchPath(/^\/caretakers\/([^/]+)\/assign-resident$/);
      if (match && method === 'POST' && req.user.role === 'patient' && canAccessResident(req, req.body?.residentId)) {
        const [assignments] = await pool.execute('SELECT caretaker_id FROM caretaker_residents WHERE resident_id = ?', [req.body.residentId]);
        if (assignments.length && !assignments.some(row => row.caretaker_id === match[1])) return denied();
        const [active] = await pool.execute('SELECT caretaker_id FROM caretakers WHERE caretaker_id = ? AND is_active = TRUE', [match[1]]);
        return active.length ? next() : res.status(404).json({ error: 'Caretaker not available' });
      }
      match = matchPath(/^\/caretakers\/([^/]+)(?:\/leave-requests)?$/);
      const own = match && ownCaretaker(match[1]);
      // Caretakers may read their profile/leave requests and submit their own leave request.
      return own && (method === 'GET' || (method === 'POST' && path.endsWith('/leave-requests'))) ? next() : denied();
    }
    // Do not allow the legacy /:id appointment aliases to handle unrelated mutations.
    return admin ? next() : denied();
  } catch (error) {
    if (error instanceof URIError) return res.status(400).json({ error: 'Invalid resource identifier' });
    console.error('[Authorization] Permission check failed:', error.message);
    return res.status(503).json({ error: 'Permissions could not be verified. Please retry.' });
  }
}
