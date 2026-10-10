// Synthetic, offline regressions. No camera, patient data, model downloads or cloud calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const helpers = import(pathToFileURL(path.join(__dirname, '../shared/liveFace.js')));
const runtimeHelpers = import(pathToFileURL(path.join(__dirname, '../shared/localFaceRuntime.js')));
const expressions = ['angry', 'disgusted', 'fearful', 'happy', 'neutral', 'sad', 'surprised'];

function probabilities(winner = 'happy', confidence = 0.9) {
  return Object.fromEntries(expressions.map(key => [key, key === winner ? confidence : (1 - confidence) / 6]));
}
function face(overrides = {}) {
  return { box: { x: 0.2, y: 0.3, width: 0.2, height: 0.25 }, detectionConfidence: 0.95,
    scores: probabilities(), landmarks: Array.from({ length: 68 }, (_, index) => ({ x: 0.21 + index * 0.001, y: 0.35 })), ...overrides };
}
function frame(faces = [face()], millis = 0, overrides = {}) {
  return { version: 'live-face-v1', provider: 'face-api.js-local', width: 640, height: 480,
    capturedAt: new Date(Date.UTC(2026, 9, 5, 12) + millis).toISOString(), processingTimeMs: 21.5, faces, ...overrides };
}
const at = (x, winner = 'happy', confidence = 0.9) => face({ box: { x, y: 0.3, width: 0.2, height: 0.2 }, scores: probabilities(winner, confidence) });
const clone = value => structuredClone(value);
const total = values => Object.values(values).reduce((sum, value) => sum + value, 0);
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, actual + ' ≈ ' + expected);

test('live frame validation returns a fresh numeric whitelist without images, identities or medical fields', async () => {
  const { validateLiveFrame } = await helpers;
  const input = frame();
  Object.assign(input, { patientName: 'PRIVATE PERSON', pixels: new Uint8Array(4), stateScore: 98, actualFeeling: 'happy' });
  Object.assign(input.faces[0], { id: 'PERSON ID', emotionLabel: 'diagnosis', note: 'PRIVATE NOTE' });
  input.faces[0].landmarks[0].identity = 'PRIVATE ID';
  const clean = validateLiveFrame(input);
  assert.deepEqual(Object.keys(clean), ['version', 'provider', 'width', 'height', 'capturedAt', 'processingTimeMs', 'faces']);
  assert.deepEqual(Object.keys(clean.faces[0]), ['box', 'detectionConfidence', 'scores', 'landmarks']);
  assert.deepEqual(Object.keys(clean.faces[0].landmarks[0]), ['x', 'y']);
  assert.notEqual(clean.faces[0], input.faces[0]);
  assert.notEqual(clean.faces[0].scores, input.faces[0].scores);
  clean.faces[0].box.x = 0.4;
  clean.faces[0].landmarks[0].x = 0;
  assert.equal(input.faces[0].box.x, 0.2);
  assert.equal(input.faces[0].landmarks[0].x, 0.21);
});

test('probabilities must be complete, finite, bounded and approximately sum to one without coercion', async () => {
  const { validateLiveFrame } = await helpers;
  const invalid = [null, [], {}, { ...probabilities(), diagnosis: 0 }, { ...probabilities(), angry: undefined }];
  for (const value of [NaN, Infinity, -Infinity, true, '0.9', -0.01, 1.01]) invalid.push({ ...probabilities(), happy: value });
  invalid.push(Object.fromEntries(expressions.map(key => [key, 0])), Object.fromEntries(expressions.map(key => [key, 1])));
  const missing = probabilities(); delete missing.sad; invalid.push(missing);
  for (const scores of invalid) assert.throws(() => validateLiveFrame(frame([face({ scores })])), /scores/);
  const rounded = probabilities(); rounded.happy += 0.019;
  assert.deepEqual(validateLiveFrame(frame([face({ scores: rounded })])).faces[0].scores, rounded);
  rounded.happy += 0.002;
  assert.throws(() => validateLiveFrame(frame([face({ scores: rounded })])), /scores.sum/);
});

test('frame dimensions, boxes and all 68 landmarks reject malformed or out-of-range facts', async () => {
  const { validateLiveFrame } = await helpers;
  for (const overrides of [{ width: 0 }, { width: 640.5 }, { height: '480' }, { width: Infinity }, { width: 32769 },
    { processingTimeMs: -1 }, { processingTimeMs: NaN }, { faces: null }, { faces: Array(101).fill(face()) }]) {
    assert.throws(() => validateLiveFrame(frame(undefined, 0, overrides)), /Invalid live face frame/);
  }
  for (const box of [{ x: -0.01, y: 0, width: 0.2, height: 0.2 }, { x: 0.9, y: 0, width: 0.2, height: 0.2 },
    { x: 0, y: 0.9, width: 0.2, height: 0.2 }, { x: 0, y: 0, width: 0, height: 0.2 }]) {
    assert.throws(() => validateLiveFrame(frame([face({ box })])), /box/);
  }
  for (const landmarks of [[], Array(67).fill({ x: 0.5, y: 0.5 }), Array(69).fill({ x: 0.5, y: 0.5 }), Array(68),
    Array(68).fill({ x: NaN, y: 0.5 }), Array(68).fill({ x: 0.5, y: 1.01 }), Array(68).fill({ x: '0.5', y: 0.5 })]) {
    assert.throws(() => validateLiveFrame(frame([face({ landmarks })])), /landmarks/);
  }
  assert.equal(validateLiveFrame(frame([])).faces.length, 0);
});

test('capture timestamps reject impossible calendar dates and canonicalize valid time zones', async () => {
  const { validateLiveFrame } = await helpers;
  for (const capturedAt of [null, 1, '2026-10-05', '2026-02-30T00:00:00Z', '2025-02-29T00:00:00Z',
    '2026-13-01T00:00:00Z', '2026-10-05T24:00:00Z', '2026-10-05T00:00:60Z', '2026-10-05T00:00:00+24:00']) {
    assert.throws(() => validateLiveFrame(frame(undefined, 0, { capturedAt })), /capturedAt/);
  }
  assert.equal(validateLiveFrame(frame(undefined, 0, { capturedAt: '2024-02-29T12:00:00+05:30' })).capturedAt, '2024-02-29T06:30:00.000Z');
});

test('matching preserves anonymous identity when the detection array is reordered', async () => {
  const { createLiveFaceTracker } = await helpers;
  const tracker = createLiveFaceTracker({ stableFrames: 2 });
  const initial = tracker.update(frame([at(0.1, 'happy'), at(0.65, 'sad')]));
  const next = tracker.update(frame([at(0.64, 'sad'), at(0.11, 'happy')], 400));
  assert.equal(next.faces[0].id, initial.faces[1].id);
  assert.equal(next.faces[1].id, initial.faces[0].id);
  assert.equal(next.faces[0].expression, 'sad');
  assert.equal(next.faces[1].expression, 'happy');
  assert.notEqual(next.faces[0].id, next.faces[1].id);
});

test('stable estimates need repeated evidence and low detection confidence remains uncertain', async () => {
  const { createLiveFaceTracker } = await helpers;
  const tracker = createLiveFaceTracker();
  for (const [millis, expected] of [[0, 'uncertain'], [200, 'uncertain'], [400, 'happy']]) {
    const result = tracker.update(frame(undefined, millis)).faces[0];
    assert.equal(result.expression, expected);
    assert.equal(result.stable, expected === 'happy');
  }
  const lowDetection = face({ detectionConfidence: 0.5999 });
  for (const millis of [500, 700, 900]) {
    const result = tracker.update(frame([lowDetection], millis)).faces[0];
    assert.equal(result.expression, 'uncertain');
    assert.equal(result.stable, false);
  }
  assert.equal(tracker.update(frame(undefined, 1000)).faces[0].expression, 'uncertain');
});

