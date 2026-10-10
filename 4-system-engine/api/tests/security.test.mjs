// Run: node --experimental-vm-modules tests/security.test.mjs
// Uses the actual middleware/router sources with isolated Firebase/SQL doubles.
// Never opens a listener, connects to MySQL or calls a remote identity service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const api = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const identity = { uid: 'patient-a', email: 'a@example.test' };
const patientProfile = { id: identity.uid, email: identity.email, name: 'A', role: 'patient', resident_id: 'R-A' };

async function source(relative, { execute, connection, token = identity, tokenError = false, configured = true, env = {}, fetchImpl, acquireError = false, googleToken, firebaseUser, claimError = false, revokeError = false, commitError = false, fixedTime } = {}) {
  const statements = [], routes = [];
  const pool = {
    async execute(sql, values = []) {
      statements.push({ sql, values: Array.isArray(values) ? Array.from(values) : values });
      return execute ? execute(sql, values) : [[patientProfile]];
    },
    async query(sql, values = []) { return this.execute(sql, values); },
    async end() { statements.push({ transaction: 'pool-end' }); },
    async getConnection() { if (acquireError) throw new Error('Database unavailable'); return typeof connection === 'function' ? connection() : connection || this; },
    async beginTransaction() { statements.push({ transaction: 'begin' }); },
    async commit() { statements.push({ transaction: 'commit' }); if (commitError) throw new Error('Commit failed'); },
    async rollback() { statements.push({ transaction: 'rollback' }); },
    release() { statements.push({ transaction: 'release' }); },
  };
  const admin = {
    apps: googleToken ? [{}] : [], credential: { cert: () => ({}), applicationDefault: () => ({}) },
    initializeApp() { this.apps.push({}); },
    app: () => ({ options: { credential: { getAccessToken: async () => ({ access_token: googleToken }) } } }),
    auth: () => ({ async verifyIdToken() { if (tokenError) throw new Error('Invalid token'); return token; },
      async getUser(uid) { return firebaseUser || { uid, email: identity.email, emailVerified: true, customClaims: { role: 'admin' } }; },
      async setCustomUserClaims(uid, claims) { statements.push({ claims, uid }); if (claimError) throw new Error('Claim mutation failed'); },
      async revokeRefreshTokens(uid) { statements.push({ revoked: uid }); if (revokeError) throw new Error('Revoke failed'); },
    }),
  };
  function Router() {
    const router = {};
    for (const method of ['get', 'post', 'put', 'delete']) router[method] = (path, handler) => {
      routes.push({ method, path, handler }); return router;
    };
    return router;
  }
  const context = createContext({
    process: { argv: ['node', resolve(api, 'tests/security.test.mjs')], env: { NODE_ENV: 'development', ...(configured ? { FIREBASE_SERVICE_ACCOUNT_KEY: '{}' } : {}), ...env } },
    console: { log() {}, warn() {}, error() {} }, Buffer,
    AbortController, setTimeout, clearTimeout, setInterval, clearInterval, URL, Date: fixedTime === undefined ? Date : class extends Date { static now() { return fixedTime; } },
    fetch: fetchImpl || (async () => { throw new Error('Unexpected external request'); }),
  });
  const cache = new Map();
  async function synthetic(key, exports) {
    if (cache.has(key)) return cache.get(key);
    const module = new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
    cache.set(key, module);
    return module;
  }
  const filename = resolve(api, relative);
  const module = new SourceTextModule(await readFile(filename, 'utf8'), {
    context, identifier: filename,
    initializeImportMeta(meta) { meta.url = pathToFileURL(filename).href; },
  });
  cache.set(filename, module);
  async function linker(specifier, parent) {
    if (specifier === '../db.js' || specifier === './db.js') return synthetic(specifier, { default: pool });
    if (specifier === 'firebase-admin') return synthetic(specifier, { default: admin });
    if (specifier === 'express') return synthetic(specifier, { Router });
    if (specifier === 'dotenv') return synthetic(specifier, { default: { config() {} } });
    if (specifier === 'mysql2/promise') return synthetic(specifier, { default: {
      createConnection: async () => { throw new Error('Unexpected database connection'); },
      createPool(options) { statements.push({ poolOptions: options }); return { ...pool, pool: { on() {} } }; },
    } });
    if (specifier === 'fs') return synthetic(specifier, { existsSync: () => false, readFileSync: () => '{}' });
    if (specifier.startsWith('.')) {
      const target = resolve(dirname(parent.identifier), specifier);
      if (!cache.has(target)) {
        const child = new SourceTextModule(await readFile(target, 'utf8'), { context, identifier: target,
          initializeImportMeta(meta) { meta.url = pathToFileURL(target).href; }, });
        cache.set(target, child);
      }
      return cache.get(target);
    }
    return synthetic(specifier, await import(specifier));
  }
  await module.link(linker);
  await module.evaluate();
  return { module: module.namespace, statements, routes };
}

function response() {
  return { statusCode: 200, data: undefined, passed: false,
    headers: {}, set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.data = data; return this; },
    next() { this.passed = true; },
  };
}
function request(path, method = 'GET', user = { ...identity, role: 'patient', profile: patientProfile, caretakerIds: [] }) {
  return { path, method, user, headers: {}, body: {}, query: {}, params: {}, residentScope: ['R-A'] };
}
async function authorize(path, method = 'GET', changes = {}, execute) {
  const loaded = await source('middleware/authorization.js', { execute });
  const req = Object.assign(request(path, method), changes), res = response();
  await loaded.module.authorizationMiddleware(req, res, () => res.next());
  return { req, res, ...loaded };
}

test('missing credentials and missing token do not grant development admin access', async () => {
  const loaded = await source('middleware/auth.js', { configured: false });
  const req = request('/residents'), res = response();
  delete req.user;
  await loaded.module.authMiddleware(req, res, () => res.next());
  assert.equal(res.statusCode, 401); assert.equal(res.passed, false); assert.equal(req.user, undefined);
});

test('forged expired administrator JWT fails closed in every environment', async () => {
  const forged = `unsigned.${Buffer.from(JSON.stringify({ sub: 'attacker', role: 'admin', exp: 1 })).toString('base64url')}.unsigned`;
  for (const NODE_ENV of ['development', 'production', 'test', '']) {
    const loaded = await source('middleware/auth.js', { configured: false, env: { NODE_ENV, ALLOW_DEV_AUTH_BYPASS: 'true' } });
    const req = request('/residents'), res = response(); delete req.user; req.headers.authorization = `Bearer ${forged}`;
    await loaded.module.authMiddleware(req, res, () => res.next());
    assert.equal(res.statusCode, 503); assert.equal(res.passed, false); assert.equal(req.user, undefined);
    assert.equal(loaded.statements.length, 0);
  }
});
test('legacy AI endpoints require authentication and registered profiles', async () => {
  for (const path of ['/emotions/analyze-image', '/analyze-prescription', '/generate-meal-plan', '/ai/donut/predict']) {
    const loaded = await source('middleware/auth.js');
    const req = request(path, 'POST'), res = response(); delete req.user;
    await loaded.module.authMiddleware(req, res, () => res.next());
    assert.equal(res.statusCode, 401); assert.equal(res.passed, false);
    assert.equal((await authorize(path, 'POST', { user: undefined })).res.statusCode, 401);
    assert.equal((await authorize(path, 'POST', { user: { uid: 'new', role: 'unregistered', profile: null } })).res.statusCode, 403);
  }
});

test('face provider status requires a registered identity and permits only its exact GET route', async () => {
  const path = '/emotions/face-status';
  const loaded = await source('middleware/auth.js');
  const req = request(path), res = response(); delete req.user;
  await loaded.module.authMiddleware(req, res, () => res.next());
  assert.equal(res.statusCode, 401); assert.equal(res.passed, false);
  assert.equal((await authorize(path, 'GET', { user: undefined })).res.statusCode, 401);
  assert.equal((await authorize(path, 'GET', { user: { uid: 'new', role: 'unregistered', profile: null } })).res.statusCode, 403);
  assert.equal((await authorize(path, 'GET', { user: { uid: 'admin', role: 'admin', profile: null } })).res.statusCode, 403);
  for (const role of ['patient']) {
    const permitted = await authorize(path, 'GET', { user: { ...identity, role, profile: { ...patientProfile, role } } });
    assert.equal(permitted.res.passed, true); assert.equal(permitted.statements.length, 0);
  }
  for (const role of ['caretaker','admin']) assert.equal((await authorize(path,'GET',{user:{...identity,role,profile:{...patientProfile,role}}})).res.statusCode,403);
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'PATCH']) assert.equal((await authorize(path, method)).res.statusCode, 403);
  for (const other of [path + '/extra', '/emotions/face-status%2Fextra', '/emotions/face-status-other']) {
    assert.equal((await authorize(other)).res.statusCode, 403);
  }
  assert.equal((await authorize(path + '/')).res.passed, true);
});

test('admin cannot bypass restricted prescription, emotion, audio or meal-generation screens via API',async()=>{
  const user={...identity,role:'admin',profile:{...patientProfile,role:'admin'}};
  for(const [path,method] of [['/analyze-prescription','POST'],['/prescriptions','POST'],['/ai/cloud-nlp','POST'],['/ai/donut/predict','POST'],['/ai/generate','POST'],['/generate-meal-plan','POST'],['/residents/R-A/meal-plan','POST'],['/emotions/analyze-image','POST'],['/emotions','POST']]){
    const result=await authorize(path,method,{user,body:{residentId:'R-A'}});assert.equal(result.res.statusCode,403,path);assert.equal(result.statements.length,0);
  }
  for(const role of ['patient','caretaker'])assert.equal((await authorize('/analyze-prescription','POST',{user:{...identity,role,profile:{...patientProfile,role}}})).res.passed,true);
  assert.equal((await authorize('/emotions/analyze-image','POST',{user:{...identity,role:'caretaker',profile:patientProfile}})).res.statusCode,403);
});

