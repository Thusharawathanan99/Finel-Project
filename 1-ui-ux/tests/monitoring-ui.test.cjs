const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load, hooks, nodes } = require('../../scripts/web-regression.cjs');
const monitoring = { saveConsent: (...args) => globalThis.monitoringSave(...args), incidentAction: (...args) => globalThis.incidentSave(...args), createDevice: (...args) => globalThis.deviceSave(...args), updateDevice: (...args) => globalThis.deviceUpdate(...args), assignResidents: (...args) => globalThis.deviceAssignments(...args), reviewObservation: (...args) => globalThis.observationSave(...args) };
const mocks = {
  CareRecordPanel: "export const CareRecordPanel='CareRecordPanel';",
  monitoringApi: 'export const monitoringApi=globalThis.monitoringMock;',
  useMonitoringFeed: 'export const useMonitoringFeed=()=>globalThis.monitoringFeed;',
};
const words = root => Array.isArray(root) ? root.map(words).join(' ') : typeof root === 'string' || typeof root === 'number' ? String(root) : root?.props ? words(root.props.children) : '';
const button = (tree, label) => nodes(tree, node => node.type === 'button' && words(node).includes(label))[0];
const tick = () => new Promise(resolve => setImmediate(resolve));

test('A failed care-note save retains the note and sends only one request', async () => {
  setup([{ resident: { medical_history: 'Recorded history' }, careNotes: [], appointments: [], medicationHistory: [], emergencies: [] }]);
  let calls = 0;
  globalThis.careNoteSave = async () => { calls++; throw Error('Care note service unavailable'); };
  const { CareRecordPanel } = await load('1-ui-ux/src/app/components/monitoring/CareRecordPanel.tsx', {
    ...mocks,
    apiService: 'export const apiGet=async()=>({}); export const apiPost=(...a)=>globalThis.careNoteSave(...a); export const apiPut=async()=>({});',
  });
  const render = () => renderWith(CareRecordPanel, { residentId: 'R1', staff: true });
  nodes(render(), node => node.type === 'textarea')[0].props.onChange({ target: { value: 'Observed resident request for assistance.' } });
  const submit = nodes(render(), node => node.type === 'form')[0].props.onSubmit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} }); await tick();
  assert.equal(calls, 1); assert.match(words(render()), /Care note service unavailable/);
  assert.equal(nodes(render(), node => node.type === 'textarea')[0].props.value, 'Observed resident request for assistance.');
  assert.ok(!words(render()).includes('Care note saved.'));
});
function setup(rows = []) {
  globalThis.hooks = hooks();
  globalThis.monitoringMock = monitoring;
  globalThis.monitoringFeed = { rows, error: '', loading: false, updatedAt: new Date(), reload: async () => {} };
}
function renderWith(component, props) { globalThis.hooks.reset(); return component(props); }

test('Pausing monitoring withdraws both required scopes without restoring earlier grants', async () => {
  setup(); const saved = []; globalThis.monitoringSave = async (id, body) => saved.push({ id, body });
  const { MonitoringConsentPanel } = await load('1-ui-ux/src/app/components/monitoring/MonitoringConsentPanel.tsx', mocks);
  const render = () => renderWith(MonitoringConsentPanel, { residentId: 'R1' });
  button(render(), 'Pause camera monitoring').props.onClick(); await tick();
  assert.deepEqual(saved.map(record => record.body.scope).sort(), ['activity', 'camera']);
  assert.ok(saved.every(record => record.id === 'R1' && record.body.status === 'withdrawn' && record.body.subjectRole === 'resident'));
  assert.match(words(render()), /Permission withdrawn/);
});

test('Staff cannot grant consent without an actual written consent reference', async () => {
  setup(); let calls = 0; globalThis.monitoringSave = async () => calls++;
  const { MonitoringConsentPanel } = await load('1-ui-ux/src/app/components/monitoring/MonitoringConsentPanel.tsx', mocks);
  const render = () => renderWith(MonitoringConsentPanel, { residentId: 'R1', staff: true });
  let tree = render(); nodes(tree, node => node.type === 'input' && node.props.type === 'checkbox')[0].props.onChange({ target: { checked: true } });
  button(render(), 'Grant permission').props.onClick(); await tick();
  assert.equal(calls, 0); assert.match(words(render()), /signed consent reference/);
});