test('uncertainty metadata explains the existing evidence, size, detection and score gates', async () => {
  const { createLiveFaceTracker } = await helpers;
  const tracker = createLiveFaceTracker();
  for (const millis of [0, 200]) {
    const result = tracker.update(frame(undefined, millis)).faces[0];
    assert.equal(result.expression, 'uncertain'); assert.equal(result.uncertaintyReason, 'collecting-evidence');
  }
  const stable = tracker.update(frame(undefined, 400)).faces[0];
  assert.equal(stable.expression, 'happy'); assert.equal(stable.uncertaintyReason, null);
  const single = createLiveFaceTracker({ stableFrames: 1 });
  for (const [overrides, expected] of [
    [{ box: { x: 0.2, y: 0.3, width: 0.02, height: 0.03 } }, 'small-face'],
    [{ detectionConfidence: 0.59 }, 'low-face-confidence'],
    [{ scores: probabilities('sad', 0.4) }, 'weak-expression-score'],
  ]) {
    single.reset(); const result = single.update(frame([face(overrides)])).faces[0];
    assert.equal(result.expression, 'uncertain'); assert.equal(result.uncertaintyReason, expected);
  }
  const closeScores = Object.fromEntries(expressions.map(key => [key, key === 'happy' ? 0.51 : key === 'sad' ? 0.4 : 0.018]));
  const closeResult = createLiveFaceTracker({ stableFrames: 1, minConfidence: 0.4 }).update(frame([face({ scores: closeScores })])).faces[0];
  assert.equal(closeResult.expression, 'uncertain'); assert.equal(closeResult.uncertaintyReason, 'close-leading-scores');
  const lowerThreshold = createLiveFaceTracker({ stableFrames: 1, minConfidence: 0.5 }).update(frame([face({ scores: probabilities('happy', 0.55) })])).faces[0];
  assert.equal(lowerThreshold.expression, 'happy'); assert.equal(lowerThreshold.uncertaintyReason, null, 'Reasons use configured gates rather than hard-coded defaults');
});

test('changed raw evidence explains history disagreement while weak current evidence takes priority', async () => {
  const { createLiveFaceTracker } = await helpers;
  const tracker = createLiveFaceTracker();
  for (const millis of [0, 200, 400]) tracker.update(frame(undefined, millis));
  const changed = tracker.update(frame([face({ scores: probabilities('sad') })], 600)).faces[0];
  assert.equal(changed.expression, 'uncertain'); assert.equal(changed.uncertaintyReason, 'history-disagreement');
  const weak = tracker.update(frame([face({ scores: probabilities('sad', 0.4) })], 800)).faces[0];
  assert.equal(weak.uncertaintyReason, 'weak-expression-score');
  const smoothed = createLiveFaceTracker({ stableFrames: 1 });
  smoothed.update(frame([face({ scores: probabilities('happy', 0.5) })]));
  const current = smoothed.update(frame([face({ scores: probabilities('happy', 0.7) })], 200)).faces[0];
  assert.equal(current.scores.happy, 0.7); assert.ok(current.expressionConfidence < 0.6);
  assert.equal(current.uncertaintyReason, 'weak-expression-score', 'A valid raw winner can still lack smoothed support');
});

test('an ambiguous current frame immediately withdraws a previously supported expression', async () => {
  const { createLiveFaceTracker } = await helpers;
  const tracker = createLiveFaceTracker();
  for (let millis = 0; millis <= 2250; millis += 250) tracker.update(frame([at(0.2, 'happy', 0.99)], millis));
  const diffuse = Object.fromEntries(expressions.map(key => [key, 1 / 7]));
  const uncertain = tracker.update(frame([face({ scores: diffuse })], 2500)).faces[0];
  assert.ok(uncertain.expressionConfidence > 0.6, 'History still favors happy, so a smoothed-only gate would be wrong');
  assert.equal(uncertain.expression, 'uncertain'); assert.equal(uncertain.stable, false);
  assert.equal(uncertain.evidenceFrames, 0); assert.equal(uncertain.evidenceDurationMs, 0);
  const resumed = tracker.update(frame(undefined, 2750)).faces[0];
  assert.equal(resumed.expression, 'uncertain'); assert.equal(resumed.evidenceFrames, 1);
});

test('a changed expression cannot inherit the previous winner or its evidence duration', async () => {
  const { createLiveFaceTracker } = await helpers;
  const tracker = createLiveFaceTracker();
  for (const millis of [0, 250, 500, 750]) tracker.update(frame([at(0.2, 'happy')], millis));
  let result = tracker.update(frame([at(0.2, 'sad')], 1000)).faces[0];
  assert.equal(result.expression, 'uncertain', 'The current sad frame contradicts the previous happy estimate');
  assert.equal(result.evidenceFrames, 0);
  for (const millis of [1250, 1500, 1750, 2000, 2250]) {
    result = tracker.update(frame([at(0.2, 'sad')], millis)).faces[0];
    assert.notEqual(result.expression, 'happy');
    if (result.stable) assert.ok(result.evidenceFrames >= 3 && result.evidenceDurationMs >= 400);
  }
  assert.equal(result.expression, 'sad');
});

test('tiny or narrow faces remain tracked but do not support expression classification', async () => {
  const { createLiveFaceTracker } = await helpers;
  for (const box of [{ x: 0.2, y: 0.2, width: 0.02, height: 0.03 },
    { x: 0.2, y: 0.2, width: 47 / 640, height: 0.5 }, { x: 0.2, y: 0.2, width: 0.1, height: 0.1 }]) {
    const tracker = createLiveFaceTracker(); let result;
    for (const millis of [0, 250, 500, 750]) result = tracker.update(frame([face({ box })], millis)).faces[0];
    assert.ok(result.id); assert.equal(result.expression, 'uncertain'); assert.equal(result.evidenceFrames, 0);
  }
  const boundary = { x: 0.2, y: 0.2, width: 48 / 640, height: 0.4 };
  assert.equal(createLiveFaceTracker({ stableFrames: 1 }).update(frame([face({ box: boundary })])).faces[0].expression, 'happy');
});

test('live evidence requires both elapsed time and repeated fresh frames; photos disclose one-frame evidence', async () => {
  const { createLiveFaceTracker } = await helpers;
  const tracker = createLiveFaceTracker();
  for (const millis of [0, 1, 2, 399]) {
    const result = tracker.update(frame(undefined, millis)).faces[0];
    assert.equal(result.expression, 'uncertain'); assert.equal(result.evidenceMode, 'temporal');
  }
  const accepted = tracker.update(frame(undefined, 400)).faces[0];
  assert.equal(accepted.expression, 'happy'); assert.equal(accepted.evidenceDurationMs, 400);
  const photo = createLiveFaceTracker({ stableFrames: 1 }).update(frame()).faces[0];
  assert.equal(photo.expression, 'happy'); assert.equal(photo.evidenceMode, 'single-frame');
  assert.equal(photo.evidenceFrames, 1); assert.equal(photo.evidenceDurationMs, 0);
  assert.equal(createLiveFaceTracker({ stableFrames: 1, minEvidenceMs: 400 }).update(frame()).faces[0].expression, 'uncertain');
});