test('face provider status router uses metadata only and is outside image inference quotas', async () => {
  const loaded = await source('routes/emotions.js', { env: { FACE_VISION_CREDENTIALS: '', FIREBASE_SERVICE_ACCOUNT_KEY: '' } });
  const route = loaded.routes.find(item => item.method === 'get' && item.path === '/emotions/face-status');
  assert.ok(route);
  const res = response(); route.handler(request('/emotions/face-status'), res);
  assert.deepEqual(JSON.parse(JSON.stringify(res.data)), { provider: 'google-cloud-vision', configurationState: 'missing', providerVerified: false });
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.equal(loaded.statements.length, 0);
  const limits = await source('middleware/inferenceLimits.js');
  const quotaReq = request('/emotions/face-status');
  const quotaRes = response();
  limits.module.inferenceLimitMiddleware(quotaReq, quotaRes, () => quotaRes.next());
  assert.equal(quotaRes.passed, true); assert.equal(quotaReq.inferenceReservation, undefined);
});
test('administrator requires a matching active SQL role and verified claim', async () => {
  for (const [profileRole, claim, expected] of [['admin', undefined, 403], ['patient', 'admin', 403], ['admin', 'admin', 200]]) {
    const loaded = await source('middleware/auth.js', { token: { ...identity, role: claim }, execute: () => [[{ ...patientProfile, role: profileRole }]] });
    const req = request('/residents'), res = response(); req.headers.authorization = 'Bearer verified';
    await loaded.module.authMiddleware(req, res, () => res.next());
    assert.equal(res.statusCode, expected); assert.equal(res.passed, expected === 200);
    if (expected === 200) assert.equal(req.residentScope, null);
  }
});
test('role downgrade revokes Firebase sessions and a failed SQL commit restores claims', async () => {
  for (const commitError of [false, true]) {
    const loaded = await source('routes/users.js', { commitError, execute: sql => /SELECT \* FROM users/.test(sql) ? [[{ ...patientProfile, role: 'admin' }]] : [{ affectedRows: 1 }] });
    const req = request('/users/patient-a', 'PUT', { ...identity, role: 'admin', profile: { ...patientProfile, role: 'admin' } }), res = response();
    req.params.id = identity.uid; req.body = { role: 'patient' };
    await loaded.routes.find(route => route.method === 'put' && route.path === '/:id').handler(req, res);
    assert.equal(res.statusCode, commitError ? 500 : 200);
    assert.equal(loaded.statements.some(item => item.revoked === identity.uid), true);
    const changes = loaded.statements.filter(item => item.claims);
    assert.equal(changes[0].claims.role, 'patient');
    if (commitError) { assert.equal(changes.at(-1).claims.role, 'admin'); assert.equal(loaded.statements.some(item => item.transaction === 'rollback'), true); }
  }
});
test('profile deletion removes the role claim and revokes sessions before commit', async () => {
  const loaded = await source('routes/users.js', { execute: sql => /SELECT id FROM users/.test(sql) ? [[{ id: identity.uid }]] : [{ affectedRows: 1 }] });
  const req = request('/users/patient-a', 'DELETE', { ...identity, role: 'admin' }), res = response(); req.params.id = identity.uid;
  await loaded.routes.find(route => route.method === 'delete').handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(loaded.statements.find(item => item.claims).claims.role, undefined);
  assert.ok(loaded.statements.findIndex(item => item.revoked) < loaded.statements.findIndex(item => item.transaction === 'commit'));
});
test('one rolling AI budget covers all legacy and proxy endpoints', async () => {
  const loaded = await source('middleware/inferenceLimits.js');
  const paths = ['/ai/generate', '/emotions/analyze-image', '/generate-meal-plan', '/analyze-prescription', '/ai/cloud-nlp', '/ai/donut/predict'];
  for (let index = 0; index < 9; index++) {
    const req = request(paths[index % paths.length], 'POST'), res = response(); res.once = () => {};
    loaded.module.inferenceLimitMiddleware(req, res, () => res.next());
    assert.equal(res.statusCode, index < 8 ? 200 : 429);
    req.inferenceReservation?.release();
  }
  assert.equal(loaded.module.reserveClient('different-user').entry.active, 1);
});
test('rolling AI limits expire and global concurrency stays bounded', async () => {
  const loaded = await source('middleware/inferenceLimits.js');
  for (let index = 0; index < 8; index++) loaded.module.reserveClient('expired', 1000).release();
  assert.equal(loaded.module.reserveClient('expired', 1001).status, 429);
  loaded.module.reserveClient('expired', 61_001).release();
  const active = Array.from({ length: 20 }, (_, index) => loaded.module.reserveClient(`user-${index}`, 61_001));
  assert.equal(active.every(item => item.entry), true);
  assert.equal(loaded.module.reserveClient('overflow', 61_001).status, 503);
  active[0].release(); active[0].release();
  assert.ok(loaded.module.reserveClient('overflow', 61_001).entry);
});
test('wellness inputs reject coercible, nonfinite and contradictory scores', async () => {
  const loaded = await source('routes/emotions.js');
  for (const stateScore of ['not-a-score', '', null, false, [], NaN, Infinity, -1, 101, 3.5]) {
    for (const path of ['/emotions', '/emotions/wellness-alert']) {
      const req = request(path, 'POST'), res = response(); req.body = { residentId: 'R-A', stateScore };
      await loaded.routes.find(route => route.method === 'post' && route.path === path).handler(req, res);
      assert.equal(res.statusCode, 400);
    }
  }
  const req = request('/emotions', 'POST'), res = response(); req.body = { residentId: 'R-A', stateScore: 10, emotionLabel: 'Happy', category: 'positive' };
  await loaded.routes.find(route => route.path === '/emotions' && route.method === 'post').handler(req, res);
  assert.equal(res.statusCode, 400); assert.equal(loaded.statements.length, 0);
});
test('critical observation escalates an existing warning and saves history atomically', async () => {
  const loaded = await source('routes/emotions.js', { execute: sql => {
    if (/SELECT name FROM residents/.test(sql)) return [[{ name: 'Verified Patient' }]];
    if (/SELECT id, severity FROM wellness_alerts/.test(sql)) return [[{ id: 7, severity: 'warning' }]];
    return [{ insertId: 11 }];
  } });
  const req = request('/emotions', 'POST'), res = response(); req.body = { residentId: 'R-A', residentName: 'Spoofed', stateScore: 10, emotionLabel: 'In Pain', category: 'negative' };
  await loaded.routes.find(route => route.path === '/emotions' && route.method === 'post').handler(req, res);
  assert.equal(res.statusCode, 201); assert.equal(res.data.escalated, true); assert.equal(res.data.alertId, 7);
  assert.equal(loaded.statements.filter(item => /INSERT INTO emotional_states/.test(item.sql || '')).length, 1);
  assert.equal(loaded.statements.some(item => /UPDATE wellness_alerts SET severity/.test(item.sql || '')), true);
  assert.equal(loaded.statements.some(item => item.transaction === 'commit'), true);
  assert.equal(res.data.residentName, 'Verified Patient');
});
test('wellness compatibility endpoint creates alerts without duplicating history', async () => {
  const loaded = await source('routes/emotions.js', { execute: sql => /SELECT name FROM residents/.test(sql) ? [[{ name: 'A' }]] : /SELECT id, severity/.test(sql) ? [[]] : [{ insertId: 2 }] });
  const req = request('/emotions/wellness-alert', 'POST'), res = response(); req.body = { residentId: 'R-A', stateScore: 20 };
  await loaded.routes.find(route => route.path === '/emotions/wellness-alert').handler(req, res);
  assert.equal(res.data.alertCreated, true);
  assert.equal(loaded.statements.some(item => /INSERT INTO emotional_states/.test(item.sql || '')), false);
});
test('emotion insertion errors roll back without a silent reduced-column insert', async () => {
  const loaded = await source('routes/emotions.js', { execute: sql => {
    if (/SELECT name/.test(sql)) return [[{ name: 'A' }]];
    if (/INSERT INTO emotional_states/.test(sql)) throw new Error('Constraint failure');
    return [[]];
  } });
  const req = request('/emotions', 'POST'), res = response(); req.body = { residentId: 'R-A', stateScore: 10, category: 'negative' };
  await loaded.routes.find(route => route.path === '/emotions' && route.method === 'post').handler(req, res);
  assert.equal(res.statusCode, 500); assert.equal(loaded.statements.filter(item => /INSERT INTO emotional_states/.test(item.sql || '')).length, 1);
  assert.equal(loaded.statements.some(item => item.transaction === 'rollback'), true);
  assert.equal(loaded.statements.some(item => /INSERT INTO wellness_alerts/.test(item.sql || '')), false);
});
test('stable observation IDs make retries idempotent and reject changed payloads', async () => {
  let stored;
  const loaded = await source('routes/emotions.js', { execute: (sql, values) => {
    if (/SELECT name/.test(sql)) return [[{ name: 'A' }]];
    if (/SELECT id, observation_hash/.test(sql)) return [stored ? [stored] : []];
    if (/INSERT INTO emotional_states/.test(sql)) { stored = { id: 17, observation_hash: values[7], wellness_alert_id: null }; return [{ insertId: 17 }]; }
    return [[]];
  } });
  const route = loaded.routes.find(route => route.path === '/emotions' && route.method === 'post');
  for (const [stateScore, expected] of [[70, 201], [70, 200], [80, 409]]) {
    const req = request('/emotions', 'POST'), res = response(); req.body = { residentId: 'R-A', stateScore, observationId: 'stable-observation' };
    await route.handler(req, res); assert.equal(res.statusCode, expected);
  }
  assert.equal(loaded.statements.filter(item => /INSERT INTO emotional_states/.test(item.sql || '')).length, 1);
});
test('wellness acknowledgement stores verified attribution rather than caller text', async () => {
  const loaded = await source('routes/emotions.js', { execute: () => [{ affectedRows: 1 }] });
  const req = request('/emotions/wellness-alerts/1/acknowledge', 'PUT'), res = response(); req.params.id = '1'; req.body = { acknowledgedBy: 'Another person' };
  await loaded.routes.find(route => route.path.endsWith('/acknowledge')).handler(req, res);
  const update = loaded.statements.find(item => item.sql);
  assert.deepEqual(update.values, ['A', identity.uid, '1']);
});
test('concurrent SOS requests lock the resident and create only one alert', async () => {
  let tail = Promise.resolve(), inserted = 0;
  const connection = () => {
    let unlock;
    return { async beginTransaction() {}, async execute(sql) {
      if (/SELECT name FROM residents/.test(sql)) { const previous = tail; tail = new Promise(resolve => { unlock = resolve; }); await previous; assert.match(sql, /FOR UPDATE/); return [[{ name: 'A' }]]; }
      if (/SELECT id.*FROM sos_alerts/.test(sql)) return [inserted ? [{ id: inserted }] : []];
      if (/INSERT INTO sos_alerts/.test(sql)) return [{ insertId: ++inserted }];
      throw new Error('Unexpected SQL');
    }, async commit() { unlock(); }, async rollback() { unlock?.(); }, release() {} };
  };
  const loaded = await source('routes/sos.js', { connection });
  const route = loaded.routes.find(route => route.path === '/sos-alerts' && route.method === 'post');
  const send = async () => { const req = request('/sos-alerts', 'POST'), res = response(); req.body = { residentId: 'R-A' }; await route.handler(req, res); return res; };
  const responses = await Promise.all([send(), send()]);
  assert.equal(inserted, 1); assert.deepEqual(responses.map(res => res.statusCode).sort(), [200, 201]);
  assert.equal(responses[0].data.alertId, responses[1].data.alertId);
});
test('reversed and impossible leave dates are rejected before insertion', async () => {
  const loaded = await source('routes/caretakers.js');
  for (const [startDate, endDate] of [['2026-10-20', '2026-10-10'], ['2026-02-30', '2026-03-01'], ['', '2026-03-01']]) {
    const req = request('/caretakers/CT-A/leave-requests', 'POST',{...identity,role:'caretaker'}), res = response(); req.authorizedCaretakerId = 'CT-A'; req.params.id = 'CT-A'; req.body = { startDate, endDate, reason: 'Leave' };
    await loaded.routes.find(route => route.method === 'post' && route.path === '/:id/leave-requests').handler(req, res); assert.equal(res.statusCode, 400);
  }
  assert.equal(loaded.statements.some(item => /INSERT/.test(item.sql || '')), false);
});
test('appointment IDs remain distinct at the same clock millisecond', async () => {
  const loaded = await source('routes/appointments.js', { fixedTime: 1000, execute: () => [{ affectedRows: 1 }] });
  const route = loaded.routes.find(route => route.method === 'post');
  for (let index = 0; index < 2; index++) { const req = request('/appointments', 'POST'), res = response(); req.body = { residentId: 'R-A', doctorName: 'Doctor', appointmentDate: '2026-10-10' }; await route.handler(req, res); assert.equal(res.statusCode, 201); }
  const ids = loaded.statements.filter(item => /INSERT INTO appointments/.test(item.sql || '')).map(item => item.values[0]);
  assert.equal(new Set(ids).size, 2); assert.match(ids[0], /^APT-[a-f0-9-]{36}$/);
});
test('prescription review metadata persists and stable-ID retries preserve one record', async () => {
  let stored;
  const loaded = await source('routes/prescriptions.js', { execute: (sql, values) => {
    if (/SELECT resident_id FROM residents/.test(sql)) return [[{ resident_id: 'R-A' }]];
    if (/SELECT resident_id, request_hash/.test(sql)) return [stored ? [stored] : []];
    if (/INSERT INTO prescriptions/.test(sql)) stored = { resident_id: values[1], request_hash: values[8] };
    return [{ insertId: 1 }];
  } });
  const route = loaded.routes.find(route => route.path === '/prescriptions');
  const body = { prescriptionId: 'stable-rx', residentId: 'R-A', dateIssued: '2026-10-05', medications: [{ drugName: 'Drug', dosage: '5mg', frequency: 'daily', confidence: 0.99, needsReview: true, reviewReasons: ['Conflicting dosage'], conflictingFields: ['dosage'], confirmed: true }] };
  for (const [value, expected] of [[body, 201], [body, 200], [{ ...body, dateIssued: '2026-10-06' }, 409]]) {
    const req = request('/prescriptions', 'POST'), res = response(); req.body = value; await route.handler(req, res); assert.equal(res.statusCode, expected);
  }
  const writes = loaded.statements.filter(item => /INSERT INTO medications/.test(item.sql || ''));
  assert.equal(writes.length, 1); assert.match(writes[0].sql, /needs_review, review_reasons, evidence/);
  assert.equal(writes[0].values[7], true); assert.match(writes[0].values[8], /Conflicting dosage/); assert.equal(writes[0].values[13], identity.uid);
  const hydrated = loaded.module.hydrateMedication({ drug_name: 'Drug', needs_review: 1, confirmed: 1, review_reasons: writes[0].values[8], evidence: writes[0].values[9] });
  assert.equal(hydrated.confirmed, true); assert.equal(hydrated.conflictingFields[0], 'dosage');
});
test('unconfirmed prescription conflicts and invalid dates cannot save', async () => {
  const loaded = await source('routes/prescriptions.js');
  for (const body of [{ prescriptionId: 'rx', residentId: 'R-A', dateIssued: '2026-02-30' },
    { prescriptionId: 'rx', residentId: 'R-A', dateIssued: '2026-10-05', medications: [{ drugName: 'Drug', needsReview: true }] }]) {
    const req = request('/prescriptions', 'POST'), res = response(); req.body = body;
    await loaded.routes.find(route => route.path === '/prescriptions').handler(req, res); assert.equal(res.statusCode, 400);
  }
  assert.equal(loaded.statements.length, 0);
});
test('calendar DATE values remain strings and connections use UTC timestamps', async () => {
  const loaded = await source('db.js');
  const options = loaded.statements.find(item => item.poolOptions).poolOptions;
  assert.equal(options.dateStrings[0], 'DATE'); assert.equal(options.timezone, 'Z');
  const validation = await source('validation.js');
  assert.equal(validation.module.validDate('2026-10-10'), true); assert.equal(validation.module.validDate('2026-02-30'), false);
});
test('medication events reject foreign medication and upsert verified actor/date', async () => {
  for (const found of [false, true]) {
    const loaded = await source('routes/medicationEvents.js', { execute: sql => /SELECT prescription_id FROM medications/.test(sql) ? [found ? [{ prescription_id: 'RX-A' }] : []]
      : /SELECT prescription_id FROM prescriptions/.test(sql) ? [[{ prescription_id: 'RX-A' }]]
      : /SELECT m.id/.test(sql) ? [found ? [{ id: 12, confirmed: true }] : []] : [{ affectedRows: 1 }] });
    const req = request('/residents/R-A/medication-events', 'POST'), res = response(); req.params.residentId = 'R-A'; req.body = { medicationId: 12, day: '2026-10-05', status: 'taken', recordedBy: 'spoofed' };
    await loaded.routes.find(route => route.method === 'post').handler(req, res);
    assert.equal(res.statusCode, found ? 200 : 404);
    const writes = loaded.statements.filter(item => /INSERT INTO medication_events/.test(item.sql || ''));
    assert.equal(writes.length, found ? 1 : 0);
    if (found) { assert.equal(writes[0].values.at(-1), identity.uid); assert.match(writes[0].sql, /ON DUPLICATE KEY UPDATE/); }
  }
});
test('readiness reflects database, authentication and migration availability', async () => {
  const loaded = await source('readiness.js');
  for (const [database, authentication, schema] of [[false, true, true], [true, false, true], [true, true, false], [true, true, true]]) {
    const state = await loaded.module.readiness({ execute: async () => { if (!database) throw new Error('Unavailable'); return [[{ one: 1 }]]; } }, () => authentication, async () => schema);
    assert.equal(state.status, database && authentication && schema ? 'ready' : 'unavailable');
  }
});
test('migration inspection adds missing columns and retains completed history', async () => {
  const loaded = await source('migrations.js');
  const statements = await loaded.module.migrationPlan({ execute: async sql => /COLUMNS/.test(sql) ? [[{ TABLE_NAME: 'finished_medications', COLUMN_NAME: 'prescription_id', IS_NULLABLE: 'NO' }]] : /STATISTICS/.test(sql) ? [[]] : [[{ CONSTRAINT_NAME: 'finished_medications_ibfk_2', DELETE_RULE: 'CASCADE' }]] }, 'custom_database');
  assert.equal(statements.some(sql => /ADD COLUMN `review_reasons`/.test(sql)), true);
  assert.equal(statements.some(sql => /DROP FOREIGN KEY/.test(sql)), true);
  assert.equal(statements.some(sql => /ON DELETE SET NULL/.test(sql)), true);
  await assert.rejects(() => loaded.module.applyMigrations({ execute: async () => [[]] }, 'custom_database'), /--migrate --confirm/);
});
test('meal endpoint rejects malformed medications without fallback or uncaught rejection', async () => {
  const loaded = await source('routes/mealplans.js', { env: { GEMINI_API_KEY: '', VITE_GEMINI_API_KEY: '' } });
  const route = loaded.routes.find(route => route.path === '/generate-meal-plan');
  for (const [medications, expected] of [[[], 400], [{}, 400], ['Drug', 503]]) {
    const req = request('/generate-meal-plan', 'POST'), res = response(); req.body = { prompt: 'Plan', medications };
    await route.handler(req, res); assert.equal(res.statusCode, expected); assert.equal(res.data.plan, undefined);
  }
});
test('missing credentials reject even a supplied token', async () => {
  const loaded = await source('middleware/auth.js', { configured: false });
  const req = request('/residents'), res = response(); req.headers.authorization = 'Bearer test';
  await loaded.module.authMiddleware(req, res, () => res.next());
  assert.equal(res.statusCode, 503); assert.equal(res.passed, false);
});
test('invalid tokens fail closed in development', async () => {
  const loaded = await source('middleware/auth.js', { tokenError: true });
  const req = request('/residents'), res = response(); req.headers.authorization = 'Bearer test';
  await loaded.module.authMiddleware(req, res, () => res.next());
  assert.equal(res.statusCode, 401); assert.equal(res.passed, false);
});
test('signup directory remains public without assigning an identity', async () => {
  const loaded = await source('middleware/auth.js', { configured: false });
  const req = request('/caretakers'), res = response(); delete req.user;
  await loaded.module.authMiddleware(req, res, () => res.next());
  assert.equal(res.passed, true); assert.equal(req.user, undefined);
});
test('a client caretaker claim cannot override a patient database profile', async () => {
  const loaded = await source('middleware/auth.js', { token: { ...identity, role: 'caretaker' } });
  const req = request('/residents'), res = response(); req.headers.authorization = 'Bearer test';
  await loaded.module.authMiddleware(req, res, () => res.next());
  assert.equal(req.user.role, 'patient'); assert.equal(req.residentScope.join(','), 'R-A');
});
test('permission lookup errors fail closed instead of guessing a role', async () => {
  const loaded = await source('middleware/auth.js', { execute: () => { throw new Error('Database unavailable'); } });
  const req = request('/residents'), res = response(); req.headers.authorization = 'Bearer test';
  await loaded.module.authMiddleware(req, res, () => res.next());
  assert.equal(res.statusCode, 503); assert.equal(res.passed, false);
});
test('verified admin claim without an active SQL admin profile is rejected', async () => {
  const loaded = await source('middleware/auth.js', { token: { ...identity, role: 'admin' }, execute: () => [[]] });
  const req = request('/users'), res = response(); req.headers.authorization = 'Bearer test';
  await loaded.module.authMiddleware(req, res, () => res.next());
  assert.equal(res.statusCode, 403); assert.equal(res.passed, false);
});
test('patient cannot read another resident or their nested subresources', async () => {
  for (const path of ['/residents/R-B', '/residents/R-B/prescriptions', '/residents/R-B/meal-plan',
    '/residents/R-B/appointments', '/residents/R-B/emotions', '/residents/R-B/complaints', '/residents/R-B/notifications']) {
    const { res } = await authorize(path);
    assert.equal(res.statusCode, 403, path); assert.equal(res.passed, false);
  }
  assert.equal((await authorize('/residents/R-A')).res.passed, true);
});
test('patients and caretakers cannot delete even an accessible resident', async () => {
  for (const role of ['patient', 'caretaker']) {
    const { res } = await authorize('/residents/R-A', 'DELETE', { user: { role, profile: patientProfile, caretakerIds: ['CT-A'] } });
    assert.equal(res.statusCode, 403); assert.equal(res.passed, false);
  }
  assert.equal((await authorize('/residents/R-B', 'DELETE', { user: { role: 'admin' } })).res.passed, true);
});
test('patient cannot provision profiles or read another account', async () => {
  assert.equal((await authorize('/users', 'POST', { body: { uid: identity.uid, role: 'admin' } })).res.statusCode, 403);
  assert.equal((await authorize('/users/patient-b')).res.statusCode, 403);
  assert.equal((await authorize('/users/patient-a')).res.passed, true);
});
test('patient role/resident-link/email escalation is rejected before an UPDATE', async () => {
  for (const body of [{ role: 'admin' }, { residentId: 'R-B' }, { email: 'admin@example.test' }]) {
    const loaded = await source('routes/users.js');
    const route = loaded.routes.find(r => r.method === 'put' && r.path === '/:id');
    const req = request('/users/patient-a', 'PUT'), res = response(); req.params.id = identity.uid; req.body = body;
    await route.handler(req, res);
    assert.equal(res.statusCode, 403); assert.equal(loaded.statements.some(s => s.sql?.startsWith('UPDATE')), false);
  }
});
test('foreign prescription, appointment, notification and SOS writes are rejected', async () => {
  const foreign = () => [[{ resident_id: 'R-B' }]];
  for (const [path, method, body] of [
    ['/prescriptions', 'POST', { residentId: 'R-B' }],
    ['/appointments', 'POST', { residentId: 'R-B' }],
    ['/emotions', 'POST', { residentId: 'R-B' }],
    ['/emotions/wellness-alert', 'POST', { residentId: 'R-B' }],
    ['/sos-alerts', 'POST', { residentId: 'R-B' }],
    ['/complaints', 'POST', { residentId: 'R-B' }],
    ['/prescriptions/RX-B/medications', 'DELETE', {}],
    ['/appointments/APT-B', 'PUT', {}],
    ['/notifications/2/read', 'PUT', {}],
  ]) {
    const { res } = await authorize(path, method, { body }, foreign);
    assert.equal(res.statusCode, 403, path); assert.equal(res.passed, false);
  }
});
test('assigned caretaker can act only for assigned residents and its own leave requests', async () => {
  const user = { uid: 'ct-uid', role: 'caretaker', profile: { role: 'caretaker' }, caretakerIds: ['CT-A'] };
  assert.equal((await authorize('/residents/R-A', 'PUT', { user })).res.passed, true);
  assert.equal((await authorize('/residents/R-B', 'PUT', { user })).res.statusCode, 403);
  assert.equal((await authorize('/caretakers/CT-A/leave-requests', 'POST', { user })).res.passed, true);
  assert.equal((await authorize('/caretakers/CT-B/leave-requests', 'POST', { user })).res.statusCode, 403);
  assert.equal((await authorize('/emotions/wellness-alerts/CT-B', 'GET', { user })).res.statusCode, 403);
});
test('unregistered identity can reach atomic registration but not resident records', async () => {
  const user = { ...identity, role: 'unregistered', profile: null };
  assert.equal((await authorize('/users/register-patient', 'POST', { user })).res.passed, true);
  assert.equal((await authorize('/residents', 'GET', { user })).res.statusCode, 403);
});
test('registration creates resident, profile and assignment in one transaction', async () => {
  const loaded = await source('routes/users.js', { execute: sql => sql.startsWith('SELECT caretaker_id') ? [[{ caretaker_id: 'CT-A' }]] : [[]] });
  const route = loaded.routes.find(r => r.path === '/register-patient');
  const req = request('/users/register-patient', 'POST', { ...identity, role: 'unregistered' }), res = response();
  req.body = { name: 'Patient A', email: identity.email, residentId: 'R-NEW', caretakerId: 'CT-A' };
  await route.handler(req, res);
  assert.equal(res.statusCode, 201); assert.equal(res.data.residentId, 'R-NEW');
  assert.equal(loaded.statements.filter(s => s.sql?.startsWith('INSERT')).length, 3);
  assert.equal(loaded.statements.some(s => s.transaction === 'commit'), true);
});
test('registration cannot claim a resident by guessing its ID', async () => {
  const loaded = await source('routes/users.js', { execute: sql => sql.includes('FROM residents') ? [[{ resident_id: 'R-B' }]] : [[]] });
  const req = request('/users/register-patient', 'POST', { ...identity, role: 'unregistered' }), res = response();
  req.body = { name: 'A', residentId: 'R-B' };
  await loaded.routes.find(r => r.path === '/register-patient').handler(req, res);
  assert.equal(res.statusCode, 409); assert.equal(loaded.statements.some(s => s.sql?.startsWith('INSERT')), false);
  assert.equal(loaded.statements.some(s => s.transaction === 'rollback'), true);
});
test('failed caretaker assignment rolls back both new patient records', async () => {
  const loaded = await source('routes/users.js', { execute: sql => {
    if (sql.startsWith('SELECT caretaker_id')) return [[{ caretaker_id: 'CT-A' }]];
    if (sql.startsWith('INSERT INTO caretaker_residents')) throw new Error('Assignment failed');
    return [[]];
  } });
  const req = request('/users/register-patient', 'POST', { ...identity, role: 'unregistered' }), res = response();
  req.body = { name: 'A', caretakerId: 'CT-A' };
  await loaded.routes.find(r => r.path === '/register-patient').handler(req, res);
  assert.equal(res.statusCode, 500); assert.equal(loaded.statements.some(s => s.transaction === 'rollback'), true);
  assert.equal(loaded.statements.some(s => s.transaction === 'commit'), false);
});
test('patient registration retry preserves the existing profile and resident link', async () => {
  const loaded = await source('routes/users.js', { execute: () => [[patientProfile]] });
  const req = request('/users/register-patient', 'POST'), res = response(); req.body = { name: 'A' };
  await loaded.routes.find(r => r.path === '/register-patient').handler(req, res);
  assert.equal(res.statusCode, 200); assert.equal(res.data.residentId, 'R-A');
  assert.equal(loaded.statements.some(s => s.sql?.startsWith('INSERT')), false);
});
test('public caretaker directory selects no contact data or resident assignments', async () => {
  const loaded = await source('routes/caretakers.js', { execute: () => [[]] });
  const req = request('/caretakers'), res = response(); delete req.user;
  await loaded.routes.find(r => r.method === 'get' && r.path === '/').handler(req, res);
  assert.match(loaded.statements[0].sql, /^SELECT caretaker_id, name, specialization/);
  assert.doesNotMatch(loaded.statements[0].sql, /email|assigned_residents/);
});
test('resident, appointment and SOS list SQL includes only the caller scope', async () => {
  for (const [file, path] of [['residents', '/'], ['appointments', ['/appointments', '/']], ['sos', '/sos-alerts']]) {
    const loaded = await source(`routes/${file}.js`, { execute: () => [[]] });
    const route = loaded.routes.find(r => r.method === 'get' && JSON.stringify(r.path) === JSON.stringify(path));
    await route.handler(request('/'), response());
    assert.match(loaded.statements[0].sql, /resident_id IN \(\?\)/);
    assert.equal(loaded.statements[0].values.join(','), 'R-A');
  }
});
test('staff administration and complaint responses require admin', async () => {
  for (const [path, method] of [['/system/components', 'POST'], ['/doctors/1', 'DELETE'],
    ['/caretakers/CT-A', 'DELETE'], ['/caretakers/reassign-resident', 'PUT'], ['/complaints/1', 'PUT']]) {
    assert.equal((await authorize(path, method)).res.statusCode, 403);
    assert.equal((await authorize(path, method, { user: { role: 'admin' } })).res.passed, true);
  }
});
test('default admin email does not create an administrator without a server role', async () => {
  const loaded = await source('middleware/auth.js', { token: { ...identity, email: 'admin@careconnect.com' }, execute: () => [[]] });
  const req = request('/users'), res = response(); req.headers.authorization = 'Bearer test';
  await loaded.module.authMiddleware(req, res, () => res.next());
  assert.equal(req.user.role, 'unregistered'); assert.equal(req.residentScope.length, 0);
});
test('caretaker scope follows the authenticated email and database assignments', async () => {
  const loaded = await source('middleware/auth.js', { execute: (sql, values) => {
    if (sql.includes('FROM users')) return [[{ ...patientProfile, role: 'caretaker' }]];
    if (sql.includes('FROM caretakers')) {
      assert.equal(values[0], identity.email); return [[{ caretaker_id: 'CT-A' }]];
    }
    return [[{ resident_id: 'R-A' }]];
  } });
  const req = request('/residents'), res = response(); req.headers.authorization = 'Bearer test';
  await loaded.module.authMiddleware(req, res, () => res.next());
  assert.equal(req.user.role, 'caretaker'); assert.equal(req.user.caretakerIds.join(','), 'CT-A');
  assert.equal(req.residentScope.join(','), 'R-A');
});
test('new system component create/delete operations persist and reject patient writes', async () => {
  const loaded = await source('routes/system.js', { execute: () => [{ affectedRows: 1 }] });
  const create = loaded.routes.find(r => r.method === 'post' && r.path === '/');
  const patient = request('/system/components', 'POST'), denied = response();
  patient.body = { name: 'OCR service' };
  await create.handler(patient, denied);
  assert.equal(denied.statusCode, 403); assert.equal(loaded.statements.length, 0);
  const admin = request('/system/components', 'POST', { role: 'admin' }), created = response();
  admin.body = { componentId: 'SC-A', name: 'OCR service', status: 'online' };
  await create.handler(admin, created);
  assert.equal(created.statusCode, 201); assert.equal(created.data.componentId, 'SC-A');
  assert.match(loaded.statements[0].sql, /^INSERT INTO system_components/);
  admin.params.id = 'SC-A';
  await loaded.routes.find(r => r.method === 'delete').handler(admin, response());
  assert.match(loaded.statements[1].sql, /^DELETE FROM system_components/);
});
test('clearing a patient address sends the empty value to the database', async () => {
  const loaded = await source('routes/residents.js', { execute: () => [{ affectedRows: 1 }] });
  const req = request('/residents/R-A', 'PUT'), res = response(); req.params.id = 'R-A'; req.body = { address: '' };
  await loaded.routes.find(r => r.method === 'put' && r.path === '/:id').handler(req, res);
  assert.equal(res.statusCode, 200); assert.match(loaded.statements[0].sql, /address = \?/);
  assert.equal(loaded.statements[0].values[0], '');
});
test('legacy single-segment appointment aliases cannot bypass ownership checks', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const { res } = await authorize('/APT-B', method);
    assert.equal(res.statusCode, 403); assert.equal(res.passed, false);
  }
  const loaded = await source('routes/appointments.js');
  assert.equal(loaded.routes.some(r => Array.isArray(r.path) && r.path.includes('/:id')), false);
  assert.equal(loaded.routes.some(r => r.path === '/:id'), false);
});
test('encoded slashes stay inside resident IDs instead of bypassing the ownership guard', async () => {
  const blocked = await authorize('/residents/R-A%2FB/prescriptions');
  assert.equal(blocked.res.statusCode, 403); assert.equal(blocked.res.passed, false);
  const own = await authorize('/residents/R-A%2FB/prescriptions', 'GET', { residentScope: ['R-A/B'] });
  assert.equal(own.res.passed, true);
  const deleting = await authorize('/residents/R-A%2FB', 'DELETE', { residentScope: ['R-A/B'] });
  assert.equal(deleting.res.statusCode, 403);
});

