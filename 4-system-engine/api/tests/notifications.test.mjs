import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calendarDay, doseInstant, materializeReminders, medicationEscalationMinutes, normalizeSchedule, reminderWithTiming, scheduleDoses } from '../medicationScheduling.js';

const api = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const now = new Date('2026-10-10T04:30:00Z');
const digest = value => createHash('sha256').update(value).digest('hex');
const key = delivery => digest(`${delivery.owner_uid}:${delivery.token_hash}${Number(delivery.registration_version || 1) > 1 ? `:${delivery.registration_version}` : ''}`).slice(0, 16);
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
  static now() { return now.getTime(); }
}
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } });
const request = (body = {}, overrides = {}) => ({ user: { uid: 'user-A', role: 'patient', profile: {} }, residentScope: ['R-A'], params: { residentId: 'R-A', medicationId: '9', reminderId: '11' }, query: {}, body, ...overrides });

function database(execute) {
  const statements = [], audit = [], transactions = [];
  const pool = {
    statements, audit, transactions,
    getConnection: async () => pool,
    beginTransaction: async () => { transactions.push('begin'); },
    commit: async () => { transactions.push('commit'); },
    rollback: async () => { transactions.push('rollback'); },
    release: () => { transactions.push('release'); },
    async execute(sql, values = []) { statements.push({ sql, values: [...values] }); return execute(sql.replace(/\s+/g, ' ').trim(), values); },
  };
  return pool;
}

// Real route/service source runs in an isolated context. The production database
// module is never imported, and provider calls use explicit test doubles only.
async function load(file, pool, env = {}) {
  const routes = [], cache = new Map();
  const Router = () => {
    const router = {};
    for (const method of ['get', 'put', 'post', 'delete']) router[method] = (path, fn) => { routes.push({ method, path, fn }); return router; };
    return router;
  };
  const context = createContext({ console, Date: FixedDate, Buffer, process: { env }, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, fetch: () => { throw Error('An explicit mock provider is required'); } });
  const synthetic = (name, exports) => {
    if (!cache.has(name)) cache.set(name, new SyntheticModule(Object.keys(exports), function () { for (const [name, value] of Object.entries(exports)) this.setExport(name, value); }, { context }));
    return cache.get(name);
  };
  const read = async path => {
    if (cache.has(path)) return cache.get(path);
    const module = new SourceTextModule(await readFile(path, 'utf8'), { context, identifier: path });
    cache.set(path, module); return module;
  };
  const linker = async (specifier, parent) => {
    if (specifier === 'express') return synthetic(specifier, { Router });
    if (specifier.startsWith('.')) {
      const path = resolve(dirname(parent.identifier), specifier);
      if (path === resolve(api, 'db.js')) return synthetic(path, { default: pool });
      if (path === resolve(api, 'monitoringService.js')) return synthetic(path, { appendAudit: async (_connection, entry) => pool.audit.push(entry) });
      if (path === resolve(api, 'middleware/authorization.js')) return synthetic(path, { canAccessResident: (req, id) => Boolean(id) && (req.user?.role === 'admin' || req.residentScope?.includes(id)) });
      return read(path);
    }
    return synthetic(specifier, await import(specifier));
  };
  const module = await read(resolve(api, file)); await module.link(linker); await module.evaluate();
  return { exports: module.namespace, routes, pool, async call(method, path, req) { const res = response(); const route = routes.find(item => item.method === method && item.path === path); assert.ok(route, `Missing route ${method} ${path}`); await route.fn(req, res); return res; } };
}

const actionPath = '/residents/:residentId/medication-reminders/:reminderId/action';
function actionDatabase(initial = {}, { onMedicationLock } = {}) {
  const reminder = { reminder_id: 11, resident_id: 'R-A', medication_id: 9, schedule_id: 3, scheduled_at: new Date(now.getTime() - 60_000), presentation_at: new Date(now.getTime() - 60_000), status: 'pending', delivery_round: 0, notification_id: 4, ...initial };
  const actions = [];
  const pool = database((sql, values) => {
    if (sql.startsWith('SELECT * FROM medication_reminders')) return [[{ ...reminder }]];
    if (sql.startsWith('SELECT prescription_id FROM medications')) return [reminder.medication_missing ? [] : [{ prescription_id: 'RX-A' }]];
    if (sql.startsWith('SELECT prescription_id FROM prescriptions')) return [reminder.prescription_resident_id === 'R-other' ? [] : [{ prescription_id: 'RX-A' }]];
    if (sql.startsWith('SELECT m.id, m.confirmed')) { onMedicationLock?.(reminder); return [reminder.medication_missing ? [] : [{ id: reminder.medication_id, confirmed: reminder.medication_confirmed !== false }]]; }
    if (sql.startsWith('SELECT schedule_id, enabled')) return [reminder.schedule_id ? [{ schedule_id: reminder.schedule_id, enabled: reminder.schedule_enabled !== false }] : []];
    if (sql.startsWith('SELECT action, actor_uid')) return [[...actions].reverse().slice(0, 1)];
    if (sql.startsWith('UPDATE medication_reminders SET status = ?')) { Object.assign(reminder, { status: values[0], presentation_at: values[1], delivery_round: reminder.delivery_round + values[2], recorded_by_uid: values[3], recorded_at: values[4] }); return [{ affectedRows: 1 }]; }
    if (sql.startsWith('UPDATE push_deliveries') || sql.startsWith('UPDATE notifications')) return [{ affectedRows: 1 }];
    if (sql.startsWith('INSERT INTO medication_reminder_actions')) { actions.push({ action: values[1], actor_uid: values[2], snooze_minutes: values[3] }); return [{ insertId: actions.length }]; }
    throw Error(`Unexpected action SQL: ${sql}`);
  });
  return { pool, reminder, actions };
}

const installationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const projectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const installationKey = 'a'.repeat(64);
const token = 'ExpoPushToken[abcdefghijklmnop123456]';
const registration = { installationId, installationKey, token, projectId, platform: 'android' };
function pushDatabase(devices = []) {
  const state = devices.map(row => ({ ...row }));
  const pool = database((sql, values) => {
    if (sql.startsWith('SELECT device_id, installation_key_hash FROM push_devices')) return [state.filter(row => row.installation_id === values[0]).map(({ device_id, installation_key_hash }) => ({ device_id, installation_key_hash }))];
    if (sql.startsWith('SELECT * FROM push_devices WHERE installation_id = ? OR')) return [state.filter(row => row.installation_id === values[0] || row.token_hash === values[1]).map(row => ({ ...row }))];
    if (sql.startsWith('SELECT * FROM push_devices WHERE installation_id')) return [state.filter(row => row.installation_id === values[0] && row.owner_uid === values[1]).map(row => ({ ...row }))];
    if (sql.startsWith('SELECT device_id FROM push_devices')) return [state.filter(row => row.owner_uid === values[0] && row.enabled).map(row => ({ device_id: row.device_id }))];
    if (sql.startsWith('SELECT device_id, installation_id')) return [state.filter(row => row.owner_uid === values[0]).map(({ device_id, installation_id, platform, project_id, enabled, last_error, last_seen_at }) => ({ device_id, installation_id, platform, project_id, enabled, last_error, last_seen_at }))];
    if (sql.startsWith('INSERT INTO push_devices')) {
      let row = state.find(item => item.installation_id === values[1]);
      if (!row) { row = { device_id: state.length + 1, installation_id: values[1], installation_key_hash: values[2] }; state.push(row); }
      Object.assign(row, { owner_uid: values[0], push_token: values[3], token_hash: values[4], project_id: values[5], platform: values[6], enabled: true, registration_version: Number(row.registration_version || 1) + values[7] });
      return [{ insertId: row.device_id }];
    }
    if (sql.startsWith('UPDATE push_devices SET enabled')) { const row = state.find(item => item.device_id === values[0]); if (row) row.enabled = false; return [{ affectedRows: row ? 1 : 0 }]; }
    if (sql.startsWith('UPDATE push_deliveries')) return [{ affectedRows: 1 }];
    throw Error(`Unexpected device SQL: ${sql}`);
  });
  return { pool, state };
}
const existingDevice = (overrides = {}) => ({ device_id: 1, owner_uid: 'user-A', installation_id: installationId, installation_key_hash: digest(installationKey), push_token: token, token_hash: digest(token), platform: 'android', project_id: projectId, enabled: true, ...overrides });