test('close contenders or diffuse probabilities never become a confident expression', async () => {
  const { createLiveFaceTracker } = await helpers;
  const ambiguous = Object.fromEntries(expressions.map(key => [key, key === 'happy' ? 0.61 : key === 'sad' ? 0.35 : 0.008]));
  const belowMargin = Object.fromEntries(expressions.map(key => [key, key === 'happy' ? 0.51 : key === 'sad' ? 0.4 : 0.018]));
  for (const scores of [belowMargin, Object.fromEntries(expressions.map(key => [key, 1 / 7]))]) {
    const tracker = createLiveFaceTracker({ stableFrames: 1, minConfidence: 0.5 });
    assert.equal(tracker.update(frame([face({ scores })])).faces[0].expression, 'uncertain');
  }
  assert.equal(createLiveFaceTracker({ stableFrames: 1 }).update(frame([face({ scores: ambiguous })])).faces[0].expression, 'happy');
});

test('smoothing uses prior scores only for a matched face and normalizes rounded vectors', async () => {
  const { createLiveFaceTracker } = await helpers;
  const tracker = createLiveFaceTracker({ alpha: 0.25, stableFrames: 1 });
  const first = tracker.update(frame([at(0.2, 'happy')]));
  const second = tracker.update(frame([at(0.21, 'sad')], 100));
  assert.equal(second.faces[0].id, first.faces[0].id);
  close(second.faces[0].smoothedScores.happy, 0.25 * probabilities('sad').happy + 0.75 * 0.9);
  close(total(second.faces[0].smoothedScores), 1);
  const rounded = probabilities('angry'); rounded.angry += 0.01;
  const different = tracker.update(frame([face({ box: { x: 0.7, y: 0.1, width: 0.2, height: 0.2 }, scores: rounded })], 200)).faces[0];
  assert.notEqual(different.id, second.faces[0].id);
  close(different.smoothedScores.angry, 0.91 / 1.01);
  close(total(different.smoothedScores), 1);
});

test('crossing movement resets identities and prevents one person inheriting another expression history', async () => {
  const { createLiveFaceTracker } = await helpers;
  const tracker = createLiveFaceTracker();
  tracker.update(frame([at(0.1, 'happy'), at(0.6, 'sad')]));
  const before = tracker.update(frame([at(0.2, 'happy'), at(0.5, 'sad')], 100));
  // Velocity predicts each person across the other person's previous position.
  const after = tracker.update(frame([at(0.5, 'angry'), at(0.2, 'surprised')], 400));
  const previousIds = new Set(before.faces.map(item => item.id));
  for (const [index, item] of after.faces.entries()) {
    assert.equal(previousIds.has(item.id), false);
    assert.equal(item.expression, 'uncertain');
    assert.equal(item.stable, false);
    const expected = probabilities(index ? 'surprised' : 'angry');
    for (const expression of expressions) close(item.smoothedScores[expression], expected[expression]);
  }
});

test('overlapping or ambiguous detections discard prior tracks instead of forcing a match', async () => {
  const { createLiveFaceTracker } = await helpers;
  const tracker = createLiveFaceTracker({ stableFrames: 1 });
  const previous = tracker.update(frame([at(0.2, 'happy'), at(0.5, 'sad')]));
  const overlap = tracker.update(frame([at(0.3, 'angry'), at(0.31, 'surprised')], 100));
  for (const item of overlap.faces) assert.ok(previous.faces.every(old => old.id !== item.id));
  assert.equal(new Set(overlap.faces.map(item => item.id)).size, 2);
});

test('missing detections, clock regressions, long gaps and resolution changes reset identity and smoothing', async () => {
  const { createLiveFaceTracker } = await helpers;
  for (const next of [frame(undefined, 0), frame(undefined, -1), frame(undefined, 1501), frame(undefined, 100, { width: 1280 }), frame(undefined, 100, { height: 720 })]) {
    const tracker = createLiveFaceTracker({ stableFrames: 2 });
    const first = tracker.update(frame());
    const second = tracker.update(next);
    assert.notEqual(second.faces[0].id, first.faces[0].id);
    assert.equal(second.faces[0].expression, 'uncertain');
  }
  const tracker = createLiveFaceTracker({ stableFrames: 1 });
  const first = tracker.update(frame()).faces[0].id;
  assert.deepEqual(tracker.update(frame([], 100)).faces, []);
  assert.notEqual(tracker.update(frame(undefined, 200)).faces[0].id, first);
});

test('explicit tracker reset expires session identity and invalid input does not poison current tracks', async () => {
  const { createLiveFaceTracker } = await helpers;
  const tracker = createLiveFaceTracker({ stableFrames: 1 });
  const first = tracker.update(frame()).faces[0].id;
  assert.throws(() => tracker.update(frame([face({ detectionConfidence: NaN })], 100)), /detectionConfidence/);
  assert.equal(tracker.update(frame(undefined, 200)).faces[0].id, first);
  tracker.reset();
  assert.notEqual(tracker.update(frame(undefined, 300)).faces[0].id, first);
  for (const options of [null, [], { alpha: 0 }, { alpha: NaN }, { alpha: 1.01 }, { minMargin: -1 }, { minConfidence: '0.6' },
    { stableFrames: 0 }, { stableFrames: 1.5 }, { stableFrames: 121 }, { minFacePixels: 0 }, { minFacePixels: Infinity },
    { minFacePixels: '48' }, { minFaceArea: -0.01 }, { minFaceArea: 1.01 }, { minEvidenceMs: -1 },
    { minEvidenceMs: '400' }, { minEvidenceMs: 60001 }]) assert.throws(() => createLiveFaceTracker(options), /Invalid live face frame/);
});

function leaves(value, prefix = '') {
  return Object.entries(value).flatMap(([key, item]) => item && typeof item === 'object' ? leaves(item, prefix + key + '.') : [[prefix + key, item]]);
}
test('English, Tamil and Sinhala have complete immutable live copy and all expression emoji', async () => {
  const { getLiveFaceCopy, EXPRESSION_LABELS, expressionEmoji, LIVE_EXPRESSIONS } = await helpers;
  assert.deepEqual(LIVE_EXPRESSIONS, expressions);
  const english = getLiveFaceCopy('en'), keys = leaves(english).map(([key]) => key).sort();
  for (const language of ['en', 'ta', 'si']) {
    const copy = getLiveFaceCopy(language);
    assert.deepEqual(leaves(copy).map(([key]) => key).sort(), keys);
    assert.ok(Object.isFrozen(copy) && Object.isFrozen(copy.expressions));
    assert.deepEqual(Object.keys(copy.expressions), [...expressions, 'uncertain']);
    for (const [key, value] of leaves(copy)) {
      assert.ok(typeof value === 'string' && value.trim(), language + ':' + key);
      if (language !== 'en') assert.match(value, language === 'ta' ? /[\u0B80-\u0BFF]/ : /[\u0D80-\u0DFF]/, language + ':' + key);
    }
    assert.equal(copy.expressions, EXPRESSION_LABELS[language]);
  }
  assert.deepEqual(Object.keys(expressionEmoji), [...expressions, 'uncertain']);
  assert.equal(new Set(Object.values(expressionEmoji)).size, 8);
  for (const symbol of Object.values(expressionEmoji)) assert.match(symbol, /\p{Extended_Pictographic}/u);
  for (const language of [null, {}, '__proto__', 'fr']) assert.equal(getLiveFaceCopy(language), english);
  assert.equal(getLiveFaceCopy(' TA-lk '), getLiveFaceCopy('ta'));
  assert.equal(getLiveFaceCopy('SI-LK'), getLiveFaceCopy('si'));
});

