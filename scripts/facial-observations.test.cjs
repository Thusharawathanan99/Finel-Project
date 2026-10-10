// Synthetic, offline geometry and state regressions. These are not recognition,
// real-camera, medical, demographic or patient-distress accuracy measurements.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const engine = import(pathToFileURL(path.join(__dirname, '../shared/facialObservations.js')));
const epoch = Date.UTC(2026, 9, 9, 0, 0, 0);
const metricKeys = ['leftEyeOpeningRatio', 'rightEyeOpeningRatio', 'mouthOpeningRatio', 'mouthCornerAsymmetryRatio', 'eyeLineRollDegrees'];
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);
function frame(ms = 0, options = {}) {
  const width = options.width ?? 640, height = options.height ?? 480;
  const scale = options.scale ?? 1, roll = (options.roll ?? 0) * Math.PI / 180;
  const center = { x: width / 2 + (options.translateX ?? 0), y: height / 2 + (options.translateY ?? 0) };
  const points = Array.from({ length: 68 }, (_, i) => ({ x: -100 + i * 3, y: 0 }));
  const eye = (start, cx, opening) => {
    const halfHeight = opening * 32 / 2;
    [[-16, 0], [-8, -halfHeight], [8, -halfHeight], [16, 0], [8, halfHeight], [-8, halfHeight]].forEach(([x, y], i) => {
      points[start + i] = { x: cx + x, y: -35 + y };
    });
  };
  eye(36, -40, options.leftEye ?? 0.3125); eye(42, 40, options.rightEye ?? 0.3125);
  points[30] = { x: options.noseShift ?? 0, y: -5 };
  points[48] = { x: -30, y: 30 }; points[54] = { x: 30, y: 30 + (options.cornerDifference ?? 0) };
  const mouthHeight = (options.mouthOpening ?? 1 / 6) * 40;
  [[-20, 0], [-10, -mouthHeight / 2], [0, -mouthHeight / 2], [10, -mouthHeight / 2], [20, 0],
    [10, mouthHeight / 2], [0, mouthHeight / 2], [-10, mouthHeight / 2]].forEach(([x, y], i) => { points[60 + i] = { x, y: 30 + y }; });
  const transform = p => ({ x: center.x + scale * (p.x * Math.cos(roll) - p.y * Math.sin(roll)),
    y: center.y + scale * (p.x * Math.sin(roll) + p.y * Math.cos(roll)) });
  const corners = [{ x: -160, y: -120 }, { x: 160, y: -120 }, { x: 160, y: 192 }, { x: -160, y: 192 }].map(transform);
  const left = Math.min(...corners.map(p => p.x)), top = Math.min(...corners.map(p => p.y));
  const right = Math.max(...corners.map(p => p.x)), bottom = Math.max(...corners.map(p => p.y));
  const quality = { version: 'face-image-quality-v1', sampleWidth: 96, sampleHeight: 96,
    meanLuminance: 120, darkFraction: 0.05, clippedFraction: 0.01, laplacianVariance: 80, eyeTiltDegrees: options.roll ?? 0,
    ...(options.quality || {}) };
  const scores = { angry: 0.02, disgusted: 0.02, fearful: 0.02, happy: 0.84, neutral: 0.06, sad: 0.02, surprised: 0.02 };
  const face = { id: options.id ?? 'anonymous-session-track-1', evidenceMode: options.evidenceMode ?? 'temporal',
    box: { x: left / width, y: top / height, width: (right - left) / width, height: (bottom - top) / height },
    detectionConfidence: options.confidence ?? 0.96, scores,
    landmarks: points.map(point => { const p = transform(point); return { x: p.x / width, y: p.y / height }; }) };
  if (options.quality !== false) face.imageQuality = quality;
  return { version: 'live-face-v1', provider: 'face-api.js-local', width, height,
    capturedAt: new Date(epoch + ms).toISOString(), completedAt: new Date(epoch + ms + (options.processingTimeMs ?? 250)).toISOString(),
    processingTimeMs: options.processingTimeMs ?? 250, faces: options.faces ?? [face], ...(options.sampledAnalysis ? { sampledAnalysis: true } : {}) };
}
async function session() { return (await engine).createFacialObservationSession(); }
async function calibrated(options = {}) {
  const s = await session(); s.startBaseline({ consent: true });
  let result;
  for (let i = 0; i < 8; i++) result = s.update(frame(i * 750, options));
  assert.equal(result.baseline.status, 'ready');
  return s;
}

