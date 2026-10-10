// Offline patient-reported symptom checks. No patient image, medical diagnosis,
// network request, caregiver notification or ambulance call is made.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const helpers = import(pathToFileURL(path.resolve(__dirname, '../shared/patientSymptoms.js')));

test('all requested symptoms have independent bounded keys and human translations in three languages', async () => {
  const h = await helpers;
  assert.deepEqual(h.PATIENT_SYMPTOM_KEYS, ['chestPain', 'breathingDifficulty', 'coldSweat', 'dizziness', 'fainting', 'unusualWeakness', 'radiatingPain', 'severeDiscomfort', 'faceDrooping', 'armWeakness', 'speechDifficulty', 'visionChanges', 'severeHeadache', 'collapse']);
  for (const language of ['en', 'ta', 'si']) {
    const copy = h.getPatientSymptomsCopy(language);
    assert.deepEqual(Object.keys(copy.symptoms), h.PATIENT_SYMPTOM_KEYS);
    assert.match(copy.guidance, /1990/);
    if (language !== 'en') for (const value of Object.values(copy.symptoms)) assert.match(value, language === 'ta' ? /[\u0B80-\u0BFF]/ : /[\u0D80-\u0DFF]/);
  }
  assert.ok(Object.isFrozen(h.PATIENT_SYMPTOMS));
  assert.ok(h.PATIENT_SYMPTOMS.every(item => Object.isFrozen(item) && Object.isFrozen(item.labels)));
});

test('any selected acute symptom immediately produces guidance without model, camera or network inputs', async () => {
  const h = await helpers;
  for (const language of ['en', 'ta', 'si']) for (const key of h.PATIENT_SYMPTOM_KEYS) {
    const observation = h.evaluatePatientSymptoms([key], language);
    assert.equal(observation.source, 'patient-reported'); assert.equal(observation.urgent, true);
    assert.equal(observation.assistanceState, 'urgent-assistance');
    assert.equal(observation.guidance, h.getPatientSymptomsCopy(language).guidance);
    assert.deepEqual(observation.labels, [h.getPatientSymptomsCopy(language).symptoms[key]]);
    assert.deepEqual(Object.keys(observation).sort(), ['assistanceState', 'guidance', 'labels', 'source', 'symptomKeys', 'urgent']);
  }
});

test('empty check-ins are no-symptoms-selected and never turn into normal or emergency ruled-out claims', async () => {
  const h = await helpers;
  const empty = h.evaluatePatientSymptoms([]);
  assert.equal(empty.urgent, false); assert.equal(empty.assistanceState, 'no-symptoms-selected');
  assert.match(empty.guidance, /does not mean that an emergency has been ruled out/);
  assert.doesNotMatch(empty.guidance, /you are safe|all clear|no emergency|no risk/i);
  assert.match(h.buildPatientSymptomHelpMessage([]), /Urgent help explicitly requested by patient\/observer/);
  assert.match(h.buildPatientSymptomHelpMessage([]), /Symptom codes: none-selected/);
});

test('camera, expression, unknown and malformed symptom data cannot trigger or contaminate a check-in', async () => {
  const h = await helpers;
  for (const input of [null, undefined, {}, 'chestPain', ['happy'], ['normal'], ['pain-detected'], ['stroke'], ['__proto__'], [1], [null], Array(1), Array(33).fill('chestPain')]) {
    assert.throws(() => h.evaluatePatientSymptoms(input), TypeError);
    assert.throws(() => h.buildPatientSymptomHelpMessage(input), TypeError);
  }
  const input = ['chestPain'];
  Object.assign(input, { emotion: 'happy', cameraImage: 'PRIVATE FACE', userId: 'PRIVATE USER', riskScore: 99 });
  const report = h.buildPatientSymptomHelpMessage(input);
  assert.doesNotMatch(report, /PRIVATE|happy|riskScore|99|cameraImage/);
});