test('expression display distinguishes probabilities from Google likelihoods and rejects invented percentage conversions', async () => {
  const { getExpressionDisplay, getLiveFaceCopy, expressionEmoji } = await helpers;
  for (const language of ['en', 'ta', 'si']) {
    const copy = getLiveFaceCopy(language);
    const probability = getExpressionDisplay('happy', 0.934, language);
    assert.deepEqual(probability, { label: copy.expressions.happy, emoji: expressionEmoji.happy, kind: 'probability', valueText: '93.4%' });
    for (const [alias, expression] of [['joy', 'happy'], ['sorrow', 'sad'], ['anger', 'angry'], ['surprise', 'surprised']]) {
      const likelihood = getExpressionDisplay(alias, 'LIKELY', language);
      assert.equal(likelihood.label, copy.expressions[expression]);
      assert.equal(likelihood.emoji, expressionEmoji[expression]);
      assert.equal(likelihood.kind, 'likelihood');
      assert.equal(likelihood.valueText, copy.likelihood.LIKELY);
      assert.equal(likelihood.valueText.includes('%'), false);
    }
    for (const value of [null, undefined, NaN, Infinity, -0.1, 1.1, '0.93', 'CERTAIN']) {
      assert.equal(getExpressionDisplay('happy', value, language).kind, 'unknown');
      assert.equal(getExpressionDisplay('happy', value, language).valueText, copy.unknown);
    }
    assert.equal(getExpressionDisplay('diagnosis', null, language).label, copy.expressions.uncertain);
  }
});

test('raw expression summaries show all seven model scores without changing an uncertain label', async () => {
  const { createLiveFaceTracker, getLiveExpressionSummary, getLiveFaceCopy, expressionEmoji } = await helpers;
  for (const winner of expressions) for (const language of ['en', 'ta', 'si']) {
    const tracked = createLiveFaceTracker().update(frame([face({ scores: probabilities(winner) })])).faces[0];
    const before = clone(tracked), copy = getLiveFaceCopy(language);
    const summary = getLiveExpressionSummary(tracked, language);
    assert.equal(tracked.expression, 'uncertain'); assert.deepEqual(tracked, before);
    assert.deepEqual(summary.leading, { expression: winner, label: copy.expressions[winner], emoji: expressionEmoji[winner], score: 0.9, valueText: '90.0%' });
    assert.equal(summary.supported, null); assert.equal(summary.uncertaintyReason, 'collecting-evidence');
    assert.equal(summary.explanation, copy.uncertaintyReasons['collecting-evidence']);
    assert.deepEqual(summary.scoreEntries.map(entry => entry.expression).sort(), [...expressions].sort());
    for (const entry of summary.scoreEntries) {
      assert.equal(entry.score, tracked.scores[entry.expression]);
      assert.equal(entry.emoji, expressionEmoji[entry.expression]);
      assert.equal(entry.label, copy.expressions[entry.expression]);
    }
    const stable = createLiveFaceTracker({ stableFrames: 1 }).update(frame([face({ scores: probabilities(winner) })])).faces[0];
    const supported = getLiveExpressionSummary(stable, language);
    assert.deepEqual(supported.supported, { ...supported.leading, score: stable.expressionConfidence });
    close(supported.supported.score, supported.leading.score);
    assert.equal(supported.uncertaintyReason, null); assert.equal(supported.explanation, null);
  }
});

test('expression summaries never invent probabilities from missing, invalid or tied evidence', async () => {
  const { getLiveExpressionSummary, getLiveFaceCopy } = await helpers;
  const zeros = Object.fromEntries(expressions.map(key => [key, 0]));
  const badScores = [undefined, null, {}, zeros, { ...probabilities(), sad: undefined }, { ...probabilities(), happy: NaN },
    { ...probabilities(), happy: '0.9' }, { ...probabilities(), happy: 1.1 }, { ...probabilities(), extra: 0 }];
  for (const language of ['en', 'ta', 'si']) {
    const expected = { leading: null, scoreEntries: [], supported: null, uncertaintyReason: null, explanation: getLiveFaceCopy(language).noModelScores };
    for (const scores of badScores) assert.deepEqual(getLiveExpressionSummary({ scores }, language), expected);
    for (const input of [null, undefined, [], 'face']) assert.deepEqual(getLiveExpressionSummary(input, language), expected);
    const tied = Object.fromEntries(expressions.map(key => [key, key === 'happy' || key === 'sad' ? 0.5 : 0]));
    const tieSummary = getLiveExpressionSummary({ scores: tied }, language);
    assert.equal(tieSummary.leading, null); assert.equal(tieSummary.scoreEntries.length, 7);
    assert.equal(tieSummary.explanation, getLiveFaceCopy(language).noUniqueLeadingScore);
    const happy = getLiveExpressionSummary({ scores: probabilities('happy', 1), stable: true, expression: 'neutral', expressionConfidence: 1, smoothedScores: probabilities('neutral', 1) }, language);
    assert.equal(happy.leading.expression, 'happy'); assert.equal(happy.leading.valueText, '100.0%');
    assert.equal(happy.supported, null, 'An unsupported label must not override the current raw winner');
    const forgedTie = getLiveExpressionSummary({ scores: probabilities('happy'), stable: true, expression: 'happy', expressionConfidence: 0.5, smoothedScores: tied }, language);
    assert.equal(forgedTie.supported, null, 'A forged stable label with tied smoothed scores has no unique supported winner');
    assert.equal(forgedTie.leading.expression, 'happy'); assert.equal(forgedTie.leading.valueText, '90.0%');
    assert.equal(forgedTie.scoreEntries.length, 7, 'Rejecting the supported claim retains the valid current-image scores');
    const rounded = probabilities(); rounded.happy += 0.01;
    assert.equal(getLiveExpressionSummary({ scores: rounded }, language).leading.valueText, '91.0%', 'Display the raw output without fabricating a normalized percentage');
  }
});

test('uncertain reports separate raw model evidence from confirmation and localize validated reasons', async () => {
  const { createLiveFaceTracker, buildLiveReportText, getLiveFaceCopy } = await helpers;
  const tracked = createLiveFaceTracker().update(frame([face({ scores: probabilities('fearful') })]));
  for (const language of ['en', 'ta', 'si']) {
    const copy = getLiveFaceCopy(language), report = buildLiveReportText(tracked, language);
    assert.ok(report.includes(copy.expression + ': 😨') === false, 'Uncertain stays the reported expression');
    assert.ok(report.includes(copy.expression + ': ❔ ' + copy.expressions.uncertain));
    assert.ok(report.includes(copy.highestModelScore + ': 😨 ' + copy.expressions.fearful + ' 90.0% (' + copy.notConfirmed + ')'));
    assert.ok(report.includes(copy.uncertaintyReason + ': ' + copy.uncertaintyReasons['collecting-evidence']));
    assert.ok(report.includes(copy.rawModelScores)); assert.ok(report.includes(copy.smoothedScores)); assert.ok(report.includes(copy.probabilityHelp));
    assert.equal(report.includes('collecting-evidence'), false, 'Internal reason codes are translated');
    const legacy = clone(tracked); delete legacy.faces[0].uncertaintyReason;
    assert.ok(buildLiveReportText(legacy, language).includes(copy.unconfirmedExplanation), 'Older saved reports remain readable');
  }
  for (const reason of ['SECRET PATIENT NOTE', '__proto__', {}, 4]) {
    const malformed = clone(tracked); malformed.faces[0].uncertaintyReason = reason;
    assert.throws(() => buildLiveReportText(malformed), /uncertaintyReason/);
  }
  const stable = createLiveFaceTracker({ stableFrames: 1 }).update(frame());
  stable.faces[0].uncertaintyReason = 'collecting-evidence';
  assert.throws(() => buildLiveReportText(stable), /uncertaintyReason/);
});