test('68-point pixel geometry provides honest dimensionless ratios and roll without changing expression scores', async () => {
  const s = await session(), input = frame(), original = structuredClone(input);
  const result = s.update(input);
  assert.equal(result.state, 'observing'); assert.deepEqual(result.qualityReasons, []);
  close(result.metrics.leftEyeOpeningRatio, 0.3125); close(result.metrics.rightEyeOpeningRatio, 0.3125);
  close(result.metrics.mouthOpeningRatio, 1 / 6); close(result.metrics.mouthCornerAsymmetryRatio, 0); close(result.metrics.eyeLineRollDegrees, 0);
  assert.deepEqual(input, original); assert.equal(result.capturedAt, input.capturedAt); assert.equal(result.completedAt, input.completedAt);
  assert.equal(result.history.length, 1); assert.equal(result.temporalContinuity, 'reset');
});

test('ratios are invariant to image aspect ratio, scale and small translated captures', async () => {
  for (const [width, height, scale, translateX] of [[640, 480, 1, 0], [800, 800, 1, 20], [1600, 900, 1, -30], [640, 480, 0.6, 15]]) {
    const result = (await session()).update(frame(0, { width, height, scale, translateX }));
    assert.equal(result.state, 'observing');
    close(result.metrics.leftEyeOpeningRatio, 0.3125); close(result.metrics.rightEyeOpeningRatio, 0.3125);
    close(result.metrics.mouthOpeningRatio, 1 / 6); close(result.metrics.mouthCornerAsymmetryRatio, 0);
  }
});

test('mouth-corner difference is corrected for actual eye-line roll rather than raw vertical coordinates', async () => {
  for (const roll of [-17, -8, 0, 12, 19]) {
    const result = (await session()).update(frame(0, { roll, cornerDifference: 12 }));
    assert.equal(result.state, 'observing'); close(result.metrics.mouthCornerAsymmetryRatio, 0.15);
    close(result.metrics.eyeLineRollDegrees, roll); close(result.metrics.leftEyeOpeningRatio, 0.3125);
    close(result.metrics.mouthOpeningRatio, 1 / 6);
  }
});

test('missing, malformed, no-face, multiple-face and unverified-track inputs withhold measurements', async () => {
  const input = frame();
  const cases = [[null, 'waiting'], [{}, 'invalid-frame'], [frame(0, { faces: [] }), 'no-face'],
    [frame(0, { faces: [input.faces[0], structuredClone(input.faces[0])] }), 'multiple-faces']];
  const missing = frame(); delete missing.faces[0].id; cases.push([missing, 'missing-track']);
  const missingMode = frame(); delete missingMode.faces[0].evidenceMode; cases.push([missingMode, 'missing-track']);
  const badPoints = frame(); badPoints.faces[0].landmarks = Array(67).fill({ x: 0.5, y: 0.5 }); cases.push([badPoints, 'invalid-frame']);
  const nanPoints = frame(); nanPoints.faces[0].landmarks[36].x = NaN; cases.push([nanPoints, 'invalid-frame']);
  const flat = frame(); flat.faces[0].landmarks = Array(68).fill({ x: 0.5, y: 0.5 }); cases.push([flat, 'invalid-landmarks']);
  const wrongTime = frame(); wrongTime.capturedAt = '2026-02-30T00:00:00Z'; cases.push([wrongTime, 'invalid-frame']);
  for (const [value, reason] of cases) {
    const result = (await session()).update(value);
    assert.equal(result.state, 'unavailable'); assert.equal(result.metrics, null); assert.ok(result.qualityReasons.includes(reason));
    assert.equal(result.sampleCount, 0); assert.deepEqual(result.changedMetrics, []);
  }
});

