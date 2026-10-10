// Harness-only Tiny input-size comparison. Production runtime is unchanged.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const faceapi = require(path.join(root, '1-ui-ux/node_modules/face-api.js'));
const PNG = require(path.join(root, '5-patient/node_modules/pngjs')).PNG;
const { fixtures, embeddedModels } = require('./evaluate-local-face-models.cjs');
const output = path.join(root, 'audit/face-model-cpu-input-experiment.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const round = value => Math.round(value * 1000) / 1000;

async function main() {
  const { createLocalFaceRuntime } = await import(pathToFileURL(path.join(root, 'shared/localFaceRuntime.js')));
  const { createLiveFaceTracker } = await import(pathToFileURL(path.join(root, 'shared/liveFace.js')));
  const bytes = fs.readFileSync(path.join(root, '.cache/face-evaluation/astronaut.png'));
  if (hash(bytes) !== '88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5') throw Error('Unexpected public fixture');
  const items = fixtures(PNG.sync.read(bytes));
  const models = embeddedModels();
  const report = { status: 'running', startedAt: new Date().toISOString(),
    method: 'Actual CPU inference through current shared runtime with TinyFaceDetectorOptions constructor overridden in this experiment only',
    productionRuntimeModified: false, inputs: [416, 320, 224], scoreThreshold: 0.55,
    fixtureSha256: hash(bytes), sdkVersion: require(path.join(root, '1-ui-ux/node_modules/face-api.js/package.json')).version,
    runtimeSha256: hash(fs.readFileSync(path.join(root, 'shared/localFaceRuntime.js'))), modelAssets: models.assets, rounds: [],
    limitations: ['One public still portrait plus deterministic transformations; no population or expression accuracy estimate.',
      'CPU Node on this laptop; not phone, browser GPU, native camera or end-to-end camera timing.',
      'A warmup, four cases and repeated normal frame per size reveal approximate runtime costs, not a controlled speed study.',
      'Other laptop work, JIT, temperature and memory contention can affect timings; all genuine observations are retained.',
      'This harness alters only Tiny detector inputSize. Production code and the completed positive-image evaluation are unchanged.'] };
  const publish = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  publish();
  try {
    for (const inputSize of report.inputs) {
      const sdk = { ...faceapi, TinyFaceDetectorOptions: function(options) {
        return new faceapi.TinyFaceDetectorOptions({ ...options, inputSize });
      } };
      const runtime = createLocalFaceRuntime({ faceapi: sdk, scope: { performance, atob, fetch: async () => { throw Error('No network'); } } });
      try {
        const initialization = await runtime.initialize({ detector: 'tiny', embeddedModels: models.files });
        const sequence = ['normal', 'normal', 'dim-35-percent', 'two-copies', 'distant-small-copy', 'normal'];
        for (let index = 0; index < sequence.length; index++) {
          const item = items.find(item => item.name === sequence[index]);
          const started = performance.now();
          const frame = await runtime.analyze({ ...item, detector: 'tiny', capturedAt: new Date().toISOString() });
          const photo = createLiveFaceTracker({ stableFrames: 1 }).update(frame);
          const row = { inputSize, case: item.name, phase: index === 0 ? 'warmup' : index === sequence.length - 1 ? 'normal-repeat' : 'case',
            backend: initialization.backend, detector: frame.detector, expectedSourceFaces: item.expectedFaces, faceCount: frame.faces.length,
            processingTimeMs: round(frame.processingTimeMs), wallTimeMs: round(performance.now() - started),
            below1500Ms: frame.processingTimeMs < 1500,
            detectionConfidence: frame.faces.map(face => round(face.detectionConfidence)), landmarkCounts: frame.faces.map(face => face.landmarks.length),
            photoExpressions: photo.faces.map(face => face.expression), tensorsAfterFrame: faceapi.tf.memory().numTensors };
          report.rounds.push(row); publish(); console.log(JSON.stringify(row));
        }
      } finally {
        runtime.dispose();
        report.rounds.push({ inputSize, phase: 'disposed', remainingTensors: faceapi.tf.memory().numTensors }); publish();
      }
    }
    report.status = 'complete';
  } catch (error) { report.status = 'failed'; report.error = String(error.stack || error); process.exitCode = 1; }
  report.completedAt = new Date().toISOString(); publish(); console.log(JSON.stringify({ status: report.status, error: report.error }));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
