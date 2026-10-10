const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = name => import(pathToFileURL(path.join(__dirname, '../shared', name)));
const measurement = load('faceImageQuality.js'), live = load('liveFace.js'), quality = load('liveFaceQuality.js');
const box = { x: 0, y: 0, width: 1, height: 1 };
function pixels(width, height, shade) {
  const result = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = typeof shade === 'function' ? shade(x, y) : shade;
    const offset = (y * width + x) * 4; result.set([value, value, value, 255], offset);
  }
  return result;
}
function landmarks(a = { x: 0.3, y: 0.4 }, b = { x: 0.7, y: 0.4 }) {
  return Array.from({ length: 68 }, (_, index) => ({ ...(index >= 36 && index < 42 ? a : index >= 42 && index < 48 ? b : { x: 0.5, y: 0.5 }) }));
}
function rawFace(overrides = {}) {
  return { box: { x: 0.1, y: 0.1, width: 0.3, height: 0.6 }, detectionConfidence: 0.95,
    scores: { angry: 0.02, disgusted: 0.02, fearful: 0.02, happy: 0.88, neutral: 0.02, sad: 0.02, surprised: 0.02 },
    landmarks: landmarks(), ...overrides };
}
function frame(faces = [rawFace()], extra = {}) {
  return { version: 'live-face-v1', provider: 'face-api.js-local', width: 640, height: 480,
    capturedAt: '2026-10-07T15:00:00.000Z', processingTimeMs: 3000, faces, ...extra };
}
const facts = () => ({ version: 'face-image-quality-v1', sampleWidth: 96, sampleHeight: 96,
  meanLuminance: 125, darkFraction: 0.1, clippedFraction: 0.1, laplacianVariance: 200, eyeTiltDegrees: 0 });

test('actual flat, dark, bright and edged pixels produce distinct bounded face-ROI measurements', async () => {
  const { measureFaceImageQuality } = await measurement;
  const measure = shade => measureFaceImageQuality({ width: 96, height: 96, pixels: pixels(96, 96, shade), box, landmarks: landmarks() });
  const dark = measure(0), bright = measure(255), flat = measure(100), edges = measure((x, y) => (x + y) % 2 ? 200 : 40);
  assert.equal(dark.meanLuminance, 0); assert.equal(dark.darkFraction, 1); assert.equal(dark.clippedFraction, 0);
  assert.ok(Math.abs(bright.meanLuminance - 255) < 1e-9); assert.equal(bright.clippedFraction, 1); assert.equal(bright.darkFraction, 0);
  assert.ok(flat.laplacianVariance < 1e-9); assert.ok(edges.laplacianVariance > 10000);
  assert.equal(edges.eyeTiltDegrees, 0); assert.equal(edges.sampleWidth, 96); assert.equal(edges.sampleHeight, 96);
});

test('sample work is bounded and only the selected face ROI contributes to brightness', async () => {
  const { measureFaceImageQuality } = await measurement;
  const input = { width: 640, height: 240, pixels: pixels(640, 240, x => x < 320 ? 0 : 255), landmarks: landmarks() };
  const left = measureFaceImageQuality({ ...input, box: { x: 0, y: 0, width: 0.5, height: 1 } });
  const right = measureFaceImageQuality({ ...input, box: { x: 0.5, y: 0, width: 0.5, height: 1 } });
  assert.equal(left.darkFraction, 1); assert.equal(right.clippedFraction, 1);
  assert.equal(left.sampleWidth * left.sampleHeight, 96 * 96);
  const tiny = measureFaceImageQuality({ width: 1, height: 1, pixels: pixels(1, 1, 120), box, landmarks: [] });
  assert.equal(tiny.sampleWidth, 1); assert.equal(tiny.sampleHeight, 1); assert.equal(tiny.eyeTiltDegrees, null); assert.equal(tiny.laplacianVariance, 0);
});

test('eye line uses actual image aspect ratio and measures only 2-D tilt', async () => {
  const { measureFaceImageQuality } = await measurement;
  const a = { x: 0.3, y: 0.3 }, b = { x: 0.7, y: 0.55 };
  const input = { width: 100, height: 200, pixels: pixels(100, 200, 120), box };
  const tilted = measureFaceImageQuality({ ...input, landmarks: landmarks(a, b) });
  assert.ok(Math.abs(tilted.eyeTiltDegrees - Math.atan2(50, 40) * 180 / Math.PI) < 1e-9);
  const reversed = measureFaceImageQuality({ ...input, landmarks: landmarks(b, a) });
  assert.ok(Math.abs(reversed.eyeTiltDegrees - tilted.eyeTiltDegrees) < 1e-9);
  assert.equal(measureFaceImageQuality({ ...input, landmarks: landmarks(a, a) }).eyeTiltDegrees, null);
  assert.ok(!Object.hasOwn(tilted, 'yaw')); assert.ok(!Object.hasOwn(tilted, 'occlusion'));
});