test('actual image quality and conservative geometric gates prevent observations from poor captures', async () => {
  const cases = [[{ quality: false }, 'quality-unavailable'], [{ quality: { sampleWidth: 7 } }, 'quality-unavailable'],
    [{ confidence: 0.65 }, 'low-confidence'], [{ scale: 0.18 }, 'small-face'],
    [{ quality: { meanLuminance: 30 } }, 'dim-pixels'], [{ quality: { darkFraction: 0.7 } }, 'dim-pixels'],
    [{ quality: { meanLuminance: 235 } }, 'clipped-pixels'], [{ quality: { clippedFraction: 0.3 } }, 'clipped-pixels'],
    [{ quality: { laplacianVariance: 5 } }, 'low-detail'], [{ roll: 25, scale: 0.7 }, 'tilted-view'],
    [{ noseShift: 30 }, 'oblique-geometry']];
  for (const [options, reason] of cases) {
    const s = await session(); let result;
    for (let i = 0; i < 6; i++) result = s.update(frame(i * 1000, options));
    assert.equal(result.state, 'unavailable'); assert.equal(result.metrics, null); assert.equal(result.history.length, 0);
    assert.ok(result.qualityReasons.includes(reason), reason + ': ' + result.qualityReasons);
  }
});

test('temporal readiness works for both rapid captures and slow completed inference instead of expiring at 1.5 seconds', async () => {
  for (const step of [100, 333, 750, 2000, 4000]) {
    const s = await session(); let result;
    const count = Math.max(4, Math.ceil(2200 / step) + 1);
    for (let i = 0; i < count; i++) result = s.update(frame(i * step, { processingTimeMs: step === 4000 ? 4500 : 250 }));
    assert.equal(result.state, 'no-significant-change', 'step ' + step);
    assert.equal(result.samplingGapMs, step);
    assert.equal(result.temporalContinuity, step > 2500 ? 'sparse' : 'sampled');
  }
});

test('repeated sampled geometric change requires current support and three of four recent eligible samples', async () => {
  const s = await session();
  for (let i = 0; i < 7; i++) s.update(frame(i * 400));
  assert.equal(s.update(frame(2800, { leftEye: 0.08 })).state, 'no-significant-change');
  assert.equal(s.update(frame(3200, { leftEye: 0.08 })).state, 'no-significant-change');
  let result = s.update(frame(3600, { leftEye: 0.08 }));
  assert.equal(result.state, 'repeated-change'); assert.deepEqual(result.changedMetrics, ['leftEyeOpeningRatio']);
  result = s.update(frame(4000));
  assert.equal(result.state, 'no-significant-change'); assert.deepEqual(result.changedMetrics, []);
});

test('one analyzed image and a brief set of fast frames cannot establish repeated movement', async () => {
  const s = await session();
  for (let i = 0; i < 10; i++) {
    const result = s.update(frame(i * 100, { leftEye: 0.05, mouthOpening: 0.6 }));
    assert.equal(result.state, 'observing'); assert.deepEqual(result.changedMetrics, []);
  }
});

test('single-frame and explicitly sampled-only live frames never transfer reused IDs into temporal evidence or calibration', async () => {
  for (const options of [{ evidenceMode: 'single-frame' }, { sampledAnalysis: true }]) {
    const s = await session(); s.startBaseline({ consent: true });
    for (let i = 0; i < 12; i++) {
      const result = s.update(frame(i * 4000, { ...options, id: 'face-1', leftEye: 0.05 }));
      assert.equal(result.state, 'observing'); assert.ok(result.metrics); assert.equal(result.history.length, 1);
      assert.deepEqual(result.qualityReasons, ['sampled-only']); assert.deepEqual(result.changedMetrics, []);
      assert.equal(result.baseline.status, 'off'); assert.equal(result.temporalContinuity, 'reset');
    }
    assert.equal(s.update(frame(44000, options)).state, 'unavailable');
  }
});