test('schedule validation requires exact distinct times, valid dates, weekdays, and supported timezone', () => {
  const valid = { times: ['20:00', '08:00'], startDate: '2026-10-10', foodInstruction: '  after food  ' };
  assert.deepEqual(normalizeSchedule(valid).times, ['08:00', '20:00']);
  assert.equal(normalizeSchedule(valid).foodInstruction, 'after food');
  for (const change of [{ times: [] }, { times: ['8:00'] }, { times: ['24:00'] }, { times: ['08:00', '08:00'] }, { startDate: '2026-02-30' }, { endDate: '2026-10-09' }, { weekdays: [7] }, { weekdays: [1, 1] }, { timezone: 'UTC' }, { enabled: 'true' }, { foodInstruction: 'x'.repeat(501) }]) assert.throws(() => normalizeSchedule({ ...valid, ...change }));
});

test('overdue dose timing uses the configured escalation threshold and excludes terminal/future doses', () => {
  const before = new Date(now.getTime() - 31 * 60_000);
  const configured = process.env.MEDICATION_ESCALATION_MINUTES;
  process.env.MEDICATION_ESCALATION_MINUTES = '30';
  try {
    assert.equal(reminderWithTiming({ status: 'pending', presentation_at: before }, now).is_overdue, true);
    assert.equal(reminderWithTiming({ status: 'snoozed', presentation_at: new Date(now.getTime() + 60_000) }, now).is_overdue, false);
    for (const status of ['taken', 'skipped', 'cancelled']) assert.equal(reminderWithTiming({ status, presentation_at: before }, now).is_overdue, false);
    process.env.MEDICATION_ESCALATION_MINUTES = '60';
    assert.equal(reminderWithTiming({ status: 'pending', presentation_at: before }, now).is_overdue, false);
    assert.equal(reminderWithTiming({ status: 'pending', presentation_at: before }, now).escalation_minutes, 60);
    for (const value of ['invalid', '', '4', '1441', 'Infinity']) assert.equal(medicationEscalationMinutes(value), 30);
  } finally {
    if (configured === undefined) delete process.env.MEDICATION_ESCALATION_MINUTES;
    else process.env.MEDICATION_ESCALATION_MINUTES = configured;
  }
});

