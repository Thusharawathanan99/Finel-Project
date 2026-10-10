// Loopback-only verification of the exact mobile HTML and its CSP. Uses a
// public NASA portrait, never a camera, account, patient record or cloud service.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '5-patient/src/generated/liveFaceRuntime.js'), 'utf8');
const html = JSON.parse(source.split('\n').find(line => line.startsWith('export const LIVE_FACE_HTML = ')).slice('export const LIVE_FACE_HTML = '.length, -1));
const page = `<!doctype html><meta charset="utf-8"><title>CareConnect mobile acceleration verification</title>
<style>body{background:#102d2b;color:#eef9f4;font:16px system-ui;margin:24px}img{width:180px;border-radius:16px}pre{white-space:pre-wrap;line-height:1.6}</style>
<h1>CareConnect mobile acceleration verification</h1><p>Exact APK runtime. Public NASA portrait. No camera, login, cloud or patient data.</p>
<img id="portrait" src="/fixture.png" alt="Public NASA test portrait"><pre id="output">Loading…</pre>
<iframe title="Exact mobile runtime" src="/mobile.html" style="width:1px;height:1px;opacity:.01" sandbox="allow-scripts allow-same-origin"></iframe>
<script>
const iframe=document.querySelector('iframe'),output=document.getElementById('output');let backend,ready=false,id=0,pending;
const image=document.querySelector('img');const loaded=new Promise(resolve=>{if(image.complete)resolve();else image.onload=resolve;});
const cases=[], startedAt=new Date().toISOString();
function analyze(dataUri,width,height,detector){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending=null;reject(Error('Inference timeout'));},20000);const requestId=++id,started=performance.now();pending={id:requestId,resolve:frame=>{clearTimeout(timeout);resolve({frame,bridgeRoundTripMs:performance.now()-started});},reject:error=>{clearTimeout(timeout);reject(error);}};iframe.contentWindow.postMessage({type:'analyze',id:requestId,image:{dataUri,width,height,capturedAt:new Date().toISOString()},detector},location.origin);});}
async function run(){await loaded;try{const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const dataUri=canvas.toDataURL('image/jpeg',.88);
for(const detector of ['auto','tiny','ssd'])for(let round=0;round<2;round++){const result=await analyze(dataUri,512,512,detector);const f=result.frame;if(f.faces.length!==1||Object.keys(f.faces[0].scores).length!==7||f.faces[0].landmarks.length!==68)throw Error('Invalid model output');cases.push({detector,round,faceCount:f.faces.length,modelMs:f.processingTimeMs,bridgeRoundTripMs:result.bridgeRoundTripMs});output.textContent=JSON.stringify({backend,cases},null,2);}
canvas.width=640;canvas.height=480;ctx.fillStyle='#333';ctx.fillRect(0,0,640,480);ctx.drawImage(image,256,176,128,128);for(let round=0;round<2;round++){const result=await analyze(canvas.toDataURL('image/jpeg',.88),640,480,'auto');if(result.frame.faces.length!==1||result.frame.detector!=='ssd')throw Error('Adaptive distant-face check failed');cases.push({detector:'auto-distant',round,actualDetector:result.frame.detector,faceCount:result.frame.faces.length,modelMs:result.frame.processingTimeMs,bridgeRoundTripMs:result.bridgeRoundTripMs});}
const result={status:'passed',backend,startedAt,completedAt:new Date().toISOString(),cases,method:'Exact embedded mobile WebView HTML in desktop browser, including JPEG decode and bridge; excludes native camera and physical phone'};output.textContent='PASS\\n'+JSON.stringify(result,null,2);await fetch('/evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
}catch(error){output.textContent='FAIL '+error.message;}finally{iframe.contentWindow.postMessage({type:'dispose'},location.origin);}}
addEventListener('message',({source,data})=>{if(source!==iframe.contentWindow||data.source!=='careconnect-live-face')return;if(data.type==='ready'&&!ready){ready=true;backend=data.backend;run();}else if(data.type==='result'&&pending?.id===data.id){const request=pending;pending=null;request.resolve(data.frame);}else if(data.type==='error'){pending?.reject(Error(data.code));pending=null;output.textContent='FAIL '+data.code;}});
</script>`;
http.createServer((req, res) => {
  if (req.url === '/' && req.method === 'GET') { res.setHeader('Content-Type', 'text/html'); res.end(page); }
  else if (req.url === '/mobile.html' && req.method === 'GET') { res.setHeader('Content-Type', 'text/html'); res.end(html); }
  else if (req.url === '/fixture.png' && req.method === 'GET') { res.setHeader('Content-Type', 'image/png'); res.end(fs.readFileSync(path.join(root, '.cache/face-evaluation/astronaut.png'))); }
  else if (req.url === '/evidence' && req.method === 'POST') {
    let body = ''; req.on('data', chunk => { body += chunk; if (body.length > 20000) req.destroy(); });
    req.on('end', () => { try { const value = JSON.parse(body); if (value.status !== 'passed' || value.backend !== 'wasm' || value.cases?.length !== 8) throw Error('Invalid evidence');
      fs.writeFileSync(path.join(root, 'audit/face-wasm-browser-verification.json'), JSON.stringify(value, null, 2) + '\n'); res.end('Saved');
    } catch { res.statusCode = 400; res.end('Invalid evidence'); } });
  } else { res.statusCode = 404; res.end('Not found'); }
}).listen(8796, '127.0.0.1', () => console.log('Mobile runtime verification: http://127.0.0.1:8796/'));
