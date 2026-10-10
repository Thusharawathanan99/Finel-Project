// Real local CPU smoke test; a public-domain NASA fixture, never a patient image.
// This measures software output and timing, not population emotion accuracy.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const faceapi = require(path.join(root, '1-ui-ux/node_modules/face-api.js'));
const { PNG } = require(path.join(root, '5-patient/node_modules/pngjs'));
async function main() {
  const fixtureBytes = fs.readFileSync(path.join(root, '.cache/face-evaluation/astronaut.png'));
  assert.equal(sha(fixtureBytes), '88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5');
  const image = PNG.sync.read(fixtureBytes);
  const normal = { width: image.width, height: image.height, pixels: new Uint8ClampedArray(image.data) };
  const dim = { ...normal, pixels: new Uint8ClampedArray(normal.pixels) };
  for (let i = 0; i < dim.pixels.length; i += 4) for (let c = 0; c < 3; c++) dim.pixels[i + c] *= 0.35;
  const distant = { width: 640, height: 480, pixels: new Uint8ClampedArray(640 * 480 * 4) };
  for (let i = 0; i < distant.pixels.length; i += 4) {
    distant.pixels[i] = distant.pixels[i + 1] = distant.pixels[i + 2] = 51;
    distant.pixels[i + 3] = 255;
  }
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const src = ((y * 4 + 2) * image.width + x * 4 + 2) * 4;
    const dst = ((y + 176) * 640 + x + 256) * 4;
    for (let c = 0; c < 3; c++) distant.pixels[dst + c] = image.data[src + c];
  }
  const embeddedModels = {}, models = [];
  const modelDir = path.join(root, '1-ui-ux/public/models/face-api');
  for (const name of ['tiny_face_detector', 'face_expression', 'face_landmark_68_tiny', 'ssd_mobilenetv1', 'face_landmark_68']) {
    const file = name + '_model-weights_manifest.json';
    const bytes = fs.readFileSync(path.join(modelDir, file));
    const manifest = JSON.parse(bytes);
    embeddedModels[file] = { json: manifest }; models.push({ file, sha256: sha(bytes) });
    for (const group of manifest) for (const shard of group.paths) {
      if (embeddedModels[shard]) continue;
      const data = fs.readFileSync(path.join(modelDir, shard));
      embeddedModels[shard] = { base64: data.toString('base64') }; models.push({ file: shard, sha256: sha(data) });
    }
  }
  const { createLocalFaceRuntime } = await import(pathToFileURL(path.join(root, 'shared/localFaceRuntime.js')));
  const { createLiveFaceTracker, validateLiveFrame, buildLiveReportText } = await import(pathToFileURL(path.join(root, 'shared/liveFace.js')));
  const { getLiveFramePresentation } = await import(pathToFileURL(path.join(root, '5-patient/src/liveFaceSession.js')));
  const { summarizeLiveFaceQuality } = await import(pathToFileURL(path.join(root, 'shared/liveFaceQuality.js')));
  const runtime = createLocalFaceRuntime({ faceapi });
  const evidence = { startedAt: new Date().toISOString(), method: 'Actual CPU tensor inference followed by production validation, evidence and result-presentation helpers',
    fixture: { sha256: sha(fixtureBytes), publicDomain: true, independentPeople: 1, labeledExpressions: false }, models,
    sourceHashes: ['shared/localFaceRuntime.js', 'shared/liveFace.js', 'shared/faceImageQuality.js', 'shared/liveFaceQuality.js', '5-patient/src/liveFaceSession.js', '5-patient/src/screens/LiveEmotionScreen.js']
      .map(file => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))) })), cases: [],
    limitations: ['Node CPU timings are not phone/GPU timings.', 'No emotion ground truth, motion tracking accuracy or medical validation.', 'Distant Tiny misses are retained; no accuracy percentage is inferred.', 'Presentation helper checks do not constitute a live camera test.'] };
  try {
    evidence.initialization = await runtime.initialize({ embeddedModels, detector: 'auto' });
    for (const [name, fixture, detector] of [['normal', normal, 'tiny'], ['dim', dim, 'tiny'], ['distant', distant, 'tiny'], ['distant', distant, 'ssd'], ['normal', normal, 'ssd']]) {
      const capturedAt = new Date().toISOString();
      const raw = await runtime.analyze({ ...fixture, detector, capturedAt });
      const completedAt = new Date().toISOString();
      const clean = validateLiveFrame(raw);
      const latency = Date.parse(completedAt) - Date.parse(capturedAt);
      const tracked = createLiveFaceTracker({ stableFrames: latency > 1500 ? 1 : 3 }).update(clean);
      const frame = { ...tracked, completedAt };
      const presentation = getLiveFramePresentation(frame, Date.parse(completedAt));
      assert.equal(presentation.resultFresh, true, 'a completed analysis should be visible on arrival');
      if (latency > 1500) assert.equal(presentation.overlayFresh, false, 'delayed geometry must not overlay the current video');
      const quality = summarizeLiveFaceQuality(frame, { mode: 'live', backend: 'cpu', now: Date.parse(completedAt) });
      for (const language of ['en', 'ta', 'si']) assert.ok(buildLiveReportText(frame, language).length > 100);
      const result = { case: name, detector, faceCount: frame.faces.length, processingTimeMs: raw.processingTimeMs, captureToResultMs: latency,
        presentation, expressions: frame.faces.map(face => ({ expression: face.expression, evidenceMode: face.evidenceMode,
          evidenceFrames: face.evidenceFrames, detectionConfidence: face.detectionConfidence, landmarkCount: face.landmarks.length,
          imageQuality: face.imageQuality ?? null })), qualityIssues: quality.issues, tensors: faceapi.tf.memory().numTensors };
      evidence.cases.push(result);
      console.log(JSON.stringify({ case: name, detector, faces: result.faceCount, delayMs: latency, resultVisible: presentation.resultFresh,
        overlayFresh: presentation.overlayFresh, expressions: result.expressions.map(face => face.expression) }));
    }
  } finally { runtime.dispose(); evidence.memoryAfterDispose = faceapi.tf.memory(); }
  assert.equal(evidence.memoryAfterDispose.numTensors, 0);
  evidence.completedAt = new Date().toISOString(); evidence.allSoftwareChecksPassed = true;
  fs.writeFileSync(path.join(root, 'audit/viva-face-cpu-smoke-test.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log('Completed actual local CPU smoke test. No phone, cloud or labeled-accuracy claim.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