test('A partial pause failure is explicit and repeated clicks send no duplicate changes', async () => {
  setup(); const calls = []; let release;
  const waiting = new Promise(resolve => release = resolve);
  globalThis.monitoringSave = async (_id, body) => { calls.push(body.scope); await waiting; if (body.scope === 'activity') throw Error('Activity permission save unavailable'); };
  const { MonitoringConsentPanel } = await load('1-ui-ux/src/app/components/monitoring/MonitoringConsentPanel.tsx', mocks);
  const render = () => renderWith(MonitoringConsentPanel, { residentId: 'R1' });
  const pause = button(render(), 'Pause camera monitoring').props.onClick; pause(); pause();
  assert.equal(calls.length, 2); release(); await tick();
  assert.match(words(render()), /1 of 2 permission changes saved/); assert.match(words(render()), /Activity permission save unavailable/);
});

test('Failed incident action retains the incident and reason, and does not pretend resolution', async () => {
  const incident = { incident_id: 1, incident_type: 'fall', resident_id: 'R1', resident_name: 'Resident', device_id: 'C1', severity: 'critical', status: 'open', reason: 'Possible fall', recommended_action: 'Check resident', detected_at: new Date().toISOString() };
  setup([incident]); let calls = 0; globalThis.incidentSave = async () => { calls++; throw Error('Incident save unavailable'); };
  const { MonitoringIncidents } = await load('1-ui-ux/src/app/components/monitoring/MonitoringIncidents.tsx', mocks);
  const render = () => renderWith(MonitoringIncidents, { residents: [] });
  button(render(), 'Review and record action').props.onClick();
  let tree = render(); nodes(tree, node => node.type === 'textarea')[0].props.onChange({ target: { value: 'Caretaker checked the resident.' } });
  tree = render(); const submit = nodes(tree, node => node.type === 'form')[0].props.onSubmit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} }); await tick();
  assert.equal(calls, 1); tree = render(); assert.match(words(tree), /Incident save unavailable/); assert.match(words(tree), /Possible fall/);
  assert.equal(nodes(tree, node => node.type === 'textarea')[0].props.value, 'Caretaker checked the resident.');
  assert.equal(globalThis.monitoringFeed.rows[0].status, 'open'); assert.ok(!words(tree).includes('Incident action saved'));
});

test('Incident resident correction requires an explicit assigned resident', async () => {
  setup([{ incident_id: 1, incident_type: 'fall', device_id: 'C1', severity: 'critical', status: 'open', reason: 'Possible fall', recommended_action: 'Check resident', detected_at: new Date().toISOString() }]);
  let calls = 0; globalThis.incidentSave = async () => calls++;
  const { MonitoringIncidents } = await load('1-ui-ux/src/app/components/monitoring/MonitoringIncidents.tsx', mocks);
  const render = () => renderWith(MonitoringIncidents, { residents: [] });
  button(render(), 'Review and record action').props.onClick();
  let tree = render(); nodes(tree, node => node.type === 'select')[0].props.onChange({ target: { value: 'resident_corrected' } });
  tree = render(); nodes(tree, node => node.type === 'textarea')[0].props.onChange({ target: { value: 'Identity checked.' } });
  nodes(render(), node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); await tick();
  assert.equal(calls, 0); assert.match(words(render()), /Select the correct resident/);
});

test('Device creation displays its one-time token only after a confirmed API save', async () => {
  setup(); let calls = 0; globalThis.deviceSave = async () => { calls++; return { deviceId: 'CAM-1', token: 'ONE-TIME-CREDENTIAL' }; };
  const { MonitoringDevices } = await load('1-ui-ux/src/app/components/monitoring/MonitoringDevices.tsx', mocks);
  const render = () => renderWith(MonitoringDevices, { residents: [] });
  button(render(), 'Register device').props.onClick();
  let tree = render(); nodes(tree, node => node.type === 'input')[0].props.onChange({ target: { value: 'Room camera' } });
  const submit = nodes(render(), node => node.type === 'form')[0].props.onSubmit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} }); await tick();
  assert.equal(calls, 1); tree = render(); const token = nodes(tree, node => node.type === 'input' && node.props['aria-label'] === 'One-time device token')[0];
  assert.equal(token.props.value, 'ONE-TIME-CREDENTIAL'); button(tree, 'I have saved the token securely').props.onClick();
  assert.equal(nodes(render(), node => node.type === 'input' && node.props['aria-label'] === 'One-time device token').length, 0);
});

