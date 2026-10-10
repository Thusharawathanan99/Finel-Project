// Real, local CPU inference on a public-domain fixture. No camera or cloud.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const PNG = require(path.join(root, '5-patient/node_modules/pngjs')).PNG;
const faceapi = require(path.join(root, '1-ui-ux/node_modules/face-api.js'));
const modelDirectory = path.join(root, '1-ui-ux/public/models/face-api');
const fixtureFile = path.join(root, '.cache/face-evaluation/astronaut.png');
const output = path.join(root, 'audit/face-model-positive-evaluation.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const rounded = number => Math.round(number * 100000) / 100000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const names = ['tiny_face_detector', 'face_expression', 'face_landmark_68_tiny', 'ssd_mobilenetv1', 'face_landmark_68'];

function embeddedModels() {
  const files = {}, assets = [];
  for (const name of names) {
    const manifestName = name + '_model-weights_manifest.json';
    const manifestBytes = fs.readFileSync(path.join(modelDirectory, manifestName));
    const manifest = JSON.parse(manifestBytes);
    files[manifestName] = { json: manifest };
    assets.push({ file: manifestName, bytes: manifestBytes.length, sha256: sha256(manifestBytes) });
    for (const group of manifest) for (const shard of group.paths) {
      if (files[shard]) continue;
      const bytes = fs.readFileSync(path.join(modelDirectory, shard));
      files[shard] = { base64: bytes.toString('base64') };
      assets.push({ file: shard, bytes: bytes.length, sha256: sha256(bytes) });
    }
  }
  return { files, assets };
}

function blank(width = 512, height = 512) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 51; data[i + 3] = 255;
  }
  return { width, height, pixels: data };
}
function bilinear(image, x, y, channel) {
  x = Math.max(0, Math.min(image.width - 1, x));
  y = Math.max(0, Math.min(image.height - 1, y));
  const left = Math.floor(x), top = Math.floor(y), right = Math.min(left + 1, image.width - 1), bottom = Math.min(top + 1, image.height - 1);
  const dx = x - left, dy = y - top;
  const pixel = (px, py) => image.data[(py * image.width + px) * 4 + channel];
  return (pixel(left, top) * (1 - dx) + pixel(right, top) * dx) * (1 - dy) +
    (pixel(left, bottom) * (1 - dx) + pixel(right, bottom) * dx) * dy;
}
function drawCrop(target, image, sx, sy, sw, sh, dx, dy, dw, dh) {
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const offset = ((dy + y) * target.width + dx + x) * 4;
    for (let c = 0; c < 3; c++) target.pixels[offset + c] = bilinear(image, sx + (x + 0.5) * sw / dw - 0.5, sy + (y + 0.5) * sh / dh - 0.5, c);
  }
}
function fixtures(image) {
  const original = { width: image.width, height: image.height, pixels: new Uint8ClampedArray(image.data) };
  const brightness = multiplier => {
    const result = { ...original, pixels: new Uint8ClampedArray(original.pixels) };
    for (let i = 0; i < result.pixels.length; i += 4) for (let c = 0; c < 3; c++) result.pixels[i + c] *= multiplier;
    return result;
  };
  const rotate = degrees => {
    const result = blank();
    const angle = degrees * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const px = x + 0.5 - 256, py = y + 0.5 - 256;
      const sourceX = cos * px + sin * py + 255.5, sourceY = -sin * px + cos * py + 255.5;
      if (sourceX < 0 || sourceY < 0 || sourceX > 511 || sourceY > 511) continue;
      for (let c = 0; c < 3; c++) result.pixels[(y * 512 + x) * 4 + c] = bilinear(image, sourceX, sourceY, c);
    }
    return result;
  };
  const group = blank(640, 480);
  drawCrop(group, image, 140, 40, 170, 190, 35, 85, 240, 270);
  drawCrop(group, image, 140, 40, 170, 190, 355, 85, 240, 270);
  const distant = blank(640, 480);
  drawCrop(distant, image, 0, 0, 512, 512, 256, 176, 128, 128);
  // Prioritize core cases so a partial interrupted run still gives useful evidence.
  return [
    { name: 'normal', expectedFaces: 1, ...original },
    { name: 'dim-35-percent', expectedFaces: 1, ...brightness(0.35) },
    { name: 'two-copies', expectedFaces: 2, ...group },
    { name: 'distant-small-copy', expectedFaces: 1, ...distant },
    { name: 'blank', expectedFaces: 0, ...blank(640, 480) },
    { name: 'bright-165-percent', expectedFaces: 1, ...brightness(1.65) },
    { name: 'rotation-minus-15-degrees', expectedFaces: 1, ...rotate(-15) },
    { name: 'rotation-plus-15-degrees', expectedFaces: 1, ...rotate(15) },
  ];
}