test('duplicate and backward capture times clear observations and calibration instead of adding votes', async () => {
  for (const offset of [5250, 4500]) {
    const s = await calibrated();
    const result = s.update(frame(offset));
    assert.equal(result.state, 'unavailable'); assert.deepEqual(result.qualityReasons, ['timestamp-order']);
    assert.equal(result.baseline.status, 'off'); assert.equal(result.baseline.reason, 'tracking-reset');
    assert.equal(result.history.length, 0);
  }
});

test('capture timestamps, not finish-time overlap, control temporal geometry on slow devices', async () => {
  const s = await session(); let result;
  for (let i = 0; i < 4; i++) result = s.update(frame(i * 4000, { processingTimeMs: 21000, leftEye: 0.08 }));
  assert.equal(result.state, 'repeated-change'); assert.equal(result.temporalContinuity, 'sparse');
  assert.equal(result.samplingGapMs, 4000); assert.equal(result.windowDurationMs, 12000);
  assert.equal(result.completedAt, new Date(epoch + 33000).toISOString());
});

test('unexplained capture gaps and maximum bounded gaps reset numeric evidence and baseline', async () => {
  for (const options of [{ next: 15250, processingTimeMs: 250 }, { next: 40250, processingTimeMs: 21000 }]) {
    const s = await calibrated(); const result = s.update(frame(options.next, options));
    assert.equal(result.state, 'observing'); assert.equal(result.history.length, 1); assert.equal(result.temporalContinuity, 'reset');
    assert.equal(result.baseline.status, 'off'); assert.equal(result.baseline.reason, 'tracking-reset');
    assert.equal(result.samplingGapMs, null);
  }
});

test('new tracks, dimensions, missing faces and multiple faces delete reference rather than transfer it', async () => {
  const original = frame();
  for (const next of [frame(6000, { id: 'different-track' }), frame(6000, { width: 800, height: 800 }),
    frame(6000, { faces: [] }), frame(6000, { faces: [original.faces[0], original.faces[0]] }), null]) {
    const s = await calibrated(); const result = s.update(next);
    assert.equal(result.baseline.status, 'off'); assert.equal(result.baseline.reason, 'tracking-reset');
    assert.equal(result.sampleCount, result.state === 'unavailable' ? 0 : 1);
  }
});

test('calibration requires explicit true consent and eight eligible captures over at least four seconds', async () => {
  const s = await session();
  for (const value of [undefined, null, {}, { consent: false }, { consent: 'true' }, { consent: 1 }]) assert.throws(() => s.startBaseline(value), /consent/);
  assert.equal(s.startBaseline({ consent: true }).baseline.status, 'collecting');
  let result;
  for (let i = 0; i < 7; i++) result = s.update(frame(i * 750));
  assert.equal(result.baseline.status, 'collecting'); assert.equal(result.baseline.sampleCount, 7);
  result = s.update(frame(5250)); assert.equal(result.baseline.status, 'ready'); assert.equal(result.baseline.sampleCount, 8);
  assert.equal(result.comparison, 'session-baseline'); assert.equal(result.history.length, 1);
});

test('fast camera calibration collects enough elapsed evidence instead of discarding all but eight rapid captures', async () => {
  const s = await session(); s.startBaseline({ consent: true }); let result;
  for (let i = 0; i <= 16; i++) result = s.update(frame(i * 250));
  assert.equal(result.baseline.status, 'ready'); assert.equal(result.baseline.sampleCount, 17);
});

test('inconsistent facial geometry and calibration view motion withhold the reference', async () => {
  for (const varied of [{ leftEye: 0.1 }, { roll: 15 }, { scale: 0.65 }, { translateX: 140 }, { noseShift: 16 }]) {
    const s = await session(); s.startBaseline({ consent: true }); let result;
    for (let i = 0; i < 8; i++) result = s.update(frame(i * 750, i % 2 ? varied : {}));
    assert.equal(result.baseline.status, 'collecting', JSON.stringify(varied));
    assert.equal(result.baseline.reason, 'unstable-samples'); assert.equal(result.baseline.sampleCount, 0);
  }
});

