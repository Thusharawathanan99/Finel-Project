const assert=require('node:assert/strict');
const {load,hooks,nodes,handler,apiDefaults}=require('./web-regression.cjs');
let count=0;
const textOf=tree=>{const walk=n=>Array.isArray(n)?n.map(walk).join(' '):n&&typeof n==='object'?walk(n.props?.children):n??'';return walk(tree);};
async function check(name,fn){await fn();count++;console.log('PASS '+name);}
async function main(){
 globalThis.fakeAuth={currentUser:{uid:'A'}};
 const {FaceCareHelpPanel}=await load('1-ui-ux/src/app/components/FaceCareHelpPanel.tsx');
 const {getFaceCareCopy}=await load('shared/faceCare.js');
 const {getPatientSymptomsCopy,buildPatientSymptomHelpMessage,PATIENT_SYMPTOM_KEYS}=await load('shared/patientSymptoms.js');
 const setup=(initial={})=>{globalThis.fakeAuth.currentUser={uid:'A'};globalThis.fakeApi=apiDefaults();globalThis.hooks=hooks(initial);return()=>{globalThis.hooks.reset();return FaceCareHelpPanel({residentId:'R1',residentName:'Local fixture',language:initial.language||'en'});};};
 await check('Urgent reports send selected patient concerns and no inferred face data',async()=>{
  const render=setup({0:['chestPain','breathingDifficulty'],1:'Reported just now'});let sent,options;
  globalThis.fakeApi.sos.create=async(body,requestOptions)=>{sent=body;options=requestOptions;return{saved:true,alertId:41,isResolved:false};};
  await handler(render(),'sendUrgentHelp')();assert.equal(sent.residentId,'R1');assert.equal(sent.message,buildPatientSymptomHelpMessage(['chestPain','breathingDifficulty'],'en','Reported just now'));assert.match(sent.requestId,/^[a-f0-9-]{36}$/);assert.ok(options.signal instanceof AbortSignal);assert.deepEqual(Object.keys(sent).sort(),['message','requestId','residentId']);assert.equal(globalThis.hooks.values[2],'saved');assert.match(textOf(render()),/#\s*41/);
 });
 await check('Explicit help works without waiting for a face, score or selected symptom',async()=>{
  const render=setup();let calls=0;globalThis.fakeApi.sos.create=async body=>{calls++;assert.match(body.message,/urgent help/i);return{saved:true,alertId:3};};await handler(render(),'sendUrgentHelp')();assert.equal(calls,1);assert.equal(globalThis.hooks.values[2],'saved');
 });
 await check('Failed or lost-response retry preserves UUID and prevents overlapping requests',async()=>{
  const render=setup({0:['faceDrooping']});let finish;const writes=[];
  globalThis.fakeApi.sos.create=body=>{writes.push(body);return new Promise((resolve,reject)=>{finish=reject;});};const pending=handler(render(),'sendUrgentHelp')();await handler(render(),'sendUrgentHelp')();assert.equal(writes.length,1);finish(Error('offline'));await pending;assert.equal(globalThis.hooks.values[2],'failed');globalThis.fakeApi.sos.create=async body=>{writes.push(body);return{saved:true,alertId:8};};await handler(render(),'sendUrgentHelp')();assert.equal(writes[0].requestId,writes[1].requestId);assert.equal(writes[0].message,writes[1].message);
 });
 await check('Changed reported details receive a new UUID after a failed request',async()=>{
  const render=setup({0:['chestPain']});const writes=[];globalThis.fakeApi.sos.create=async body=>{writes.push(body);throw Error('offline');};await handler(render(),'sendUrgentHelp')();globalThis.hooks.values[0]=['collapse'];await handler(render(),'sendUrgentHelp')();assert.notEqual(writes[0].requestId,writes[1].requestId);
 });
 await check('A stalled request times out, releases retry and ignores a late saved receipt',async()=>{
  const originalSetTimeout=globalThis.setTimeout,originalClearTimeout=globalThis.clearTimeout;
  try{
   let expire,finish;const writes=[];globalThis.setTimeout=(fn,delay)=>{assert.equal(delay,15000);expire=fn;return 1;};globalThis.clearTimeout=()=>{};
   const render=setup();globalThis.fakeApi.sos.create=(body,options)=>{writes.push(body);return new Promise(resolve=>{finish=resolve;});};
   const pending=handler(render(),'sendUrgentHelp')();expire();await pending;assert.equal(globalThis.hooks.values[2],'failed');assert.equal(globalThis.hooks.values[3],null);
   finish({saved:true,alertId:81});await Promise.resolve();assert.equal(globalThis.hooks.values[2],'failed');
   globalThis.fakeApi.sos.create=async body=>{writes.push(body);return{saved:true,alertId:81,replayed:true};};await handler(render(),'sendUrgentHelp')();assert.equal(writes[0].requestId,writes[1].requestId);assert.equal(globalThis.hooks.values[2],'saved');
  }finally{globalThis.setTimeout=originalSetTimeout;globalThis.clearTimeout=originalClearTimeout;}
 });
 await check('Malformed receipts never claim that urgent help was saved',async()=>{
  for(const response of [{alertId:1},{saved:true,alertId:0},{saved:true,alertId:'2'},{saved:false,alertId:9}]){const render=setup();globalThis.fakeApi.sos.create=async()=>response;await handler(render(),'sendUrgentHelp')();assert.equal(globalThis.hooks.values[2],'failed');assert.equal(globalThis.hooks.values[3],null);}
 });
 await check('Account changes discard a late urgent receipt and unauthenticated help sends nothing',async()=>{
  let render=setup(),finish;globalThis.fakeApi.sos.create=()=>new Promise(resolve=>{finish=resolve;});const pending=handler(render(),'sendUrgentHelp')();globalThis.fakeAuth.currentUser={uid:'B'};finish({saved:true,alertId:4});await pending;assert.notEqual(globalThis.hooks.values[2],'saved');render=setup();globalThis.fakeAuth.currentUser=null;let calls=0;globalThis.fakeApi.sos.create=async()=>{calls++;};await handler(render(),'sendUrgentHelp')();assert.equal(calls,0);
 });
 await check('Resolved replay is labeled resolved and a deliberate new request gets a new UUID',async()=>{
  const render=setup();const writes=[];globalThis.fakeApi.sos.create=async body=>{writes.push(body);return{saved:true,alertId:7,isResolved:true,replayed:true};};await handler(render(),'sendUrgentHelp')();assert.equal(globalThis.hooks.values[2],'resolved');assert.ok(textOf(render()).includes(getFaceCareCopy('en').resolvedMessage));handler(render(),'startNewUrgentHelp')();await handler(render(),'sendUrgentHelp')();assert.notEqual(writes[0].requestId,writes[1].requestId);
 });
 await check('All languages preserve direct ambulance action and honest saved wording',async()=>{
  for(const language of ['en','ta','si']){const render=setup({language});const t=getFaceCareCopy(language),symptomCopy=getPatientSymptomsCopy(language),tree=render();assert.ok(textOf(tree).includes(symptomCopy.notDiagnosis));assert.ok(textOf(tree).includes(symptomCopy.noSelection));assert.equal(nodes(tree,n=>n.props?.href==='tel:1990').length,1);globalThis.fakeApi.sos.create=async()=>({saved:true,alertId:6});await handler(tree,'sendUrgentHelp')();assert.ok(textOf(render()).includes(t.savedMessage));}
 });
 await check('Every urgent manually selected symptom shows local guidance before any request and without a camera',()=>{
  for(const language of ['en','ta','si'])for(const symptom of PATIENT_SYMPTOM_KEYS){const render=setup({0:[symptom],language});let writes=0;globalThis.fakeApi.sos.create=async()=>{writes++;};const tree=render(),t=getPatientSymptomsCopy(language);assert.ok(textOf(tree).includes(t.urgentTitle));assert.ok(textOf(tree).includes(t.guidance));assert.ok(textOf(tree).includes(t.symptoms[symptom]));assert.equal(nodes(tree,n=>n.type==='input'&&n.props.type==='checkbox').length,14);assert.equal(writes,0);assert.equal(nodes(tree,n=>n.props['data-testid']==='patient-symptom-guidance')[0].props.role,'alert');}
 });
 await check('An unavailable symptom export gives localized failure without inventing a saved receipt',()=>{
  const render=setup({0:['severeHeadache'],language:'ta'});handler(render(),'downloadSymptomReport')();assert.ok(textOf(render()).includes(getPatientSymptomsCopy('ta').shareFailed));assert.equal(globalThis.hooks.values[2],'idle');assert.equal(globalThis.hooks.values[3],null);
 });
 await check('A changed account cannot send or export previous-account symptom selections before effects reset',async()=>{
  let render=setup({0:['chestPain'],1:'Private note'}),tree=render(),writes=0;globalThis.fakeApi.sos.create=async()=>{writes++;return{saved:true,alertId:91};};globalThis.fakeAuth.currentUser={uid:'B'};await handler(tree,'sendUrgentHelp')();assert.equal(writes,0);assert.deepEqual(globalThis.hooks.values[0],[]);assert.equal(globalThis.hooks.values[1],'');render=setup({0:['faceDrooping'],1:'Old account note'});tree=render();globalThis.fakeAuth.currentUser={uid:'B'};handler(tree,'downloadSymptomReport')();assert.deepEqual(globalThis.hooks.values[0],[]);assert.equal(globalThis.hooks.values[1],'');
 });
 await check('Browsers without randomUUID still send securely generated retry identifiers',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  try{Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues(bytes){bytes.fill(17);return bytes;}}});const render=setup();let body;globalThis.fakeApi.sos.create=async value=>{body=value;return{saved:true,alertId:9};};await handler(render(),'sendUrgentHelp')();assert.match(body.requestId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.equal(globalThis.hooks.values[2],'saved');}
  finally{if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;}
 });
 await check('Unavailable secure randomness cannot produce a weak identifier or false success',async()=>{
  const {createUrgentRequestId}=await load('shared/urgentRequestId.js');assert.throws(()=>createUrgentRequestId({}),/SECURE_RANDOM_UNAVAILABLE/);assert.throws(()=>createUrgentRequestId({randomUUID:()=> 'patient-name'}),/SECURE_RANDOM_UNAVAILABLE/);
 });
 console.log(count+' urgent-help website regression scenarios passed; no real alert sent.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
