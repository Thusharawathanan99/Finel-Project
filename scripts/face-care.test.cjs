// Synthetic offline cases only: no camera, patient records, network calls or emergency sending.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const care = import(pathToFileURL(path.join(__dirname, '../shared/faceCare.js')));
const quality = import(pathToFileURL(path.join(__dirname, '../shared/liveFaceQuality.js')));
const tracker = import(pathToFileURL(path.join(__dirname, '../shared/liveFace.js')));
const expressions = ['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised'];
function scores(winner = 'happy', confidence = 0.9) {
  return Object.fromEntries(expressions.map(key => [key, key === winner ? confidence : (1 - confidence) / 6]));
}
function face(overrides = {}) {
  return { box: { x: 0.1, y: 0.2, width: 0.2, height: 0.25 }, detectionConfidence: 0.9,
    scores: scores(), landmarks: Array.from({ length: 68 }, () => ({ x: 0.2, y: 0.3 })),
    id: 'EPHEMERAL ID', smoothedScores: scores(), expression: 'happy', expressionConfidence: 0.9, stable: true,
    evidenceMode: 'temporal', evidenceFrames: 3, evidenceDurationMs: 500, ...overrides };
}
function frame(faces = [face()], overrides = {}) {
  return { version: 'live-face-v1', provider: 'face-api.js-local', width: 640, height: 480,
    capturedAt: '2026-10-06T04:30:00.000Z', processingTimeMs: 75, faces, ...overrides };
}
function allStrings(value) {
  return typeof value === 'string' ? [value] : Object.values(value).flatMap(allStrings);
}

test('explicit help with no selected symptoms is a valid report and never claims symptom absence', async () => {
  const { buildUrgentHelpMessage } = await care;
  const message = buildUrgentHelpMessage([]);
  assert.match(message, /^Urgent help requested\./);
  assert.match(message, /Patient\/observer-reported; not a facial diagnosis/);
  assert.match(message, /No symptoms selected; help requested explicitly/);
  assert.doesNotMatch(message, /no symptoms present|no emergency|healthy|all clear|safe/i);
});

test('each symptom retains canonical English and a translated human label in EN, TA and SI', async () => {
  const { buildUrgentHelpMessage, getFaceCareCopy, URGENT_SYMPTOM_KEYS } = await care;
  for (const language of ['en', 'ta', 'si']) for (const key of URGENT_SYMPTOM_KEYS) {
    const message = buildUrgentHelpMessage([key], language);
    assert.ok(message.includes(getFaceCareCopy('en').symptoms[key]));
    assert.ok(message.includes(getFaceCareCopy(language).symptoms[key]));
    assert.match(message, /Patient\/observer-reported; not a facial diagnosis/);
    assert.doesNotMatch(message, /severity|diagnosis confirmed|detected stroke|heart attack detected/i);
  }
});

test('selection order and duplicate taps produce deterministic retry content without mutating input', async () => {
  const { buildUrgentHelpMessage } = await care;
  const input = ['collapse', 'chestPain', 'collapse'];
  const before = [...input];
  assert.equal(buildUrgentHelpMessage(input, 'ta', ' Started now '), buildUrgentHelpMessage(['chestPain', 'collapse'], 'ta', 'Started now'));
  assert.deepEqual(input, before);
});

test('unsupported, sparse, coerced and camera-derived symptom inputs fail closed', async () => {
  const { buildUrgentHelpMessage } = await care;
  for (const input of [null, undefined, 'chestPain', {}, ['sad'], ['stroke'], ['__proto__'], [true], [null], Array(1), Array(33).fill('chestPain'), frame()]) {
    assert.throws(() => buildUrgentHelpMessage(input), TypeError);
  }
  const key = { toString() { throw new Error('Must not coerce a symptom'); } };
  assert.throws(() => buildUrgentHelpMessage([key]), TypeError);
});

