// Real bundled model inference in a browser-like VM, without camera or network.
// This is a laptop benchmark and detection regression, not emotion accuracy.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const { PNG } = require(path.join(root, '5-patient/node_modules/pngjs'));
const { fixtures, embeddedModels } = require('./evaluate-local-face-models.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function main() {
  const vendorDir = path.join(root, 'shared/vendor/face-runtime');
  const vendor = JSON.parse(fs.readFileSync(path.join(vendorDir, 'manifest.json')));
  const assets = {};
  for (const item of vendor.files) {
    const bytes = fs.readFileSync(path.join(vendorDir, item.name));
    assert.equal(sha(bytes), item.sha256);
    if (item.name.endsWith('.wasm')) assets[item.name] = bytes.toString('base64');
  }
  const context = { console, setTimeout, clearTimeout, performance, TextDecoder, TextEncoder, atob, btoa,
    WebAssembly, Uint8Array, Uint8ClampedArray, Float32Array, Int32Array, ArrayBuffer, Response,
    fetch: () => { throw Error('NETWORK_NOT_ALLOWED'); }, importScripts: () => {}, location: { href: 'blob:offline-test' } };
  context.self = context; context.globalThis = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(vendorDir, 'face-api-1.7.15.js'), 'utf8'), context);
  const fixture = fs.readFileSync(path.join(root, '.cache/face-evaluation/astronaut.png'));
  assert.equal(sha(fixture), '88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5');
  const { createLocalFaceRuntime } = await import(pathToFileURL(path.join(root, 'shared/localFaceRuntime.js')));
  const { validateLiveFrame } = await import(pathToFileURL(path.join(root, 'shared/liveFace.js')));
  const runtime = createLocalFaceRuntime({ faceapi: context.faceapi, scope: context });
  const model = embeddedModels();
  const evidence = { startedAt: new Date().toISOString(), method: 'Actual TensorFlow 4.22 WASM inference in laptop browser-like VM; all network fetches rejected',
    sdkVersion: vendor.sdkVersion, tensorflowVersion: vendor.tensorflowVersion, vendor,
    fixture: { sha256: sha(fixture), independentPeople: 1, expressionGroundTruth: false }, models: model.assets,
    sourceHashes: ['shared/localFaceRuntime.js', 'shared/localFaceAcceleration.js', 'shared/liveFace.js'].map(file => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))) })), cases: [],
    limitations: ['Laptop inference excludes camera capture, JPEG encoding, native bridge and screen rendering.',
      'One public-domain portrait and synthetic transformations; no population emotion accuracy or clinical evaluation.',
      'SIMD availability and performance on physical phones remain unverified.',
      'Faster still misses the distant synthetic face; Adaptive can try Detailed on the same pixels when no face is found.'] };
  try {
    const started = performance.now();
    evidence.ready = await runtime.initialize({ embeddedModels: model.files, wasmAssets: assets, preferRealtime: true, detector: 'auto' });
    evidence.initializationMs = performance.now() - started;
    assert.equal(evidence.ready.backend, 'wasm'); assert.equal(evidence.ready.detector, 'tiny');
    for (const detector of ['tiny', 'ssd', 'auto']) for (const item of fixtures(PNG.sync.read(fixture))) {
      if (detector === 'auto' && !['normal', 'distant-small-copy', 'blank'].includes(item.name)) continue;
      const rounds = [];
      for (let round = 0; round < 2; round++) {
        const result = await runtime.analyze({ ...item, detector, capturedAt: new Date().toISOString() });
        validateLiveFrame(result);
        rounds.push({ actualDetector: result.detector, processingTimeMs: result.processingTimeMs, faceCount: result.faces.length,
          faces: result.faces.map(face => ({ box: face.box, detectionConfidence: face.detectionConfidence, scores: face.scores, landmarkCount: face.landmarks.length })) });
      }
      assert.ok(rounds.every(round => round.faceCount === rounds[0].faceCount));
      if (item.name === 'normal' || item.name === 'blank' || (detector !== 'tiny' && item.name === 'distant-small-copy'))
        assert.ok(rounds.every(round => round.faceCount === item.expectedFaces));
      evidence.cases.push({ case: item.name, detector, expectedFaces: item.expectedFaces, countsMatch: rounds.every(round => round.faceCount === item.expectedFaces), rounds });
      console.log(JSON.stringify({ detector, case: item.name, ms: rounds.map(round => Math.round(round.processingTimeMs)), faces: rounds.map(round => round.faceCount) }));
    }
    evidence.status = 'passed';
  } finally {
    runtime.dispose(); evidence.remainingTensors = context.faceapi.tf.memory().numTensors;
    evidence.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(root, 'audit/face-wasm-acceleration-evaluation.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
  assert.equal(evidence.remainingTensors, 0);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