test('case-insensitive database lookup cannot grant another Firebase UID its role', async () => {
  const loaded = await source('middleware/auth.js', { execute: () => [[{ ...patientProfile, id: 'PATIENT-A', role: 'admin' }]] });
  const req = request('/residents'), res = response(); req.headers.authorization = 'Bearer test';
  await loaded.module.authMiddleware(req, res, () => res.next());
  assert.equal(res.statusCode, 403); assert.equal(res.passed, false);
});

test('production has no implicit development bypass even when an opt-in variable is present', async () => {
  const loaded = await source('middleware/auth.js', { configured: false, env: { NODE_ENV: 'production', ALLOW_DEV_AUTH_BYPASS: 'true' } });
  const req = request('/residents'), res = response(); delete req.user;
  await loaded.module.authMiddleware(req, res, () => res.next());
  assert.equal(res.statusCode, 401); assert.equal(req.user, undefined);
});

test('caretaker Firebase UID collision resolves only to the authenticated staff ID', async () => {
  const user = { uid: 'CT-B', role: 'caretaker', profile: { role: 'caretaker' }, caretakerIds: ['CT-A'] };
  for (const path of ['/caretakers/CT-B', '/caretakers/CT-B/leave-requests', '/emotions/wellness-alerts/CT-B']) {
    const result = await authorize(path, 'GET', { user });
    assert.equal(result.res.passed, true); assert.equal(result.req.authorizedCaretakerId, 'CT-A');
  }
  const loaded = await source('routes/caretakers.js', { execute: sql => sql.includes('FROM caretakers') ? [[{ caretaker_id: 'CT-A' }]] : [[]] });
  const req = request('/caretakers/CT-B', 'GET', user), res = response();
  req.params.id = 'CT-B'; req.authorizedCaretakerId = 'CT-A';
  await loaded.routes.find(route => route.method === 'get' && route.path === '/:id').handler(req, res);
  assert.equal(loaded.statements[0].values[0], 'CT-A'); assert.equal(res.data.caretaker_id, 'CT-A');
});