test('notes are bounded, explicitly attributed, and strip invisible control spoofing', async () => {
  const { buildUrgentHelpMessage, URGENT_HELP_NOTE_MAX_LENGTH, URGENT_HELP_MESSAGE_MAX_LENGTH, URGENT_SYMPTOM_KEYS } = await care;
  const note = 'x'.repeat(URGENT_HELP_NOTE_MAX_LENGTH);
  for (const language of ['en', 'ta', 'si']) {
    const message = buildUrgentHelpMessage(URGENT_SYMPTOM_KEYS, language, note);
    assert.ok(message.length <= URGENT_HELP_MESSAGE_MAX_LENGTH);
    assert.ok(message.length < 5000);
    assert.ok(message.endsWith('Patient/observer note: ' + note));
  }
  assert.throws(() => buildUrgentHelpMessage([], 'en', note + 'x'), RangeError);
  for (const bad of [null, 42, [], {}, { toString() { throw new Error('Must not coerce note'); } }]) {
    assert.throws(() => buildUrgentHelpMessage([], 'en', bad), TypeError);
  }
  const message = buildUrgentHelpMessage([], 'si', '  hello\u0000\u001B\u0085\u202E\u2066\nline 2  ');
  assert.ok(message.endsWith('Patient/observer note: hello\nline 2'));
  assert.doesNotMatch(message, /[\u0000\u001B\u0085\u202E\u2066]/);
  assert.doesNotMatch(buildUrgentHelpMessage([], 'en', '  '), /Patient\/observer note:/);
});

test('report builder exports text only and discards incidental camera and patient properties', async () => {
  const { buildUrgentHelpMessage } = await care;
  const keys = ['chestPain'];
  Object.assign(keys, { cameraImage: 'PRIVATE IMAGE', face: frame(), patientId: 'PRIVATE ID', expression: 'sad' });
  const message = buildUrgentHelpMessage(keys);
  assert.equal(typeof message, 'string');
  assert.doesNotMatch(message, /PRIVATE|EPHEMERAL|sad|happy|cameraImage|patientId/);
});

test('language tags normalize safely and care translations cover every key and symptom', async () => {
  const { getFaceCareCopy, URGENT_SYMPTOM_KEYS } = await care;
  assert.equal(getFaceCareCopy(' TA_lk '), getFaceCareCopy('ta'));
  assert.equal(getFaceCareCopy('si-LK'), getFaceCareCopy('si'));
  for (const language of [undefined, null, 3, '__proto__', 'constructor', 'fr', {}]) assert.equal(getFaceCareCopy(language), getFaceCareCopy('en'));
  const english = getFaceCareCopy('en');
  for (const language of ['ta', 'si']) {
    const localized = getFaceCareCopy(language);
    assert.deepEqual(Object.keys(localized).sort(), Object.keys(english).sort());
    assert.deepEqual(Object.keys(localized.symptoms), URGENT_SYMPTOM_KEYS);
    for (const text of allStrings(localized)) assert.match(text, language === 'ta' ? /[\u0B80-\u0BFF]/ : /[\u0D80-\u0DFF]/);
  }
  assert.ok(Object.isFrozen(english)); assert.ok(Object.isFrozen(english.symptoms));
});

