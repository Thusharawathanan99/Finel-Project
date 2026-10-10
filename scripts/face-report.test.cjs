// Offline contract tests: synthetic face facts only; no images or provider calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const helpers = import(pathToFileURL(path.join(__dirname, '../shared/faceReport.js')));

function face(overrides = {}) {
  return { box: { x: 0.2, y: 0.1, width: 0.4, height: 0.6 }, confidence: 0.94, landmarkConfidence: null,
    pose: { roll: 0, pan: null, tilt: -2.5 }, quality: { blur: 'VERY_UNLIKELY', underExposure: 'UNKNOWN' },
    signals: { joy: 'LIKELY', sorrow: 'VERY_UNLIKELY', anger: 'UNKNOWN', surprise: 'POSSIBLE' }, ...overrides };
}
function report(overrides = {}) {
  return { version: 'face-report-v1', provider: 'google-cloud-vision', analyzedAt: '2026-10-05T14:00:00.000Z',
    image: { width: 1000, height: 800 }, faceCount: 1, status: 'ready', faces: [face()], issues: [], ...overrides };
}
async function checkedFace(value, image = { width: 1000, height: 800 }) {
  const { deriveFaceReportIssues } = await helpers;
  const issues = deriveFaceReportIssues([value], image);
  return report({ image, faces: [value], status: issues.length ? 'retake' : 'ready', issues });
}

test('canonical validator returns a fresh whitelist, preserves unknowns and never adds a wellness score', async () => {
  const { validateFaceReport } = await helpers;
  const raw = report({ patientName: 'SYNTHETIC PRIVATE PERSON', state_score: 98, emotion: 'Happy', rawProvider: { privateId: 'synthetic-identifier' } });
  raw.faces[0].privateNote = 'synthetic private note';
  const result = validateFaceReport(raw);
  assert.deepEqual(Object.keys(result), ['version', 'provider', 'analyzedAt', 'image', 'faceCount', 'status', 'faces', 'issues']);
  assert.notEqual(result, raw);
  assert.notEqual(result.faces[0], raw.faces[0]);
  assert.equal(result.faces[0].pose.pan, null);
  assert.equal(result.faces[0].landmarkConfidence, null);
  assert.equal(result.faces[0].quality.underExposure, 'UNKNOWN');
  assert.equal('privateNote' in result.faces[0], false);
  assert.equal('state_score' in result, false);
  assert.deepEqual(validateFaceReport(result), result);
  result.faces[0].box.x = 0.3;
  assert.equal(raw.faces[0].box.x, 0.2);
});

test('zero faces requires retake while a clear group photo keeps separate ready face facts', async () => {
  const { validateFaceReport } = await helpers;
  const none = report({ faceCount: 0, faces: [], issues: ['no_face'], status: 'retake' });
  assert.equal(validateFaceReport(none).faceCount, 0);
  const second = face({ confidence: 0.88, signals: { joy: 'UNLIKELY', sorrow: 'LIKELY', anger: 'UNKNOWN', surprise: 'VERY_UNLIKELY' } });
  const multi = report({ faceCount: 2, faces: [face(), second], issues: ['multiple_faces'], status: 'ready' });
  const checked = validateFaceReport(multi);
  assert.equal(checked.faceCount, 2);
  assert.equal(checked.status, 'ready');
  assert.deepEqual(checked.faces, [face(), second]);
  for (const value of [report({ faceCount: 0 }), { ...none, status: 'ready' }, { ...none, issues: [] }, { ...multi, issues: [] },
    { ...multi, status: 'retake' }, report({ issues: ['no_face'], status: 'retake' })]) {
    assert.throws(() => validateFaceReport(value), /Invalid face report/);
  }
});

