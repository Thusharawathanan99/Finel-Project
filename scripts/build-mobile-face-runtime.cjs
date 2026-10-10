// Regenerate after changing shared/localFaceRuntime.js or the bundled models.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const esbuild = require(path.join(root, '1-ui-ux/node_modules/esbuild'));
async function main() {
  const modelDir = path.join(root, '1-ui-ux/public/models/face-api');
  const files = {}, assets = [];
  for (const name of ['tiny_face_detector', 'face_expression', 'face_landmark_68_tiny', 'ssd_mobilenetv1', 'face_landmark_68']) {
    const filename = name + '_model-weights_manifest.json';
    const bytes = fs.readFileSync(path.join(modelDir, filename));
    const manifest = JSON.parse(bytes);
    files[filename] = { json: manifest };
    assets.push({ name: filename, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    for (const group of manifest) for (const shard of group.paths) {
      if (!/^[a-z0-9_-]+$/.test(shard)) throw Error('Invalid model shard');
      const buffer = fs.readFileSync(path.join(modelDir, shard));
      files[shard] = { base64: buffer.toString('base64') };
      assets.push({ name: shard, bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') });
    }
  }
  const runtime = await esbuild.build({ stdin: {contents:fs.readFileSync(path.join(root, 'shared/localFaceRuntime.js'),'utf8'),loader:'js',resolveDir:path.join(root,'shared')}, bundle: true, write: false,
    format: 'iife', globalName: 'CareConnectLiveRuntime', platform: 'browser', minify: true, target: 'es2020' });
  const vendorDir = path.join(root, 'shared/vendor/face-runtime');
  const vendor = JSON.parse(fs.readFileSync(path.join(vendorDir, 'manifest.json')));
  const wasmAssets = {};
  for (const asset of vendor.files) {
    const bytes = fs.readFileSync(path.join(vendorDir, asset.name));
    if (bytes.length !== asset.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw Error('Runtime asset integrity mismatch');
    if (asset.name.endsWith('.wasm')) wasmAssets[asset.name] = bytes.toString('base64');
  }
  const sdk = fs.readFileSync(path.join(vendorDir, 'face-api-1.7.15.js'), 'utf8');
  const license = ['FACE_API_LICENSE', 'TENSORFLOW_LICENSE', 'MODEL_LICENSE'].map(name => fs.readFileSync(path.join(vendorDir, name), 'utf8')).join('\n');
  const worker = sdk + '\n' + runtime.outputFiles[0].text + '\n' + `
const runtime = CareConnectLiveRuntime.createLocalFaceRuntime({faceapi,scope:self});
onmessage = async ({data}) => {
  try {
    if(data.type==='init') {
      const info=await runtime.initialize({embeddedModels:${JSON.stringify(files)},wasmAssets:${JSON.stringify(wasmAssets)},preferRealtime:true,detector:'auto'});
      postMessage({type:'ready',id:0,backend:info.backend,detector:info.detector});
    } else if(data.type==='frame') {
      const frame=await runtime.analyze({...data.frame,pixels:new Uint8ClampedArray(data.frame.pixels)});
      postMessage({type:'result',id:data.id,frame});
    }
  } catch {postMessage({type:'error',id:data.id||0,code:'MODEL_UNAVAILABLE'});}
};`;
  const host = `
const source='careconnect-live-face';let ready=false,busy=false,worker;
function send(data){const value={source,...data};if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(value));else parent.postMessage(value,'*');}
window.CareConnectFace={receive:async packet=>{
  if(packet?.type==='dispose'){ready=false;busy=false;worker?.terminate();worker=null;return;}
  const id=packet?.id;
  if(packet?.type!=='analyze'||!Number.isSafeInteger(id)||id<1)return;
  if(!ready||busy){send({type:'error',id,code:busy?'BUSY':'MODEL_UNAVAILABLE'});return;}
  const image=packet.image;
  if(packet.detector!==undefined&&!['auto','tiny','ssd'].includes(packet.detector)){send({type:'error',id,code:'INVALID_FRAME'});return;}
  if(!image||typeof image.dataUri!=='string'||image.dataUri.length>4000000||!/^data:image\\/(jpeg|png);base64,[a-zA-Z0-9+/=]+$/.test(image.dataUri)||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width*image.height>4000000){send({type:'error',id,code:'INVALID_FRAME'});return;}
  busy=true;
  try{
    const bitmap=new Image();
    await new Promise((resolve,reject)=>{bitmap.onload=resolve;bitmap.onerror=reject;bitmap.src=image.dataUri;});
    if(bitmap.naturalWidth!==image.width||bitmap.naturalHeight!==image.height)throw Error('INVALID_FRAME');
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('UNSUPPORTED');
    context.drawImage(bitmap,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
    worker.postMessage({type:'frame',id,frame:{width:image.width,height:image.height,pixels:pixels.buffer,capturedAt:image.capturedAt||new Date().toISOString(),detector:packet.detector||'auto'}},[pixels.buffer]);
    canvas.width=canvas.height=1;
  }catch{busy=false;send({type:'error',id,code:'INVALID_FRAME'});}
}};
addEventListener('message',event=>{if(event.source===parent)window.CareConnectFace.receive(event.data);});
addEventListener('pagehide',()=>worker?.terminate());
try{
  if(typeof Worker!=='function')throw Error('UNSUPPORTED');
  const url=URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'}));worker=new Worker(url);URL.revokeObjectURL(url);
  worker.onmessage=({data})=>{if(data.type==='ready')ready=true;else busy=false;send(data);};
  worker.onerror=()=>{busy=false;ready=false;send({type:'error',id:0,code:'MODEL_UNAVAILABLE'});};
  worker.postMessage({type:'init',id:0});
}catch{send({type:'error',id:0,code:'MODEL_UNAVAILABLE'});}`;
  new Function(host); // Fail generation if any embedded host syntax is invalid.
  new Function(worker);
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'wasm-unsafe-eval\' blob:; worker-src blob:; img-src data: blob:; connect-src \'none\'; style-src \'unsafe-inline\'">' +
    '</head><body><!-- face-api.js and model license:\n' + license + '\n--><script>' + host.replace(/<\/script/gi, '<\\/script') + '</script></body></html>';
  const destination = path.join(root, '5-patient/src/generated');
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'liveFaceRuntime.js'), '// Generated by scripts/build-mobile-face-runtime.cjs. Offline model assets; do not edit by hand.\n' +
    'export const LIVE_FACE_HTML = ' + JSON.stringify(html) + ';\n' + 'export const LIVE_FACE_MODEL_ASSETS = ' + JSON.stringify(assets) + ';\n' +
    'export const LIVE_FACE_ACCELERATION_ASSETS = ' + JSON.stringify(vendor) + ';\n');
  console.log('Offline mobile face runtime generated: ' + Buffer.byteLength(html) + ' bytes; ' + assets.length + ' verified model files.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