test('receipt and emergency copy avoids acknowledgement promises and false reassurance', async () => {
  const { getFaceCareCopy, FACE_CARE_SOURCES, SRI_LANKA_AMBULANCE_NUMBER, SRI_LANKA_AMBULANCE_TEL } = await care;
  const english = getFaceCareCopy('en');
  assert.match(english.savedMessage, /does not confirm that anyone has seen it/);
  assert.match(english.confirmationMessage, /does not call an ambulance/);
  assert.match(english.callHelp, /Do not wait for an app response/);
  assert.match(english.resolvedMessage, /does not confirm your current condition/);
  assert.match(english.cancelPending, /may already be saved/);
  assert.match(english.failedMessage, /could not confirm/);
  assert.doesNotMatch(allStrings(english).join('\n'), /help is on the way|will reply soon|caregiver notified|you are safe|no emergency|healthy/i);
  for (const language of ['en', 'ta', 'si']) for (const key of ['savedMessage', 'resolvedMessage', 'callFailed', 'confirmationMessage', 'callHelp', 'failedMessage', 'signInRequired']) {
    assert.match(getFaceCareCopy(language)[key], /1990/);
  }
  assert.equal(SRI_LANKA_AMBULANCE_NUMBER, '1990'); assert.equal(SRI_LANKA_AMBULANCE_TEL, 'tel:1990');
  assert.equal(FACE_CARE_SOURCES.length, 3);
  assert.ok(FACE_CARE_SOURCES.every(source => source.url.startsWith('https://') && Object.isFrozen(source)));
  assert.ok(Object.isFrozen(FACE_CARE_SOURCES));
});

test('missing and invalid camera evidence stay distinct from a completed no-face frame', async () => {
  const { summarizeLiveFaceQuality } = await quality;
  for (const missing of [undefined, null]) {
    const summary = summarizeLiveFaceQuality(missing);
    assert.equal(summary.state, 'waiting'); assert.equal(summary.faceCount, null);
  }
  for (const invalid of [{}, [], 1, frame(undefined, { processingTimeMs: NaN }), frame([face({ stable: 'true' })])]) {
    const summary = summarizeLiveFaceQuality(invalid);
    assert.equal(summary.state, 'unavailable'); assert.deepEqual(summary.issues, ['invalidFrame']);
    assert.equal(summary.faceCount, null); assert.equal(summary.stableCount, null);
  }
  const empty = summarizeLiveFaceQuality(frame([]));
  assert.equal(empty.state, 'noFace'); assert.equal(empty.faceCount, 0); assert.equal(empty.stableCount, 0);
  assert.ok(empty.issues.includes('noFace'));
});