test('Dose reminder actions target one exact reminder and preserve failure visibility', async () => {
  setup([{ reminder_id: 17, delivery_round: 0, medication_id: 4, drug_name: 'Example', dosage: '10 mg', scheduled_at: new Date(Date.now() - 60000).toISOString(), presentation_at: new Date().toISOString(), status: 'pending' }]);
  let seen; globalThis.doseAction = async (...args) => { seen = args; throw Error('Dose save unavailable'); };
  const { MedicationReminderPanel } = await load('1-ui-ux/src/app/components/MedicationReminderPanel.tsx', { ...mocks, useMonitoringFeed: 'export const useMonitoringFeed=()=>globalThis.doseFeedCalls++%2?globalThis.monitoringFeed:{...globalThis.monitoringFeed,rows:[]};', medicationSchedulesApi: 'export const medicationSchedulesApi={action:(...args)=>globalThis.doseAction(...args)};' });
  const render = () => { globalThis.doseFeedCalls = 0; return renderWith(MedicationReminderPanel, { resident: { residentId: 'R1', getAllMedications: () => [] } }); };
  button(render(), 'Snooze 10 min').props.onClick(); await tick();
  assert.deepEqual(seen, ['R1', 17, 'snoozed', 0]); assert.match(words(render()), /Dose save unavailable/);
  assert.equal(globalThis.monitoringFeed.rows[0].status, 'pending');
});

test('Device threshold edits send only changed rules and preserve activity configuration', async () => {
  setup(); let saved; let assignments = 0;
  globalThis.deviceUpdate = async (...args) => { saved = args; };
  globalThis.deviceAssignments = async () => { assignments++; };
  const { DeviceCard } = await load('1-ui-ux/src/app/components/monitoring/MonitoringDevices.tsx', mocks);
  const device = { device_id: 'C1', device_type: 'raspberry_pi', name: 'Room camera', enabled: true, resident_ids: [], settings: { inactivitySeconds: 300, enabledActivities: ['fall'], cameraState: 'running' } };
  const render = () => renderWith(DeviceCard, { device, residents: [], readOnly: false, pending: false, run: async change => change(), showToken() {} });
  button(render(), 'Edit room and residents').props.onClick();
  nodes(render(), node => node.props?.['aria-label'] === 'Inactivity alert threshold (seconds)')[0].props.onChange({ target: { value: '600' } });
  nodes(render(), node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); await tick();
  assert.equal(saved[0], 'C1'); assert.deepEqual(saved[1].settings, { inactivitySeconds: 600 });
  assert.ok(!Object.hasOwn(saved[1].settings, 'cameraState')); assert.ok(!Object.hasOwn(saved[1].settings, 'enabledActivities'));
  assert.equal(assignments, 0, 'Threshold edits must preserve assignment timestamps');
});

test('Disabling an activity retains other explicit activities', async () => {
  setup(); let saved;
  globalThis.deviceUpdate = async (_id, body) => { saved = body; }; globalThis.deviceAssignments = async () => {};
  const { DeviceCard } = await load('1-ui-ux/src/app/components/monitoring/MonitoringDevices.tsx', mocks);
  const device = { device_id: 'C1', device_type: 'raspberry_pi', name: 'Room camera', enabled: true, resident_ids: [], settings: { enabledActivities: ['walking', 'fall'] } };
  const render = () => renderWith(DeviceCard, { device, residents: [], readOnly: false, pending: false, run: async change => change(), showToken() {} });
  button(render(), 'Edit room and residents').props.onClick();
  const walking = nodes(render(), node => node.type === 'label' && words(node).trim() === 'Walking')[0];
  nodes(walking, node => node.type === 'input')[0].props.onChange({ target: { checked: false } });
  nodes(render(), node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); await tick();
  assert.deepEqual(saved.settings, { enabledActivities: ['fall'] });
});

test('Failed observation review preserves notes, original status and duplicate-click protection', async () => {
  setup([{ event_id: 'E1', activity: 'walking', confidence: 0.8, observed_at: new Date().toISOString(), review_status: 'pending' }]);
  let calls = 0; let sent;
  globalThis.observationSave = async (...args) => { calls++; sent = args; throw Error('Observation save unavailable'); };
  const { ActivityObservationReview } = await load('1-ui-ux/src/app/components/monitoring/ActivityObservationReview.tsx', mocks);
  const render = () => renderWith(ActivityObservationReview, { residentId: 'R1' });
  button(render(), 'Review observation').props.onClick();
  nodes(render(), node => node.type === 'textarea')[0].props.onChange({ target: { value: 'Staff independently observed this resident walking.' } });
  const submit = nodes(render(), node => node.type === 'form')[0].props.onSubmit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} }); await tick();
  assert.equal(calls, 1); assert.deepEqual(sent, ['R1', 'E1', 'confirmed', 'Staff independently observed this resident walking.']);
  assert.match(words(render()), /Observation save unavailable/); assert.equal(globalThis.monitoringFeed.rows[0].review_status, 'pending');
  assert.ok(nodes(render(), node => node.type === 'textarea')[0].props.value.length > 0);
});