test('inactive caretaker cannot use a Firebase UID alias to recover assignments', async () => {
  const user = { uid: 'ct-uid', role: 'caretaker', profile: { role: 'caretaker' }, caretakerIds: [] };
  for (const path of ['/caretakers/ct-uid', '/emotions/wellness-alerts/ct-uid']) {
    assert.equal((await authorize(path, 'GET', { user })).res.statusCode, 403);
  }
});

test('admin duplicate email provisioning rolls back instead of changing a different UID', async () => {
  const loaded = await source('routes/users.js', { execute: sql => {
    if (sql.startsWith('INSERT INTO users')) throw Object.assign(new Error('Duplicate email'), { code: 'ER_DUP_ENTRY' });
    return [[]];
  } });
  const req = request('/users', 'POST', { uid: 'admin-a', role: 'admin' }), res = response();
  req.body = { uid: 'patient-new', name: 'New Patient', email: identity.email, role: 'patient' };
  await loaded.routes.find(route => route.method === 'post' && route.path === '/').handler(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(loaded.statements.some(statement => /ON DUPLICATE KEY UPDATE/.test(statement.sql || '')), false);
  assert.equal(loaded.statements.some(statement => statement.transaction === 'rollback'), true);
  assert.equal(loaded.statements.some(statement => statement.transaction === 'commit'), false);
});

test('admin resident-link update locks the resident and rejects another account link', async () => {
  const loaded = await source('routes/users.js', { execute: sql => {
    if (sql.includes('SELECT * FROM users')) return [[patientProfile]];
    if (sql.includes('FROM residents')) return [[{ resident_id: 'R-B' }]];
    if (sql.includes('SELECT id FROM users')) return [[{ id: 'patient-b' }]];
    return [[]];
  } });
  const req = request('/users/patient-a', 'PUT', { role: 'admin' }), res = response();
  req.params.id = identity.uid; req.body = { residentId: 'R-B' };
  await loaded.routes.find(route => route.method === 'put').handler(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(loaded.statements.some(statement => /FROM residents.*FOR UPDATE/.test(statement.sql || '')), true);
  assert.equal(loaded.statements.some(statement => statement.sql?.startsWith('UPDATE')), false);
});

test('reassignment database failure preserves the original caretaker assignment', async () => {
  const loaded = await source('routes/caretakers.js', { execute: sql => {
    if (sql.includes('FROM residents')) return [[{ resident_id: 'R-A' }]];
    if (sql.includes('FROM caretakers')) return [[{ caretaker_id: 'CT-B' }]];
    if (sql.startsWith('INSERT IGNORE')) throw new Error('Assignment failed');
    return [{ affectedRows: 1 }];
  } });
  const req = request('/caretakers/reassign-resident', 'PUT', { role: 'admin' }), res = response();
  req.body = { residentId: 'R-A', fromCaretakerId: 'CT-A', toCaretakerId: 'CT-B' };
  await loaded.routes.find(route => route.method === 'put' && route.path === '/reassign-resident').handler(req, res);
  assert.equal(res.statusCode, 500); assert.equal(loaded.statements.some(statement => statement.transaction === 'rollback'), true);
  assert.equal(loaded.statements.some(statement => statement.transaction === 'commit'), false);
});

test('patient caretaker selection is rechecked under the resident transaction lock', async () => {
  const loaded = await source('routes/caretakers.js', { execute: sql => {
    if (sql.includes('FROM residents')) return [[{ resident_id: 'R-A' }]];
    if (sql.includes('FROM caretakers')) return [[{ caretaker_id: 'CT-B' }]];
    if (sql.includes('FROM caretaker_residents')) return [[{ caretaker_id: 'CT-A' }]];
    return [[]];
  } });
  const req = request('/caretakers/CT-B/assign-resident', 'POST'), res = response();
  req.params.id = 'CT-B'; req.body = { residentId: 'R-A' };
  await loaded.routes.find(route => route.path === '/:id/assign-resident').handler(req, res);
  assert.equal(res.statusCode, 403); assert.equal(loaded.statements.some(statement => statement.sql?.startsWith('INSERT')), false);
  assert.equal(loaded.statements.some(statement => /FROM residents.*FOR UPDATE/.test(statement.sql || '')), true);
});

test('prescription routes return a response when database connection acquisition fails', async () => {
  for (const path of ['/prescriptions', '/prescriptions/:prescriptionId/medications']) {
    const loaded = await source('routes/prescriptions.js', { acquireError: true });
    const req = request('/prescriptions', 'POST'), res = response();
    req.body = { prescriptionId: 'RX-A', residentId: 'R-A', dateIssued: '2026-10-05', medicationId: 1 };
    req.params.prescriptionId = 'RX-A';
    await loaded.routes.find(route => route.path === path).handler(req, res);
    assert.equal(res.statusCode, 500); assert.match(res.data.error, /preserved/);
  }
});

const inferenceResult = () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Reviewed result' }] } }] }) });

test('AI proxy permits patient and caretaker roles and denies admins and unregistered accounts before inference', async () => {
  for (const role of ['patient', 'caretaker']) {
    assert.equal((await authorize('/ai/generate', 'POST', { user: { uid: role, role, profile: { role } } })).res.passed, true);
    assert.equal((await authorize('/ai/cloud-nlp', 'POST', { user: { uid: role, role, profile: { role } } })).res.passed, true);
  }
  assert.equal((await authorize('/ai/generate', 'POST', { user: { uid: 'new', role: 'unregistered', profile: null } })).res.statusCode, 403);
  const loaded = await source('routes/ai.js', { env: { GEMINI_API_KEY: 'test-server-secret' } });
  const req = request('/ai/generate', 'POST', { uid: 'new', role: 'unregistered' }), res = response();
  req.body = { contents: [{ text: 'Text' }] };
  await loaded.routes.find(route => route.path === '/ai/generate').handler(req, res);
  assert.equal(res.statusCode, 403);
});

test('AI input rejects oversized text, multiple images, unsupported MIME and malformed base64', async () => {
  const loaded = await source('routes/ai.js');
  for (const contents of [[], [{ text: 'x'.repeat(100_001) }],
    [{ inlineData: { mimeType: 'text/html', data: 'eA==' } }],
    [{ inlineData: { mimeType: 'image/png', data: '%bad%' } }],
    [{ text: 'text', inlineData: { mimeType: 'image/png', data: 'eA==' } }],
    [{ inlineData: { mimeType: 'image/png', data: 'eA==' } }, { inlineData: { mimeType: 'image/png', data: 'eA==' } }]]) {
    assert.equal(loaded.module.validateParts(contents), null);
  }
  assert.equal(loaded.module.validateParts([{ text: 'Prescription text' }, { inlineData: { mimeType: 'image/jpeg', data: 'eA==' } }]).length, 2);
});

test('AI proxy keeps its credential and model on the server', async () => {
  let providerRequest;
  const loaded = await source('routes/ai.js', { env: { GEMINI_API_KEY: 'test-server-secret', GEMINI_MODEL: 'gemini-server' },
    fetchImpl: async (url, options) => { providerRequest = { url, options }; return inferenceResult(); } });
  const req = request('/ai/generate', 'POST'), res = response();
  req.body = { model: 'untrusted-model', key: 'untrusted-key', contents: [{ text: 'Prescription text' }] };
  await loaded.routes.find(route => route.path === '/ai/generate').handler(req, res);
  assert.equal(res.statusCode, 200); assert.equal(res.data.text, 'Reviewed result');
  assert.match(providerRequest.url, /models\/gemini-server:generateContent$/);
  assert.doesNotMatch(providerRequest.url, /secret|key=/);
  assert.equal(providerRequest.options.headers['x-goog-api-key'], 'test-server-secret');
  assert.equal(JSON.stringify(res.data).includes('secret'), false);
});

test('AI proxy returns unavailable for missing credentials, provider errors and empty analysis', async () => {
  for (const [env, fetchImpl] of [
    [{}, async () => { throw new Error('Must not be called'); }],
    [{ GEMINI_API_KEY: 'test' }, async () => ({ ok: false, status: 403 })],
    [{ GEMINI_API_KEY: 'test' }, async () => ({ ok: true, json: async () => ({ candidates: [] }) })],
  ]) {
    const loaded = await source('routes/ai.js', { env, fetchImpl });
    const req = request('/ai/generate', 'POST'), res = response(); req.body = { contents: [{ text: 'text' }] };
    await loaded.routes.find(route => route.path === '/ai/generate').handler(req, res);
    assert.equal(res.statusCode, 503); assert.equal(res.data.text, undefined);
  }
});

test('AI proxy retries only transient failures and bounds calls to two attempts', async () => {
  let calls = 0;
  const loaded = await source('routes/ai.js', { env: { GEMINI_API_KEY: 'test' }, fetchImpl: async () => {
    calls += 1; return calls === 1 ? { ok: false, status: 503 } : inferenceResult();
  } });
  const req = request('/ai/generate', 'POST'), res = response(); req.body = { contents: [{ text: 'text' }] };
  await loaded.routes.find(route => route.path === '/ai/generate').handler(req, res);
  assert.equal(calls, 2); assert.equal(res.statusCode, 200);
});

test('AI proxy allows three concurrent requests by UID and releases slots after completion', async () => {
  const releases = [];
  const loaded = await source('routes/ai.js', { env: { GEMINI_API_KEY: 'test' }, fetchImpl: async () => new Promise(resolve => { releases.push(() => resolve(inferenceResult())); }) });
  const route = loaded.routes.find(route => route.path === '/ai/generate');
  const req = request('/ai/generate', 'POST'); req.body = { contents: [{ text: 'text' }] };
  const first = response(), pending = route.handler(req, first);
  const second = response(), secondPending = route.handler(req, second);
  const third = response(), thirdPending = route.handler(req, third);
  const concurrent = response(); await route.handler(req, concurrent);
  assert.equal(concurrent.statusCode, 429); assert.equal(concurrent.headers['Retry-After'], '60');
  releases.splice(0).forEach(release => release()); await Promise.all([pending, secondPending, thirdPending]);
  assert.equal(first.statusCode, 200); assert.equal(second.statusCode, 200); assert.equal(third.statusCode, 200);
  const after = response(), afterPending = route.handler(req, after); releases.splice(0).forEach(release => release()); await afterPending;
  assert.equal(after.statusCode, 200);
});

test('AI proxy rate limits one UID while another account remains available', async () => {
  const loaded = await source('routes/ai.js', { env: { GEMINI_API_KEY: 'test' }, fetchImpl: async () => inferenceResult() });
  const route = loaded.routes.find(route => route.path === '/ai/generate');
  const req = request('/ai/generate', 'POST'); req.body = { contents: [{ text: 'text' }] };
  for (let i = 0; i < 8; i += 1) { const res = response(); await route.handler(req, res); assert.equal(res.statusCode, 200); }
  const blocked = response(); await route.handler(req, blocked); assert.equal(blocked.statusCode, 429);
  const other = request('/ai/generate', 'POST', { ...req.user, uid: 'patient-b' }), allowed = response(); other.body = req.body;
  await route.handler(other, allowed); assert.equal(allowed.statusCode, 200);
});

test('AI timeout aborts inference and returns unavailable without a fabricated result', async () => {
  const loaded = await source('routes/ai.js', { env: { GEMINI_API_KEY: 'test', AI_TIMEOUT_MS: '1000' }, fetchImpl: async (_url, options) =>
    new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Timeout'), { name: 'AbortError' })), { once: true })) });
  const req = request('/ai/generate', 'POST'), res = response(); req.body = { contents: [{ text: 'text' }] };
  await loaded.routes.find(route => route.path === '/ai/generate').handler(req, res);
  assert.equal(res.statusCode, 503); assert.equal(res.data.text, undefined);
});

test('Cloud Healthcare NLP uses server OAuth and the documented request body', async () => {
  let outgoing;
  const loaded = await source('routes/ai.js', { env: { GOOGLE_CLOUD_PROJECT_ID: 'project-test', GOOGLE_CLOUD_API_KEY: 'test-key' }, googleToken: 'test-google-access-token',
    fetchImpl: async (url, options) => { outgoing = { url, options }; return { ok: true, json: async () => ({ entityMentions: [] }) }; } });
  const req = request('/ai/cloud-nlp', 'POST'), res = response(); req.body = { text: 'Prescription text', project: 'untrusted-project' };
  await loaded.routes.find(route => route.path === '/ai/cloud-nlp').handler(req, res);
  assert.equal(res.statusCode, 200); assert.equal(res.data.entityMentions.length, 0);
  assert.match(outgoing.url, /projects\/project-test\/locations\/us-central1\/services\/nlp:analyzeEntities$/);
  assert.equal(outgoing.options.headers.Authorization, 'Bearer test-google-access-token');
  assert.deepEqual(JSON.parse(outgoing.options.body), { documentContent: 'Prescription text' });
});

test('Cloud NLP rejects unconfigured credentials and excessive text without contacting a provider', async () => {
  const loaded = await source('routes/ai.js');
  const route = loaded.routes.find(route => route.path === '/ai/cloud-nlp');
  const req = request('/ai/cloud-nlp', 'POST'), unavailable = response(); req.body = { text: 'Prescription text' };
  await route.handler(req, unavailable); assert.equal(unavailable.statusCode, 503);
  const oversized = response(); req.body = { text: 'x'.repeat(100_001) };
  await route.handler(req, oversized); assert.equal(oversized.statusCode, 400);
});

test('meal-plan inference has sufficient output allowance and incomplete output is rejected', async () => {
  let allowance;
  const loaded = await source('routes/ai.js', { env: { GEMINI_API_KEY: 'test' }, fetchImpl: async (_url, options) => {
    allowance = JSON.parse(options.body).generationConfig.maxOutputTokens;
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{incomplete' }] } }] }) };
  } });
  const req = request('/ai/generate', 'POST'), res = response(); req.body = { task: 'meal-plan', contents: [{ text: 'weekly meals' }] };
  await loaded.routes.find(route => route.path === '/ai/generate').handler(req, res);
  assert.equal(allowance, 16384); assert.equal(res.statusCode, 503); assert.equal(res.data.text, undefined);
});

test('default database setup preserves every table and excludes repeated demo INSERTs', async () => {
  const loaded = await source('setup_db.js');
  const original = await readFile(resolve(api, 'schema.sql'), 'utf8');
  const prepared = loaded.module.prepareSchema(original, 'careconnect_test');
  assert.equal((prepared.match(/CREATE TABLE IF NOT EXISTS/g) || []).length, (original.match(/CREATE TABLE IF NOT EXISTS/g) || []).length);
  assert.doesNotMatch(prepared, /INSERT IGNORE INTO/);
  assert.doesNotMatch(prepared, /^\s*(?:DROP|TRUNCATE|DELETE)\s/mi);
  assert.match(prepared, /CREATE DATABASE IF NOT EXISTS `careconnect_test`/);
  assert.match(prepared, /USE `careconnect_test`;/);
  assert.match(loaded.module.prepareSchema(original, 'careconnect_test', { seed: true }), /INSERT IGNORE INTO/);
  assert.throws(() => loaded.module.prepareSchema(original, 'unsafe;DROP DATABASE users'), /MYSQL_DATABASE/);
});

test('database demo seeding refuses to run without its explicit confirmation flag', async () => {
  const loaded = await source('setup_db.js');
  await assert.rejects(() => loaded.module.setupDatabase(['--seed']), /--seed --confirm/);
});

function adminBootstrapServices({ account = { uid: identity.uid, email: identity.email, emailVerified: true, customClaims: { feature: 'enabled' } },
  profile, commitFailure = false, claimFailures = 0, emailConflict = false } = {}) {
  const operations = [], claims = [];
  const pool = {
    async execute(sql, values) {
      operations.push({ sql, values });
      if (sql.startsWith('SELECT id FROM users')) return [emailConflict ? [{ id: 'different-uid' }] : []];
      if (sql.startsWith('SELECT')) return [profile ? [profile] : []];
      return [{ affectedRows: 1 }];
    },
    async getConnection() { return this; },
    async beginTransaction() { operations.push({ transaction: 'begin' }); },
    async commit() { if (commitFailure) throw new Error('Commit failed'); operations.push({ transaction: 'commit' }); },
    async rollback() { operations.push({ transaction: 'rollback' }); },
    release() { operations.push({ transaction: 'release' }); },
  };
  const admin = { apps: [{}], auth: () => ({
    async getUser() { return account; },
    async setCustomUserClaims(uid, claim) {
      claims.push({ uid, claim });
      if (claimFailures-- > 0) throw new Error('Claims failed');
    },
  }) };
  return { admin, pool, operations, claims };
}
const bootstrapArguments = ['--uid', identity.uid, '--email', identity.email];

test('first-admin help is offline and provisioning requires an explicit UID and email', async () => {
  const loaded = await source('bootstrap_admin.js');
  assert.match((await loaded.module.bootstrapAdmin(['--help'])).help, /--confirm/);
  assert.throws(() => loaded.module.parseArguments(['--confirm']), /--uid/);
  assert.throws(() => loaded.module.parseArguments(['--uid', identity.uid]), /--email/);
});

test('first-admin default is read-only even for a verified matching Firebase user', async () => {
  const loaded = await source('bootstrap_admin.js');
  const services = adminBootstrapServices({ profile: patientProfile });
  const result = await loaded.module.bootstrapAdmin(bootstrapArguments, services);
  assert.equal(result.dryRun, true); assert.equal(result.previousRole, 'patient');
  assert.equal(services.claims.length, 0);
  assert.equal(services.operations.every(operation => operation.sql?.startsWith('SELECT')), true);
});

test('first-admin rejects mismatched, unverified, disabled and conflicting-email accounts', async () => {
  const loaded = await source('bootstrap_admin.js');
  for (const account of [
    { uid: identity.uid, email: 'different@example.test', emailVerified: true },
    { uid: identity.uid, email: identity.email, emailVerified: false },
    { uid: identity.uid, email: identity.email, emailVerified: true, disabled: true },
  ]) {
    const services = adminBootstrapServices({ account });
    await assert.rejects(() => loaded.module.bootstrapAdmin([...bootstrapArguments, '--confirm'], services));
    assert.equal(services.claims.length, 0); assert.equal(services.operations.some(operation => operation.sql?.startsWith('INSERT')), false);
  }
  const services = adminBootstrapServices({ emailConflict: true });
  await assert.rejects(() => loaded.module.bootstrapAdmin(bootstrapArguments, services), /different database account/);
  assert.equal(services.claims.length, 0);
});

test('first-admin confirmation updates only its UID and preserves existing claims and resident links', async () => {
  const loaded = await source('bootstrap_admin.js');
  const services = adminBootstrapServices({ profile: patientProfile });
  const result = await loaded.module.bootstrapAdmin([...bootstrapArguments, '--confirm'], services);
  assert.equal(result.role, 'admin'); assert.equal(result.dryRun, false);
  assert.equal(services.claims[0].uid, identity.uid); assert.equal(services.claims[0].claim.role, 'admin');
  assert.equal(services.claims[0].claim.feature, 'enabled');
  const update = services.operations.find(operation => operation.sql?.startsWith('UPDATE'));
  assert.doesNotMatch(update.sql, /resident_id/); assert.equal(update.values.at(-1), identity.uid);
  assert.equal(services.operations.some(operation => operation.transaction === 'commit'), true);
});

test('first-admin commit failure rolls back SQL and restores all previous Firebase claims', async () => {
  const loaded = await source('bootstrap_admin.js');
  const services = adminBootstrapServices({ commitFailure: true });
  await assert.rejects(() => loaded.module.bootstrapAdmin([...bootstrapArguments, '--confirm'], services), /previous Firebase claims were restored/);
  assert.equal(services.claims.length, 2); assert.equal(services.claims[0].claim.role, 'admin');
  assert.equal(services.claims[1].claim.role, undefined); assert.equal(services.claims[1].claim.feature, 'enabled');
  assert.equal(services.operations.some(operation => operation.transaction === 'rollback'), true);
  assert.equal(services.operations.some(operation => operation.transaction === 'commit'), false);
});

test('first-admin claim failure restores previous claims and failed compensation requests inspection', async () => {
  const loaded = await source('bootstrap_admin.js');
  const recovered = adminBootstrapServices({ claimFailures: 1 });
  await assert.rejects(() => loaded.module.bootstrapAdmin([...bootstrapArguments, '--confirm'], recovered), /claims were restored/);
  assert.equal(recovered.claims[1].claim.role, undefined);
  const failed = adminBootstrapServices({ claimFailures: 2 });
  await assert.rejects(() => loaded.module.bootstrapAdmin([...bootstrapArguments, '--confirm'], failed), /Inspect this UID/);
  assert.equal(failed.operations.some(operation => operation.transaction === 'rollback'), true);
});

test('caretaker reset dry-run performs no schema, SQL data or Firebase mutation', async () => {
  const loaded = await source('reset_caretakers.js', { execute: sql => sql.startsWith('SELECT COUNT') ? [[{ count: 0 }]] : [[]] });
  await loaded.module.resetCaretakers({ dryRun: true, withFirebase: true });
  assert.equal(loaded.statements.filter(statement => statement.sql).every(statement => statement.sql.startsWith('SELECT')), true);
  assert.equal(loaded.statements.some(statement => /ALTER|DELETE|INSERT|UPDATE/.test(statement.sql || '')), false);
  assert.equal(loaded.statements.some(statement => statement.transaction === 'rollback'), true);
  assert.equal(loaded.statements.some(statement => statement.transaction === 'commit'), false);
});

const helpUUID = '3d7d5aaa-9243-4b26-a011-d45581424678';
function helpDatabase() {
  const alerts = [], operations = [];
  const connection = {
    async beginTransaction() { operations.push('begin'); }, async commit() { operations.push('commit'); },
    async rollback() { operations.push('rollback'); }, release() { operations.push('release'); },
    async execute(sql, values) {
      operations.push({ sql, values: Array.from(values) });
      if (/SELECT name FROM residents/.test(sql)) return [[{ name: 'Fixture resident' }]];
      if (/WHERE requested_by_uid/.test(sql)) return [alerts.filter(row => row.requested_by_uid === values[0] && row.request_id === values[1])];
      if (/INSERT INTO sos_alerts/.test(sql)) {
        const row = { id: alerts.length + 1, resident_id: values[0], resident_name: values[1], message: values[2],
          requested_by_uid: values[3], request_id: values[4], request_hash: values[5], is_resolved: 0 };
        alerts.push(row); return [{ insertId: row.id }];
      }
      throw Error('Unexpected offline SQL');
    },
  };
  return { alerts, operations, connection };
}
async function sendHelp(loaded, body, changes = {}) {
  const req = Object.assign(request('/sos-alerts', 'POST'), changes), res = response(); req.body = body;
  await loaded.routes.find(route => route.path === '/sos-alerts' && route.method === 'post').handler(req, res);
  return res;
}

test('urgent help validates identity, ownership, UUID and message before opening a transaction', async () => {
  const db = helpDatabase(), loaded = await source('routes/sos.js', { connection: db.connection });
  for (const [body, changes, expected] of [
    [{ residentId: 'R-A', requestId: helpUUID }, { user: undefined }, 401],
    [{ residentId: 'R-B', requestId: helpUUID }, {}, 403],
    [{ residentId: 'R-A', requestId: 'invalid-id' }, {}, 400],
    [{ residentId: 'R-A', requestId: null }, {}, 400],
    [{ residentId: 'R-A', requestId: helpUUID, message: 'x'.repeat(5001) }, {}, 400],
    [{ residentId: 'R-A', requestId: helpUUID, message: { diagnosis: 'unsafe' } }, {}, 400],
  ]) assert.equal((await sendHelp(loaded, body, changes)).statusCode, expected);
  assert.deepEqual(db.operations, []);
});

test('durable urgent-help replay returns the same saved alert after resolution without creating a duplicate', async () => {
  const db = helpDatabase(), loaded = await source('routes/sos.js', { connection: db.connection });
  const body = { residentId: 'R-A', message: 'Patient-reported difficulty breathing. Please help.', requestId: helpUUID };
  const first = await sendHelp(loaded, body); assert.equal(first.statusCode, 201);
  assert.equal(first.data.saved, true); assert.equal(first.data.replayed, false); assert.equal(first.data.isResolved, false);
  db.alerts[0].is_resolved = 1;
  const second = await sendHelp(loaded, { ...body, requestId: helpUUID.toUpperCase() });
  assert.equal(second.statusCode, 200); assert.equal(second.data.alertId, first.data.alertId);
  assert.equal(second.data.saved, true); assert.equal(second.data.replayed, true); assert.equal(second.data.isResolved, true);
  assert.equal(db.alerts.length, 1); assert.equal(db.alerts[0].requested_by_uid, identity.uid);
  assert.equal(db.operations.some(item => /DATE_SUB/.test(item.sql || '')), false);
  assert.equal('delivered' in second.data, false); assert.equal('caregiverSeen' in second.data, false);
});

test('reusing an urgent request UUID for changed symptoms or a different resident is a conflict', async () => {
  const db = helpDatabase(), loaded = await source('routes/sos.js', { connection: db.connection });
  const original = { residentId: 'R-A', message: 'Patient-reported chest discomfort', requestId: helpUUID };
  await sendHelp(loaded, original);
  for (const changes of [{ message: 'A different symptom' }, { residentId: 'R-B' }]) {
    const result = await sendHelp(loaded, { ...original, ...changes }, { residentScope: ['R-A', 'R-B'] });
    assert.equal(result.statusCode, 409); assert.equal(result.data.errorCode, 'REQUEST_CONFLICT');
  }
  assert.equal(db.alerts.length, 1); assert.equal(db.alerts[0].message, original.message);
});

test('new keyed urgent reports preserve changed symptom details instead of suppressing them under legacy cooldown', async () => {
  const db = helpDatabase(), loaded = await source('routes/sos.js', { connection: db.connection });
  const first = await sendHelp(loaded, { residentId: 'R-A', message: 'Patient-reported dizziness', requestId: helpUUID });
  const second = await sendHelp(loaded, { residentId: 'R-A', message: 'Patient-reported worsening breathing', requestId: 'ad123aaa-9243-4b26-a011-d45581424678' });
  assert.equal(first.statusCode, 201); assert.equal(second.statusCode, 201); assert.notEqual(first.data.alertId, second.data.alertId);
  assert.equal(db.alerts[0].message, 'Patient-reported dizziness'); assert.equal(db.alerts[1].message, 'Patient-reported worsening breathing');
});

test('simultaneous identical urgent-help requests lock the resident and save exactly once', async () => {
  const db = helpDatabase(); let tail = Promise.resolve();
  const connection = () => {
    let unlock;
    return { ...db.connection, async execute(sql, values) {
      if (/SELECT name FROM residents/.test(sql)) { const before = tail; tail = new Promise(resolve => { unlock = resolve; }); await before; assert.match(sql, /FOR UPDATE/); }
      return db.connection.execute(sql, values);
    }, async commit() { unlock(); }, async rollback() { unlock?.(); } };
  };
  const loaded = await source('routes/sos.js', { connection });
  const body = { residentId: 'R-A', message: 'Patient requests urgent help', requestId: helpUUID };
  const results = await Promise.all([sendHelp(loaded, body), sendHelp(loaded, body)]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 201]);
  assert.equal(results[0].data.alertId, results[1].data.alertId); assert.equal(db.alerts.length, 1);
});

test('failed urgent-help persistence never claims saved or provides a successful alert receipt', async () => {
  const db = helpDatabase(); db.connection.execute = async () => { throw Object.assign(Error('Offline DB failure'), { code: 'FIXTURE_FAILURE' }); };
  const loaded = await source('routes/sos.js', { connection: db.connection });
  const result = await sendHelp(loaded, { residentId: 'R-A', message: 'Please help', requestId: helpUUID });
  assert.equal(result.statusCode, 500); assert.equal(result.data.saved, undefined); assert.equal(result.data.alertId, undefined);
  assert.ok(db.operations.includes('rollback') && db.operations.includes('release'));
});

test('urgent-help resolution is limited to assigned care staff and validates the record ID', async () => {
  const loaded = await source('routes/sos.js', { execute: () => [[{ resident_id: 'R-B', is_resolved: 0 }]] });
  const resolve = loaded.routes.find(route => route.path.endsWith('/resolve')).handler;
  for (const [role, id, scope, expected] of [['patient', '1', ['R-A'], 403], ['caretaker', 'not-an-id', ['R-A'], 400],
    ['caretaker', '1', ['R-A'], 403], ['caretaker', '0', ['R-A'], 400]]) {
    const req = request('/sos-alerts/1/resolve', 'PUT', { ...identity, role, profile: patientProfile }), res = response();
    req.params.id = id; req.residentScope = scope; await resolve(req, res); assert.equal(res.statusCode, expected);
  }
  assert.equal(loaded.statements.some(item => /^UPDATE/.test(item.sql || '')), false);
});

test('repeated caregiver resolution preserves first verified resolver attribution and ignores client names', async () => {
  let isResolved = 0, resolver;
  const loaded = await source('routes/sos.js', { execute: (sql, values) => {
    if (/SELECT resident_id/.test(sql)) return [[{ resident_id: 'R-A', is_resolved: isResolved }]];
    if (/^UPDATE/.test(sql)) { assert.match(sql, /is_resolved = FALSE/); if (!isResolved) resolver = { resolved_by: values[0], resolved_by_uid: values[1], resolved_at: '2026-10-06T12:00:00Z', is_resolved: 1 }; isResolved = 1; return [{ affectedRows: 1 }]; }
    if (/SELECT resolved_by/.test(sql)) return [[resolver]];
    throw Error('Unexpected SQL');
  } });
  const handler = loaded.routes.find(route => route.path.endsWith('/resolve')).handler;
  for (const uid of ['verified-carer-one', 'verified-carer-two']) {
    const req = request('/sos-alerts/1/resolve', 'PUT', { uid, role: 'caretaker', profile: { name: uid } }), res = response();
    req.params.id = '1'; req.body = { resolvedBy: 'Forged person' }; await handler(req, res);
    assert.equal(res.statusCode, 200); assert.equal(res.data.isResolved, true); assert.equal(res.data.resolvedByUid, 'verified-carer-one');
  }
  assert.equal(loaded.statements.filter(item => /^UPDATE/.test(item.sql || '')).length, 1);
});

test('simultaneous caregiver resolutions preserve the first atomic resolver and both return its receipt', async () => {
  let resolved = false, changes = 0, resolver;
  const loaded = await source('routes/sos.js', { execute: (sql, values) => {
    if (/SELECT resident_id/.test(sql)) return [[{ resident_id: 'R-A', is_resolved: 0 }]];
    if (/^UPDATE/.test(sql)) {
      assert.match(sql, /AND is_resolved = FALSE/);
      if (!resolved) { resolved = true; changes++; resolver = { resolved_by: values[0], resolved_by_uid: values[1], is_resolved: 1 }; return [{ affectedRows: 1 }]; }
      return [{ affectedRows: 0 }];
    }
    if (/SELECT resolved_by/.test(sql)) return [[resolver]];
    throw Error('Unexpected SQL');
  } });
  const handler = loaded.routes.find(route => route.path.endsWith('/resolve')).handler;
  const results = await Promise.all(['care-one', 'care-two'].map(async uid => {
    const req = request('/sos-alerts/1/resolve', 'PUT', { uid, role: 'caretaker', profile: { name: uid } }), res = response();
    req.params.id = '1'; await handler(req, res); return res;
  }));
  assert.equal(changes, 1); assert.ok(results.every(res => res.statusCode === 200 && res.data.isResolved));
  assert.equal(results[0].data.resolvedByUid, results[1].data.resolvedByUid);
});

test('resolution that cannot be verified never produces a false successful resolution receipt', async () => {
  const loaded = await source('routes/sos.js', { execute: sql => /^UPDATE/.test(sql) ? [{ affectedRows: 0 }] : /SELECT resident_id/.test(sql) ? [[{ resident_id: 'R-A', is_resolved: 0 }]] : [[{ is_resolved: 0 }]] });
  const req = request('/sos-alerts/1/resolve', 'PUT', { uid: 'care-one', role: 'caretaker', profile: { name: 'Care one' } }), res = response();
  req.params.id = '1'; await loaded.routes.find(route => route.path.endsWith('/resolve')).handler(req, res);
  assert.equal(res.statusCode, 503); assert.equal(res.data.isResolved, undefined);
});

test('urgent-help schema inspection adds only missing SOS request columns and a unique actor request key', async () => {
  const loaded = await source('migrations.js');
  const existing = Object.entries(loaded.module.requiredColumns).flatMap(([table, columns]) => Object.keys(columns).filter(column => table !== 'sos_alerts' || !['request_id', 'request_hash', 'requested_by_uid'].includes(column)).map(column => ({ TABLE_NAME: table, COLUMN_NAME: column })));
  existing.push({ TABLE_NAME: 'finished_medications', COLUMN_NAME: 'prescription_id', IS_NULLABLE: 'YES' });
  const db = { execute: async sql => /COLUMNS/.test(sql) ? [existing] : /STATISTICS/.test(sql) ? [sql.includes("'sos_alerts'") ? [] : [{ INDEX_NAME: 'uq_emotion_observation' }]] : [[{ DELETE_RULE: 'SET NULL' }]] };
  const plan = await loaded.module.migrationPlan(db, 'offline_database');
  assert.equal(plan.length, 4); assert.ok(plan.every(statement => /^ALTER TABLE `?sos_alerts`? /.test(statement)));
  assert.ok(plan.some(statement => /uq_sos_request \(requested_by_uid, request_id\)/.test(statement)));
  assert.match(loaded.module.SCHEMA_VERSION, /^2026-10-/);
});

test('urgent-help migration planning is read-only and idempotent once its columns and unique index exist', async () => {
  const loaded = await source('migrations.js'), statements = [];
  const columns = Object.entries(loaded.module.requiredColumns).flatMap(([table, fields]) => Object.keys(fields).map(column => ({ TABLE_NAME: table, COLUMN_NAME: column })));
  columns.push({ TABLE_NAME: 'finished_medications', COLUMN_NAME: 'prescription_id', IS_NULLABLE: 'YES' });
  const plan = await loaded.module.migrationPlan({ execute: async sql => { statements.push(sql); return /COLUMNS/.test(sql) ? [columns] : /STATISTICS/.test(sql) ? [[{ INDEX_NAME: 'existing_index' }]] : [[{ DELETE_RULE: 'SET NULL' }]]; } }, 'offline_database');
  assert.equal(plan.length, 0); assert.ok(statements.every(sql => sql.startsWith('SELECT')));
});

test('leave review validates replacement availability, freezes reviewed decisions and audits the authenticated reviewer',async()=>{
  for(const scenario of ['valid','self','inactive','on_leave','closed']){
    const replacement=scenario==='self'?'CT-A':'CT-B';
    const loaded=await source('routes/caretakers.js',{execute:sql=>{
      if(sql.includes('SELECT caretaker_id,is_active'))return [[{caretaker_id:'CT-A',is_active:1},{caretaker_id:'CT-B',is_active:scenario==='inactive'?0:1}]];
      if(sql.includes('SELECT * FROM leave_requests'))return [[{status:scenario==='closed'?'rejected':'pending',start_date:'2099-01-01',end_date:'2099-01-03'}]];
      if(sql.includes('SELECT request_id FROM leave_requests'))return [scenario==='on_leave'?[{request_id:'other'}]:[]];
      return [{affectedRows:1}];
    }});
    const req=request('/caretakers/CT-A/leave-requests/LR-A','PUT',{...identity,role:'admin',profile:{name:'Verified Administrator'}}),res=response();
    req.params={caretakerId:'CT-A',requestId:'LR-A'};req.body={status:'approved',temporaryReplacement:replacement,reviewedBy:'Forged reviewer'};
    await loaded.routes.find(route=>route.method==='put'&&route.path==='/:caretakerId/leave-requests/:requestId').handler(req,res);
    assert.equal(res.statusCode,scenario==='valid'?200:['self','inactive'].includes(scenario)?400:409);
    const update=loaded.statements.find(row=>row.sql?.startsWith('UPDATE leave_requests'));
    if(scenario==='valid'){assert.equal(update.values[1],'Verified Administrator');assert.equal(update.values[2],'CT-B');assert.ok(loaded.statements.some(row=>row.sql?.includes('INSERT INTO audit_events')));}
    else assert.equal(update,undefined);
  }
});
test('past leave dates and forged staff identities cannot create leave records',async()=>{
  const loaded=await source('routes/caretakers.js'),route=loaded.routes.find(r=>r.method==='post'&&r.path==='/:id/leave-requests');
  const req=request('/caretakers/CT-A/leave-requests','POST',{...identity,role:'caretaker'});req.params.id='CT-A';req.authorizedCaretakerId='CT-A';req.body={startDate:'2000-01-01',endDate:'2000-01-02',reason:'Past'};
  const res=response();await route.handler(req,res);assert.equal(res.statusCode,400);assert.equal(loaded.statements.length,0);
});
test('patients cannot edit administrator or clinical profile fields and invalid component status is rejected',async()=>{
  const resident=await source('routes/residents.js'),req=request('/residents/R-A','PUT'),res=response();req.params.id='R-A';req.body={roomNumber:'200',medicalHistory:'Forged history'};
  await resident.routes.find(r=>r.method==='put').handler(req,res);assert.equal(res.statusCode,403);assert.equal(resident.statements.length,0);
  const system=await source('routes/system.js'),adminReq=request('/system/components/OCR','PUT',{...identity,role:'admin'}),bad=response();adminReq.params.id='OCR';adminReq.body={status:'invented'};
  await system.routes.find(r=>r.method==='put').handler(adminReq,bad);assert.equal(bad.statusCode,400);assert.equal(system.statements.length,0);
});
test('private image grants deny admins and foreign residents; image references reject external and cross-resident URLs',async()=>{
  for(const role of ['patient','caretaker','admin']){
    const decision=await authorize('/storage/prescriptions/R-A/access','POST',{user:{...identity,role,profile:{role}}});assert.equal(decision.res.passed,role!=='admin');
  }
  assert.equal((await authorize('/storage/prescriptions/R-B/access','POST')).res.statusCode,403);
  const {module}=await source('prescriptionStorage.js');const path='prescriptions/R-A/01.png',url=`https://firebasestorage.googleapis.com/v0/b/private.example/o/${encodeURIComponent(path)}?alt=media&token=private`;
  assert.equal(module.validPrescriptionImageReference('R-A',path,url,'private.example'),true);
  assert.equal(module.validPrescriptionImageReference('R-B',path,url,'private.example'),false);
  assert.equal(module.validPrescriptionImageReference('R-A',path,'https://untrusted.example/patient.png','private.example'),false);
  assert.equal(module.validPrescriptionImageReference('R-A',path,url,'other.example'),false);
});
test('cloud care signals contain no clinical text, images, audio, identities or raw probabilities',async()=>{
  const {module}=await source('realtimeCare.js');const signal=module.careSignal('emotion',{residentId:'private',note:'private',image:'private',audio:'private',probabilities:{happy:1},provenance:'experimental-assessment'});
  assert.deepEqual(Object.keys(signal).sort(),['changedAt','experimental','kind','reviewRequired','version']);assert.equal(signal.reviewRequired,true);assert.equal(signal.experimental,true);
});
test('emergency streams recheck SQL role and current effective scope instead of retaining old request assignments',async()=>{
  const {module}=await source('sosRealtime.js');let role='caretaker';
  const connection={execute:async sql=>sql.includes('FROM users')?[[{id:identity.uid,role}]]:sql.includes('FROM caretakers')?[[{caretaker_id:'CT-A'}]]:[[{resident_id:'R-B'}]]};
  const user={...identity,role:'caretaker',tokenExpiresAt:Date.now()+60_000};
  assert.equal((await module.streamResidentScope(connection,user)).join(','),'R-B');role='patient';await assert.rejects(()=>module.streamResidentScope(connection,user),/access changed/);
});