test('well-formed tracker output reports observations without identities or health conclusions', async () => {
  const { summarizeLiveFaceQuality } = await quality;
  const { createLiveFaceTracker } = await tracker;
  const live = createLiveFaceTracker();
  let tracked;
  for (let index = 0; index < 3; index++) tracked = live.update(frame(undefined, { capturedAt: new Date(Date.parse(frame().capturedAt) + index * 200).toISOString() }));
  const summary = summarizeLiveFaceQuality(tracked, { completedRateHz: 10, frameAgeMs: 75, backend: 'webgl2' });
  assert.equal(summary.state, 'observed'); assert.equal(summary.faceCount, 1); assert.equal(summary.stableCount, 1);
  assert.equal(summary.uncertainCount, 0); assert.deepEqual(summary.issues, []);
  assert.equal(summary.processingTimeMs, 75); assert.equal(summary.completedRateHz, 10);
  assert.equal(summary.frameAgeMs, 75); assert.equal(summary.backend, 'webgl2');
  assert.equal(summary.evidenceMode, 'temporal');
  assert.doesNotMatch(JSON.stringify(summary), /happy|healthy|safe|diagnosis|patient|landmarks|scores|id\"/i);
  assert.ok(Object.isFrozen(summary)); assert.ok(Object.isFrozen(summary.issues));
});

test('single-photo quality discloses its evidence and does not apply live cadence or age rules', async () => {
  const { summarizeLiveFaceQuality, getLiveFaceQualityCopy } = await quality;
  const { createLiveFaceTracker, buildLiveReportText, getLiveFaceCopy } = await tracker;
  const photo = createLiveFaceTracker({ stableFrames: 1 }).update(frame());
  const summary = summarizeLiveFaceQuality(photo, { mode: 'photo', now: Date.parse(photo.capturedAt) + 86400000, fps: 0 });
  assert.equal(summary.state, 'observed'); assert.equal(summary.evidenceMode, 'single-frame');
  assert.equal(summary.frameAgeMs, null); assert.equal(summary.completedRateHz, null);
  assert.ok(!summary.issues.includes('staleFrame') && !summary.issues.includes('slowUpdates'));
  assert.equal(summarizeLiveFaceQuality(photo, { mode: 'live', frameAgeMs: 1501 }).state, 'stale');
  for (const language of ['en', 'ta', 'si']) {
    const copy = getLiveFaceCopy(language), notice = getLiveFaceQualityCopy(language).singleFrameNotice;
    const report = buildLiveReportText(photo, language);
    assert.ok(report.includes(copy.singleFrame)); assert.equal(report.includes(copy.temporalEvidence), false);
    assert.ok(notice.trim());
  }
});

test('face-size quality measures pixels as well as normalized area and keeps evidence modes explicit', async () => {
  const { summarizeLiveFaceQuality } = await quality;
  const narrow = face({ box: { x: 0.2, y: 0.2, width: 47 / 640, height: 0.5 } });
  assert.ok(narrow.box.width * narrow.box.height > 0.02);
  assert.equal(summarizeLiveFaceQuality(frame([narrow])).smallFaceCount, 1);
  assert.equal(summarizeLiveFaceQuality(frame([face(), face({ evidenceMode: 'single-frame', evidenceFrames: 1, evidenceDurationMs: 0 })])).evidenceMode, null);
  assert.equal(summarizeLiveFaceQuality(frame([]), { mode: 'photo' }).evidenceMode, 'single-frame');
  assert.ok(summarizeLiveFaceQuality(frame(), { mode: 'diagnostic' }).issues.includes('invalidMetrics'));
});

test('group count and stable versus uncertain estimates remain separately visible', async () => {
  const { summarizeLiveFaceQuality } = await quality;
  const summary = summarizeLiveFaceQuality(frame([face(), face({ stable: false, expression: 'uncertain' }), face()]));
  assert.equal(summary.faceCount, 3); assert.equal(summary.stableCount, 2); assert.equal(summary.uncertainCount, 1);
  assert.equal(summary.state, 'limited'); assert.ok(summary.issues.includes('multipleFaces'));
  assert.ok(summary.issues.includes('uncertainExpression'));
  assert.deepEqual(summary.reasonCodes, summary.issues);
  assert.equal(summarizeLiveFaceQuality(frame([face(), face()])).state, 'observed');
});

test('confidence and face-area boundaries produce visibility tips without health scores', async () => {
  const { summarizeLiveFaceQuality } = await quality;
  const equal = face({ detectionConfidence: 0.6, box: { x: 0, y: 0, width: 0.1, height: 0.2 } });
  assert.equal(summarizeLiveFaceQuality(frame([equal])).state, 'observed');
  const limited = summarizeLiveFaceQuality(frame([face({ detectionConfidence: 0.5999, box: { x: 0, y: 0, width: 0.1, height: 0.199 } })]));
  assert.equal(limited.lowConfidenceCount, 1); assert.equal(limited.smallFaceCount, 1);
  assert.equal(limited.state, 'limited'); assert.ok(limited.issues.includes('lowConfidence')); assert.ok(limited.issues.includes('smallFace'));
  assert.equal('severity' in limited, false); assert.equal('stateScore' in limited, false);
});

test('stale reset matches the tracker 1500ms boundary and overrides otherwise stable evidence', async () => {
  const { summarizeLiveFaceQuality } = await quality;
  const timestamp = Date.parse(frame().capturedAt);
  assert.equal(summarizeLiveFaceQuality(frame(), { frameAgeMs: 1500 }).state, 'observed');
  assert.equal(summarizeLiveFaceQuality(frame(), { frameAgeMs: 1501 }).state, 'stale');
  assert.equal(summarizeLiveFaceQuality(frame(), { now: timestamp + 1501 }).frameAgeMs, 1501);
  assert.equal(summarizeLiveFaceQuality(frame(), { now: timestamp + 1501 }).state, 'stale');
  assert.equal(summarizeLiveFaceQuality(frame([]), { frameAgeMs: 1501 }).state, 'stale');
  assert.ok(summarizeLiveFaceQuality(frame([]), { frameAgeMs: 1501 }).issues.includes('noFace'));
});

test('completed rate zero, fractional CPU speed and slow processing are candid metrics', async () => {
  const { summarizeLiveFaceQuality } = await quality;
  const stalled = summarizeLiveFaceQuality(frame(), { completedRateHz: 0 });
  assert.equal(stalled.completedRateHz, 0); assert.ok(stalled.issues.includes('slowUpdates'));
  const cpu = summarizeLiveFaceQuality(frame(undefined, { processingTimeMs: 7700 }), { fps: 0.13, backend: 'cpu' });
  assert.equal(cpu.completedRateHz, 0.13); assert.equal(cpu.processingTimeMs, 7700); assert.equal(cpu.state, 'limited');
  for (const code of ['slowProcessing', 'slowUpdates', 'cpuBackend']) assert.ok(cpu.issues.includes(code));
  assert.equal(summarizeLiveFaceQuality(frame(undefined, { processingTimeMs: 1500 }), { fps: 1 }).state, 'observed');
  assert.equal(summarizeLiveFaceQuality(frame()).completedRateHz, null);
  assert.equal(summarizeLiveFaceQuality(frame()).frameAgeMs, null);
});

test('invalid or conflicting timing is unavailable without numeric coercion or speed claims', async () => {
  const { summarizeLiveFaceQuality } = await quality;
  for (const options of [{ completedRateHz: '30' }, { completedRateHz: Infinity }, { fps: NaN }, { fps: -1 },
    { fps: 1001 }, { completedRateHz: 2, fps: 3 }, { now: '1791261000000' }, { now: Date.parse(frame().capturedAt) - 1 },
    { frameAgeMs: -1 }, { frameAgeMs: Infinity }, { backend: 'PRIVATE GPU DEVICE' }, null, []]) {
    const summary = summarizeLiveFaceQuality(frame(), options);
    assert.ok(summary.issues.includes('invalidMetrics'));
    assert.equal(summary.state, 'limited');
    assert.doesNotMatch(JSON.stringify(summary), /PRIVATE/);
  }
  const uncoercible = { valueOf() { throw new Error('Must not coerce timing'); } };
  assert.ok(summarizeLiveFaceQuality(frame(), { now: uncoercible }).issues.includes('invalidMetrics'));
  assert.equal(summarizeLiveFaceQuality(frame(), { fps: 2, completedRateHz: 2 }).completedRateHz, 2);
});

test('forged stability, incomplete probabilities and mismatched expression evidence fail closed', async () => {
  const { summarizeLiveFaceQuality } = await quality;
  for (const change of [{ stable: true, expression: 'uncertain' }, { stable: false, expression: 'happy' }, { expression: 'healthy' },
    { expressionConfidence: 0.2 }, { expression: 'sad' }, { smoothedScores: {} }, { smoothedScores: { ...scores(), diagnosis: 0 } },
    { smoothedScores: scores('happy', NaN) }, { smoothedScores: Object.fromEntries(expressions.map(key => [key, 0])) },
    { evidenceMode: 'diagnostic' }, { evidenceFrames: 0 }, { evidenceFrames: 1 }, { evidenceFrames: -1 },
    { evidenceDurationMs: '500' }, { evidenceDurationMs: 0 }]) {
    assert.equal(summarizeLiveFaceQuality(frame([face(change)])).state, 'unavailable');
  }
});

test('quality output is a fixed aggregate whitelist and never carries patient or camera content', async () => {
  const { summarizeLiveFaceQuality } = await quality;
  const input = frame();
  Object.assign(input, { patientName: 'PRIVATE PERSON', image: 'PRIVATE IMAGE', pixels: new Uint8Array(4), note: 'PRIVATE NOTE', stateScore: 100, diagnosis: 'healthy' });
  Object.assign(input.faces[0], { id: 'PRIVATE FACE ID', clinicalSeverity: 'urgent' });
  const before = structuredClone(input);
  const summary = summarizeLiveFaceQuality(input, { backend: 'webgl', patientId: 'PRIVATE ID' });
  assert.deepEqual(Object.keys(summary), ['state', 'issues', 'reasonCodes', 'faceCount', 'stableCount', 'uncertainCount', 'lowConfidenceCount', 'smallFaceCount', 'processingTimeMs', 'completedRateHz', 'frameAgeMs', 'backend', 'evidenceMode']);
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE|healthy|image|pixels|note|stateScore|diagnosis|landmarks|happy|clinicalSeverity/);
  assert.deepEqual(input, before);
});