test('calibrated comparisons flag repeated geometric change while a changed view or scale withholds it', async () => {
  const s = await calibrated(); let result;
  for (let i = 0; i < 4; i++) result = s.update(frame(6000 + i * 750, { leftEye: 0.1 }));
  assert.equal(result.state, 'repeated-change'); assert.equal(result.comparison, 'session-baseline');
  assert.deepEqual(result.changedMetrics, ['leftEyeOpeningRatio']);
  for (const varied of [{ roll: 15 }, { noseShift: 12 }, { scale: 0.6 }, { scale: 1.6, width: 1024, height: 1024 }, { translateX: 140 }]) {
    const calibratedSession = await calibrated(varied.width ? { width: 1024, height: 1024 } : {});
    const withheld = calibratedSession.update(frame(6000, varied));
    assert.equal(withheld.state, 'unavailable'); assert.equal(withheld.metrics, null); assert.ok(withheld.qualityReasons.includes('view-changed'));
  }
});

test('temporary bad capture withholds output but an established same-track calibration remains usable', async () => {
  const s = await calibrated();
  const failed = s.update(frame(6000, { quality: { meanLuminance: 20 } }));
  assert.equal(failed.state, 'unavailable'); assert.equal(failed.baseline.status, 'ready'); assert.equal(failed.history.length, 0);
  const recovered = s.update(frame(6750)); assert.equal(recovered.state, 'observing'); assert.equal(recovered.baseline.status, 'ready');
  assert.equal(recovered.history.length, 1); assert.deepEqual(recovered.changedMetrics, []);
});

test('baseline deletion and complete session reset remove reference and observation history', async () => {
  const s = await calibrated();
  const deleted = s.resetBaseline(); assert.equal(deleted.baseline.status, 'off'); assert.equal(deleted.baseline.sampleCount, 0);
  assert.equal(deleted.history.length, 0); assert.equal(deleted.comparison, 'sampled-geometry');
  const reset = s.reset(); assert.equal(reset.state, 'unavailable'); assert.equal(reset.metrics, null);
  assert.equal(reset.capturedAt, null); assert.equal(reset.completedAt, null); assert.equal(reset.baseline.reason, null);
  assert.equal(reset.sampleCount, 0); assert.equal(s.update(frame()).state, 'observing');
});

test('history is bounded in both number and capture duration and carries no input photos or identities', async () => {
  const s = await session(); let result;
  for (let i = 0; i < 500; i++) {
    const input = frame(i * 100); input.patientName = 'PRIVATE_NAME'; input.facePhoto = 'PRIVATE_PHOTO';
    Object.assign(input.faces[0], { personId: 'PRIVATE_ID', embedding: [1, 2, 3], note: 'PRIVATE_DIAGNOSIS' });
    result = s.update(input);
  }
  assert.equal(result.history.length, 60); assert.ok(result.windowDurationMs <= 30000);
  const json = JSON.stringify(result); assert.doesNotMatch(json, /PRIVATE_|anonymous-session-track|landmarks|embedding|facePhoto|personId/);
  for (const item of result.history) {
    assert.deepEqual(Object.keys(item).sort(), ['capturedAt', 'changedMetrics', 'metrics', 'state']);
    assert.deepEqual(Object.keys(item.metrics).sort(), metricKeys.slice().sort());
    for (const value of Object.values(item.metrics)) assert.equal(typeof value, 'number');
  }
  const slow = await session(); for (let i = 0; i < 20; i++) result = slow.update(frame(i * 2000));
  assert.equal(result.history.length, 16); assert.equal(result.windowDurationMs, 30000);
});

test('returned snapshots are detached and caller mutations cannot corrupt future measurements or references', async () => {
  const s = await calibrated(), result = s.update(frame(6000));
  result.metrics.leftEyeOpeningRatio = 999; result.baseline.status = 'off'; result.qualityReasons.push('made-up');
  result.changedMetrics.push('made-up'); result.history[0].metrics.leftEyeOpeningRatio = 999; result.history[0].changedMetrics.push('made-up');
  const later = s.update(frame(6750)); close(later.metrics.leftEyeOpeningRatio, 0.3125);
  assert.equal(later.baseline.status, 'ready'); assert.deepEqual(later.qualityReasons, []);
  assert.ok(later.history.every(item => item.metrics.leftEyeOpeningRatio < 1 && !item.changedMetrics.includes('made-up')));
});

