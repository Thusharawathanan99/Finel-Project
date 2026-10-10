// Real local startup/schema/auth-boundary smoke. No accounts, records, camera,
// inference or notification delivery are created or contacted by this script.
const {spawn}=require('node:child_process');
const {resolve}=require('node:path');
const assert=require('node:assert/strict');
const port=Number(process.env.SMOKE_API_PORT||3097);
const child=spawn(process.execPath,['index.js'],{cwd:resolve(__dirname,'../4-system-engine/api'),windowsHide:true,
  env:{...process.env,API_PORT:String(port),BACKGROUND_WORKERS_ENABLED:'false',PUSH_NOTIFICATIONS_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',part=>{logs+=part.toString();});child.stderr.on('data',part=>{logs+=part.toString();});
async function main(){
  const base=`http://127.0.0.1:${port}/api`;let started=false;
  for(let i=0;i<60;i++){
    if(child.exitCode!==null)throw Error('API failed to start: '+logs);
    if(logs.includes('API server running')){started=true;break;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(started,'API did not announce startup');
  const evidence=[];
  const health=await fetch(base+'/health');const state=await health.json();assert.equal(health.status,200);assert.equal(state.status,'ready');
  evidence.push({check:'database-schema-and-auth-readiness',status:health.status});
  for(const path of ['/monitoring/devices','/monitoring/incidents','/push-devices','/residents/not-a-resident/medication-reminders','/edge/config','/edge/health']){
    const response=await fetch(base+path,{method:path==='/edge/health'?'POST':'GET',headers:{'Content-Type':'application/json'},...(path==='/edge/health'?{body:'{}'}:{})});
    assert.equal(response.status,401,`Unauthenticated access must fail on ${path}`);evidence.push({check:path,status:response.status});
  }
  const forged=await fetch(base+'/edge/config',{headers:{Authorization:'Bearer '+ 'a'.repeat(43)}});assert.equal(forged.status,403);evidence.push({check:'unregistered-device-token',status:forged.status});
  console.log(JSON.stringify({checks:evidence.length,passed:true,evidence},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>child.kill());