test('duplicate order-independent symptom choices are canonical and preserve caller data', async () => {
  const h = await helpers;
  const input = ['speechDifficulty', 'chestPain', 'speechDifficulty'];
  assert.deepEqual(h.normalizePatientSymptoms(input), ['chestPain', 'speechDifficulty']);
  assert.equal(h.buildPatientSymptomHelpMessage(input, 'ta', ' Started now '), h.buildPatientSymptomHelpMessage(['chestPain', 'speechDifficulty'], 'ta', 'Started now'));
  assert.deepEqual(input, ['speechDifficulty', 'chestPain', 'speechDifficulty']);
});

test('bounded SOS messages include canonical codes and EN/localized human labels within the existing API limit', async () => {
  const h = await helpers;
  for (const language of ['en', 'ta', 'si']) {
    const message = h.buildPatientSymptomHelpMessage(h.PATIENT_SYMPTOM_KEYS, language, 'x'.repeat(h.PATIENT_SYMPTOM_NOTE_MAX_LENGTH));
    assert.ok(message.length <= 4999, 'SOS message exceeds existing API bounds for ' + language);
    for (const key of h.PATIENT_SYMPTOM_KEYS) {
      assert.ok(message.includes(key));
      assert.ok(message.includes(h.getPatientSymptomsCopy('en').symptoms[key]));
      assert.ok(message.includes(h.getPatientSymptomsCopy(language).symptoms[key]));
    }
    assert.doesNotMatch(message, /heart attack detected|stroke detected|severity score|diagnosis confirmed/i);
  }
  assert.throws(() => h.buildPatientSymptomHelpMessage([], 'en', 'x'.repeat(1001)), RangeError);
  for (const note of [null, 17, [], {}]) assert.throws(() => h.buildPatientSymptomHelpMessage([], 'en', note), TypeError);
  const stripped = h.buildPatientSymptomHelpMessage([], 'en', '  hello\u0000\u202E\u2066\nworld  ');
  assert.ok(stripped.endsWith('Patient/observer note: hello\nworld'));
});

test('shared symptom reports remain localized and require a genuine saved-only receipt', async () => {
  const h = await helpers;
  const at = '2026-10-08T19:30:00.000Z';
  for (const language of ['en', 'ta', 'si']) {
    const copy = h.getPatientSymptomsCopy(language);
    const report = h.buildPatientSymptomReport(['armWeakness', 'speechDifficulty'], language, 'Synthetic note.', at, { saved: true, alertId: 17 });
    assert.ok(report.includes(copy.reportTitle)); assert.ok(report.includes(copy.symptoms.armWeakness));
    assert.ok(report.includes(copy.guidance)); assert.ok(report.includes(copy.savedStatus)); assert.ok(report.includes(at));
    assert.ok(!report.includes(h.getPatientSymptomsCopy('en').savedStatus) || language === 'en');
    for (const malformed of [null, {}, { saved: false, alertId: 17 }, { saved: true, alertId: 0 }, { saved: true, alertId: '17' }]) {
      assert.ok(h.buildPatientSymptomReport([], language, '', null, malformed).includes(copy.notSentStatus));
    }
    assert.ok(h.buildPatientSymptomReport([], language, '', null, { saved: true, alertId: 17, isResolved: true }).includes(copy.resolvedMessage));
  }
  assert.throws(() => h.buildPatientSymptomReport([], 'en', '', 'invalid'), TypeError);
  assert.throws(() => h.buildPatientSymptomReport([], 'en', '', 5), TypeError);
});

test('language fallback is safe and every localized copy field exists', async () => {
  const h = await helpers, en = h.getPatientSymptomsCopy('en');
  assert.equal(h.getPatientSymptomCopy('TA_lk'), h.getPatientSymptomsCopy('ta'));
  assert.equal(h.getPatientSymptomsCopy('si-LK'), h.getPatientSymptomsCopy('si'));
  for (const language of [null, 7, {}, '__proto__', 'constructor', 'fr']) assert.equal(h.getPatientSymptomsCopy(language), en);
  for (const language of ['ta', 'si']) {
    const copy = h.getPatientSymptomsCopy(language);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(en).sort());
    assert.ok(Object.isFrozen(copy)); assert.ok(Object.isFrozen(copy.symptoms));
  }
  assert.ok(h.PATIENT_SYMPTOM_SOURCES.includes('https://www.1990.lk/faq/'));
});
