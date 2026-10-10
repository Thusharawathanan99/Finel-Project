// Browser smoke check of the actual bundled models, using a blank synthetic image.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'1-ui-ux/dist');
const esbuild=require(path.join(root,'1-ui-ux/node_modules/esbuild'));
const {outputFiles}=esbuild.buildSync({stdin:{contents:fs.readFileSync(path.join(root,'5-patient/src/generated/liveFaceRuntime.js'),'utf8'),loader:'js'},write:false,format:'cjs'});
const holder={exports:{}};new Function('exports','module',outputFiles[0].text)(holder.exports,holder);
const worker=fs.readdirSync(path.join(dist,'assets')).find(file=>/^face\.worker-.*\.js$/.test(file));
if(!worker)throw Error('Build the website first');
const page=`<!doctype html><meta charset="utf-8"><title>Live face runtime verification</title><h1>Live face runtime verification</h1><p>Blank synthetic pixels only. No camera, account, patient data or cloud requests.</p><pre id="web">Website: loading</pre><pre id="mobile">Mobile offline runtime: loading</pre><iframe title="Offline mobile model" src="/mobile.html" style="width:64px;height:64px;opacity:.01" sandbox="allow-scripts allow-same-origin"></iframe><script>
const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');ctx.fillStyle='#555';ctx.fillRect(0,0,320,240);
const capturedAt=new Date().toISOString();const image={dataUri:canvas.toDataURL('image/jpeg'),width:320,height:240,capturedAt};
const iframe=document.querySelector('iframe');let mobileCount=0,mobileBackend;
addEventListener('message',({source,data})=>{if(source!==iframe.contentWindow||data.source!=='careconnect-live-face')return;
 if(data.type==='ready'){mobileBackend=data.backend;iframe.contentWindow.postMessage({type:'analyze',id:1,image},location.origin);}
 else if(data.type==='result'){const frame=data.frame;document.getElementById('mobile').textContent='Mobile offline runtime: '+(frame.faces.length===0&&frame.width===320&&frame.height===240?'PASS':'FAIL')+'; '+JSON.stringify({backend:mobileBackend,faces:frame.faces.length,width:frame.width,height:frame.height,processingTimeMs:frame.processingTimeMs,round:++mobileCount});if(mobileCount===1)iframe.contentWindow.postMessage({type:'analyze',id:2,image:{...image,capturedAt:new Date().toISOString()}},location.origin);}
 else if(data.type==='error')document.getElementById('mobile').textContent='Mobile offline runtime: FAIL '+JSON.stringify(data);
});
let rounds=0,webBackend;const cpu=new URLSearchParams(location.search).has('cpu');const web=new Worker(cpu?'/cpu-worker.js':'/assets/${worker}',{type:'module'});
function sendFrame(){const pixels=ctx.getImageData(0,0,320,240).data;web.postMessage({type:'frame',id:++rounds,frame:{width:320,height:240,pixels:pixels.buffer,capturedAt:new Date().toISOString()}},[pixels.buffer]);}
web.onmessage=({data})=>{if(data.type==='bootstrap')web.postMessage({type:'init',id:0,options:{modelsPath:location.origin+'/models/face-api'}});else if(data.type==='ready'){webBackend=data.backend;sendFrame();}else if(data.type==='result'){document.getElementById('web').textContent='Website: '+(data.frame.faces.length===0?'PASS':'FAIL')+'; '+JSON.stringify({backend:webBackend,faces:data.frame.faces.length,width:data.frame.width,height:data.frame.height,processingTimeMs:data.frame.processingTimeMs,round:rounds});if(rounds===1)sendFrame();else web.terminate();}else document.getElementById('web').textContent='Website: FAIL '+JSON.stringify(data);};
web.onerror=event=>document.getElementById('web').textContent='Website: FAIL '+event.message;
if(!cpu)web.postMessage({type:'init',id:0,options:{modelsPath:location.origin+'/models/face-api'}});
</script>`;
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/cpu-worker.js'){res.setHeader('Content-Type','application/javascript');res.end('self.OffscreenCanvas=undefined;await import("/assets/${worker}");postMessage({type:"bootstrap"});'.replace('${worker}',worker));return;}
 if(url.pathname==='/mobile.html'){res.setHeader('Content-Type','text/html');res.end(holder.exports.LIVE_FACE_HTML);return;}
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(page);return;}
 const file=path.resolve(dist,'.'+url.pathname);
 if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end('Missing asset');return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.json')?'application/json':'application/octet-stream');res.end(fs.readFileSync(file));
}).listen(8767,'127.0.0.1',()=>console.log('Synthetic model smoke check: http://127.0.0.1:8767'));