test('group photo quality issues still require retake and preserve evidence for every face', async () => {
  const { validateFaceReport, deriveFaceReportIssues, buildFaceReportText, getFaceCopy } = await helpers;
  const second = face({ confidence: 0.72, quality: { blur: 'LIKELY', underExposure: 'UNKNOWN' } });
  const faces = [face(), second], issues = deriveFaceReportIssues(faces, { width: 1000, height: 800 });
  assert.deepEqual(issues, ['multiple_faces', 'low_confidence', 'blurred']);
  const group = report({ faceCount: 2, faces, issues, status: 'retake' });
  assert.deepEqual(validateFaceReport(group).faces, faces);
  assert.throws(() => validateFaceReport({ ...group, status: 'ready' }), /status/);
  assert.throws(() => validateFaceReport({ ...group, issues: ['multiple_faces'], status: 'ready' }), /issues.consistency/);
  const clearGroup = report({ faceCount: 2, faces: [face(), face()], issues: ['multiple_faces'], status: 'ready' });
  for (const language of ['en', 'ta', 'si']) {
    const labels = getFaceCopy(language), text = buildFaceReportText(clearGroup, language);
    assert.ok(text.startsWith(labels.report + '\n' + labels.ready));
    assert.ok(text.includes(labels.face + ' 1') && text.includes(labels.face + ' 2'));
    assert.ok(text.includes(labels.issues.multiple_faces));
    assert.equal(text.includes(labels.retakeNeeded), false);
    assert.ok(labels.issues.multiple_faces.includes(language === 'en' ? 'separately' : language === 'ta' ? 'தனித்தனியாக' : 'වෙන වෙනම'));
  }
});

test('the vendored mobile photo contract matches shared group readiness and translated guidance', async () => {
  const shared = await helpers;
  // Metro consumes this ESM source; data import exercises it offline without changing package type.
  const source = require('node:fs').readFileSync(path.join(__dirname, '../5-patient/src/faceReport.js'), 'utf8');
  const mobile = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const group = report({ faceCount: 2, faces: [face(), face()], issues: ['multiple_faces'], status: 'ready' });
  assert.deepEqual(mobile.validateFaceReport(group), shared.validateFaceReport(group));
  for (const language of ['en', 'ta', 'si']) {
    assert.equal(mobile.getFaceCopy(language).issues.multiple_faces, shared.getFaceCopy(language).issues.multiple_faces);
    assert.equal(mobile.buildFaceReportText(group, language), shared.buildFaceReportText(group, language));
  }
});

test('each photo-quality issue is enforced and cannot be removed from a ready payload', async () => {
  const { validateFaceReport } = await helpers;
  const cases = [
    [face({ confidence: 0.7999 }), 'low_confidence'],
    [face({ quality: { blur: 'LIKELY', underExposure: 'UNKNOWN' } }), 'blurred'],
    [face({ quality: { blur: 'UNKNOWN', underExposure: 'VERY_LIKELY' } }), 'dark'],
    [face({ pose: { roll: null, pan: -35.01, tilt: null } }), 'angled'],
    [face({ box: { x: 0.2, y: 0.2, width: 0.099, height: 0.4 } }), 'small_face'],
  ];
  for (const [value, expected] of cases) {
    const input = await checkedFace(value);
    assert.ok(validateFaceReport(input).issues.includes(expected));
    assert.throws(() => validateFaceReport({ ...input, issues: [], status: 'ready' }), /issues.consistency/);
    assert.throws(() => validateFaceReport({ ...input, status: 'ready' }), /status/);
  }
  const combined = await checkedFace(face({ confidence: 0.2, pose: { roll: 90, pan: 40, tilt: null },
    quality: { blur: 'VERY_LIKELY', underExposure: 'LIKELY' }, box: { x: 0.2, y: 0.2, width: 0.05, height: 0.05 } }));
  assert.deepEqual(validateFaceReport(combined).issues, ['low_confidence', 'blurred', 'dark', 'angled', 'small_face']);
});

test('retake thresholds have explicit boundaries and account for actual pixels', async () => {
  const { validateFaceReport } = await helpers;
  const boundary = await checkedFace(face({ confidence: 0.8, pose: { roll: 35, pan: -35, tilt: null },
    quality: { blur: 'POSSIBLE', underExposure: 'UNLIKELY' }, box: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 } }), { width: 640, height: 640 });
  assert.deepEqual(validateFaceReport(boundary).issues, []);
  const smallPixels = await checkedFace(face({ box: { x: 0.2, y: 0.2, width: 0.4, height: 0.5 } }), { width: 100, height: 100 });
  assert.deepEqual(validateFaceReport(smallPixels).issues, ['small_face']);
  const unknownPose = await checkedFace(face({ pose: { roll: null, pan: null, tilt: null } }));
  assert.deepEqual(validateFaceReport(unknownPose).faces[0].pose, { roll: null, pan: null, tilt: null });
});