test('live reports preserve validated probabilities and caveats in three languages without images or personal identities', async () => {
  const { createLiveFaceTracker, buildLiveReportText, getLiveFaceCopy } = await helpers;
  const tracked = createLiveFaceTracker({ stableFrames: 1 }).update(frame());
  Object.assign(tracked, { patientName: 'PRIVATE PERSON', pixels: new Uint8Array(4), diagnosis: 'SECRET DIAGNOSIS', notes: 'PRIVATE NOTE' });
  tracked.faces[0].privateId = 'PRIVATE ID';
  for (const language of ['en', 'ta', 'si']) {
    const copy = getLiveFaceCopy(language), report = buildLiveReportText(tracked, language);
    for (const expected of [copy.report, copy.localProcessing, copy.probabilityHelp, copy.likelihoodHelp, copy.trackingHelp, copy.limitations, copy.localPrivacy,
      tracked.capturedAt, '640 × 480', '21.5', '90.0%', copy.stable, copy.singleFrame, copy.evidenceFrames, copy.evidenceDuration]) assert.ok(report.includes(expected), language + ':' + expected);
    assert.equal(report.includes(copy.temporalEvidence), false, 'One photo must not be described as repeated evidence');
    for (const expression of expressions) assert.ok(report.includes(copy.expressions[expression]));
    for (const forbidden of ['PRIVATE PERSON', 'SECRET DIAGNOSIS', 'PRIVATE NOTE', 'PRIVATE ID', tracked.faces[0].id, 'data:image/', 'stateScore']) {
      assert.equal(report.includes(forbidden), false);
    }
    assert.ok(buildLiveReportText(createLiveFaceTracker().update(frame([])), language).includes(copy.noFaces));
  }
});

test('reports reject forged tracked confidence, stable labels or smoothing vectors', async () => {
  const { createLiveFaceTracker, buildLiveReportText } = await helpers;
  const tracked = createLiveFaceTracker({ stableFrames: 1 }).update(frame());
  for (const change of [{ id: '' }, { id: 'x'.repeat(129) }, { stable: 'true' }, { expression: 'diagnosed' },
    { expression: 'uncertain', stable: true }, { expression: 'happy', stable: false }, { expression: 'sad', stable: true },
    { expressionConfidence: 0.5 }, { expressionConfidence: NaN }, { smoothedScores: probabilities('happy', 0.1) },
    { evidenceMode: 'diagnostic' }, { evidenceMode: 'temporal' }, { evidenceFrames: 0 }, { evidenceFrames: 0.1 }, { evidenceFrames: -1 },
    { evidenceDurationMs: -1 }, { evidenceDurationMs: '400' }, { evidenceDurationMs: 400 }]) {
    const malformed = clone(tracked); Object.assign(malformed.faces[0], change);
    assert.throws(() => buildLiveReportText(malformed), /Invalid live face frame/);
  }
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function detection(overrides = {}) {
  return { detection: { box: { x: 16, y: 8, width: 32, height: 32 }, score: 0.94 }, expressions: probabilities(),
    landmarks: { positions: Array.from({ length: 68 }, () => ({ x: 24, y: 16 })) }, ...overrides };
}
function pixelsFrame(overrides = {}) {
  return { width: 128, height: 64, pixels: new Uint8ClampedArray(128 * 64 * 4), capturedAt: '2026-10-05T12:00:00.000Z', ...overrides };
}
function mockRuntime() {
  const calls = { backend: [], load: [], netDispose: [], tensors: [], options: [], inputs: [], landmarkMode: [], environment: [], decoded: [] };
  const behavior = { detections: [detection()], load: null, infer: null, allocationError: null, weightError: false, decodeError: false, setBackend: null };
  const names = { tinyFaceDetector: 'tiny_face_detector', faceExpressionNet: 'face_expression',
    faceLandmark68TinyNet: 'face_landmark_68_tiny', ssdMobilenetv1: 'ssd_mobilenetv1', faceLandmark68Net: 'face_landmark_68' };
  const nets = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, {
    isLoaded: false, weights: [],
    async loadFromUri(uri) { calls.load.push({ name, uri }); if (behavior.load) await behavior.load(name); this.isLoaded = true; },
    loadFromWeightMap(weights) { if (behavior.weightError) throw Error('BAD_WEIGHTS'); this.weights = Object.values(weights); this.isLoaded = true; },
    dispose() { calls.netDispose.push(name); this.weights.forEach(tensor => tensor.dispose()); this.isLoaded = false; },
  }]));
  let backend = 'cpu';
  const faceapi = { nets, env: { setEnv: value => calls.environment.push(value) },
    tf: { async setBackend(value) {
      calls.backend.push(value);
      if (behavior.setBackend && await behavior.setBackend(value) === false) return false;
      backend = value; return true;
    }, getBackend: () => backend,
      browser: { fromPixels(input, channels) {
        if (behavior.allocationError) { const error = behavior.allocationError; behavior.allocationError = null; throw error; }
        calls.inputs.push({ input, channels });
        const tensor = { disposeCount: 0, dispose() { this.disposeCount++; } }; calls.tensors.push(tensor); return tensor;
      } }, io: { decodeWeights() {
        if (behavior.decodeError) throw Error('BAD_DECODE');
        const tensor = { disposeCount: 0, dispose() { this.disposeCount++; } }; calls.decoded.push(tensor);
        return { ['weight-' + calls.decoded.length]: tensor };
      } } },
    TinyFaceDetectorOptions: class { constructor(options) { this.kind = 'tiny'; Object.assign(this, options); } },
    SsdMobilenetv1Options: class { constructor(options) { this.kind = 'ssd'; Object.assign(this, options); } },
    detectAllFaces(tensor, options) { calls.options.push(options); return {
      withFaceLandmarks(tiny) { calls.landmarkMode.push(tiny); return { withFaceExpressions: async () => behavior.infer ? behavior.infer() : behavior.detections }; },
    }; },
  };
  let tick = 0;
  const scope = { performance: { now: () => (tick += 10) }, atob: text => Buffer.from(text, 'base64').toString('binary'),
    OffscreenCanvas: class {}, OffscreenCanvasRenderingContext2D: class {}, ImageData: class {} };
  return { faceapi, scope, calls, behavior };
}
async function createMockRuntime() {
  const { createLocalFaceRuntime } = await runtimeHelpers;
  const mock = mockRuntime();
  const runtime = createLocalFaceRuntime({ faceapi: mock.faceapi, scope: mock.scope, fetchImpl: () => { throw Error('NETWORK_NOT_ALLOWED'); } });
  return { runtime, ...mock };
}

function enableMockGPU(mock, { context = {}, existingFactory = false, setupError = false } = {}) {
  const calls = { contexts: [], installs: [], flags: [], registrations: [] };
  mock.scope.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext(type, options) { calls.contexts.push({ type, options }); return context; }
  };
  mock.faceapi.tf.webgl = {
    MathBackendWebGL: class {},
    setWebGLContext(version, gl) { if (setupError) throw Error('NO_GPU'); calls.installs.push({ version, gl }); },
  };
  mock.faceapi.tf.env = () => ({ set: (key, value) => calls.flags.push({ key, value }) });
  mock.faceapi.tf.findBackendFactory = () => existingFactory ? () => ({}) : null;
  mock.faceapi.tf.registerBackend = (name, factory, priority) => calls.registrations.push({ name, factory, priority });
  return calls;
}

