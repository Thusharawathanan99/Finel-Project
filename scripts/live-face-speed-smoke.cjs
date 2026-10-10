// Measures the actual website session with a synthetic video and bundled models.
// No camera permission, face image, account or cloud service is used.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'1-ui-ux/dist');
const esbuild=require(path.join(root,'1-ui-ux/node_modules/esbuild'));
const worker=fs.readdirSync(path.join(dist,'assets')).find(file=>/^face\.worker-.*\.js$/.test(file));
if(!worker)throw Error('Build the website first');
const sessionPath=path.join(root,'1-ui-ux/src/app/ml/live/LiveFaceSession.ts');
const source=fs.readFileSync(sessionPath,'utf8').replace("new URL('./face.worker.ts', import.meta.url)",`new URL(${JSON.stringify('/assets/'+worker)},location.href)`);
const {outputFiles}=esbuild.buildSync({stdin:{contents:source,loader:'ts',sourcefile:sessionPath,resolveDir:path.dirname(sessionPath)},bundle:true,write:false,format:'esm',platform:'browser'});
const page=`<!doctype html><meta charset="utf-8"><title>Live detection cadence check</title><h1>Live detection cadence check</h1><p>Synthetic blank video. No camera, face data, account or cloud requests. This measures cadence, not recognition accuracy.</p><video autoplay muted playsinline width="320" height="240"></video><pre id="result">Starting…</pre><script type="module">
import {startLiveFaceDetection} from '/session.js';
const output=document.getElementById('result'),video=document.querySelector('video'),canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
const context=canvas.getContext('2d');let ticks=0,drawId;
function draw(){context.fillStyle=ticks++%2?'#555':'#565656';context.fillRect(0,0,640,480);drawId=requestAnimationFrame(draw);}draw();
const stream=canvas.captureStream(30);video.srcObject=stream;await video.play();
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
const results=[];
async function run(name,minIntervalMs){return new Promise((resolve,reject)=>{
 const abort=new AbortController(),times=[],inferences=[];let backend,complete=false;
 const timeout=setTimeout(()=>{abort.abort();reject(Error('Cadence check timed out'));},90000);
 startLiveFaceDetection(video,frame=>{
  if(frame.faces.length!==0||frame.width!==640||frame.height!==480){abort.abort();clearTimeout(timeout);reject(Error('Unexpected synthetic frame'));return;}
  times.push(performance.now());inferences.push(frame.processingTimeMs);
  if(times.length===12){complete=true;abort.abort();clearTimeout(timeout);const gaps=times.slice(3).map((at,index)=>at-times[index+2]);const gap=median(gaps);resolve({name,backend,frames:times.length,medianResultIntervalMs:+gap.toFixed(1),medianInferenceMs:+median(inferences.slice(3)).toFixed(1),resultUpdatesPerSecond:+(1000/gap).toFixed(2)});}
 },status=>{if(status.backend)backend=status.backend;if(status.state==='unavailable'&&!complete){clearTimeout(timeout);reject(Error(status.code));}},{signal:abort.signal,...(minIntervalMs?{minIntervalMs}:{})}).catch(reject);
});}
try{output.textContent='Checking previous 300 ms cadence…';results.push(await run('previous-300ms',300));output.textContent=JSON.stringify(results,null,2)+'\\nChecking faster default…';results.push(await run('current-default'));output.textContent='PASS\\n'+JSON.stringify(results,null,2);}catch(error){output.textContent='FAIL '+error.message;}finally{cancelAnimationFrame(drawId);stream.getTracks().forEach(track=>track.stop());video.srcObject=null;}
</script>`;
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(page);return;}
 if(url.pathname==='/session.js'){res.setHeader('Content-Type','application/javascript');res.end(outputFiles[0].text);return;}
 const file=path.resolve(dist,'.'+url.pathname);
 if(!file.startsWith(dist+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end('Missing asset');return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.json')?'application/json':'application/octet-stream');res.end(fs.readFileSync(file));
}).listen(8768,'127.0.0.1',()=>console.log('Synthetic live cadence check: http://127.0.0.1:8768'));