test('optional quality facts are strictly bounded, copied, stripped and malformed metrics fail validation', async () => {
  const { validateLiveFrame } = await live;
  const input = frame([rawFace({ imageQuality: { ...facts(), patientName: 'PRIVATE', image: 'PRIVATE' } })]);
  const output = validateLiveFrame(input);
  assert.deepEqual(Object.keys(output.faces[0].imageQuality), Object.keys(facts()));
  assert.notEqual(output.faces[0].imageQuality, input.faces[0].imageQuality);
  for (const change of [{ version: 'other' }, { sampleWidth: 97 }, { sampleHeight: 0 }, { sampleWidth: 1.5 },
    { meanLuminance: '100' }, { meanLuminance: NaN }, { meanLuminance: 256 }, { darkFraction: -0.1 },
    { clippedFraction: Infinity }, { darkFraction: 0.8, clippedFraction: 0.5 }, { laplacianVariance: 1040401 },
    { eyeTiltDegrees: 91 }, { eyeTiltDegrees: undefined }]) {
    assert.throws(() => validateLiveFrame(frame([rawFace({ imageQuality: { ...facts(), ...change } })])), /imageQuality/);
  }
  for (const invalid of [null, undefined, [], 'fake']) assert.throws(() => validateLiveFrame(frame([rawFace({ imageQuality: invalid })])), /imageQuality/);
  assert.ok(!Object.hasOwn(validateLiveFrame(frame()).faces[0], 'imageQuality'));
});

test('quality measurements stay paired with the face after detection-order changes', async () => {
  const { createLiveFaceTracker } = await live;
  const tracker = createLiveFaceTracker({ stableFrames: 1 });
  const a = rawFace({ imageQuality: { ...facts(), meanLuminance: 10, darkFraction: 0.9, clippedFraction: 0 } });
  const b = rawFace({ box: { ...a.box, x: 0.65 }, imageQuality: { ...facts(), meanLuminance: 250, darkFraction: 0, clippedFraction: 0.8 } });
  const first = tracker.update(frame([a, b]));
  const second = tracker.update(frame([b, a], { capturedAt: '2026-10-07T15:00:00.400Z' }));
  assert.equal(second.faces[0].id, first.faces[1].id); assert.equal(second.faces[0].imageQuality.meanLuminance, 250);
  assert.equal(second.faces[1].id, first.faces[0].id); assert.equal(second.faces[1].imageQuality.meanLuminance, 10);
});

test('measured capture guidance is localized and never changes expression probabilities', async () => {
  const { createLiveFaceTracker } = await live;
  const { summarizeLiveFaceQuality, getLiveFaceQualityCopy } = await quality;
  const raw = rawFace({ imageQuality: { ...facts(), meanLuminance: 80, darkFraction: 0.7, clippedFraction: 0.21, laplacianVariance: 0, eyeTiltDegrees: 30 } });
  const tracked = createLiveFaceTracker({ stableFrames: 1 }).update(frame([raw]));
  const before = structuredClone(tracked);
  const summary = summarizeLiveFaceQuality(tracked, { mode: 'photo' });
  for (const issue of ['dimPixels', 'clippedPixels', 'lowImageDetail', 'eyeLineTilt']) {
    assert.ok(summary.issues.includes(issue));
    for (const language of ['en', 'ta', 'si']) {
      assert.equal(typeof getLiveFaceQualityCopy(language).issues[issue], 'string');
      assert.equal(typeof getLiveFaceQualityCopy(language).tips[issue], 'string');
    }
  }
  assert.deepEqual(tracked, before); assert.equal(tracked.faces[0].expression, 'happy');
  assert.match(getLiveFaceQualityCopy('en').tips.lowImageDetail, /unvalidated.*cannot confirm blur/);
  const without = createLiveFaceTracker({ stableFrames: 1 }).update(frame());
  assert.ok(!summarizeLiveFaceQuality(without).issues.includes('dimPixels'));
});

test('reports preserve supplied capture and completion times, show true total delay in all languages, and invent none', async () => {
  const { createLiveFaceTracker, buildLiveReportText, getLiveFaceCopy, validateLiveFrame } = await live;
  const input = frame(undefined, { completedAt: '2026-10-07T20:30:21.300+05:30' });
  const tracked = createLiveFaceTracker({ stableFrames: 1 }).update(input);
  assert.equal(tracked.completedAt, '2026-10-07T15:00:21.300Z');
  for (const language of ['en', 'ta', 'si']) {
    const copy = getLiveFaceCopy(language), report = buildLiveReportText(tracked, language);
    assert.ok(report.includes(copy.reportAt + ': 2026-10-07T15:00:00.000Z'));
    assert.ok(report.includes(copy.analysisCompletedAt + ': 2026-10-07T15:00:21.300Z'));
    assert.ok(report.includes(copy.captureToResultDelay + ': 21300 ' + copy.milliseconds));
    const without = createLiveFaceTracker({ stableFrames: 1 }).update(frame());
    assert.ok(!buildLiveReportText(without, language).includes(copy.analysisCompletedAt + ':'));
  }
  for (const completedAt of [null, undefined, 'invalid', '2026-10-07T14:59:59.999Z', '2026-02-30T15:00:00Z']) {
    assert.throws(() => validateLiveFrame(frame(undefined, { completedAt })), /completedAt/);
  }
});