test('worker prefers available WebGL and reuses an existing backend registration', async () => {
  for (const existingFactory of [false, true]) {
    const mock = await createMockRuntime(), context = { mockWebGL: true };
    const gpu = enableMockGPU(mock, { context, existingFactory });
    assert.deepEqual(await mock.runtime.initialize(), { backend: 'webgl', detector: 'tiny' });
    assert.deepEqual(mock.calls.backend, ['webgl']);
    assert.equal(gpu.contexts.length, 1); assert.equal(gpu.contexts[0].type, 'webgl2');
    assert.deepEqual(gpu.installs, [{ version: 2, gl: context }]);
    assert.deepEqual(gpu.flags, [{ key: 'WEBGL_VERSION', value: 2 }, { key: 'HAS_WEBGL', value: true }]);
    assert.equal(gpu.registrations.length, existingFactory ? 0 : 1);
    if (!existingFactory) {
      assert.equal(gpu.registrations[0].name, 'webgl');
      assert.equal(gpu.registrations[0].priority, 2);
      assert.ok(gpu.registrations[0].factory() instanceof mock.faceapi.tf.webgl.MathBackendWebGL);
    }
    assert.equal((await mock.runtime.analyze(pixelsFrame())).faces.length, 1);
    assert.equal(mock.calls.tensors[0].disposeCount, 1);
    mock.runtime.dispose();
  }
});

test('worker falls back to CPU for unavailable WebGL contexts or failed GPU setup', async () => {
  for (const options of [{ context: null }, { setupError: true }]) {
    const mock = await createMockRuntime(); enableMockGPU(mock, options);
    assert.deepEqual(await mock.runtime.initialize(), { backend: 'cpu', detector: 'tiny' });
    assert.deepEqual(mock.calls.backend, ['cpu']);
    assert.equal(mock.calls.load.length, 3);
    assert.equal((await mock.runtime.analyze(pixelsFrame())).faces.length, 1);
    assert.equal(mock.calls.tensors[0].disposeCount, 1);
    mock.runtime.dispose();
  }
});

test('worker falls back to CPU when WebGL backend selection rejects or returns false', async () => {
  for (const rejectSelection of [false, true]) {
    const mock = await createMockRuntime(); enableMockGPU(mock);
    mock.behavior.setBackend = value => {
      if (value === 'webgl') { if (rejectSelection) throw Error('WEBGL_FAILED'); return false; }
      return true;
    };
    assert.deepEqual(await mock.runtime.initialize(), { backend: 'cpu', detector: 'tiny' });
    assert.deepEqual(mock.calls.backend, ['webgl', 'cpu']);
    assert.equal((await mock.runtime.analyze(pixelsFrame())).faces.length, 1);
    mock.runtime.dispose();
  }
});

test('worker initialization deduplicates simultaneous requests and loads only the selected detector locally', async () => {
  const { runtime, calls, behavior } = await createMockRuntime();
  const gate = deferred(); behavior.load = () => gate.promise;
  const first = runtime.initialize({ modelsPath: '/offline-models', detector: 'ssd' });
  const second = runtime.initialize({ modelsPath: '/unused-models', detector: 'tiny' });
  await Promise.resolve(); gate.resolve();
  assert.deepEqual(await first, { backend: 'cpu', detector: 'ssd' });
  assert.deepEqual(await second, { backend: 'cpu', detector: 'ssd' });
  assert.deepEqual(calls.backend, ['cpu']);
  assert.deepEqual(calls.load.map(item => item.name).sort(), ['face_expression', 'face_landmark_68', 'ssd_mobilenetv1']);
  assert.ok(calls.load.every(item => item.uri === '/offline-models'));
  assert.equal(calls.environment.length, 1);
  await runtime.initialize(); assert.equal(calls.load.length, 3);
  await runtime.analyze(pixelsFrame());
  assert.deepEqual({ ...calls.options[0] }, { kind: 'ssd', minConfidence: 0.55, maxResults: 12 });
  assert.deepEqual(calls.landmarkMode, [false], 'SSD must use the loaded full landmark model');
  runtime.dispose();
  assert.equal(calls.netDispose.length, 3);
});

test('auto mode loads both detectors and selects SSD on WebGL and tiny on actual CPU fallback', async () => {
  for (const setup of ['gpu', 'cpu', 'gpu-rejected']) {
    const mock = await createMockRuntime();
    if (setup !== 'cpu') enableMockGPU(mock);
    if (setup === 'gpu-rejected') mock.behavior.setBackend = backend => backend !== 'webgl';
    const ready = await mock.runtime.initialize({ detector: 'auto', modelsPath: '/local-models' });
    const expected = setup === 'gpu' ? 'ssd' : 'tiny';
    assert.deepEqual(ready, { backend: setup === 'gpu' ? 'webgl' : 'cpu', detector: expected });
    assert.deepEqual(mock.calls.load.map(item => item.name).sort(),
      ['face_expression', 'face_landmark_68', 'face_landmark_68_tiny', 'ssd_mobilenetv1', 'tiny_face_detector']);
    assert.ok(mock.calls.load.every(item => item.uri === '/local-models'));
    await mock.runtime.analyze(pixelsFrame({ detector: 'auto' }));
    assert.equal(mock.calls.options[0].kind, expected); assert.equal(mock.calls.landmarkMode[0], expected === 'tiny');
    assert.equal(mock.calls.tensors[0].disposeCount, 1);
    mock.runtime.dispose();
  }
});

test('auto mode permits frame-specific detector switches with the matching full or tiny landmarks', async () => {
  const { runtime, calls } = await createMockRuntime();
  await runtime.initialize({ detector: 'auto' });
  for (const detector of ['ssd', 'tiny', 'ssd', 'auto']) await runtime.analyze(pixelsFrame({ detector }));
  assert.deepEqual(calls.options.map(option => option.kind), ['ssd', 'tiny', 'ssd', 'tiny']);
  assert.deepEqual(calls.landmarkMode, [false, true, false, true]);
  assert.equal(calls.load.length, 5, 'A per-frame switch must not reload models');
  assert.ok(calls.tensors.every(tensor => tensor.disposeCount === 1));
  runtime.dispose();
});

test('accelerated Adaptive checks a missed face on the same tensor with full landmarks', async () => {
  const mock = await createMockRuntime();
  Object.assign(mock.scope, { WebAssembly: {}, Response: class {}, TextEncoder, TextDecoder });
  Object.assign(mock.faceapi.tf, { setPlatform() {}, setWasmPaths() {}, env: () => ({ set() {} }), ready: async () => {} });
  mock.behavior.infer = () => mock.calls.options.at(-1).kind === 'tiny' ? [] : [detection()];
  const assets = { 'tfjs-backend-wasm.wasm': 'YWJj', 'tfjs-backend-wasm-simd.wasm': 'ZGVm' };
  assert.deepEqual(await mock.runtime.initialize({ detector: 'auto', preferRealtime: true, wasmAssets: assets }), { backend: 'wasm', detector: 'tiny' });
  const result = await mock.runtime.analyze(pixelsFrame({ detector: 'auto' }));
  assert.equal(result.faces.length, 1); assert.equal(result.detector, 'ssd');
  assert.deepEqual(mock.calls.options.map(option => option.kind), ['tiny', 'ssd']);
  assert.deepEqual(mock.calls.landmarkMode, [true, false]); assert.equal(mock.calls.tensors.length, 1);
  assert.equal(mock.calls.tensors[0].disposeCount, 1); mock.runtime.dispose();
});

