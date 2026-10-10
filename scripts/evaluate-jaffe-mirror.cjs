// Private, non-commercial research evaluation. Does not distribute JAFFE images.
// Requested-pose agreement is not a measurement of internal emotions or clinical accuracy.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const { PNG } = require(path.join(root, '5-patient/node_modules/pngjs'));
const { embeddedModels } = require('./evaluate-local-face-models.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const classes = ['angry','disgusted','fearful','happy','neutral','sad','surprised'];
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
  const { createLocalFaceRuntime } = await import(pathToFileURL(path.join(root, 'shared/localFaceRuntime.js')));
  const { validateLiveFrame, createLiveFaceTracker } = await import(pathToFileURL(path.join(root, 'shared/liveFace.js')));
  const datasetDir = path.join(root, '.cache/emotion-evaluation/jaffe');
  const manifest = JSON.parse(fs.readFileSync(path.join(datasetDir, 'manifest-private.json')));
  const sourceHashes = ['shared/localFaceRuntime.js','shared/localFaceAcceleration.js','shared/liveFace.js'].map(file => ({file, sha256:sha(fs.readFileSync(path.join(root,file)))}));
  const net=context.faceapi.nets.faceExpressionNet, predict=net.predictExpressions.bind(net);
  net.predictExpressions=async input=>{if(input.rank!==3)throw Error('Unexpected expression input');const direct=await predict(input),mirror=context.faceapi.tf.reverse(input,[1]);try{const flipped=await predict(mirror);return Object.fromEntries(classes.map(k=>[k,(direct[k]+flipped[k])/2]));}finally{mirror.dispose();}};
  const runtime = createLocalFaceRuntime({ faceapi: context.faceapi, scope: context });
  const evidence = { status:'running', startedAt:new Date().toISOString(),
    method:'213 independent still-image inferences using production Adaptive Tiny→SSD pipeline, pinned WASM SDK, unchanged seven-class weights with original/mirrored aligned-face score averaging; network rejected. No training or thresholds fitted.',
    dataset:{name:manifest.dataset,record:manifest.record,images:manifest.files.length,people:manifest.people,population:manifest.population,
      archiveSha256:manifest.archiveSha256,readmeSha256:manifest.readmeSha256,conditions:manifest.conditions,citations:manifest.citations},
    target:'Requested-pose labels in original filenames, not inner emotions. Single-frame output gating evaluated independently per image; live temporal stability cannot be measured with independent still images.',
    sourceHashes, vendor:{sdkVersion:vendor.sdkVersion,tensorflowVersion:vendor.tensorflowVersion},classes, samples:[],
    limitations:[...manifest.limitations,'Cannot rule out pretraining overlap with JAFFE; no training was performed in this evaluation.',
      'Laptop WASM inference excludes physical phone, native camera, JPEG/bridge latency, cloud services and spontaneous patient states.',
      'Single-frame gating is an optimistic output coverage estimate; actual temporal tracking requires independent supporting video frames.',
      'No label for pain, urgency, unresponsiveness, or any of the additional 100 self-reported feelings is present.']};
  const privateFrames = [];
  const privateOutput = path.join(datasetDir,'mirror-frames-private.json');
  const output = path.join(root,'audit/emotion-jaffe-mirror-comparison-2026-10-08.json');
  const save = () => fs.writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
  try {
    const model = embeddedModels(); evidence.modelAssets = model.assets;
    evidence.ready = await runtime.initialize({embeddedModels:model.files,wasmAssets:assets,preferRealtime:true,detector:'auto'});
    assert.equal(evidence.ready.backend,'wasm');
    for(const fixture of manifest.files) {
      const bytes = fs.readFileSync(path.join(datasetDir,'png-private',fixture.file)); assert.equal(sha(bytes),fixture.pngSha256);
      const png = PNG.sync.read(bytes);
      const frame = await runtime.analyze({width:png.width,height:png.height,pixels:new Uint8ClampedArray(png.data),capturedAt:new Date().toISOString(),detector:'auto'});
      validateLiveFrame(frame);
      privateFrames.push({file:fixture.file,expectedLabel:fixture.expectedPoseLabel,frame});
      const face = frame.faces.length===1 ? frame.faces[0] : null;
      const rawLabel = face ? classes.slice().sort((a,b)=>face.scores[b]-face.scores[a])[0] : null;
      const tracker = createLiveFaceTracker({stableFrames:1,minEvidenceMs:0});
      const tracked = tracker.update(frame);
      const supportedLabel = face && tracked.faces[0].stable ? tracked.faces[0].expression : null;
      evidence.samples.push({file:fixture.file,expectedLabel:fixture.expectedPoseLabel,faceCount:frame.faces.length,detector:frame.detector,
        processingTimeMs:frame.processingTimeMs,rawLabel,rawCorrect:rawLabel===fixture.expectedPoseLabel,
        supportedLabel,supportedCorrect:supportedLabel===fixture.expectedPoseLabel,
        abstentionReason:!face?(frame.faces.length?'multiple-faces':'no-face'):!supportedLabel?'confidence-margin-size-gate':null,
        detectionConfidence:face?.detectionConfidence??null,scores:face?.scores??null,box:face?.box??null,
        semanticMeanRatings:fixture.semanticMeanRatings});
      if(evidence.samples.length%20===0) { console.log(JSON.stringify({completed:evidence.samples.length,total:manifest.files.length})); save(); fs.writeFileSync(privateOutput,JSON.stringify({sourceHashes,frames:privateFrames},null,2)+'\n'); }
    }
    const matrix = labels => Object.fromEntries(classes.map(expected=>[expected,Object.fromEntries([...classes,'abstained'].map(actual=>[actual,evidence.samples.filter(s=>s.expectedLabel===expected&&(labels(s)||'abstained')===actual).length]))]));
    const detected = evidence.samples.filter(s=>s.rawLabel), supported = evidence.samples.filter(s=>s.supportedLabel);
    evidence.aggregate = {images:evidence.samples.length,exactlyOneFace:detected.length,noFace:evidence.samples.filter(s=>!s.faceCount).length,
      multiFace:evidence.samples.filter(s=>s.faceCount>1).length,rawCorrectOnDetected:detected.filter(s=>s.rawCorrect).length,
      rawAgreementOnDetected:detected.length?detected.filter(s=>s.rawCorrect).length/detected.length:null,
      supportedOutputs:supported.length,abstained:evidence.samples.length-supported.length,supportedCorrect:supported.filter(s=>s.supportedCorrect).length,
      supportedPrecision:supported.length?supported.filter(s=>s.supportedCorrect).length/supported.length:null,
      endToEndSupportedCorrectFraction:supported.filter(s=>s.supportedCorrect).length/evidence.samples.length,
      rawPredictionCounts:Object.fromEntries(classes.map(label=>[label,detected.filter(s=>s.rawLabel===label).length])),
      supportedPredictionCounts:Object.fromEntries(classes.map(label=>[label,supported.filter(s=>s.supportedLabel===label).length])),
      rawConfusion:matrix(s=>s.rawLabel),supportedConfusion:matrix(s=>s.supportedLabel),
      perClass:Object.fromEntries(classes.map(label=>{const ss=evidence.samples.filter(s=>s.expectedLabel===label);return[label,{images:ss.length,oneFace:ss.filter(s=>s.rawLabel).length,rawCorrect:ss.filter(s=>s.rawCorrect).length,supported:ss.filter(s=>s.supportedLabel).length,supportedCorrect:ss.filter(s=>s.supportedCorrect).length}]})),
      minProcessingMs:Math.min(...evidence.samples.map(s=>s.processingTimeMs)),maxProcessingMs:Math.max(...evidence.samples.map(s=>s.processingTimeMs))};
    evidence.status='completed';
  } finally {
    runtime.dispose(); evidence.remainingTensors=context.faceapi.tf.memory().numTensors;
    evidence.sourcesUnchanged=sourceHashes.every(s=>sha(fs.readFileSync(path.join(root,s.file)))===s.sha256);
    evidence.completedAt=new Date().toISOString();save();fs.writeFileSync(privateOutput,JSON.stringify({sourceHashes,frames:privateFrames},null,2)+'\n');
  }
  assert.equal(evidence.remainingTensors,0);
  console.log(JSON.stringify({status:evidence.status,sourcesUnchanged:evidence.sourcesUnchanged,aggregate:evidence.aggregate}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