async function main() {
  const runtimeModule = await import(pathToFileURL(path.join(root, 'shared/localFaceRuntime.js')));
  const { createLiveFaceTracker } = await import(pathToFileURL(path.join(root, 'shared/liveFace.js')));
  const fixtureBytes = fs.readFileSync(fixtureFile);
  const decoded = PNG.sync.read(fixtureBytes);
  if (decoded.width !== 512 || decoded.height !== 512 || sha256(fixtureBytes) !== '88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5') throw Error('Unexpected public fixture');
  const models = embeddedModels();
  const memory = () => ({ numTensors: faceapi.tf.memory().numTensors, numBytes: faceapi.tf.memory().numBytes });
  let report = {
    status: 'running', startedAt: new Date().toISOString(), method: 'Real face-api.js CPU tensor inference in Node; same shared runtime and embedded weights as mobile',
    sdkVersion: require(path.join(root, '1-ui-ux/node_modules/face-api.js/package.json')).version,
    fixture: { file: '.cache/face-evaluation/astronaut.png', sha256: sha256(fixtureBytes), bytes: fixtureBytes.length,
      license: 'Public domain NASA image, documented by official scikit-image data.astronaut documentation',
      source: 'https://raw.githubusercontent.com/scikit-image/scikit-image/a160f384523ac70173d069954b7084bee79fb68e/skimage/data/astronaut.png',
      licenseSource: 'https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut' },
    sourceHashes: ['shared/localFaceRuntime.js', 'shared/liveFace.js'].map(file => ({ file, sha256: sha256(fs.readFileSync(path.join(root, file))) })),
    models: models.assets, memory: { beforeInitialize: memory() }, cases: [],
    limitations: [
      'One public still-image fixture and deterministic transformations; not a population accuracy estimate.',
      'No independently labeled emotion ground truth; expression labels are model estimates, not measured emotion accuracy.',
      'Tiny cases and original SSD are repeated three times; transformed SSD cases may have only one inference and establish no repeat consistency.',
      'CPU Node timings are specific to this laptop and do not establish browser, Android, camera, GPU or cloud performance.',
      'Synthetic brightness and in-plane rotation do not represent every real lighting condition or out-of-plane head angle.',
      'No clinical inference, identity recognition, patient data, network image upload or caregiver alert.'
    ]
  };
  if (process.argv.includes('--resume') && fs.existsSync(output)) {
    const previous = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (JSON.stringify(previous.sourceHashes) !== JSON.stringify(report.sourceHashes) ||
        JSON.stringify(previous.models) !== JSON.stringify(report.models) || previous.fixture.sha256 !== report.fixture.sha256) throw Error('Evaluation source changed; cannot combine phases');
    const current = report;
    report = { ...previous, status: 'running', limitations: current.limitations, memory: current.memory,
      executionPhases: [...(previous.executionPhases || [{ startedAt: previous.startedAt, stoppedAt: current.startedAt,
        completedComparisons: previous.cases.length, memory: previous.memory,
        note: 'First process stopped intentionally to shorten remaining transformed SSD cases; disposal not measured in interrupted process. Early timings include other laptop build activity.' }]),
        { startedAt: current.startedAt, note: 'Resumed current runtime and the same 11 weight files. Transformed SSD cases use one inference unless already completed.' }] };
  } else report.executionPhases = [{ startedAt: report.startedAt }];
  const publish = () => fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  publish();
  const scope = { performance, atob, fetch: async () => { throw Error('Evaluation has no network fetch'); } };
  const runtime = runtimeModule.createLocalFaceRuntime({ faceapi, scope });
  try {
    report.initialization = await runtime.initialize({ embeddedModels: models.files, detector: 'auto' });
    report.memory.afterInitialize = memory();
    console.log(JSON.stringify({ event: 'ready', ...report.initialization, models: models.assets.length }));
    publish();
    for (const item of fixtures(decoded)) for (const detector of ['tiny', 'ssd']) {
      if (report.cases.some(row => row.case === item.name && row.requestedDetector === detector)) continue;
      const tracker = createLiveFaceTracker(), rounds = [];
      let raw, tracked;
      const roundCount = detector === 'ssd' && item.name !== 'normal' ? 1 : 3;
      for (let round = 0; round < roundCount; round++) {
        const started = performance.now();
        raw = await runtime.analyze({ width: item.width, height: item.height, pixels: item.pixels, detector, capturedAt: new Date().toISOString() });
        tracked = tracker.update(raw);
        const photo = createLiveFaceTracker({ stableFrames: 1 }).update(raw);
        rounds.push({ faceCount: raw.faces.length, processingTimeMs: rounded(raw.processingTimeMs), wallTimeMs: rounded(performance.now() - started),
          liveExpressions: tracked.faces.map(face => face.expression), photoExpressions: photo.faces.map(face => face.expression),
          landmarkCounts: raw.faces.map(face => face.landmarks.length), tensorsAfterFrame: memory().numTensors });
        console.log(JSON.stringify({ event: 'round', case: item.name, detector, round: round + 1, count: raw.faces.length, ms: rounded(raw.processingTimeMs) }));
        if (round < roundCount - 1) await sleep(250);
      }
      const row = { case: item.name, expectedSourceFaces: item.expectedFaces, width: item.width, height: item.height,
        pixelSha256: sha256(item.pixels), requestedDetector: detector, actualDetector: raw.detector,
        backend: faceapi.tf.getBackend(), allCountsMatchFixture: rounds.every(round => round.faceCount === item.expectedFaces),
        repeatsHaveSameCount: rounds.length > 1 ? rounds.every(round => round.faceCount === rounds[0].faceCount) : null, rounds,
        faces: raw.faces.map((face, index) => ({ box: Object.fromEntries(Object.entries(face.box).map(([key, value]) => [key, rounded(value)])),
          detectionConfidence: rounded(face.detectionConfidence), rawScores: Object.fromEntries(Object.entries(face.scores).map(([key, value]) => [key, rounded(value)])),
          landmarkCount: face.landmarks.length, liveExpression: tracked.faces[index].expression, liveAbstained: tracked.faces[index].expression === 'uncertain',
          liveEvidenceMode: tracked.faces[index].evidenceMode, liveSupportingFrames: tracked.faces[index].evidenceFrames,
          liveEvidenceDurationMs: tracked.faces[index].evidenceDurationMs })) };
      report.cases.push(row); publish();
      console.log(JSON.stringify({ event: 'case-complete', case: item.name, detector, counts: rounds.map(round => round.faceCount), expected: item.expectedFaces }));
    }
    report.status = 'complete';
    report.summary = { comparisons: report.cases.length, recordedInferences: report.cases.reduce((sum, row) => sum + row.rounds.length, 0),
      fixtureCountMatches: report.cases.filter(row => row.allCountsMatchFixture).length,
      repeatedComparisons: report.cases.filter(row => row.rounds.length > 1).length,
      repeatCountConsistency: report.cases.filter(row => row.repeatsHaveSameCount).length,
      blankFalseDetections: report.cases.filter(row => row.case === 'blank').flatMap(row => row.rounds).reduce((sum, round) => sum + round.faceCount, 0) };
  } catch (error) {
    report.status = 'failed'; report.error = String(error.stack || error); process.exitCode = 1;
  } finally {
    runtime.dispose(); report.memory.afterDispose = memory(); report.completedAt = new Date().toISOString();
    Object.assign(report.executionPhases[report.executionPhases.length - 1], { completedAt: report.completedAt, memory: report.memory }); publish();
    console.log(JSON.stringify({ event: 'finished', status: report.status, summary: report.summary, memory: report.memory, error: report.error }));
  }
}
module.exports = { fixtures, embeddedModels };
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
