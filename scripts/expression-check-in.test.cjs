const test = require('node:test'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url'), path = require('node:path');
const modulePromise = import(pathToFileURL(path.resolve(__dirname, '../shared/expressionCheckIn.js')));
const start = Date.UTC(2026, 9, 7, 12);
function frame(time, overrides = {}) {
  const face = { id: 'face-test-1', box: { x: 0.2, y: 0.2, width: 0.3, height: 0.4 }, detectionConfidence: 0.95,
    landmarks: Array.from({ length: 68 }, () => ({ x: 0.3, y: 0.3 })),
    scores: { angry: 0.01, disgusted: 0.01, fearful: 0.01, happy: 0.01, neutral: 0.01, sad: 0.94, surprised: 0.01 },
    expression: 'sad', expressionConfidence: 0.94, stable: true, evidenceMode: 'temporal', evidenceFrames: 4, evidenceDurationMs: 600, ...overrides };
  face.smoothedScores = { ...face.scores };
  return { version: 'live-face-v1', provider: 'face-api.js-local', detector: 'tiny', width: 640, height: 480,
    capturedAt: new Date(time).toISOString(), completedAt: new Date(time + 100).toISOString(), processingTimeMs: 100, faces: [face] };
}
test('sound requires sustained fresh temporal evidence, remains nonclinical and has a 60-second cooldown', async () => {
  const { createExpressionCheckInMonitor } = await modulePromise, monitor = createExpressionCheckInMonitor();
  const events = [];
  for (let ms = 0; ms <= 16000; ms += 1000) { const result = monitor.update(frame(start + ms), start + ms + 100); if (result) events.push(result); }
  assert.equal(events.length, 1); assert.equal(events[0].durationMs, 8000);
  assert.equal(events[0].clinicalAssessment, false); assert.equal(events[0].caregiverRequestSent, false);
  assert.equal(events[0].type, 'expression-check-in');
});
test('duplicate frames never build evidence or sound', async () => {
  const { createExpressionCheckInMonitor } = await modulePromise, monitor = createExpressionCheckInMonitor();
  for (let i = 0; i < 20; i++) assert.equal(monitor.update(frame(start), start + 100), null);
});
test('single photos, unstable expressions, low confidence, poor pixels and small faces never trigger', async () => {
  const { createExpressionCheckInMonitor } = await modulePromise;
  for (const overrides of [{ evidenceMode: 'single-frame' }, { stable: false }, { expression: 'uncertain' },
    { detectionConfidence: 0.7 }, { evidenceFrames: NaN }, { evidenceDurationMs: Infinity },
    { box: { x: 0.1, y: 0.1, width: 0.01, height: 0.01 } },
    { imageQuality: { version: 'face-image-quality-v1', sampleWidth: 96, sampleHeight: 96, meanLuminance: 15, darkFraction: 0.9, clippedFraction: 0, laplacianVariance: 120, eyeTiltDegrees: 0 } }]) {
    const monitor = createExpressionCheckInMonitor();
    for (let ms = 0; ms <= 20000; ms += 1000) assert.equal(monitor.update(frame(start + ms, overrides), start + ms + 100), null);
  }
});
test('missing or multiple faces, changed tracks, timing gaps and stale results reset evidence', async () => {
  const { createExpressionCheckInMonitor } = await modulePromise;
  for (const invalidate of [value => ({ ...value, faces: [] }), value => ({ ...value, faces: [value.faces[0], value.faces[0]] }),
    value => ({ ...value, completedAt: undefined }), value => ({ ...value, completedAt: new Date(start + 90000).toISOString() })]) {
    const monitor = createExpressionCheckInMonitor();
    for (let ms = 0; ms < 8000; ms += 1000) assert.equal(monitor.update(frame(start + ms), start + ms + 100), null);
    assert.equal(monitor.update(invalidate(frame(start + 8000)), start + 8100), null);
    assert.equal(monitor.update(frame(start + 9000), start + 9100), null);
  }
  const monitor = createExpressionCheckInMonitor();
  for (let ms = 0; ms < 8000; ms += 1000) monitor.update(frame(start + ms), start + ms + 100);
  assert.equal(monitor.update(frame(start + 8000, { id: 'new-track' }), start + 8100), null);
  assert.equal(monitor.update(frame(start + 11000, { id: 'new-track' }), start + 11100), null);
  assert.equal(monitor.update(frame(start + 12000), start + 20000), null);
});
test('all three languages explain the reminder, clinical limits and sound testing', async () => {
  const { getExpressionCheckInCopy } = await modulePromise;
  for (const language of ['en', 'ta', 'si']) for (const key of ['title', 'enable', 'disable', 'test', 'notice', 'prompted', 'explanation', 'unavailable'])
    assert.ok(getExpressionCheckInCopy(language)[key].length > 5);
});