test('quality translations cover all states/issues and never infer lighting or medical status', async () => {
  const { getLiveFaceQualityCopy, summarizeLiveFaceQuality } = await quality;
  const english = getLiveFaceQualityCopy('en');
  assert.match(english.evidenceNotice, /not a person’s feelings or health/);
  assert.match(english.notHealth, /cannot confirm or rule out an emergency/);
  assert.match(english.tips.noFace, /lighting has not been measured/);
  assert.match(english.tips.staleFrame, /does not describe the current scene/);
  assert.doesNotMatch(allStrings(english).join('\n'), /you are safe|you are healthy|no emergency|lighting is poor|too dark|camera says/i);
  for (const language of ['ta', 'si']) {
    const localized = getLiveFaceQualityCopy(language);
    assert.deepEqual(Object.keys(localized).sort(), Object.keys(english).sort());
    for (const map of ['states', 'issues', 'tips']) assert.deepEqual(Object.keys(localized[map]), Object.keys(english[map]));
    for (const text of allStrings(localized)) assert.match(text, language === 'ta' ? /[\u0B80-\u0BFF]/ : /[\u0D80-\u0DFF]/);
  }
  for (const scenario of [null, {}, frame([]), frame(), frame([face({ detectionConfidence: 0.1 })])]) {
    const summary = summarizeLiveFaceQuality(scenario);
    for (const code of summary.issues) for (const language of ['en', 'ta', 'si']) {
      assert.equal(typeof getLiveFaceQualityCopy(language).issues[code], 'string');
      assert.equal(typeof getLiveFaceQualityCopy(language).tips[code], 'string');
    }
    assert.ok(!summary.issues.some(code => /lighting|dark|health|disease|emergency/i.test(code)));
  }
  assert.equal(getLiveFaceQualityCopy('SI_lk'), getLiveFaceQualityCopy('si'));
  assert.equal(getLiveFaceQualityCopy('__proto__'), english);
  assert.ok(Object.isFrozen(english)); assert.ok(Object.isFrozen(english.states));
});

test('manual text and camera summary have no side effects or implicit wall clock dependency', async () => {
  const { buildUrgentHelpMessage } = await care;
  const { summarizeLiveFaceQuality } = await quality;
  const oldClock = Date.now, oldFetch = global.fetch;
  try {
    Date.now = () => { throw new Error('No implicit clock'); };
    global.fetch = () => { throw new Error('No network or automated alert'); };
    assert.equal(summarizeLiveFaceQuality(frame()).frameAgeMs, null);
    assert.equal(summarizeLiveFaceQuality(frame(), { now: Date.parse(frame().capturedAt) + 20 }).frameAgeMs, 20);
    assert.match(buildUrgentHelpMessage(['breathingDifficulty']), /Severe difficulty breathing/);
  } finally { Date.now = oldClock; global.fetch = oldFetch; }
});