test('localized English Tamil and Sinhala copy covers every engine reason, state and metric', async () => {
  const { getFacialObservationCopy } = await engine;
  const en = getFacialObservationCopy('en'), ta = getFacialObservationCopy(' ta-LK '), si = getFacialObservationCopy('si_LK');
  assert.equal(getFacialObservationCopy('unsupported'), en); assert.equal(getFacialObservationCopy(null), en);
  for (const copy of [en, ta, si]) {
    assert.equal(Object.isFrozen(copy), true); assert.deepEqual(Object.keys(copy), Object.keys(en));
    for (const key of ['states', 'metrics', 'reasons', 'baselineStatuses']) {
      assert.deepEqual(Object.keys(copy[key]), Object.keys(en[key]));
      for (const value of Object.values(copy[key])) assert.equal(typeof value, 'string');
      assert.equal(Object.isFrozen(copy[key]), true);
    }
    assert.equal(copy.metricLabels, copy.metrics); assert.equal(copy.researchNotice, copy.notice);
  }
  assert.match(ta.title, /[\u0B80-\u0BFF]/); assert.match(si.title, /[\u0D80-\u0DFF]/);
  assert.notEqual(ta.reasons['sampled-only'], en.reasons['sampled-only']); assert.notEqual(si.reasons['view-changed'], en.reasons['view-changed']);
});

test('reports separate sampled measured geometry from health, symptoms and emotional predictions in all three languages', async () => {
  const { buildFacialObservationReport, getFacialObservationCopy } = await engine;
  const s = await session(); let result;
  for (let i = 0; i < 4; i++) result = s.update(frame(i * 4000, { mouthOpening: 0.6, processingTimeMs: 4500 }));
  assert.equal(result.state, 'repeated-change');
  for (const language of ['en', 'ta', 'si']) {
    const copy = getFacialObservationCopy(language), report = buildFacialObservationReport(result, language);
    for (const text of [copy.report, copy.notice, copy.notHealth, copy.privacy, copy.sparseNotice, copy.changedExplanation, copy.checkInSuggested,
      copy.metrics.mouthOpeningRatio, copy.noBaseline, result.capturedAt, result.completedAt]) assert.ok(report.includes(text));
    assert.doesNotMatch(report, /99%|100%|heart attack detected|stroke detected|patient is healthy|unresponsive detected/i);
  }
});

test('report export whitelists timestamps facts and fixed labels and rejects injected diagnostic text', async () => {
  const { buildFacialObservationReport, getFacialObservationCopy } = await engine;
  const result = (await session()).update(frame());
  Object.assign(result, { note: 'PRIVATE_DIAGNOSIS', capturedAt: '2026-10-09T00:00:00Z\nPRIVATE_DIAGNOSIS',
    completedAt: '2026-02-30T00:00:00Z', qualityReasons: ['PRIVATE_DIAGNOSIS'], changedMetrics: ['PRIVATE_DIAGNOSIS'] });
  result.metrics.leftEyeOpeningRatio = -1; result.metrics.rightEyeOpeningRatio = Infinity; result.metrics.mouthOpeningRatio = 'PRIVATE_DIAGNOSIS';
  result.baseline.reason = 'PRIVATE_DIAGNOSIS'; result.baseline.status = 'PRIVATE_DIAGNOSIS';
  const report = buildFacialObservationReport(result);
  assert.doesNotMatch(report, /PRIVATE_DIAGNOSIS|Infinity|2026-02-30/); assert.match(report, /Not available/);
  for (const invalid of [null, {}, { version: 'facial-observation-v1', state: 'PRIVATE_DIAGNOSIS' }]) {
    const text = buildFacialObservationReport(invalid); assert.ok(text.includes(getFacialObservationCopy().states.unavailable));
    assert.doesNotMatch(text, /PRIVATE_DIAGNOSIS/);
  }
});
