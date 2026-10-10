import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '../../..');
const response = body => ({ ok: true, json: async () => body });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let index = 0; index < 15; index += 1) await new Promise(done => setImmediate(done)); };

async function fixture(app, { sendingEnabled = false, doses = [], platform = 'android', delayedPost = null, permissionGranted = true, storedIdentity = null, rejectAuthenticatedDelete = false, rejectPossessionDelete = false, fixedNow = null } = {}) {
  const effects = [], requests = [], states = [], scheduled = new Map(), hooks = {};
  let scheduledCalls = 0;
  let serverOwner = storedIdentity ? 'previous-owner' : null, signedOut = false, handler;
  const user = uid => ({ uid, getIdToken: async () => { if (signedOut) throw new Error('Token cleared after logout'); return 'bearer-' + uid; } });
  const auth = { currentUser: null };
  const Notifications = {
    AndroidImportance: { HIGH: 4, MAX: 5 }, IosAuthorizationStatus: { PROVISIONAL: 3 }, SchedulableTriggerInputTypes: { DATE: 'date' },
    setNotificationHandler: value => { handler = value; },
    setNotificationChannelAsync: async () => {}, getPermissionsAsync: async () => ({ status: permissionGranted ? 'granted' : 'denied', granted: permissionGranted }),
    requestPermissionsAsync: async () => ({ granted: permissionGranted }), getExpoPushTokenAsync: async () => ({ data: 'ExpoPushToken[fixture-token-123456]' }),
    addPushTokenListener: callback => { hooks.token = callback; return { remove() {} }; },
    getAllScheduledNotificationsAsync: async () => [...scheduled.values()],
    cancelScheduledNotificationAsync: async id => { scheduled.delete(id); },
    dismissAllNotificationsAsync: async () => { requests.push({ method: 'DISMISS' }); },
    scheduleNotificationAsync: async item => { scheduledCalls += 1; scheduled.set(item.identifier, item); return item.identifier; },
  };
  let stored = storedIdentity && JSON.stringify(storedIdentity);
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length || fixedNow === null ? args : [fixedNow])); }
    static now() { return fixedNow ?? Date.now(); }
  }
  const context = createContext({
    useEffect: fn => effects.push(fn()), useRef: value => ({ current: value }), useState: value => [value, state => states.push(state)],
    AppState: { addEventListener: (_, callback) => { hooks.foreground = callback; return { remove() {} }; } }, Platform: { OS: platform },
    AsyncStorage: { getItem: async () => stored, setItem: async (_, value) => { stored = value; } },
    Constants: { executionEnvironment: 'standalone', expoConfig: { extra: { eas: { projectId: 'a6568fcb-0ea5-4a33-ab65-0125e0c45552' } } } },
    Crypto: { randomUUID: () => 'b1111111-1111-4111-8111-111111111111', getRandomBytesAsync: async () => Array(32).fill(12) },
    Device: { isDevice: true }, Notifications, auth,
    onAuthStateChanged: (_, callback) => { hooks.auth = callback; return () => {}; },
    apiFetch: async path => {
      if (path.startsWith('/users/')) return response({ role: app === '5-patient' ? 'patient' : 'caretaker', resident_id: 'R-secret' });
      const day = new URL('https://fixture.invalid' + path).searchParams.get('day');
      return response(doses.filter(dose => {
        const presentationDay = new Date(new Date(dose.presentation_at).getTime() + 330 * 60_000).toISOString().slice(0, 10);
        return (dose.event_day || presentationDay) === day || dose.status === 'snoozed' && presentationDay === day;
      }));
    },
    getApiBase: () => 'https://fixture.invalid/api',
    fetch: async (url, options) => {
      const uid = options.headers.Authorization?.replace('Bearer bearer-', '') || null;
      requests.push({ method: options.method, uid, body: JSON.parse(options.body), url });
      if (options.method === 'POST') {
        if (delayedPost && uid === 'old') await delayedPost.promise;
        serverOwner = uid;
        return response({ registered: true, sendingEnabled });
      }
      if (options.method === 'DELETE' && (uid && rejectAuthenticatedDelete || !uid && rejectPossessionDelete)) return { ok: false, status: 401, json: async () => ({ error: 'Token expired' }) };
      if (serverOwner === uid || url.endsWith('/push-devices/revoke-installation') && JSON.parse(options.body).installationKey === JSON.parse(stored || '{}').installationKey) serverOwner = null;
      return response({ unregistered: true });
    },
    Date: FixtureDate, JSON, Map, Promise, AbortController, setTimeout, clearTimeout, console, encodeURIComponent,
  });
  const source = (await readFile(resolve(root, app, 'src/pushNotifications.js'), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  runInContext(source + '\nthis.exports = { usePushNotifications, unregisterPushNotifications, cancelLocalDoseReminder, syncLocalDoseReminders };', context);
  context.exports.usePushNotifications(app === '5-patient' ? 'patient' : 'caretaker');
  return {
    ...context.exports, auth, hooks, user, requests, states, scheduled,
    changeUser(next) { auth.currentUser = next; hooks.auth?.(next); },
    clearToken() { signedOut = true; }, get serverOwner() { return serverOwner; }, get handler() { return handler; },
    get scheduledCalls() { return scheduledCalls; },
    cleanup() { for (const fn of effects) fn?.(); },
  };
}

for (const app of ['5-patient', '6-caretaker']) {
  test(`${app}: delayed old registration cannot reclaim an installation after account switch`, async () => {
    const blocked = deferred(), f = await fixture(app, { sendingEnabled: true, delayedPost: blocked });
    f.changeUser(f.user('old')); await settle();
    assert.equal(f.requests.filter(item => item.method === 'POST').length, 1);
    f.changeUser(f.user('new')); await settle();
    assert.equal(f.requests.filter(item => item.method === 'POST').length, 1, 'new registration waits for the old operation');
    blocked.resolve(); await settle();
    assert.equal(f.serverOwner, 'new');
    const registrations = f.requests.filter(item => item.method === 'POST');
    assert.deepEqual(registrations.map(item => item.uid), ['old', 'new']);
    assert.ok(f.requests.findIndex(item => item.method === 'DELETE' && item.uid === 'old') < f.requests.findIndex(item => item.method === 'POST' && item.uid === 'new'));
    assert.match(registrations[0].body.installationKey, /^[a-f\d]{64}$/);
    f.cleanup();
  });

  test(`${app}: logout revokes using captured credentials after Firebase clears the token`, async () => {
    const f = await fixture(app, { sendingEnabled: true });
    const old = f.user('old'); f.changeUser(old); await settle();
    f.clearToken(); f.changeUser(null); await settle();
    assert.equal(f.serverOwner, null);
    assert.ok(f.requests.some(item => item.method === 'DELETE' && item.uid === 'old'));
    const display = await f.handler.handleNotification({ request: { content: { data: {} } } });
    assert.equal(display.shouldShowBanner, false);
    f.cleanup();
  });

  test(`${app}: rejected account-token logout falls back to installation-secret revocation`, async () => {
    const f = await fixture(app, { sendingEnabled: true, rejectAuthenticatedDelete: true });
    f.changeUser(f.user('old')); await settle();
    f.clearToken(); f.changeUser(null); await settle();
    assert.equal(f.serverOwner, null);
    assert.ok(f.requests.some(item => item.method === 'DELETE' && !item.uid && item.url.endsWith('/push-devices/revoke-installation')));
    f.cleanup();
  });

  test(`${app}: foreground notification display requires the current account owner`, async () => {
    const f = await fixture(app, { sendingEnabled: true });
    f.changeUser(f.user('new')); await settle();
    for (const ownerUid of ['old', undefined]) {
      const display = await f.handler.handleNotification({ request: { content: { data: { ownerUid } } } });
      assert.equal(display.shouldShowBanner, false); assert.equal(display.shouldPlaySound, false);
    }
    const current = await f.handler.handleNotification({ request: { content: { data: { ownerUid: 'new' } } } });
    assert.equal(current.shouldShowBanner, true); assert.equal(current.shouldPlaySound, true);
    f.cleanup();
  });
}

test('patient local fallback schedules approved unfinished doses once, with generic content, for at most 48 hours', async () => {
  const now = Date.now(), dose = (id, minutes, status = 'pending') => ({ reminder_id: id, status, delivery_round: 2, presentation_at: new Date(now + minutes * 60_000).toISOString(), drug_name: 'SecretMedication', dosage: 'PrivateDose' });
  const f = await fixture('5-patient', { doses: [dose(1, 30), dose(2, 90, 'taken'), dose(3, 100, 'skipped'), dose(4, 49 * 60), dose(5, 60, 'snoozed')] });
  f.changeUser(f.user('patient')); await settle();
  assert.equal(f.scheduled.size, 2);
  for (const item of f.scheduled.values()) {
    assert.equal(item.trigger.type, 'date');
    assert.equal(item.trigger.channelId, 'medication');
    assert.doesNotMatch(JSON.stringify(item.content), /SecretMedication|PrivateDose|R-secret/);
  }
  await f.syncLocalDoseReminders('R-secret');
  assert.equal(f.scheduled.size, 2, 'refresh replaces pending notifications instead of duplicating them');
  await f.cancelLocalDoseReminder(1); assert.equal(f.scheduled.size, 1);
  await f.unregisterPushNotifications(); assert.equal(f.scheduled.size, 0);
  f.cleanup();
});

test('local fallback retains a previous-day dose snoozed across Colombo midnight', async () => {
  const f = await fixture('5-patient', {
    fixedNow: Date.parse('2026-10-11T00:30:00+05:30'),
    doses: [{ reminder_id: 1, event_day: '2026-10-10', status: 'snoozed', delivery_round: 1, presentation_at: '2026-10-11T00:40:00+05:30' }],
  });
  f.changeUser(f.user('patient')); await settle();
  assert.equal(f.scheduled.size, 1);
  assert.equal(f.scheduledCalls, 1, 'original-day and presentation-day responses schedule a carryover only once');
  const reminder = [...f.scheduled.values()][0];
  assert.equal(reminder.content.data.reminderId, '1');
  assert.equal(reminder.trigger.date.getTime(), Date.parse('2026-10-11T00:40:00+05:30'));
  f.cleanup();
});

test('server push mode cancels existing local doses, and caretakers do not cache resident schedules locally', async () => {
  for (const app of ['5-patient', '6-caretaker']) {
    const f = await fixture(app, { sendingEnabled: app === '5-patient', doses: [{ reminder_id: 1, status: 'pending', delivery_round: 0, presentation_at: new Date(Date.now() + 60_000).toISOString() }] });
    f.scheduled.set('old-local', { identifier: 'old-local', content: { data: { careconnectLocalDose: true, ownerUid: 'old' } } });
    f.changeUser(f.user('current')); await settle();
    assert.equal(f.scheduled.size, 0);
    f.cleanup();
  }
});

test('web helper never requests native notification permission or registers a device', async () => {
  const f = await fixture('5-patient', { platform: 'web' });
  assert.equal(f.hooks.auth, undefined);
  assert.equal(f.requests.length, 0);
  await f.unregisterPushNotifications(); await f.syncLocalDoseReminders('R-secret');
  assert.equal(f.requests.length, 0);
  f.cleanup();
});

test('denied notification permissions revoke a prior device rather than leaving an enabled registration', async () => {
  const f = await fixture('5-patient', { permissionGranted: false });
  f.changeUser(f.user('patient')); await settle();
  assert.equal(f.requests.filter(item => item.method === 'POST').length, 0);
  assert.equal(f.scheduled.size, 0);
  assert.ok(f.states.some(state => state.status === 'denied'));
  f.cleanup();
});

test('signed-out startup revokes a persisted installation using its secret without an account token', async () => {
  const identity = { installationId: 'b1111111-1111-4111-8111-111111111111', installationKey: '0c'.repeat(32) };
  for (const app of ['5-patient', '6-caretaker']) {
    const f = await fixture(app, { storedIdentity: identity });
    f.changeUser(null); await settle();
    assert.equal(f.serverOwner, null);
    const removal = f.requests.find(item => item.method === 'DELETE');
    assert.ok(removal.url.endsWith('/push-devices/revoke-installation'));
    assert.equal(removal.uid, null);
    assert.equal(removal.body.installationKey, identity.installationKey);
    assert.equal(f.requests.filter(item => item.method === 'POST').length, 0);
    f.cleanup();
  }
});

async function incidentFixture({ states = [], residents = [], apiFetch } = {}) {
  const source = await readFile(resolve(root, '6-caretaker/src/components/MonitoringIncidents.js'), 'utf8');
  const parser = createRequire(resolve(root, '5-patient/package.json'))('@babel/parser');
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const fn = ast.program.body.find(item => item.type === 'ExportDefaultDeclaration').declaration;
  const ret = fn.body.body.find(item => item.type === 'ReturnStatement');
  const updates = [], cleanup = [], requests = [];
  let state = 0;
  const context = createContext({
    useState: value => { const index = state++; updates[index] = []; return [index < states.length ? states[index] : value, next => updates[index].push(next)]; },
    useRef: value => ({ current: value }), useCallback: fn => fn, useEffect: fn => cleanup.push(fn()),
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    apiFetch: async (path, options = {}) => { requests.push({ path, options }); return apiFetch ? apiFetch(path, options) : response([]); },
    AbortController, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, Date, JSON, String, console,
  });
  const factory = runInContext(`(${source.slice(fn.start, fn.body.start)}{${source.slice(fn.body.start + 1, ret.start)}return { review, act, load };})`, context);
  const handlers = factory({ residents });
  await settle();
  return { handlers, updates, requests, cleanup() { cleanup.forEach(fn => fn?.()); } };
}

test('caretaker incident review shows action history and resident corrections only from the current camera assignments', async () => {
  const actions = [{ action_id: 2, action: 'acknowledged', notes: 'Resident checked' }];
  const f = await incidentFixture({ residents: [{ id: 'R-A', name: 'Alice' }, { id: 'R-B', name: 'Ben' }], apiFetch: async path => response(path.endsWith('/actions') ? actions : path.endsWith('/devices') ? [{ device_id: 'CAM-A', resident_ids: ['R-A'] }] : []) });
  await f.handlers.review({ incident_id: 9, device_id: 'CAM-A' });
  assert.equal(f.updates[6].at(-1)[0].action_id, 2);
  assert.equal(f.updates[7].at(-1).length, 1);
  assert.equal(f.updates[7].at(-1)[0].id, 'R-A');
  f.cleanup();
});

test('caretaker incident actions require verification notes and send the selected corrected resident exactly once', async () => {
  const f = await incidentFixture({ states: [[], '', 9, 'Verified directly', false, false, [], [], 'R-A'], apiFetch: async () => response({ saved: true }) });
  const first = f.handlers.act('resident_corrected');
  const duplicate = f.handlers.act('resident_corrected');
  await Promise.all([first, duplicate]);
  const writes = f.requests.filter(item => item.options.method === 'POST');
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].options.body), { action: 'resident_corrected', notes: 'Verified directly', residentId: 'R-A' });
  f.cleanup();
  const missing = await incidentFixture({ states: [[], '', 9, '', false] });
  await missing.handlers.act('resolved');
  assert.equal(missing.requests.filter(item => item.options.method === 'POST').length, 0);
  assert.match(missing.updates[1].at(-1), /verification reason/);
  missing.cleanup();
});

test('caretaker incident review ignores history returned for a superseded incident', async () => {
  const old = deferred();
  const f = await incidentFixture({ apiFetch: async path => path === '/monitoring/incidents/1/actions' ? old.promise : response(path === '/monitoring/incidents/2/actions' ? [{ action_id: 20 }] : []) });
  const first = f.handlers.review({ incident_id: 1, device_id: 'CAM-A' });
  await f.handlers.review({ incident_id: 2, device_id: 'CAM-A' });
  old.resolve(response([{ action_id: 10 }])); await first;
  assert.equal(f.updates[6].at(-1)[0].action_id, 20);
  f.cleanup();
});