test('malformed confidence, landmark and pose values are rejected without coercion', async () => {
  const { validateFaceReport } = await helpers;
  for (const value of [NaN, Infinity, -Infinity, '0.9', true, false, undefined, null, -0.01, 1.01]) {
    assert.throws(() => validateFaceReport(report({ faces: [face({ confidence: value })] })), /confidence/);
  }
  for (const value of [NaN, Infinity, '0.9', true, undefined, -0.01, 1.01]) {
    assert.throws(() => validateFaceReport(report({ faces: [face({ landmarkConfidence: value })] })), /landmarkConfidence/);
  }
  for (const value of [NaN, Infinity, '0', false, undefined, -181, 181]) {
    assert.throws(() => validateFaceReport(report({ faces: [face({ pose: { roll: value, pan: null, tilt: 0 } })] })), /pose/);
  }
});

test('malformed dimensions, zero-area and out-of-image boxes are rejected', async () => {
  const { validateFaceReport } = await helpers;
  for (const image of [{ width: 0, height: 800 }, { width: 1.5, height: 800 }, { width: '1000', height: 800 },
    { width: Infinity, height: 800 }, { width: 8000, height: 8000 }, { width: 32769, height: 1 }]) {
    assert.throws(() => validateFaceReport(report({ image })), /image/);
  }
  for (const box of [{ x: -0.1, y: 0.1, width: 0.4, height: 0.4 }, { x: 0.9, y: 0.1, width: 0.2, height: 0.4 },
    { x: 0.1, y: 0.9, width: 0.4, height: 0.2 }, { x: 0.1, y: 0.1, width: 0, height: 0.4 },
    { x: 0.1, y: 0.1, width: 0.4, height: 0 }, { x: '0.1', y: 0.1, width: 0.4, height: 0.4 }]) {
    assert.throws(() => validateFaceReport(report({ faces: [face({ box })] })), /box/);
  }
  const edge = await checkedFace(face({ box: { x: 0.6, y: 0.4, width: 0.4, height: 0.6 } }));
  assert.deepEqual(validateFaceReport(edge).faces[0].box, edge.faces[0].box);
});

test('only canonical enum values, report structure and consistent issues are accepted', async () => {
  const { validateFaceReport } = await helpers;
  for (const input of [null, [], false, {}, report({ version: 'face-report-v2' }), report({ provider: 'local' }),
    report({ faceCount: '1' }), report({ faces: null }), report({ status: 'approved' }), report({ issues: ['diagnosis'], status: 'retake' }),
    report({ issues: ['blurred', 'blurred'], status: 'retake' }), report({ faces: Array(101).fill(face()), faceCount: 101 })]) {
    assert.throws(() => validateFaceReport(input), /Invalid face report/);
  }
  for (const value of [undefined, null, 0, 'likely', 'CERTAIN', 'SYNTHETIC PRIVATE NOTE']) {
    assert.throws(() => validateFaceReport(report({ faces: [face({ quality: { blur: value, underExposure: 'UNKNOWN' } })] })), /quality.blur/);
    assert.throws(() => validateFaceReport(report({ faces: [face({ signals: { joy: value, sorrow: 'UNKNOWN', anger: 'UNKNOWN', surprise: 'UNKNOWN' } })] })), /signals.joy/);
  }
});