test('Adaptive suppresses repeated expensive fallback while explicit Detailed remains available', async () => {
  const mock = await createMockRuntime(); let now = 0;
  Object.assign(mock.scope, { WebAssembly: {}, Response: class {}, TextEncoder, TextDecoder, performance: { now: () => now } });
  Object.assign(mock.faceapi.tf, { setPlatform() {}, setWasmPaths() {}, env: () => ({ set() {} }), ready: async () => {} });
  mock.behavior.infer = () => { if (mock.calls.options.at(-1).kind === 'ssd') now += 2000; return []; };
  await mock.runtime.initialize({ detector: 'auto', preferRealtime: true,
    wasmAssets: { 'tfjs-backend-wasm.wasm': 'YWJj', 'tfjs-backend-wasm-simd.wasm': 'ZGVm' } });
  await mock.runtime.analyze(pixelsFrame({ detector: 'auto' }));
  await mock.runtime.analyze(pixelsFrame({ detector: 'auto' }));
  await mock.runtime.analyze(pixelsFrame({ detector: 'tiny' }));
  await mock.runtime.analyze(pixelsFrame({ detector: 'ssd' }));
  assert.deepEqual(mock.calls.options.map(option => option.kind), ['tiny', 'ssd', 'tiny', 'tiny', 'ssd']);
  assert.ok(mock.calls.tensors.every(tensor => tensor.disposeCount === 1)); mock.runtime.dispose();
});

test('Adaptive retries a slow detailed fallback after a cooldown and restores fast fallback when the device recovers', async () => {
  const mock = await createMockRuntime(); let now = 0, detailedRuns = 0;
  Object.assign(mock.scope, { WebAssembly: {}, Response: class {}, TextEncoder, TextDecoder, performance: { now: () => now } });
  Object.assign(mock.faceapi.tf, { setPlatform() {}, setWasmPaths() {}, env: () => ({ set() {} }), ready: async () => {} });
  mock.behavior.infer = () => {
    if (mock.calls.options.at(-1).kind === 'tiny') return [];
    detailedRuns++; now += detailedRuns === 1 ? 2000 : 500;
    return detailedRuns === 1 ? [] : [detection()];
  };
  await mock.runtime.initialize({ detector: 'auto', preferRealtime: true,
    wasmAssets: { 'tfjs-backend-wasm.wasm': 'YWJj', 'tfjs-backend-wasm-simd.wasm': 'ZGVm' } });
  assert.equal((await mock.runtime.analyze(pixelsFrame({ detector: 'auto' }))).faces.length, 0);
  now = 11999;
  assert.equal((await mock.runtime.analyze(pixelsFrame({ detector: 'auto' }))).detector, 'tiny');
  now = 12000;
  await mock.runtime.analyze(pixelsFrame({ detector: 'tiny' }));
  assert.equal(detailedRuns, 1, 'Explicit Faster must never trigger the detailed fallback');
  const recovered = await mock.runtime.analyze(pixelsFrame({ detector: 'auto' }));
  assert.equal(recovered.detector, 'ssd'); assert.equal(recovered.faces.length, 1);
  assert.equal(recovered.processingTimeMs, 500);
  assert.equal((await mock.runtime.analyze(pixelsFrame({ detector: 'auto' }))).faces.length, 1);
  assert.deepEqual(mock.calls.options.map(option => option.kind), ['tiny', 'ssd', 'tiny', 'tiny', 'tiny', 'ssd', 'tiny', 'ssd']);
  assert.ok(mock.calls.tensors.every(tensor => tensor.disposeCount === 1)); mock.runtime.dispose();
});

test('a detector absent from an explicitly loaded mode fails before allocation and preserves the working mode', async () => {
  for (const detector of ['tiny', 'ssd']) {
    const { runtime, calls } = await createMockRuntime();
    await runtime.initialize({ detector });
    await assert.rejects(runtime.analyze(pixelsFrame({ detector: detector === 'tiny' ? 'ssd' : 'tiny' })), /MODEL_UNAVAILABLE/);
    assert.equal(calls.tensors.length, 0); assert.equal(calls.options.length, 0);
    await runtime.analyze(pixelsFrame());
    assert.equal(calls.options[0].kind, detector); assert.equal(calls.tensors[0].disposeCount, 1);
    assert.equal(calls.load.length, 3);
    runtime.dispose();
  }
});

test('unsupported per-frame modes never allocate tensors or silently use a different detector', async () => {
  const { runtime, calls } = await createMockRuntime();
  await runtime.initialize({ detector: 'auto' });
  for (const detector of ['enhanced', '', null, 1, {}, []]) {
    await assert.rejects(runtime.analyze(pixelsFrame({ detector })), /INVALID_FRAME/);
  }
  assert.equal(calls.tensors.length, 0); assert.equal(calls.options.length, 0);
  await runtime.analyze(pixelsFrame({ detector: 'ssd' }));
  assert.equal(calls.options[0].kind, 'ssd'); assert.equal(calls.tensors[0].disposeCount, 1);
  runtime.dispose();
});

test('worker output clips boxes and landmarks, caps detections and always releases the input tensor', async () => {
  const { runtime, calls, behavior } = await createMockRuntime();
  await runtime.initialize();
  behavior.detections = Array.from({ length: 20 }, () => detection({
    detection: { box: { x: -16, y: -8, width: 64, height: 96 }, score: 0.94 },
    landmarks: { positions: Array.from({ length: 68 }, (_, index) => ({ x: index % 2 ? -1 : 200, y: index % 2 ? 100 : -2 })) },
  }));
  const result = await runtime.analyze(pixelsFrame());
  const { validateLiveFrame } = await helpers; validateLiveFrame(result);
  assert.equal(result.faces.length, 12);
  assert.deepEqual(result.faces[0].box, { x: 0, y: 0, width: 0.375, height: 1 });
  assert.deepEqual(result.faces[0].landmarks.slice(0, 2), [{ x: 1, y: 0 }, { x: 0, y: 1 }]);
  assert.equal(result.processingTimeMs, 10);
  assert.deepEqual(calls.landmarkMode, [true]);
  assert.deepEqual({ ...calls.options[0] }, { kind: 'tiny', inputSize: 416, scoreThreshold: 0.55 });
  assert.equal(calls.tensors[0].disposeCount, 1);
  runtime.dispose();
});

test('worker passes only the exact transferred pixel view and rejects invalid frames before tensor allocation', async () => {
  const { runtime, calls, behavior } = await createMockRuntime();
  await runtime.initialize(); behavior.detections = [];
  for (const overrides of [{ width: 0 }, { height: 1.5 }, { width: 2001, height: 2000, pixels: new Uint8Array(1) },
    { pixels: [] }, { pixels: new Uint8Array(3) }]) await assert.rejects(runtime.analyze(pixelsFrame(overrides)), /INVALID_FRAME/);
  assert.equal(calls.tensors.length, 0);
  const backing = new Uint8Array(40).fill(222), view = backing.subarray(8, 24); view.fill(7);
  const result = await runtime.analyze(pixelsFrame({ width: 2, height: 2, pixels: view }));
  assert.equal(result.faces.length, 0);
  assert.equal(calls.inputs[0].input.data.byteOffset, 8);
  assert.equal(calls.inputs[0].input.data.byteLength, 16);
  assert.deepEqual(Array.from(calls.inputs[0].input.data), Array(16).fill(7));
  assert.equal(calls.inputs[0].channels, 3);
  assert.equal(calls.tensors[0].disposeCount, 1);
  runtime.dispose();
});