test('First activity edit preserves anonymous-person and future classifier observation settings', async () => {
  setup(); let saved;
  globalThis.deviceUpdate = async (_id, body) => { saved = body; }; globalThis.deviceAssignments = async () => {};
  const { DeviceCard } = await load('1-ui-ux/src/app/components/monitoring/MonitoringDevices.tsx', mocks);
  const device = { device_id: 'C1', device_type: 'raspberry_pi', name: 'Room camera', enabled: true, resident_ids: [], settings: {} };
  const render = () => renderWith(DeviceCard, { device, residents: [], readOnly: false, pending: false, run: async change => change(), showToken() {} });
  button(render(), 'Edit room and residents').props.onClick();
  const walking = nodes(render(), node => node.type === 'label' && words(node).trim() === 'Walking')[0];
  nodes(walking, node => node.type === 'input')[0].props.onChange({ target: { checked: false } });
  nodes(render(), node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} }); await tick();
  assert.ok(saved.settings.enabledActivities.includes('unknown')); assert.ok(saved.settings.enabledActivities.includes('abnormal_movement'));
  assert.ok(!saved.settings.enabledActivities.includes('walking'));
});

test('An unlinked safety observation remains reviewable without inventing an incident', async () => {
  setup([{ event_id: 'E1', activity: 'inactivity', incident_id: null, confidence: 0.7, observed_at: new Date().toISOString(), review_status: 'pending' }]);
  const { ActivityObservationReview } = await load('1-ui-ux/src/app/components/monitoring/ActivityObservationReview.tsx', mocks);
  const tree = renderWith(ActivityObservationReview, { residentId: 'R1' });
  assert.ok(button(tree, 'Review observation')); assert.ok(!words(tree).includes('Use the incident workflow to review this safety observation.'));
});

test('Safety observations direct staff to incident review and expose no ordinary confirmation', async () => {
  setup([{ event_id: 'E1', activity: 'fall', incident_id: 7, confidence: 0.9, observed_at: new Date().toISOString(), review_status: 'pending' }, { event_id: 'E2', activity: 'walking', incident_id: 8, confidence: 0.8, observed_at: new Date().toISOString(), review_status: 'pending' }]);
  const { ActivityObservationReview } = await load('1-ui-ux/src/app/components/monitoring/ActivityObservationReview.tsx', mocks);
  const tree = renderWith(ActivityObservationReview, { residentId: 'R1' });
  assert.match(words(tree), /incident workflow/); assert.equal(nodes(tree, node => node.type === 'button' && words(node) === 'Review observation').length, 0);
});

test('Care action history shows staff attribution and unavailable-history errors', async () => {
  setup([{ action_id: 4, action: 'acknowledged', actor_name: 'Assigned caretaker', created_at: new Date().toISOString(), notes: 'Resident checked.' }]);
  const { IncidentActionHistory } = await load('1-ui-ux/src/app/components/monitoring/MonitoringIncidents.tsx', mocks);
  let tree = renderWith(IncidentActionHistory, { incidentId: 8 }); assert.match(words(tree), /Assigned caretaker/); assert.match(words(tree), /Resident checked/);
  globalThis.monitoringFeed.error = 'History unavailable'; tree = renderWith(IncidentActionHistory, { incidentId: 8 });
  assert.match(words(tree), /History unavailable/); assert.ok(button(tree, 'Retry history'));
});

test('Overdue reminder text does not claim a delivered notification', async () => {
  setup([{ reminder_id: 17, delivery_round: 0, medication_id: 4, drug_name: 'Example', dosage: '10 mg', scheduled_at: new Date(Date.now() - 7200000).toISOString(), presentation_at: new Date().toISOString(), status: 'pending', is_overdue: true, escalation_minutes: 45 }]);
  const { MedicationReminderPanel } = await load('1-ui-ux/src/app/components/MedicationReminderPanel.tsx', { ...mocks, useMonitoringFeed: 'export const useMonitoringFeed=()=>globalThis.doseFeedCalls++%2?globalThis.monitoringFeed:{...globalThis.monitoringFeed,rows:[]};', medicationSchedulesApi: 'export const medicationSchedulesApi={};' });
  globalThis.doseFeedCalls = 0;
  const tree = renderWith(MedicationReminderPanel, { resident: { residentId: 'R1', getAllMedications: () => [] } });
  assert.match(words(tree), /Overdue by at least\s+45\s+minutes/); assert.match(words(tree), /notification delivery is tracked separately/);
});