test('timestamps use a real ISO calendar date and canonicalize valid offsets', async () => {
  const { validateFaceReport } = await helpers;
  for (const analyzedAt of [null, 0, '', '2026-10-05', '2026-02-30T00:00:00.000Z', '2025-02-29T00:00:00Z',
    '2026-13-01T00:00:00Z', '2026-10-05T24:00:00Z', '2026-10-05T00:00:60Z', '2026-10-05T00:00:00+24:00']) {
    assert.throws(() => validateFaceReport(report({ analyzedAt })), /analyzedAt/);
  }
  assert.equal(validateFaceReport(report({ analyzedAt: '2024-02-29T12:00:00+05:30' })).analyzedAt, '2024-02-29T06:30:00.000Z');
});

function leaves(value, prefix = '') {
  return Object.entries(value).flatMap(([key, item]) => item && typeof item === 'object' ? leaves(item, prefix + key + '.') : [[prefix + key, item]]);
}
test('English, Tamil and Sinhala have identical complete immutable translation keys', async () => {
  const { FACE_LANGUAGES, FACE_LIKELIHOODS, FACE_ISSUES, getFaceCopy } = await helpers;
  assert.deepEqual(FACE_LANGUAGES, [{ code: 'en', label: 'English' }, { code: 'ta', label: 'தமிழ்' }, { code: 'si', label: 'සිංහල' }]);
  const english = getFaceCopy('en');
  const keys = leaves(english).map(([key]) => key).sort();
  for (const { code } of FACE_LANGUAGES) {
    const translated = getFaceCopy(code);
    assert.deepEqual(leaves(translated).map(([key]) => key).sort(), keys);
    for (const [key, value] of leaves(translated)) assert.ok(typeof value === 'string' && value.trim(), code + ':' + key);
    assert.deepEqual(Object.keys(translated.likelihood), FACE_LIKELIHOODS);
    assert.deepEqual(Object.keys(translated.issues), FACE_ISSUES);
    assert.deepEqual(Object.keys(translated.feelings), ['Happy', 'Sad', 'Angry', 'Anxious', 'Neutral']);
    assert.ok(Object.isFrozen(translated) && Object.isFrozen(translated.errors) && Object.isFrozen(translated.likelihood));
    if (code !== 'en') for (const [key, value] of leaves(translated)) {
      assert.match(value, code === 'ta' ? /[\u0B80-\u0BFF]/ : /[\u0D80-\u0DFF]/, code + ':' + key);
    }
  }
  for (const language of [undefined, null, {}, '__proto__', 'fr']) assert.equal(getFaceCopy(language), english);
  assert.equal(getFaceCopy(' ta-LK '), getFaceCopy('ta'));
  assert.equal(getFaceCopy('SI-lk'), getFaceCopy('si'));
});

test('translated report text contains only validated facts and limitations, never private or inferred clinical fields', async () => {
  const { buildFaceReportText, getFaceCopy } = await helpers;
  const raw = report({ patientName: 'SYNTHETIC PRIVATE PERSON', state_score: 98, diagnosis: 'synthetic diagnosis', notes: 'synthetic private note' });
  for (const language of ['en', 'ta', 'si']) {
    const labels = getFaceCopy(language), text = buildFaceReportText(raw, language);
    assert.ok(text.startsWith(labels.report + '\n' + labels.ready));
    assert.ok(text.includes(labels.faces + ': 1'));
    assert.ok(text.includes(labels.confidence + ': 94.0%'));
    assert.ok(text.includes(labels.pose.pan + ' ' + labels.unknown));
    assert.ok(text.includes(labels.signals.joy + ': ' + labels.likelihood.LIKELY));
    assert.ok(text.includes(labels.quality.underExposure + ': ' + labels.likelihood.UNKNOWN));
    assert.ok(text.includes(labels.confidenceHelp) && text.includes(labels.limitations) && text.includes(labels.privacyNotice));
    assert.doesNotMatch(text, /SYNTHETIC PRIVATE PERSON|synthetic diagnosis|synthetic private note|state_score|98/);
    assert.equal(buildFaceReportText(raw, language), text);
  }
  const none = report({ faceCount: 0, faces: [], status: 'retake', issues: ['no_face'] });
  assert.ok(buildFaceReportText(none, 'ta').includes(getFaceCopy('ta').issues.no_face));
  assert.throws(() => buildFaceReportText(report({ faces: [face({ confidence: NaN })] })), /Invalid face report/);
});