test('Colombo midnight, weekday selection, and inclusive date bounds produce correct UTC dose instants', () => {
  assert.equal(calendarDay(new Date('2026-10-09T18:29:59Z')), '2026-10-09');
  assert.equal(calendarDay(new Date('2026-10-09T18:30:00Z')), '2026-10-10');
  assert.equal(doseInstant('2026-10-10', '00:00').toISOString(), '2026-10-09T18:30:00.000Z');
  const schedule = { enabled: true, times: '["08:00","20:00"]', weekdays: '[6]', start_date: '2026-10-10', end_date: '2026-10-17' };
  const doses = scheduleDoses(schedule, ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-17', '2026-10-24']);
  assert.deepEqual(doses.map(dose => dose.at.toISOString()), ['2026-10-10T02:30:00.000Z', '2026-10-10T14:30:00.000Z', '2026-10-17T02:30:00.000Z', '2026-10-17T14:30:00.000Z']);
  assert.deepEqual(scheduleDoses({ ...schedule, enabled: false }, ['2026-10-10']), []);
});

test('materialization targets resident and calendar day with stable dose identity and immutable completed snapshots', async () => {
  const writes = [], schedule = { schedule_id: 3, resident_id: 'R-A', medication_id: 9, drug_name: 'Example tablet', dosage: 'one', food_instruction: 'after food', enabled: true, times: ['08:00'], weekdays: [6], start_date: '2026-10-10', end_date: null };
  const pool = database((sql, values) => { if (sql.startsWith('SELECT s.*')) return [[schedule]]; writes.push({ sql, values }); return [{ insertId: 1 }]; });
  await materializeReminders(pool, now, { residentId: 'R-A', day: '2026-10-10' });
  await materializeReminders(pool, now, { residentId: 'R-A', day: '2026-10-10' });
  assert.equal(writes.length, 2);
  for (const write of writes) { assert.equal(write.values[6], '2026-10-10'); assert.equal(write.values[7].toISOString(), '2026-10-10T02:30:00.000Z'); assert.equal(write.values[8].toISOString(), write.values[7].toISOString()); assert.match(write.sql, /ON DUPLICATE KEY UPDATE/); assert.match(write.sql, /drug_name = IF\(status IN \('taken', 'skipped'\)/); assert.match(write.sql, /presentation_at = IF\(status = 'cancelled', VALUES\(presentation_at\)/); assert.match(write.sql, /delivery_round = delivery_round \+ IF\(status = 'cancelled', 1, 0\)/); }
  assert.deepEqual(pool.statements[0].values, ['R-A']);
  assert.match(pool.statements[0].sql, /m.confirmed = TRUE AND p.resident_id = s.resident_id/);
});

test('reminder routes deny unauthenticated and other-resident requests before database access', async () => {
  const pool = database(() => { throw Error('Denied requests must not read records'); });
  const loaded = await load('routes/reminders.js', pool);
  for (const route of loaded.routes) {
    let res = response(); await route.fn(request({}, { user: null }), res); assert.equal(res.statusCode, 401);
    res = response(); await route.fn(request({}, { params: { residentId: 'R-B', medicationId: '9', reminderId: '11' } }), res); assert.equal(res.statusCode, 403);
  }
  assert.equal(pool.statements.length, 0);
});

test('taken and skipped actions replay without another journal and reject opposite terminal actions', async () => {
  for (const status of ['taken', 'skipped']) {
    const { pool, actions } = actionDatabase(); const loaded = await load('routes/reminders.js', pool);
    assert.equal((await loaded.call('post', actionPath, request({ status }))).statusCode, 200);
    const replay = await loaded.call('post', actionPath, request({ status })); assert.equal(replay.data.replayed, true);
    const conflict = await loaded.call('post', actionPath, request({ status: status === 'taken' ? 'skipped' : 'taken' })); assert.equal(conflict.statusCode, 409);
    assert.equal(actions.length, 1); assert.equal(pool.audit.length, 1); assert.equal(actions[0].actor_uid, 'user-A');
    assert.ok(pool.statements.some(item => item.sql.includes('UPDATE notifications SET is_read = TRUE')));
  }
});

test('future and cancelled doses reject completion and do not journal', async () => {
  for (const initial of [{ scheduled_at: new Date(now.getTime() + 60_000) }, { status: 'cancelled' }]) {
    const { pool, actions } = actionDatabase(initial); const loaded = await load('routes/reminders.js', pool);
    assert.equal((await loaded.call('post', actionPath, request({ status: 'taken' }))).statusCode, 409);
    assert.equal(actions.length, 0); assert.equal(pool.audit.length, 0); assert.ok(pool.transactions.includes('rollback'));
  }
});

test('stale dose actions reject withdrawn schedules, deleted medications, and unconfirmed prescriptions', async () => {
  for (const initial of [{ schedule_enabled: false }, { medication_confirmed: false }, { schedule_id: null }, { medication_missing: true }, { prescription_resident_id: 'R-other' }]) {
    const { pool, actions } = actionDatabase(initial);
    const loaded = await load('routes/reminders.js', pool);
    const res = await loaded.call('post', actionPath, request({ status: 'taken' }));
    assert.equal(res.statusCode, 409);
    assert.match(res.data.error, /no longer active/);
    assert.equal(actions.length, 0);
    const check = pool.statements.find(item => item.sql.startsWith('SELECT schedule_id, enabled'));
    assert.match(check.sql, /FOR UPDATE/);
    assert.equal(pool.transactions.includes('rollback'), true);
  }
});

test('approval withdrawn between lookup and locking read cannot race a dose write, with consistent parent-first lock order', async () => {
  const { pool, actions } = actionDatabase({}, { onMedicationLock: reminder => { reminder.medication_confirmed = false; } });
  const loaded = await load('routes/reminders.js', pool);
  const result = await loaded.call('post', actionPath, request({ status: 'taken' }));
  assert.equal(result.statusCode, 409);
  assert.equal(actions.length, 0);
  assert.equal(pool.audit.length, 0);
  const locks = pool.statements.filter(item => /FOR UPDATE/.test(item.sql));
  assert.equal(locks.length, 4);
  assert.match(locks[0].sql, /FROM prescriptions/);
  assert.match(locks[1].sql, /FROM medications/);
  assert.match(locks[2].sql, /FROM medication_schedules/);
  assert.match(locks[3].sql, /FROM medication_reminders/);
});

test('completed-history retries still replay after medication and schedule deletion', async () => {
  const { pool, actions } = actionDatabase({ status: 'taken', medication_missing: true, schedule_id: null });
  const loaded = await load('routes/reminders.js', pool);
  const result = await loaded.call('post', actionPath, request({ status: 'taken' }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.data.replayed, true);
  assert.equal(actions.length, 0);
});

test('reminder list exposes overdue timing without changing persisted dose status', async () => {
  const reminder = { reminder_id: 11, status: 'pending', presentation_at: new Date(now.getTime() - 31 * 60_000) };
  const pool = database(sql => {
    if (sql.startsWith('SELECT s.*')) return [[]];
    if (sql.startsWith('SELECT * FROM medication_reminders')) return [[reminder]];
    throw Error(`Unexpected reminder read SQL: ${sql}`);
  });
  const loaded = await load('routes/reminders.js', pool, { MEDICATION_ESCALATION_MINUTES: '30' });
  const result = await loaded.call('get', '/residents/:residentId/medication-reminders', request());
  assert.equal(result.statusCode, 200);
  assert.equal(result.data[0].is_overdue, true);
  assert.equal(result.data[0].escalation_minutes, 30);
  assert.equal(result.data[0].status, 'pending');
});

test('daily list retains previous-day snoozes only when their presentation belongs to the requested Colombo day', async () => {
  const reminders = [
    { reminder_id: 1, event_day: '2026-10-09', status: 'snoozed', presentation_at: doseInstant('2026-10-10', '00:40') },
    { reminder_id: 2, event_day: '2026-10-09', status: 'taken', presentation_at: doseInstant('2026-10-10', '00:40') },
    { reminder_id: 3, event_day: '2026-10-09', status: 'snoozed', presentation_at: doseInstant('2026-10-11', '00:00') },
    { reminder_id: 4, event_day: '2026-10-10', status: 'taken', presentation_at: doseInstant('2026-10-10', '08:00') },
  ];
  const pool = database((sql, values) => {
    if (sql.startsWith('SELECT s.*')) return [[]];
    if (sql.startsWith('SELECT * FROM medication_reminders')) {
      assert.match(sql, /event_day = \? OR status = 'snoozed' AND presentation_at >= \? AND presentation_at < \?/);
      assert.equal(values[2].toISOString(), '2026-10-09T18:30:00.000Z');
      assert.equal(values[3].toISOString(), '2026-10-10T18:30:00.000Z');
      return [reminders.filter(row => row.event_day === values[1] || row.status === 'snoozed' && row.presentation_at >= values[2] && row.presentation_at < values[3])];
    }
    throw Error(`Unexpected daily reminder SQL: ${sql}`);
  });
  const loaded = await load('routes/reminders.js', pool);
  const result = await loaded.call('get', '/residents/:residentId/medication-reminders', request({}, { query: { day: '2026-10-10' } }));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(Array.from(result.data, row => row.reminder_id), [1, 4]);
  assert.equal(result.data[0].event_day, '2026-10-09');
});

test('daily medication events cannot record an unconfirmed medication', async () => {
  const pool = database(sql => {
    if (sql.startsWith('SELECT prescription_id FROM medications')) return [[{ prescription_id: 'RX-A' }]];
    if (sql.startsWith('SELECT prescription_id FROM prescriptions')) return [[{ prescription_id: 'RX-A' }]];
    if (sql.startsWith('SELECT m.id')) { assert.match(sql, /FOR UPDATE/); return [[{ id: 9, confirmed: false }]]; }
    throw Error(`Unconfirmed medication must not create an event: ${sql}`);
  });
  const loaded = await load('routes/medicationEvents.js', pool);
  const result = await loaded.call('post', '/residents/:residentId/medication-events', request({ medicationId: 9, day: '2026-10-10', status: 'taken' }));
  assert.equal(result.statusCode, 404);
  assert.equal(pool.transactions.includes('rollback'), true);
});

test('snooze requires deliveryRound and retries exactly once for the same actor, minutes, and prior round', async () => {
  const { pool, reminder, actions } = actionDatabase(); const loaded = await load('routes/reminders.js', pool);
  for (const body of [{ status: 'snoozed' }, { status: 'snoozed', deliveryRound: 0, minutes: 4 }, { status: 'snoozed', deliveryRound: -1 }]) assert.equal((await loaded.call('post', actionPath, request(body))).statusCode, 400);
  const body = { status: 'snoozed', deliveryRound: 0, minutes: 10 };
  const saved = await loaded.call('post', actionPath, request(body)); assert.equal(saved.statusCode, 200); assert.equal(saved.data.delivery_round, 1);
  assert.equal(new Date(reminder.presentation_at).toISOString(), '2026-10-10T04:40:00.000Z');
  assert.equal((await loaded.call('post', actionPath, request(body))).data.replayed, true);
  assert.equal((await loaded.call('post', actionPath, request({ ...body, minutes: 20 }))).statusCode, 409);
  assert.equal((await loaded.call('post', actionPath, request(body, { user: { uid: 'user-B', role: 'caretaker', profile: {} } }))).statusCode, 409);
  assert.equal(actions.length, 1); assert.equal(pool.audit.length, 1); assert.equal(reminder.delivery_round, 1);
});

test('editing a schedule cancels a removed dose snoozed into the future even when its original time has passed', async () => {
  const removed = { status: 'snoozed', scheduled_at: new Date(now.getTime() - 30 * 60_000), presentation_at: new Date(now.getTime() + 10 * 60_000) };
  const pool = database((sql, values) => {
    if (sql.startsWith('SELECT prescription_id FROM medications')) return [[{ prescription_id: 'RX-A' }]];
    if (sql.startsWith('SELECT prescription_id FROM prescriptions')) return [[{ prescription_id: 'RX-A' }]];
    if (sql.startsWith('SELECT m.id, m.confirmed')) return [[{ id: 9, confirmed: true }]];
    if (sql.startsWith('SELECT * FROM medication_schedules')) return [[]];
    if (sql.startsWith('SELECT s.*')) return [[]];
    if (sql.startsWith("UPDATE medication_reminders SET status = 'cancelled'")) {
      if (!sql.includes('scheduled_at >=') || removed.scheduled_at >= values[2]) removed.status = 'cancelled';
      return [{ affectedRows: removed.status === 'cancelled' ? 1 : 0 }];
    }
    if (sql.startsWith('INSERT INTO medication_schedules')) return [{ insertId: 1 }];
    if (sql.startsWith('UPDATE notifications n JOIN medication_reminders')) return [{ affectedRows: 1 }];
    throw Error(`Unexpected schedule edit SQL: ${sql}`);
  });
  const loaded = await load('routes/reminders.js', pool);
  const res = await loaded.call('put', '/residents/:residentId/medication-schedules/:medicationId', request({ times: ['11:00'], startDate: '2026-10-10' }));
  assert.equal(res.statusCode, 200); assert.equal(removed.status, 'cancelled'); assert.equal(pool.audit.length, 1);
  const selection = pool.statements.find(item => item.sql.includes('SELECT m.id, m.confirmed'));
  assert.deepEqual(selection.values, ['9', 'RX-A']); assert.match(selection.sql, /FOR UPDATE/);
  const parent = pool.statements.find(item => item.sql.includes('FROM prescriptions'));
  assert.deepEqual(parent.values, ['RX-A', 'R-A']);
  const generated = pool.statements.find(item => item.sql.startsWith('SELECT s.*'));
  assert.match(generated.sql, /s.medication_id = \?/);
  assert.deepEqual(generated.values, ['R-A', 9]);
});

test('replaying an unchanged schedule preserves snoozes, delivery rounds and action history', async () => {
  const pool = database(sql => {
    if (sql.startsWith('SELECT prescription_id FROM medications')) return [[{ prescription_id: 'RX-A' }]];
    if (sql.startsWith('SELECT prescription_id FROM prescriptions')) return [[{ prescription_id: 'RX-A' }]];
    if (sql.startsWith('SELECT m.id, m.confirmed')) return [[{ id: 9, confirmed: true }]];
    if (sql.startsWith('SELECT * FROM medication_schedules')) return [[{ times: '["08:00","20:00"]', weekdays: '[0,1,2,3,4,5,6]', timezone: 'Asia/Colombo', start_date: '2026-10-10', end_date: null, food_instruction: null, enabled: 1 }]];
    throw Error(`An unchanged schedule must not mutate data: ${sql}`);
  });
  const loaded = await load('routes/reminders.js', pool);
  const result = await loaded.call('put', '/residents/:residentId/medication-schedules/:medicationId', request({ times: ['20:00', '08:00'], startDate: '2026-10-10' }));
  assert.equal(result.statusCode, 200); assert.equal(result.data.replayed, true);
  assert.equal(pool.audit.length, 0); assert.ok(pool.transactions.includes('commit'));
  assert.equal(pool.statements.some(item => /^(INSERT|UPDATE|DELETE)/.test(item.sql)), false);
});

test('push registration rejects unregistered roles, invalid projects, secret mismatch, and foreign token installations', async () => {
  const foreign = existingDevice({ installation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
  for (const devices of [[existingDevice()], [foreign]]) {
    const { pool } = pushDatabase(devices); const loaded = await load('routes/pushDevices.js', pool);
    const res = await loaded.call('post', '/push-devices', request({ ...registration, installationKey: 'b'.repeat(64) })); assert.equal(res.statusCode, 409);
    assert.ok(!pool.statements.some(item => item.sql.startsWith('INSERT'))); assert.ok(pool.transactions.includes('rollback'));
  }
  const { pool } = pushDatabase(); const loaded = await load('routes/pushDevices.js', pool, { EXPO_PUSH_PROJECT_IDS: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
  assert.equal((await loaded.call('post', '/push-devices', request(registration))).statusCode, 400);
  assert.equal((await loaded.call('post', '/push-devices', request(registration, { user: { uid: 'user-A', role: 'unregistered', profile: null } }))).statusCode, 403);
  assert.equal(pool.statements.length, 0);
});

test('installation-secret ownership transfer cancels old deliveries and preserves the verified installation', async () => {
  const { pool, state } = pushDatabase([existingDevice()]); const loaded = await load('routes/pushDevices.js', pool);
  const res = await loaded.call('post', '/push-devices', request(registration, { user: { uid: 'user-B', role: 'caretaker', profile: {} } }));
  assert.equal(res.statusCode, 200); assert.equal(res.data.deviceId, 1); assert.equal(state[0].owner_uid, 'user-B'); assert.equal(state[0].installation_key_hash, digest(installationKey));
  assert.ok(pool.statements.some(item => item.sql.includes("status IN ('pending', 'retry', 'sending')"))); assert.ok(pool.transactions.includes('commit'));
});

test('same-owner login renews a disabled registration once while foreground refresh stays idempotent', async () => {
  const { pool, state } = pushDatabase([existingDevice({ enabled: false, registration_version: 1 })]);
  const loaded = await load('routes/pushDevices.js', pool);
  assert.equal((await loaded.call('post', '/push-devices', request(registration))).statusCode, 200);
  assert.equal(state[0].registration_version, 2);
  assert.equal((await loaded.call('post', '/push-devices', request(registration))).statusCode, 200);
  assert.equal(state[0].registration_version, 2, 'a normal app refresh must not generate duplicate alert identities');
});

test('transferring an existing installation cannot bypass the receiving account device limit', async () => {
  const owned = Array.from({ length: 10 }, (_, index) => existingDevice({ device_id: index + 2, owner_uid: 'user-B', installation_id: `fixture-installation-${index}`, token_hash: digest(`fixture-token-${index}`) }));
  const { pool, state } = pushDatabase([existingDevice(), ...owned]); const loaded = await load('routes/pushDevices.js', pool);
  const res = await loaded.call('post', '/push-devices', request(registration, { user: { uid: 'user-B', role: 'caretaker', profile: {} } }));
  assert.equal(res.statusCode, 409); assert.equal(state[0].owner_uid, 'user-A'); assert.ok(!pool.statements.some(item => item.sql.startsWith('INSERT')));
});

test('token refresh cancels stale deliveries and device status never returns tokens or installation secrets', async () => {
  const { pool, state } = pushDatabase([existingDevice(), existingDevice({ device_id: 2, installation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', owner_uid: 'user-B', token_hash: digest('user-B-token'), push_token: 'ExpoPushToken[userbabcdefghijk123456]' })]);
  const loaded = await load('routes/pushDevices.js', pool);
  const replacement = 'ExponentPushToken[newtokenabcdefgh12345]';
  assert.equal((await loaded.call('post', '/push-devices', request({ ...registration, token: replacement }))).statusCode, 200);
  assert.equal(state[0].token_hash, digest(replacement)); assert.equal(state[1].owner_uid, 'user-B');
  const status = await loaded.call('get', '/push-devices', request()); assert.equal(status.data.devices.length, 1);
  assert.ok(!JSON.stringify(status.data).includes(replacement)); assert.ok(!JSON.stringify(status.data).includes(installationKey)); assert.ok(!('token_hash' in status.data.devices[0]));
  assert.ok(pool.statements.some(item => item.sql.includes("status IN ('pending', 'retry', 'sending')")));
});

test('device revocation verifies the owner and installation key, including already claimed sends', async () => {
  const { pool, state } = pushDatabase([existingDevice()]); const loaded = await load('routes/pushDevices.js', pool);
  assert.equal((await loaded.call('delete', '/push-devices', request({ ...registration, installationKey: 'b'.repeat(64) }))).statusCode, 403); assert.equal(state[0].enabled, true);
  assert.equal((await loaded.call('delete', '/push-devices', request(registration, { user: { uid: 'user-B', role: 'caretaker', profile: {} } }))).statusCode, 200); assert.equal(state[0].enabled, true);
  assert.equal((await loaded.call('delete', '/push-devices', request(registration))).statusCode, 200); assert.equal(state[0].enabled, false);
  assert.ok(pool.statements.some(item => item.sql.includes("status IN ('pending', 'retry', 'sending')")));
});

test('possession revocation returns the same generic response for absent installations and wrong proof without writing', async () => {
  const { pool, state } = pushDatabase([existingDevice()]); const loaded = await load('routes/pushDevices.js', pool);
  const bodies = [{ installationId, installationKey: 'b'.repeat(64) }, { installationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', installationKey }];
  const results = [];
  for (const body of bodies) { const res = response(); await loaded.exports.revokeInstallationHandler({ body, ip: '192.0.2.1' }, res); assert.equal(res.statusCode, 200); results.push(JSON.stringify(res.data)); }
  assert.deepEqual(results, ['{"unregistered":true}', '{"unregistered":true}']); assert.equal(state[0].enabled, true);
  assert.ok(!pool.statements.some(item => /^(UPDATE|INSERT|DELETE)/.test(item.sql))); assert.equal(pool.transactions.filter(item => item === 'commit').length, 2);
});

test('correct installation possession disables only that device and cancels claimed work without account authentication', async () => {
  const other = existingDevice({ device_id: 2, owner_uid: 'user-B', installation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', token_hash: digest('other-token'), push_token: 'ExpoPushToken[otherabcdefghijklmnop]' });
  const { pool, state } = pushDatabase([existingDevice(), other]); const before = state.map(row => ({ ...row })); const loaded = await load('routes/pushDevices.js', pool);
  const res = response();
  await loaded.exports.revokeInstallationHandler({ body: { installationId, installationKey, owner_uid: 'forged-owner', push_token: 'forged-token', enabled: true }, ip: '192.0.2.2' }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.data.unregistered, true);
  assert.deepEqual(state[0], { ...before[0], enabled: false }); assert.deepEqual(state[1], before[1]);
  const writes = pool.statements.filter(item => item.sql.startsWith('UPDATE'));
  assert.equal(writes.length, 2); assert.deepEqual(writes[0].values, [1]); assert.deepEqual(writes[1].values, [1]);
  assert.match(writes[1].sql, /status IN \('pending', 'retry', 'sending'\)/);
  assert.equal(pool.transactions.at(-1), 'release'); assert.ok(pool.transactions.includes('commit'));
});

test('possession revocation validates proof shape and limits each address to twenty requests per minute', async () => {
  const pool = database(() => { throw Error('Invalid or rate-limited requests must not access the database'); }); const loaded = await load('routes/pushDevices.js', pool);
  for (let index = 0; index < 20; index++) { const res = response(); await loaded.exports.revokeInstallationHandler({ body: index % 2 ? { installationId, installationKey: 'short-key' } : { installationId: 'not-a-uuid', installationKey }, ip: '192.0.2.3' }, res); assert.equal(res.statusCode, 400); }
  const limited = response(); limited.headers = {}; limited.set = (name, value) => { limited.headers[name] = value; return limited; };
  await loaded.exports.revokeInstallationHandler({ body: { installationId, installationKey }, ip: '192.0.2.3' }, limited);
  assert.equal(limited.statusCode, 429); assert.equal(limited.headers['Retry-After'], '60');
  const independent = response(); await loaded.exports.revokeInstallationHandler({ body: {}, socket: { remoteAddress: '192.0.2.4' } }, independent); assert.equal(independent.statusCode, 400);
  assert.equal(pool.statements.length, 0);
});

function cycleDatabase(initial = {}) {
  const state = { lock: true, schedules: [], reminders: [], deliveries: [], devices: [], incidents: [], sos: [], wellness: [], notifications: [], offlineAssignments: {}, onBoundary: null, ...initial };
  const eligible = (device, type, resident) => device.enabled && (type === 'medication' ? device.role === 'patient' && device.resident_id === resident || device.role === 'caretaker' && device.active !== false && device.assignments?.includes(resident) : type === 'notification' ? device.role === 'patient' && device.resident_id === resident : device.role === 'caretaker' && device.active !== false && device.assignments?.includes(resident));
  const incidentResidents = row => row.corrected_resident_id || row.resident_id ? [row.corrected_resident_id || row.resident_id] : row.incident_type === 'device_offline' ? state.offlineAssignments[row.device_id] || [] : [];
  const pool = database((sql, values) => {
    if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: state.lock ? 1 : 0 }]];
    if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }]];
    if (sql.startsWith('SELECT s.*')) return [state.schedules];
    if (sql.startsWith('UPDATE medication_reminders r')) return [{ affectedRows: 0 }];
    if (sql.startsWith('UPDATE notifications n JOIN medication_reminders')) {
      for (const notice of state.notifications) if (state.reminders.some(reminder => reminder.notification_id === notice.notification_id && ['cancelled', 'taken', 'skipped'].includes(reminder.status))) notice.is_read = true;
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT * FROM medication_reminders WHERE status')) return [state.reminders.filter(row => ['pending', 'snoozed'].includes(row.status) && new Date(row.presentation_at) <= values[0] && new Date(row.presentation_at) >= values[1]).map(row => ({ ...row }))];
    if (sql.startsWith('SELECT * FROM medication_reminders WHERE reminder_id')) return [state.reminders.filter(row => row.reminder_id === values[0] && ['pending', 'snoozed'].includes(row.status)).map(row => ({ ...row }))];
    if (sql.startsWith('INSERT INTO notifications')) { const row = { notification_id: state.notifications.length + 1, resident_id: values[0], title: values[1], message: values[2], type: 'medication_reminder', is_read: false }; state.notifications.push(row); return [{ insertId: row.notification_id }]; }
    if (sql.startsWith('UPDATE medication_reminders SET notification_id')) { const row = state.reminders.find(row => row.reminder_id === values[1]); row.notification_id = values[0]; row.notified_round = row.delivery_round; return [{ affectedRows: 1 }]; }
    if (sql.startsWith('UPDATE medication_reminders SET notified_round')) { const row = state.reminders.find(row => row.reminder_id === values[0]); row.notified_round = row.delivery_round; return [{ affectedRows: 1 }]; }
    if (sql.startsWith('UPDATE notifications SET is_read = FALSE')) { const row = state.notifications.find(row => row.notification_id === values[0]); if (row) row.is_read = false; return [{ affectedRows: 1 }]; }
    if (sql.startsWith('SELECT incident_id AS id')) return [state.incidents.filter(row => row.status === 'open').flatMap(row => incidentResidents(row).map(resident_id => ({ id: row.incident_id, resident_id })))];
    if (sql.startsWith('SELECT id, resident_id FROM sos_alerts')) return [state.sos.filter(row => !row.is_resolved)];
    if (sql.startsWith('SELECT id, resident_id FROM wellness_alerts')) return [state.wellness.filter(row => !row.acknowledged && ['warning', 'critical'].includes(row.severity))];
    if (sql.startsWith('SELECT notification_id AS id')) return [state.notifications.filter(row => !row.is_read && row.type !== 'medication_reminder').map(row => ({ id: row.notification_id, resident_id: row.resident_id }))];
    if (sql.startsWith('INSERT IGNORE INTO push_deliveries')) {
      assert.match(sql, /IF\(d.registration_version > 1, CONCAT\(':', d.registration_version\), ''\)/);
      for (const device of state.devices.filter(device => eligible(device, values[1], values[3]))) {
        const source_key = `${values[0]}:${key(device)}`;
        if (!state.deliveries.some(row => row.source_key === source_key && row.device_id === device.device_id)) state.deliveries.push({ delivery_id: state.deliveries.length + 1, source_key, source_type: values[1], source_id: values[2], resident_id: values[3], device_id: device.device_id, owner_uid: device.owner_uid, token_hash: device.token_hash, registration_version: Number(device.registration_version || 1), next_attempt_at: values[4], status: 'pending', attempts: 0 });
      }
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT d.push_token')) {
      assert.match(sql, /BINARY d.owner_uid = BINARY \? AND d.token_hash = \? AND d.registration_version = \? AND d.enabled = TRUE/);
      const delivery = state.deliveries.find(row => row.device_id === values[0] && row.owner_uid === values[1] && row.token_hash === values[2] && Number(row.registration_version || 1) === values[3]);
      const device = state.devices.find(row => row.device_id === values[0] && row.owner_uid === values[1] && row.token_hash === values[2] && Number(row.registration_version || 1) === values[3]);
      return [device && delivery && eligible(device, delivery.source_type, delivery.resident_id) ? [{ push_token: device.push_token, project_id: device.project_id }] : []];
    }
    if (sql.startsWith('SELECT r.reminder_id')) return [state.reminders.filter(row => row.reminder_id === values[0] && row.resident_id === values[1] && ['pending', 'snoozed'].includes(row.status) && row.enabled !== false && row.confirmed !== false && new Date(row.presentation_at) <= values[2] && new Date(row.presentation_at) >= values[3])];
    if (sql.startsWith('SELECT i.incident_id')) return [state.incidents.filter(row => row.incident_id === values[0] && row.status === 'open' && incidentResidents(row).includes(values[1]))];
    if (sql.startsWith('SELECT id FROM sos_alerts')) return [state.sos.filter(row => row.id === values[0] && row.resident_id === values[1] && !row.is_resolved)];
    if (sql.startsWith('SELECT id FROM wellness_alerts')) return [state.wellness.filter(row => row.id === values[0] && row.resident_id === values[1] && !row.acknowledged)];
    if (sql.startsWith('SELECT notification_id FROM notifications')) return [state.notifications.filter(row => row.notification_id === values[0] && row.resident_id === values[1] && !row.is_read)];
    if (sql.startsWith("UPDATE push_deliveries SET status = 'unknown'")) { for (const row of state.deliveries) if (row.status === 'sending' && new Date(row.last_attempt_at) < values[0]) Object.assign(row, { status: 'unknown', provider_error: 'InterruptedDispatch' }); return [{ affectedRows: 1 }]; }
    if (sql.startsWith("SELECT * FROM push_deliveries WHERE status IN")) return [state.deliveries.filter(row => ['pending', 'retry'].includes(row.status) && new Date(row.next_attempt_at) <= values[0] && row.attempts < values[1]).map(row => ({ ...row }))];
    if (sql.startsWith("UPDATE push_deliveries SET status = 'sending'")) { const row = state.deliveries.find(row => row.delivery_id === values[1] && ['pending', 'retry'].includes(row.status)); if (row) Object.assign(row, { status: 'sending', attempts: row.attempts + 1, last_attempt_at: values[0] }); return [{ affectedRows: row ? 1 : 0 }]; }
    if (sql.startsWith('SELECT delivery_id FROM push_deliveries')) { state.onBoundary?.(state); return [state.deliveries.filter(row => row.delivery_id === values[0] && row.status === 'sending').map(row => ({ delivery_id: row.delivery_id }))]; }
    if (sql.startsWith("UPDATE push_deliveries SET status = 'cancelled'")) { const row = state.deliveries.find(row => row.delivery_id === values[0]); if (row) row.status = 'cancelled'; return [{ affectedRows: row ? 1 : 0 }]; }
    if (sql.startsWith('UPDATE push_deliveries SET status = ?')) {
      const row = state.deliveries.find(row => row.delivery_id === values[4]);
      if (row && row.status === (sql.includes("status = 'sending'") ? 'sending' : 'ticket_accepted')) {
        if (sql.includes('expo_ticket_id')) Object.assign(row, { status: values[0], expo_ticket_id: values[1], provider_error: values[2], next_attempt_at: values[3] });
        else Object.assign(row, { status: values[0], provider_error: values[1], next_attempt_at: values[2], receipt_checked_at: values[3] });
      }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (sql.startsWith("SELECT * FROM push_deliveries WHERE status = 'ticket_accepted'")) return [state.deliveries.filter(row => row.status === 'ticket_accepted' && new Date(row.next_attempt_at) <= values[0]).map(row => ({ ...row }))];
    if (sql.startsWith('UPDATE push_deliveries SET next_attempt_at')) { for (const row of state.deliveries) if (row.status === 'ticket_accepted' && new Date(row.next_attempt_at) <= values[1]) row.next_attempt_at = values[0]; return [{ affectedRows: 1 }]; }
    if (sql.startsWith('UPDATE push_devices SET')) { const row = state.devices.find(row => row.device_id === values[1] && row.token_hash === values[2]); if (row) { row.last_error = values[0]; if (sql.includes('enabled = FALSE')) row.enabled = false; } return [{ affectedRows: row ? 1 : 0 }]; }
    throw Error(`Unexpected cycle SQL: ${sql}`);
  });
  return { pool, state };
}

const patientDevice = (overrides = {}) => ({ ...existingDevice(), role: 'patient', resident_id: 'R-A', ...overrides });
const caretakerDevice = (overrides = {}) => ({ ...existingDevice({ device_id: 2, owner_uid: 'carer-A', token_hash: digest('carer-token'), push_token: 'ExpoPushToken[carerabcdefghijklmnop]' }), role: 'caretaker', assignments: ['R-A'], ...overrides });
const dueReminder = (overrides = {}) => ({ reminder_id: 11, resident_id: 'R-A', medication_id: 9, scheduled_at: new Date(now.getTime() - 60 * 60_000), presentation_at: new Date(now.getTime() - 60 * 60_000), status: 'pending', delivery_round: 0, notified_round: -1, notification_id: null, ...overrides });
const sosDelivery = (device, overrides = {}) => ({ delivery_id: 1, source_key: `sos:7:${digest('R-A').slice(0, 16)}:${key(device)}`, source_type: 'sos', source_id: 7, resident_id: 'R-A', device_id: device.device_id, owner_uid: device.owner_uid, token_hash: device.token_hash, status: 'pending', attempts: 0, next_attempt_at: now, ...overrides });
const provider = data => ({ ok: true, json: async () => ({ data }) });

test('disabled sending still creates one in-app reminder and idempotent patient/caretaker delivery rows without contacting a provider', async () => {
  const { pool, state } = cycleDatabase({ reminders: [dueReminder()], devices: [patientDevice(), caretakerDevice()] });
  const service = (await load('notificationService.js', pool)).exports;
  const fetchImpl = () => { throw Error('Disabled delivery contacted the provider'); };
  await service.runNotificationCycle(pool, { now, sendingEnabled: false, fetchImpl });
  await service.runNotificationCycle(pool, { now, sendingEnabled: false, fetchImpl });
  assert.equal(state.notifications.length, 1); assert.equal(state.deliveries.length, 3);
  assert.equal(state.deliveries.filter(row => row.source_type === 'medication').length, 2);
  assert.equal(state.deliveries.filter(row => row.source_type === 'medication_overdue').length, 1);
  assert.ok(state.deliveries.every(row => row.status === 'pending' && row.attempts === 0));
  assert.ok(state.deliveries.some(row => row.source_key.startsWith('medication_overdue:11:0:'))); assert.equal(pool.transactions.at(-1), 'release');
});

test('same account re-registration delivers unresolved sources again without reviving previous attempted work', async () => {
  const device = caretakerDevice({ registration_version: 2 });
  const previous = sosDelivery(device, { registration_version: 1, source_key: `sos:7:${digest('R-A').slice(0, 16)}:${key({ ...device, registration_version: 1 })}`, status: 'cancelled', attempts: 1 });
  const { pool, state } = cycleDatabase({ devices: [device], deliveries: [previous], sos: [{ id: 7, resident_id: 'R-A', is_resolved: false }] });
  const service = (await load('notificationService.js', pool)).exports;
  const sent = [];
  await service.runNotificationCycle(pool, { now, sendingEnabled: true, fetchImpl: async (_url, options) => { sent.push(...JSON.parse(options.body)); return provider([{ status: 'ok', id: 'new-ticket' }]); } });
  assert.equal(state.deliveries.length, 2);
  assert.equal(state.deliveries[0].status, 'cancelled');
  assert.equal(state.deliveries[1].status, 'ticket_accepted');
  assert.equal(state.deliveries[1].registration_version, 2);
  assert.equal(sent.length, 1); assert.equal(sent[0].data.ownerUid, device.owner_uid);
  assert.equal(await service.deliveryStillRelevant(pool, { ...previous, status: 'pending' }, now), null);
  await service.runNotificationCycle(pool, { now, sendingEnabled: false });
  assert.equal(state.deliveries.length, 2, 'routine refresh cannot queue another version-two alert');
});

test('corrected incidents route to the corrected resident and offline incidents fan out only to current active caretakers', async () => {
  const { pool, state } = cycleDatabase({ devices: [patientDevice(), caretakerDevice(), caretakerDevice({ device_id: 3, owner_uid: 'carer-B', token_hash: digest('B-token'), assignments: ['R-B'] }), caretakerDevice({ device_id: 4, owner_uid: 'inactive-carer', active: false })], incidents: [{ incident_id: 1, resident_id: 'R-A', corrected_resident_id: 'R-B', status: 'open' }, { incident_id: 2, resident_id: null, corrected_resident_id: null, incident_type: 'device_offline', device_id: 'CAM-A', status: 'open' }], offlineAssignments: { 'CAM-A': ['R-A', 'R-B'] } });
  const service = (await load('notificationService.js', pool)).exports; await service.runNotificationCycle(pool, { now, sendingEnabled: false });
  assert.deepEqual(state.deliveries.map(row => [row.source_id, row.resident_id, row.owner_uid]), [[1, 'R-B', 'carer-B'], [2, 'R-A', 'carer-A'], [2, 'R-B', 'carer-B']]);
  const query = pool.statements.find(item => item.sql.includes('SELECT incident_id AS id')).sql;
  assert.match(query, /COALESCE\(corrected_resident_id, resident_id\)/); assert.match(query, /a.unassigned_at IS NULL/);
  assert.match(pool.statements.find(item => item.sql.startsWith('INSERT IGNORE')).sql, /c.is_active = TRUE/);
});

test('token rotation and owner transfer allow fresh source deliveries while retained old registrations fail relevance checks', async () => {
  const device = caretakerDevice(); const old = sosDelivery(device, { status: 'cancelled' });
  const changed = { ...device, owner_uid: 'carer-B', token_hash: digest('rotated-token') };
  const { pool, state } = cycleDatabase({ devices: [changed], deliveries: [old], sos: [{ id: 7, resident_id: 'R-A', is_resolved: false }] });
  const service = (await load('notificationService.js', pool)).exports;
  assert.equal(await service.deliveryStillRelevant(pool, old, now), null);
  await service.runNotificationCycle(pool, { now, sendingEnabled: false });
  assert.equal(state.deliveries.length, 2); assert.notEqual(state.deliveries[0].source_key, state.deliveries[1].source_key); assert.equal(state.deliveries[1].owner_uid, 'carer-B');
  assert.equal(service.registrationKey(changed), key(changed));
});

test('snoozed round rejects old reminder and overdue deliveries and generates fresh escalation identity', async () => {
  const device = caretakerDevice(); const reminder = dueReminder({ delivery_round: 2, notified_round: 2 });
  const stale = { ...sosDelivery(device), source_type: 'medication_overdue', source_id: 11, source_key: `medication_overdue:11:1:${key(device)}` };
  const { pool, state } = cycleDatabase({ reminders: [reminder], devices: [device], deliveries: [stale] }); const service = (await load('notificationService.js', pool)).exports;
  assert.equal(await service.deliveryStillRelevant(pool, stale, now), null);
  await service.runNotificationCycle(pool, { now, sendingEnabled: false });
  assert.ok(state.deliveries.some(row => row.source_key === `medication_overdue:11:2:${key(device)}`));
  assert.equal(await service.deliveryStillRelevant(pool, { ...stale, source_type: 'medication', source_key: `medication:11:1:${key(device)}` }, now), null);
});

test('an unavailable worker lock skips all preparation and releases its connection', async () => {
  const { pool } = cycleDatabase({ lock: false }); const service = (await load('notificationService.js', pool)).exports;
  const result = await service.runNotificationCycle(pool, { now, sendingEnabled: true, fetchImpl: () => { throw Error('No worker lock'); } });
  assert.equal(result.skipped, true); assert.equal(pool.statements.length, 1); assert.equal(pool.transactions.at(-1), 'release');
});

test('provider tickets classify transient, invalid-token, and malformed outcomes without claiming device receipt', async () => {
  const service = (await load('notificationService.js', database(() => [[]]))).exports;
  assert.equal(service.classifyPushResult({ status: 'ok', id: 'ticket' }).status, 'ticket_accepted');
  assert.equal(service.classifyPushResult({ status: 'error', details: { error: 'MessageRateExceeded' } }).status, 'retry');
  assert.equal(service.classifyPushResult({ status: 'error', details: { error: 'DeviceNotRegistered' } }).status, 'failed');
  assert.equal(service.classifyPushResult({ status: 'ok' }).error, 'InvalidProviderResponse');
});

test('dispatch retries HTTP throttling with backoff and caps the fifth attempt', async () => {
  for (const attempts of [0, 4]) {
    const device = caretakerDevice(); const { pool, state } = cycleDatabase({ devices: [device], deliveries: [sosDelivery(device, { attempts })], sos: [{ id: 7, resident_id: 'R-A', is_resolved: false }] });
    const service = (await load('notificationService.js', pool)).exports; let sent = 0;
    await service.runNotificationCycle(pool, { now, sendingEnabled: true, fetchImpl: async () => { sent++; return { ok: false, status: 429 }; } });
    assert.equal(sent, 1); assert.equal(state.deliveries[0].attempts, attempts + 1); assert.equal(state.deliveries[0].status, attempts === 4 ? 'failed' : 'retry'); assert.equal(state.deliveries[0].provider_error, 'Http429');
    assert.equal(state.deliveries[0].next_attempt_at.getTime(), now.getTime() + 30_000 * 2 ** attempts);
  }
});

test('ambiguous transport failure preserves unknown rather than resending automatically', async () => {
  const device = caretakerDevice(); const { pool, state } = cycleDatabase({ devices: [device], deliveries: [sosDelivery(device)], sos: [{ id: 7, resident_id: 'R-A', is_resolved: false }] });
  const service = (await load('notificationService.js', pool)).exports; let sent = 0;
  const fetchImpl = async () => { sent++; throw new TypeError('Connection reset after send'); };
  await service.runNotificationCycle(pool, { now, sendingEnabled: true, fetchImpl }); await service.runNotificationCycle(pool, { now, sendingEnabled: true, fetchImpl });
  assert.equal(sent, 1); assert.equal(state.deliveries[0].status, 'unknown'); assert.equal(state.deliveries[0].provider_error, 'TransportOutcomeUnknown');
});

test('cancellation after a delivery claim prevents provider sending at the boundary', async () => {
  const device = caretakerDevice(); const { pool, state } = cycleDatabase({ devices: [device], deliveries: [sosDelivery(device)], sos: [{ id: 7, resident_id: 'R-A', is_resolved: false }], onBoundary: current => { current.deliveries[0].status = 'cancelled'; } });
  const service = (await load('notificationService.js', pool)).exports;
  await service.runNotificationCycle(pool, { now, sendingEnabled: true, fetchImpl: () => { throw Error('Cancelled delivery was sent'); } }); assert.equal(state.deliveries[0].status, 'cancelled');
});

test('token changes, removed assignments, and resolved sources after claiming are rechecked before sending', async () => {
  for (const change of [current => { current.devices[0].token_hash = digest('rotated-after-claim'); }, current => { current.devices[0].assignments = []; }, current => { current.sos[0].is_resolved = true; }]) {
    const device = caretakerDevice(); const { pool, state } = cycleDatabase({ devices: [device], deliveries: [sosDelivery(device)], sos: [{ id: 7, resident_id: 'R-A', is_resolved: false }], onBoundary: change });
    const service = (await load('notificationService.js', pool)).exports;
    await service.runNotificationCycle(pool, { now, sendingEnabled: true, fetchImpl: () => { throw Error('Stale recipient or resolved source was sent'); } });
    assert.equal(state.deliveries[0].status, 'cancelled'); assert.equal(state.deliveries[0].attempts, 1);
  }
});

test('different Expo projects are sent in separate batches', async () => {
  const first = caretakerDevice(), second = caretakerDevice({ device_id: 3, owner_uid: 'carer-B', token_hash: digest('project-B-token'), push_token: 'ExpoPushToken[projectbabcdefgh12345]', project_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
  const { pool, state } = cycleDatabase({ devices: [first, second], sos: [{ id: 7, resident_id: 'R-A', is_resolved: false }] }); const service = (await load('notificationService.js', pool)).exports;
  const batches = [];
  await service.runNotificationCycle(pool, { now, sendingEnabled: true, fetchImpl: async (url, options) => { assert.ok(url.endsWith('/send')); const batch = JSON.parse(options.body); batches.push(batch); return provider(batch.map((_payload, index) => ({ status: 'ok', id: `ticket-${batches.length}-${index}` }))); } });
  assert.equal(batches.length, 2); assert.ok(batches.every(batch => batch.length === 1)); assert.deepEqual(batches.map(batch => batch[0].to), [first.push_token, second.push_token]); assert.ok(state.deliveries.every(row => row.status === 'ticket_accepted'));
});

test('provider acceptance remains a ticket until a later receipt confirms provider handoff', async () => {
  const device = caretakerDevice(); const { pool, state } = cycleDatabase({ devices: [device], deliveries: [sosDelivery(device)], sos: [{ id: 7, resident_id: 'R-A', is_resolved: false }] });
  const service = (await load('notificationService.js', pool)).exports; const requests = [];
  const fetchImpl = async (url, options) => { requests.push({ url, payload: JSON.parse(options.body) }); return provider(url.endsWith('/send') ? [{ status: 'ok', id: 'ticket-1' }] : { 'ticket-1': { status: 'ok' } }); };
  await service.runNotificationCycle(pool, { now, sendingEnabled: true, fetchImpl }); assert.equal(state.deliveries[0].status, 'ticket_accepted'); assert.equal(requests.length, 1);
  await service.runNotificationCycle(pool, { now: new Date(now.getTime() + 16 * 60_000), sendingEnabled: true, fetchImpl }); assert.equal(state.deliveries[0].status, 'provider_accepted'); assert.equal(requests.length, 2); assert.deepEqual(requests[1].payload, { ids: ['ticket-1'] });
});

test('invalid-device receipts disable only the matching current token and expire missing receipts as unknown', async () => {
  for (const scenario of ['invalid-token', 'missing-expired', 'malformed-error']) {
    const device = caretakerDevice(); const delivery = sosDelivery(device, { status: 'ticket_accepted', attempts: 1, expo_ticket_id: 'ticket-1', last_attempt_at: new Date(now.getTime() - (scenario === 'missing-expired' ? 24 * 60 * 60_000 : 20 * 60_000)) });
    const { pool, state } = cycleDatabase({ devices: [device], deliveries: [delivery] }); const service = (await load('notificationService.js', pool)).exports;
    const receipts = scenario === 'missing-expired' ? {} : { 'ticket-1': { status: 'error', details: { error: scenario === 'invalid-token' ? 'DeviceNotRegistered' : { untrusted: true } } } };
    await service.runNotificationCycle(pool, { now, sendingEnabled: true, fetchImpl: async () => provider(receipts) });
    assert.equal(state.deliveries[0].status, scenario === 'missing-expired' ? 'unknown' : 'failed');
    assert.equal(state.devices[0].enabled, scenario !== 'invalid-token');
    if (scenario === 'missing-expired') assert.equal(state.deliveries[0].provider_error, 'ReceiptUnavailable');
    if (scenario === 'malformed-error') assert.equal(state.deliveries[0].provider_error, 'ProviderDeliveryFailed');
    if (scenario === 'invalid-token') assert.deepEqual(pool.statements.find(item => item.sql.startsWith('UPDATE push_devices SET enabled')).values, ['DeviceNotRegistered', device.device_id, device.token_hash]);
  }
});

test('transient receipt errors queue a bounded retry without calling it delivered', async () => {
  const device = caretakerDevice(); const { pool, state } = cycleDatabase({ devices: [device], deliveries: [sosDelivery(device, { status: 'ticket_accepted', attempts: 1, expo_ticket_id: 'ticket-1', last_attempt_at: new Date(now.getTime() - 20 * 60_000) })] }); const service = (await load('notificationService.js', pool)).exports;
  await service.runNotificationCycle(pool, { now, sendingEnabled: true, fetchImpl: async url => { assert.ok(url.endsWith('/getReceipts')); return provider({ 'ticket-1': { status: 'error', details: { error: 'MessageRateExceeded' } } }); } });
  assert.equal(state.deliveries[0].status, 'retry'); assert.equal(state.deliveries[0].provider_error, 'MessageRateExceeded'); assert.equal(state.deliveries[0].attempts, 1); assert.equal(state.deliveries[0].next_attempt_at.getTime(), now.getTime() + 60_000);
});

test('lock-screen payloads omit all resident, drug, emotion, and incident details', async () => {
  const service = (await load('notificationService.js', database(() => [[]]))).exports;
  for (const source_type of ['medication', 'medication_overdue', 'incident', 'sos', 'wellness', 'notification']) {
    const payload = service.pushPayload({ delivery_id: 12, source_id: 14, source_type, owner_uid: 'opaque-owner-id', resident_id: 'SECRET-RESIDENT', resident_name: 'SECRET-NAME', drug_name: 'SECRET-DRUG', emotion: 'SECRET-EMOTION', message: 'SECRET-DESCRIPTION' }, token);
    assert.ok(!JSON.stringify(payload).includes('SECRET')); assert.equal(payload.data.deliveryId, '12'); assert.equal(payload.data.sourceId, '14'); assert.equal(payload.to, token);
    assert.equal(payload.priority, source_type === 'medication' ? 'normal' : 'high');
    assert.equal(payload.data.ownerUid, 'opaque-owner-id');
  }
});

test('empty provider ticket IDs cannot be accepted as a trackable delivery', async () => {
  const service = (await load('notificationService.js', database(() => [[]]))).exports;
  assert.equal(service.classifyPushResult({ status: 'ok', id: '' }).status, 'failed');
});

test('notification worker cadence rejects unsafe intervals and defaults invalid settings', async () => {
  const service = (await load('notificationService.js', database(() => [[]]))).exports;
  for (const [input, expected] of [[undefined, 30_000], ['invalid', 30_000], [Infinity, 30_000], [0, 5000], [-10, 5000], [60_000, 60_000], [999_999, 300_000]]) assert.equal(service.notificationWorkerInterval(input), expected);
});
