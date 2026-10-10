// Classifier-only comparison on immutable cached detections; no image uploads.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');const root=path.resolve(__dirname,'..');
const {PNG}=require(path.join(root,'5-patient/node_modules/pngjs'));
const {embeddedModels}=require('./evaluate-local-face-models.cjs');
const classes=['angry','disgusted','fearful','happy','neutral','sad','surprised'];
async function main(){
 const vendor=path.join(root,'shared/vendor/face-runtime'),assets={};
 for(const file of JSON.parse(fs.readFileSync(path.join(vendor,'manifest.json'))).files){const bytes=fs.readFileSync(path.join(vendor,file.name));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256);if(file.name.endsWith('.wasm'))assets[file.name]=bytes.toString('base64');}
 const context={console,setTimeout,clearTimeout,performance,TextEncoder,TextDecoder,atob,btoa,WebAssembly,Uint8Array,Uint8ClampedArray,Float32Array,Int32Array,ArrayBuffer,Response,fetch:()=>{throw Error('NETWORK_BLOCKED')},importScripts:()=>{},location:{href:'blob:private-classifier-test'}};
 context.self=context;context.globalThis=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(vendor,'face-api-1.7.15.js'),'utf8'),context);
 const api=context.faceapi,{createLocalFaceRuntime}=await import(pathToFileURL(path.join(root,'shared/localFaceRuntime.js'))),{createLiveFaceTracker}=await import(pathToFileURL(path.join(root,'shared/liveFace.js')));
 const runtime=createLocalFaceRuntime({faceapi:api,scope:context});const files=embeddedModels();await runtime.initialize({embeddedModels:files.files,wasmAssets:assets,preferRealtime:true,detector:'auto'});
 const cached=JSON.parse(fs.readFileSync(path.join(root,'.cache/emotion-evaluation/jaffe/production-frames-private.json')));
 const report={status:'running',method:'Same cached213 production face detections and68landmarks. Original aligned crop and horizontal mirror scored with unchanged classifier; equal probability average. No local training or thresholds fitted.',samples:[],maxBaselineScoreDifference:0};
 try{for(const item of cached.frames){const frame=item.frame,face=frame.faces.length===1?frame.faces[0]:null;let rawLabel=null,supportedLabel=null,scores=null,inferenceMs=null;
  if(face){const png=PNG.sync.read(fs.readFileSync(path.join(root,'.cache/emotion-evaluation/jaffe/png-private',item.file)));
   const image=api.tf.browser.fromPixels({data:new Uint8Array(png.data),width:png.width,height:png.height},3);
   let crop,mirror;
   try{const dims=new api.Dimensions(frame.width,frame.height),landmarks=new api.FaceLandmarks68(face.landmarks.map(p=>new api.Point(p.x,p.y)),dims),rect=landmarks.align();
    const aligned=new api.FaceDetection(face.detectionConfidence,rect.rescale(dims.reverse()),dims);
    [crop]=await api.extractFaceTensors(image,[aligned]);mirror=api.tf.reverse(crop,[1]);
    const at=performance.now(),original=await api.nets.faceExpressionNet.predictExpressions(crop),flipped=await api.nets.faceExpressionNet.predictExpressions(mirror);inferenceMs=performance.now()-at;
    for(const key of classes)report.maxBaselineScoreDifference=Math.max(report.maxBaselineScoreDifference,Math.abs(original[key]-face.scores[key]));
    scores=Object.fromEntries(classes.map(k=>[k,(original[k]+flipped[k])/2]));rawLabel=classes.slice().sort((a,b)=>scores[b]-scores[a])[0];
    const tracked=createLiveFaceTracker({stableFrames:1,minEvidenceMs:0}).update({...frame,faces:[{...face,scores}]});supportedLabel=tracked.faces[0].stable?tracked.faces[0].expression:null;
   }finally{mirror?.dispose();crop?.dispose();image.dispose();}}
  report.samples.push({file:item.file,expectedLabel:item.expectedLabel,rawLabel,supportedLabel,scores,inferenceMs,rawCorrect:rawLabel===item.expectedLabel,supportedCorrect:supportedLabel===item.expectedLabel});
  if(report.samples.length%50===0)console.log(JSON.stringify({done:report.samples.length}));}
  const ss=report.samples,raw=ss.filter(s=>s.rawLabel),supported=ss.filter(s=>s.supportedLabel);
  report.aggregate={images:ss.length,rawOutputs:raw.length,rawCorrect:raw.filter(s=>s.rawCorrect).length,rawAgreement:raw.filter(s=>s.rawCorrect).length/raw.length,
   supportedOutputs:supported.length,supportedCorrect:supported.filter(s=>s.supportedCorrect).length,supportedPrecision:supported.filter(s=>s.supportedCorrect).length/supported.length,
   predictionCounts:Object.fromEntries(classes.map(k=>[k,ss.filter(s=>s.rawLabel===k).length])),
   perClass:Object.fromEntries(classes.map(k=>[k,{images:ss.filter(s=>s.expectedLabel===k).length,correct:ss.filter(s=>s.expectedLabel===k&&s.rawCorrect).length}])),
   minClassifierMs:Math.min(...raw.map(s=>s.inferenceMs)),maxClassifierMs:Math.max(...raw.map(s=>s.inferenceMs))};report.status='completed';
 }finally{runtime.dispose();report.remainingTensors=api.tf.memory().numTensors;report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(root,'audit/emotion-jaffe-cached-mirror-comparison-2026-10-08.json'),JSON.stringify(report,null,2)+'\n');}
 assert.equal(report.remainingTensors,0);console.log(JSON.stringify({status:report.status,aggregate:report.aggregate,maxBaselineScoreDifference:report.maxBaselineScoreDifference}));
}main().catch(e=>{console.error(e.stack);process.exitCode=1});
