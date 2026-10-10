// Same-detection candidate comparison; private images never leave this computer.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname,'..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const { PNG } = require(path.join(root,'5-patient/node_modules/pngjs'));
async function main() {
  const dir = path.join(root,'.cache/emotion-model-research/ort122/package/dist');
  const ort = require(path.join(dir,'ort.wasm.min.js'));
  ort.env.logLevel='error';ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;
  ort.env.wasm.wasmBinary=fs.readFileSync(path.join(dir,'ort-wasm-simd-threaded.wasm'));
  ort.env.wasm.wasmPaths={mjs:pathToFileURL(path.join(dir,'ort-wasm-simd-threaded.mjs')).href};
  const { prepareMobileFaceNetInput, MOBILEFACENET_CLASSES: classes } = await import(pathToFileURL(path.join(root,'shared/faceExpressionInput.js')));
  const { createLiveFaceTracker, validateLiveFrame } = await import(pathToFileURL(path.join(root,'shared/liveFace.js')));
  const helperSha256=sha(fs.readFileSync(path.join(root,'shared/faceExpressionInput.js')));
  const modelBytes=fs.readFileSync(path.join(root,'.cache/emotion-model-research/mobilefacenet.onnx'));
  const baseline=JSON.parse(fs.readFileSync(path.join(root,'audit/emotion-jaffe-current-baseline-2026-10-08.json')));
  const privateData=JSON.parse(fs.readFileSync(path.join(root,'.cache/emotion-evaluation/jaffe/production-frames-private.json')));
  assert.equal(privateData.frames.length,213);
  const start=performance.now();
  const session=await ort.InferenceSession.create(modelBytes,{executionProviders:['wasm'],graphOptimizationLevel:'all',logSeverityLevel:3});
  const evidence={status:'running',startedAt:new Date().toISOString(),method:'MobileFaceNet Progressive Teacher ONNX seven-logit model on SAME production Adaptive detections and face-api68points as prior213-image baseline; official similarity-aligned RGB[-1,1]112×112 preprocessing.',
    initializationMs:performance.now()-start,modelSha256:sha(modelBytes),helperSha256,baselineSourceHashes:privateData.sourceHashes,
    dataset:baseline.dataset,classes,samples:[],limitations:[...baseline.limitations,
      'Candidate changes expression alignment and classifier together. Detection and68landmarks are cached unchanged, not full-landmark refinement or end-to-end live camera.',
      'Model was pretrained elsewhere; no localtraining. Posed class agreement does not establish true emotions or medical safety.',
      'ONNX Node WASM speed is not a physical-phone latency guarantee.']};
  try {
    for(const item of privateData.frames) {
      const frame=validateLiveFrame(item.frame);const face=frame.faces.length===1?frame.faces[0]:null;
      let scores=null,rawLabel=null,supportedLabel=null,preparationMs=null,inferenceMs=null,error=null;
      if(face) {
        try {
          const bytes=fs.readFileSync(path.join(root,'.cache/emotion-evaluation/jaffe/png-private',item.file));
          const png=PNG.sync.read(bytes);
          const prepStart=performance.now();
          const tensorData=prepareMobileFaceNetInput({width:png.width,height:png.height,pixels:new Uint8ClampedArray(png.data),landmarks:face.landmarks});
          preparationMs=performance.now()-prepStart;
          const infStart=performance.now();
          const result=await session.run({data:new ort.Tensor('float32',tensorData,[1,3,112,112])});
          inferenceMs=performance.now()-infStart;
          const logits=[...result[session.outputNames[0]].data];assert.equal(logits.length,7);assert.ok(logits.every(Number.isFinite));
          const max=Math.max(...logits),exp=logits.map(x=>Math.exp(x-max)),sum=exp.reduce((a,b)=>a+b,0);
          scores=Object.fromEntries(classes.map((key,i)=>[key,exp[i]/sum]));
          rawLabel=classes.slice().sort((a,b)=>scores[b]-scores[a])[0];
          const candidateFrame={...frame,faces:[{...face,scores}]};
          const tracked=createLiveFaceTracker({stableFrames:1,minEvidenceMs:0}).update(candidateFrame);
          supportedLabel=tracked.faces[0].stable?tracked.faces[0].expression:null;
        } catch(e) {error=e.message;}
      }
      evidence.samples.push({file:item.file,expectedLabel:item.expectedLabel,faceCount:frame.faces.length,rawLabel,
        rawCorrect:rawLabel===item.expectedLabel,supportedLabel,supportedCorrect:supportedLabel===item.expectedLabel,
        scores,preparationMs,inferenceMs,error,abstentionReason:!face?'multiple-or-no-face':error?'candidate-error':!supportedLabel?'confidence-margin-size-gate':null});
      if(evidence.samples.length%40===0)console.log(JSON.stringify({completed:evidence.samples.length,total:213}));
    }
    const ss=evidence.samples,detected=ss.filter(s=>s.rawLabel),supported=ss.filter(s=>s.supportedLabel);
    const matrix=key=>Object.fromEntries(classes.map(expected=>[expected,Object.fromEntries([...classes,'abstained'].map(actual=>[actual,ss.filter(s=>s.expectedLabel===expected&&(s[key]||'abstained')===actual).length]))]));
    evidence.aggregate={images:ss.length,rawOutputs:detected.length,candidateErrors:ss.filter(s=>s.error).length,
      rawCorrect:detected.filter(s=>s.rawCorrect).length,rawAgreementOnDetected:detected.filter(s=>s.rawCorrect).length/detected.length,
      supportedOutputs:supported.length,abstained:ss.length-supported.length,supportedCorrect:supported.filter(s=>s.supportedCorrect).length,
      supportedPrecision:supported.filter(s=>s.supportedCorrect).length/supported.length,
      endToEndSupportedCorrectFraction:supported.filter(s=>s.supportedCorrect).length/ss.length,
      rawConfusion:matrix('rawLabel'),supportedConfusion:matrix('supportedLabel'),
      perClass:Object.fromEntries(classes.map(key=>{const subset=ss.filter(s=>s.expectedLabel===key);return[key,{images:subset.length,rawCorrect:subset.filter(s=>s.rawCorrect).length,supported:subset.filter(s=>s.supportedLabel).length,supportedCorrect:subset.filter(s=>s.supportedCorrect).length}]})),
      rawPredictionCounts:Object.fromEntries(classes.map(key=>[key,ss.filter(s=>s.rawLabel===key).length])),
      supportedPredictionCounts:Object.fromEntries(classes.map(key=>[key,ss.filter(s=>s.supportedLabel===key).length])),
      minInferenceMs:Math.min(...detected.map(s=>s.inferenceMs)),maxInferenceMs:Math.max(...detected.map(s=>s.inferenceMs)),
      minPreparationMs:Math.min(...detected.map(s=>s.preparationMs)),maxPreparationMs:Math.max(...detected.map(s=>s.preparationMs))};
    evidence.baselineAggregate=baseline.aggregate;
    evidence.comparison={rawCorrectDelta:evidence.aggregate.rawCorrect-baseline.aggregate.rawCorrectOnDetected,
      supportedCorrectDelta:evidence.aggregate.supportedCorrect-baseline.aggregate.supportedCorrect,
      supportedOutputsDelta:evidence.aggregate.supportedOutputs-baseline.aggregate.supportedOutputs,
      changedPredictions:ss.filter(s=>s.rawLabel!==baseline.samples.find(b=>b.file===s.file).rawLabel).length};
    evidence.status='completed';
  } finally {await session.release();evidence.completedAt=new Date().toISOString();evidence.helperUnchanged=helperSha256===sha(fs.readFileSync(path.join(root,'shared/faceExpressionInput.js')));fs.writeFileSync(path.join(root,'audit/emotion-jaffe-mobilefacenet-comparison-2026-10-08.json'),JSON.stringify(evidence,null,2)+'\n');}
  console.log(JSON.stringify({status:evidence.status,helperUnchanged:evidence.helperUnchanged,aggregate:evidence.aggregate,comparison:evidence.comparison}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