test('worker enforces one inference at a time and can recover after inference rejection', async () => {
  const { runtime, calls, behavior } = await createMockRuntime();
  await runtime.initialize();
  const gate = deferred(); behavior.infer = () => gate.promise;
  const pending = runtime.analyze(pixelsFrame());
  await assert.rejects(runtime.analyze(pixelsFrame()), /BUSY/);
  assert.equal(calls.tensors.length, 1);
  gate.reject(Error('INFERENCE_FAILED'));
  await assert.rejects(pending, /INFERENCE_FAILED/);
  assert.equal(calls.tensors[0].disposeCount, 1);
  behavior.infer = null;
  assert.equal((await runtime.analyze(pixelsFrame())).faces.length, 1);
  assert.equal(calls.tensors[1].disposeCount, 1);
  runtime.dispose();
});

test('worker releases tensors if output mapping fails and permits a subsequent frame', async () => {
  const { runtime, calls, behavior } = await createMockRuntime();
  await runtime.initialize(); behavior.detections = [detection({ landmarks: null })];
  await assert.rejects(runtime.analyze(pixelsFrame()), TypeError);
  assert.equal(calls.tensors[0].disposeCount, 1);
  behavior.detections = [detection()];
  assert.equal((await runtime.analyze(pixelsFrame())).faces.length, 1);
  assert.equal(calls.tensors[1].disposeCount, 1);
  runtime.dispose();
});

test('worker recovers from tensor allocation failure rather than remaining permanently BUSY', async () => {
  const { runtime, calls, behavior } = await createMockRuntime();
  await runtime.initialize(); behavior.allocationError = Error('ALLOCATION_FAILED');
  await assert.rejects(runtime.analyze(pixelsFrame()), /ALLOCATION_FAILED/);
  assert.equal(calls.tensors.length, 0);
  assert.equal((await runtime.analyze(pixelsFrame())).faces.length, 1);
  assert.equal(calls.tensors[0].disposeCount, 1);
  runtime.dispose();
});

test('disposing during inference frees all nets and the input tensor and suppresses a late frame', async () => {
  const { runtime, calls, behavior } = await createMockRuntime();
  await assert.rejects(runtime.analyze(pixelsFrame()), /MODEL_UNAVAILABLE/);
  await runtime.initialize();
  const gate = deferred(); behavior.infer = () => gate.promise;
  const pending = runtime.analyze(pixelsFrame()); runtime.dispose();
  gate.resolve([detection()]);
  await assert.rejects(pending, /STOPPED/);
  assert.equal(calls.tensors[0].disposeCount, 1);
  assert.equal(calls.netDispose.length, 3);
  await assert.rejects(runtime.analyze(pixelsFrame()), /STOPPED/);
  await assert.rejects(runtime.initialize(), /STOPPED/);
  runtime.dispose(); assert.equal(calls.netDispose.length, 3);
});

test('disposing while models are loading releases models that complete after the stop', async () => {
  const { runtime, calls, behavior, faceapi } = await createMockRuntime();
  const gate = deferred(); behavior.load = () => gate.promise;
  const pending = runtime.initialize();
  await Promise.resolve(); runtime.dispose(); gate.resolve();
  await assert.rejects(pending, /STOPPED/);
  assert.ok(Object.values(faceapi.nets).every(net => !net.isLoaded));
  assert.equal(calls.netDispose.length, 3);
});

test('failed model initialization can be retried without caching the rejected initialization promise', async () => {
  const { runtime, behavior, calls, faceapi } = await createMockRuntime();
  behavior.load = name => { if (name === 'face_expression') throw Error('MODEL_FAILED'); };
  await assert.rejects(runtime.initialize(), /MODEL_UNAVAILABLE/);
  assert.equal(calls.netDispose.length, 2);
  assert.ok(Object.values(faceapi.nets).every(net => !net.isLoaded));
  behavior.load = null;
  assert.deepEqual(await runtime.initialize(), { backend: 'cpu', detector: 'tiny' });
  assert.equal((await runtime.analyze(pixelsFrame())).faces.length, 1);
  runtime.dispose();
});

test('partial model failure waits for late successful loads and frees all resulting nets', async () => {
  const { runtime, calls, behavior, faceapi } = await createMockRuntime();
  const gate = deferred();
  behavior.load = name => {
    if (name === 'face_expression') throw Error('EARLY_MODEL_FAILURE');
    return gate.promise;
  };
  let settled = false;
  const pending = runtime.initialize();
  // Attach a rejection handler immediately; there must be no unhandled early rejection.
  const rejected = assert.rejects(pending, /MODEL_UNAVAILABLE/).then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(calls.netDispose.length, 0);
  gate.resolve();
  await rejected;
  assert.equal(calls.netDispose.length, 2);
  assert.ok(Object.values(faceapi.nets).every(net => !net.isLoaded));
  runtime.dispose();
});

function embeddedModels() {
  const files = { 'synthetic-shard': { base64: Buffer.from([1, 2, 3, 4]).toString('base64') } };
  for (const name of ['tiny_face_detector', 'face_expression', 'face_landmark_68_tiny', 'ssd_mobilenetv1', 'face_landmark_68']) {
    files[name + '_model-weights_manifest.json'] = { json: [{ paths: ['synthetic-shard'], weights: [] }] };
  }
  return files;
}
test('embedded worker models transfer tensor ownership to nets and release those weights on disposal', async () => {
  const { runtime, calls } = await createMockRuntime();
  await runtime.initialize({ embeddedModels: embeddedModels() });
  assert.equal(calls.load.length, 0);
  assert.equal(calls.decoded.length, 3);
  assert.ok(calls.decoded.every(tensor => tensor.disposeCount === 0));
  runtime.dispose();
  assert.ok(calls.decoded.every(tensor => tensor.disposeCount === 1));
});

test('embedded auto mode owns and disposes both detector and landmark weights exactly once', async () => {
  const { runtime, calls, faceapi } = await createMockRuntime();
  await runtime.initialize({ detector: 'auto', embeddedModels: embeddedModels() });
  assert.equal(calls.load.length, 0, 'Embedded inference must not make model fetches');
  assert.equal(calls.decoded.length, 5); assert.ok(calls.decoded.every(tensor => tensor.disposeCount === 0));
  await runtime.analyze(pixelsFrame({ detector: 'ssd' }));
  await runtime.analyze(pixelsFrame({ detector: 'tiny' }));
  runtime.dispose(); runtime.dispose();
  assert.deepEqual(calls.netDispose.sort(), ['face_expression', 'face_landmark_68', 'face_landmark_68_tiny', 'ssd_mobilenetv1', 'tiny_face_detector']);
  assert.ok(calls.decoded.every(tensor => tensor.disposeCount === 1));
  assert.ok(calls.tensors.every(tensor => tensor.disposeCount === 1));
  assert.ok(Object.values(faceapi.nets).every(net => !net.isLoaded));
  await assert.rejects(runtime.analyze(pixelsFrame({ detector: 'ssd' })), /STOPPED/);
});

test('embedded weight-map failure releases every tensor decoded before the failure', async () => {
  const { runtime, calls, behavior } = await createMockRuntime();
  behavior.weightError = true;
  await assert.rejects(runtime.initialize({ embeddedModels: embeddedModels() }), /MODEL_UNAVAILABLE/);
  assert.equal(calls.decoded.length, 3);
  assert.ok(calls.decoded.every(tensor => tensor.disposeCount === 1));
  runtime.dispose();
});

test('non-finite model expression output is rejected at the canonical tracker boundary', async () => {
  const { runtime, calls, behavior } = await createMockRuntime();
  await runtime.initialize(); behavior.detections = [detection({ expressions: { ...probabilities(), happy: NaN } })];
  const result = await runtime.analyze(pixelsFrame());
  const { createLiveFaceTracker } = await helpers;
  assert.throws(() => createLiveFaceTracker().update(result), /scores.happy/);
  assert.equal(calls.tensors[0].disposeCount, 1);
  runtime.dispose();
});
