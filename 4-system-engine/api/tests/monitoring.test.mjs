import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {recordActivityEvent,hasForbiddenEvidence,hasActiveConsent,sha256} from '../monitoringService.js';
import {DEFAULT_SETTINGS,validInstant,validatedSettings,validPolygon} from '../monitoringConfig.js';
import {canonicalJSON} from '../validation.js';
import {runMonitoringMaintenance} from '../monitoringMaintenance.js';
import {normalizeBaseline,evaluateBehaviorSignals,runResidentAnomalies} from '../behaviorAnomalies.js';
const api=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const payload={requestId:'event-test-0001',residentId:'R-A',activity:'fall',confidence:0.85,observedAt:new Date().toISOString(),modelVersion:'pose-rules-v1',evidence:{durationMs:1200,trackId:1}};
function database({state='running',consent=true,withdrawn=false,regranted=false,duplicate=null,assigned=['R-A'],assignedAt=null}={}) {
  const ops=[]; const pool={
    async getConnection(){return this;},async beginTransaction(){ops.push('begin');},async commit(){ops.push('commit');},async rollback(){ops.push('rollback');},release(){ops.push('release');},
    async execute(sql,values=[]){ops.push({sql,values});
      if(sql.includes('SELECT device_id, enabled'))return [[{device_id:'CAM-A',enabled:1,status:'online',camera_state:state}]];
      if(sql.includes('FROM activity_events WHERE device_id'))return [duplicate?[duplicate]:[]];
      if(sql.includes('FROM monitoring_device_residents'))return [assigned.map(resident_id=>({resident_id,assigned_at:assignedAt}))];
      if(sql.includes('FROM monitoring_consents')){
        if(sql.includes("status='withdrawn'"))return [regranted?[{consent_id:2}]:[]];
        const current=values[2].getTime()>Date.parse(payload.observedAt)+1;
        return [[{status:consent && !(withdrawn&&current)?'granted':'withdrawn',expires_at:null}]];
      }
      if(sql.startsWith('INSERT'))return [{insertId:7}];
      if(sql.startsWith('UPDATE'))return [{affectedRows:1}];
      throw Error('Unexpected SQL '+sql);
    }
  };return {pool,ops};
}
test('fall creates one auditable critical incident without image evidence',async()=>{
  const {pool,ops}=database();const r=await recordActivityEvent(pool,{device_id:'CAM-A'},payload);
  assert.equal(r.status,201);assert.equal(r.body.incidentId,7);assert.equal(r.body.requiresHumanReview,true);
  const writes=ops.filter(x=>x.sql);assert.equal(writes.filter(x=>x.sql.includes('INSERT INTO activity_events')).length,1);
  assert.equal(writes.find(x=>x.sql.includes('INSERT INTO monitoring_incidents')).values[4],'critical');
  assert.ok(ops.includes('commit'));assert.equal(ops.at(-1),'release');
});
test('low confidence fall is retained as observation without emergency conclusion',async()=>{
  const {pool,ops}=database();const r=await recordActivityEvent(pool,{device_id:'CAM-A'},{...payload,confidence:0.3});
  assert.equal(r.status,201);assert.equal(r.body.requiresHumanReview,false);assert.ok(!ops.some(x=>x.sql?.includes('INSERT INTO monitoring_incidents')));
});
test('paused or stopped camera rejects events before writing',async()=>{
  for(const state of ['paused','stopped']){const {pool,ops}=database({state});assert.equal((await recordActivityEvent(pool,{device_id:'CAM-A'},payload)).status,403);assert.ok(!ops.some(x=>x.sql?.startsWith('INSERT')));}
});
test('missing consent rejects pose events and preserves transactional rollback',async()=>{
  const {pool,ops}=database({consent:false});assert.equal((await recordActivityEvent(pool,{device_id:'CAM-A'},payload)).status,403);assert.ok(ops.includes('rollback'));assert.ok(!ops.some(x=>x.sql?.startsWith('INSERT')));
});
test('current withdrawal rejects delayed queued observations even if capture consent was granted',async()=>{
  const {pool}=database({withdrawn:true});const old={...payload,observedAt:new Date(Date.now()-60_000).toISOString()};
  pool.execute=async(sql,values=[])=>{
    if(sql.includes('SELECT device_id, enabled'))return [[{enabled:1,status:'online',camera_state:'running'}]];
    if(sql.includes('FROM activity_events'))return [[]];
    if(sql.includes('FROM monitoring_device_residents'))return [[{resident_id:'R-A'}]];
    if(sql.includes('FROM monitoring_consents'))return [[{status:values[2].getTime()<Date.now()-30_000?'granted':'withdrawn'}]];
    throw Error('Unexpected write');
  };
  assert.equal((await recordActivityEvent(pool,{device_id:'CAM-A'},old)).status,403);
});
test('regrant never resurrects queued data invalidated by a withdrawal',async()=>{
  const {pool,ops}=database({regranted:true});
  assert.equal((await recordActivityEvent(pool,{device_id:'CAM-A'},payload)).status,403);
  assert.ok(!ops.some(x=>x.sql?.startsWith('INSERT')));
});
test('delayed observation cannot be attributed to a newly assigned resident',async()=>{
  const {pool,ops}=database({assignedAt:new Date(Date.parse(payload.observedAt)+10_000)});
  assert.equal((await recordActivityEvent(pool,{device_id:'CAM-A'},payload)).status,403);
  assert.ok(!ops.some(x=>x.sql?.startsWith('INSERT')));
});
test('same request and evidence returns original event without another incident',async()=>{
  const {pool,ops}=database({duplicate:{event_id:'original',request_hash:sha256(canonicalJSON(payload))}});
  const result=await recordActivityEvent(pool,{device_id:'CAM-A'},payload);assert.equal(result.status,200);assert.equal(result.body.event_id,'original');assert.equal(result.body.replayed,true);assert.ok(!ops.some(x=>x.sql?.startsWith('INSERT')));assert.equal(result.body.request_hash,undefined);
});
test('reused event request ID with changed confidence conflicts',async()=>{
  const {pool}=database({duplicate:{event_id:'original',request_hash:sha256(canonicalJSON(payload))}});
  assert.equal((await recordActivityEvent(pool,{device_id:'CAM-A'},{...payload,confidence:0.95})).status,409);
});
test('multiple residents cannot be guessed from a camera assignment',async()=>{
  const {pool}=database({assigned:['R-A','R-B']});const {residentId,...unlinked}=payload;
  assert.equal((await recordActivityEvent(pool,{device_id:'CAM-A'},unlinked)).status,409);
});
test('anonymous multiperson observation never becomes an attributed fall',async()=>{
  const {pool,ops}=database({assigned:['R-A','R-B']});const {residentId,...unlinked}=payload;
  const result=await recordActivityEvent(pool,{device_id:'CAM-A'},{...unlinked,activity:'unknown'});
  assert.equal(result.status,201);assert.equal(result.body.residentId,null);assert.equal(result.body.requiresHumanReview,false);
  assert.ok(!ops.some(x=>x.sql?.includes('INSERT INTO monitoring_incidents')));
});
test('raw images and nested video cannot enter evidence',()=>{
  for(const evidence of [{image:'pixels'},{pose:{snapshot:'pixels'}},{array:[{rawVideo:'pixels'}]},
    {sample:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='},{sample:'https://camera.example/room.jpg'},
    {sample:'iVBORw0KGgoAAAANSUhEUgAAAAUA'}])assert.equal(hasForbiddenEvidence(evidence),true);
  assert.equal(hasForbiddenEvidence({trackId:1,hipY:0.7,durationMs:900}),false);
});
test('expired/latest withdrawn consent fails closed',async()=>{
  const db={execute:async()=>[[{status:'granted',expires_at:new Date(Date.now()-1)}]]};assert.equal(await hasActiveConsent(db,'R-A','camera'),false);
});
test('timestamps require timezone and configuration cannot disable visibility safeguards',()=>{
  assert.equal(validInstant('2026-10-09T08:00:00'),false);assert.equal(validInstant('2026-10-09T08:00:00+05:30'),true);
  assert.throws(()=>validatedSettings({minPoseVisibility:0}));assert.throws(()=>validatedSettings({enabledActivities:['invented']}));
  assert.equal(validPolygon([[0,0],[1,0],[0,1]]),true);assert.equal(validPolygon([[0,0],[2,0],[0,1]]),false);
});
test('backend defaults retain supported edge temporal thresholds',()=>{
  assert.equal(DEFAULT_SETTINGS.minPoseVisibility,0.75);assert.equal(DEFAULT_SETTINGS.fallDropThreshold,0.4);
  assert.equal(DEFAULT_SETTINGS.eventIntervalSeconds,30);
  assert.deepEqual(validatedSettings(DEFAULT_SETTINGS),DEFAULT_SETTINGS);
});
async function loadRoutes(execute, name='monitoring') {
  const routes=[],statements=[];
  const pool={execute:async(sql,values=[])=>{statements.push({sql,values});return execute?execute(sql,values):[[]];},getConnection:async()=>pool,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{}};
  const Router=()=>{const router={use:()=>{}};for(const method of ['get','post','put','delete'])router[method]=(path,fn)=>{routes.push({method,path,fn});return router;};return router;};
  const context=createContext({console,Date,Buffer,process});const cache=new Map();
  const synth=(key,exports)=>{if(!cache.has(key))cache.set(key,new SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v);},{context}));return cache.get(key);};
  const linker=async(spec,parent)=>{
    if(spec==='express')return synth(spec,{Router});
    if(spec==='../db.js')return synth(spec,{default:pool});
    if(spec==='../middleware/authorization.js')return synth(spec,{canAccessResident:(req,id)=>Boolean(id)&&(req.user.role==='admin'||req.residentScope.includes(id))});
    if(spec.startsWith('.'))return readModule(resolve(dirname(parent.identifier),spec));return synth(spec,await import(spec));
  };
  const readModule=async file=>{if(cache.has(file))return cache.get(file);const mod=new SourceTextModule(await readFile(file,'utf8'),{context,identifier:file});cache.set(file,mod);return mod;};
  const mod=await readModule(resolve(api,`routes/${name}.js`));await mod.link(linker);await mod.evaluate();return{routes,statements};
}
const request=(role='patient',id='R-A',body={})=>({user:{uid:'verified-user',role,profile:{name:'User'}},residentScope:['R-A'],params:{id},body,query:{}});
const response=()=>({statusCode:200,status(code){this.statusCode=code;return this;},json(data){this.data=data;return this;}});
test('patients cannot enumerate cameras or mutate incident workflow',async()=>{
  const loaded=await loadRoutes();for(const [method,path]of [['get','/devices'],['post','/devices'],['get','/incidents'],['post','/incidents/:id/actions']]){const res=response();await loaded.routes.find(x=>x.method===method&&x.path===path).fn(request(),res);assert.equal(res.statusCode,403);}assert.equal(loaded.statements.length,0);
});
test('consent for another resident is denied before a database read',async()=>{
  const loaded=await loadRoutes();const res=response();await loaded.routes.find(x=>x.path==='/residents/:id/consents'&&x.method==='get').fn(request('patient','R-B'),res);assert.equal(res.statusCode,403);assert.equal(loaded.statements.length,0);
});
test('staff cannot invent resident consent without explicit confirmation and written reference',async()=>{
  const loaded=await loadRoutes();const res=response();await loaded.routes.find(x=>x.path==='/residents/:id/consents'&&x.method==='post').fn(request('caretaker','R-A',{scope:'camera',status:'granted',language:'en',subjectRole:'resident',confirmed:true}),res);assert.equal(res.statusCode,400);assert.equal(loaded.statements.length,0);
});
test('caretaker incident decisions cannot use forged actor attribution or unassigned resident',async()=>{
  const loaded=await loadRoutes(()=>[[{incident_id:1,resident_id:'R-B',device_id:'CAM-A',status:'open'}]]);const res=response();await loaded.routes.find(x=>x.path==='/incidents/:id/actions').fn(request('caretaker','1',{action:'resolved',notes:'Verified',actorUid:'forged'}),res);assert.equal(res.statusCode,403);assert.ok(!loaded.statements.some(x=>/^UPDATE|^INSERT/.test(x.sql)));
});
test('corrected anonymous incidents obey their current resident scope for reads and actions',async()=>{
  for(const method of ['get','post']){
    const loaded=await loadRoutes(()=>[[{incident_id:1,resident_id:null,corrected_resident_id:'R-B',device_id:'CAM-A',status:'open'}]]);
    const res=response();await loaded.routes.find(x=>x.method===method&&x.path==='/incidents/:id/actions').fn(request('caretaker','1',{action:'resolved',notes:'Verified'}),res);
    assert.equal(res.statusCode,403);assert.ok(!loaded.statements.some(x=>/^UPDATE|^INSERT/.test(x.sql)));
  }
});
test('incident listing does not treat corrected residents as anonymous cameras',async()=>{
  const loaded=await loadRoutes();const res=response();await loaded.routes.find(x=>x.method==='get'&&x.path==='/incidents').fn(request('caretaker'),res);
  assert.equal(res.statusCode,200);assert.ok(loaded.statements.some(x=>x.sql.includes('OR COALESCE(i.corrected_resident_id,i.resident_id) IS NULL')));
});
test('resident correction also moves the source observation and audits the corrected resident',async()=>{
  const incident={incident_id:1,event_id:'event-A',resident_id:'R-A',device_id:'CAM-A',status:'open',detected_at:new Date()};
  const loaded=await loadRoutes(sql=>sql.includes('FROM monitoring_device_residents')?[[{resident_id:'R-C',assigned_at:new Date(0)}]]:
    sql.includes('FROM monitoring_consents')?(sql.includes("status='withdrawn'")?[[]]:[[{status:'granted'}]]):sql.startsWith('SELECT')?[[incident]]:[{insertId:7}]);
  const req=request('admin','1',{action:'resident_corrected',residentId:'R-C',notes:'Confirmed resident'}),res=response();
  await loaded.routes.find(x=>x.path==='/incidents/:id/actions'&&x.method==='post').fn(req,res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(Array.from(loaded.statements.find(x=>x.sql==='UPDATE activity_events SET resident_id=? WHERE event_id=?').values),['R-C','event-A']);
  assert.equal(loaded.statements.find(x=>x.sql.includes('INSERT INTO audit_events')).values[5],'R-C');
});

test('resident correction cannot attach evidence without capture consent or to a new assignment',async()=>{
  for(const kind of ['withdrawn','new_assignment']){
    const incident={incident_id:1,event_id:'event-A',resident_id:'R-A',device_id:'CAM-A',status:'open',detected_at:new Date(Date.now()-60_000)};
    const loaded=await loadRoutes(sql=>sql.includes('FROM monitoring_device_residents')?[[{resident_id:'R-C',assigned_at:kind==='new_assignment'?new Date():new Date(0)}]]:
      sql.includes('FROM monitoring_consents')?[[{status:'withdrawn'}]]:sql.startsWith('SELECT')?[[incident]]:[{insertId:7}]);
    const res=response();await loaded.routes.find(x=>x.path==='/incidents/:id/actions'&&x.method==='post').fn(request('admin','1',{action:'resident_corrected',residentId:'R-C',notes:'Verified identity'}),res);
    assert.equal(res.statusCode,403);assert.ok(!loaded.statements.some(x=>/^UPDATE|^INSERT/.test(x.sql)));
  }
});

test('partial camera threshold changes preserve activity restrictions and other custom settings',async()=>{
  const settings={inactivitySeconds:900,minPoseVisibility:0.9,enabledActivities:['fall','standing']};
  const loaded=await loadRoutes(sql=>sql.startsWith('SELECT settings')?[[{settings:JSON.stringify(settings)}]]:[[{}]]),res=response();
  await loaded.routes.find(x=>x.path==='/devices/:id'&&x.method==='put').fn(request('admin','CAM-A',{settings:{offlineTimeoutSeconds:120}}),res);
  assert.equal(res.statusCode,200);
  const changed=JSON.parse(loaded.statements.find(x=>x.sql.startsWith('UPDATE monitoring_devices SET')).values[0]);
  assert.equal(changed.inactivitySeconds,900);assert.equal(changed.minPoseVisibility,0.9);assert.deepEqual(changed.enabledActivities,settings.enabledActivities);assert.equal(changed.offlineTimeoutSeconds,120);
});

const observationId='00000000-0000-4000-8000-000000000001';
async function reviewObservation({role='caretaker',residentId='R-A',incident=false,consent=true,current='pending'}={}){
  const event={event_id:observationId,resident_id:'R-A',device_id:'CAM-A',observed_at:new Date(Date.now()-60_000),review_status:current};
  const loaded=await loadRoutes(sql=>{
    if(sql.includes('FROM activity_events'))return [[event]];
    if(sql.includes('FROM monitoring_incidents'))return [incident?[{incident_id:1}]:[]];
    if(sql.includes('FROM monitoring_consents'))return sql.includes("status='withdrawn'")?[[]]:[[{status:consent?'granted':'withdrawn'}]];
    return [[{device_id:'CAM-A'}]];
  });
  const req=request(role,residentId,{status:'confirmed',notes:'Observed resident walking normally'}),res=response();req.params.eventId=observationId;
  await loaded.routes.find(x=>x.path==='/residents/:id/events/:eventId/review').fn(req,res);return{...loaded,res};
}
test('caretaker review makes ordinary activity available to verified behavior rules and audits the actor',async()=>{
  const {res,statements}=await reviewObservation();assert.equal(res.statusCode,200);assert.equal(res.data.reviewStatus,'confirmed');
  const update=statements.find(x=>x.sql.startsWith('UPDATE activity_events'));assert.equal(update.values[1],'verified-user');
  const audit=statements.find(x=>x.sql.includes('INSERT INTO audit_events'));assert.equal(audit.values[5],'R-A');assert.match(audit.values[6],/Observed resident walking normally/);
});
test('ordinary observation review enforces care scope, consent and the emergency workflow',async()=>{
  for(const [options,status] of [[{role:'patient'},403],[{residentId:'R-B'},403],[{consent:false},403],[{incident:true},409]]){
    const {res,statements}=await reviewObservation(options);assert.equal(res.statusCode,status);assert.ok(!statements.some(x=>/^UPDATE|^INSERT/.test(x.sql)));
  }
});
test('replayed observation confirmation does not rewrite the actor or audit history',async()=>{
  const {res,statements}=await reviewObservation({current:'confirmed'});assert.equal(res.statusCode,200);assert.equal(res.data.replayed,true);assert.ok(!statements.some(x=>/^UPDATE|^INSERT/.test(x.sql)));
});
test('retrying the same completed resolution returns the saved decision',async()=>{
  const loaded=await loadRoutes(()=>[[{incident_id:1,resident_id:'R-A',device_id:'CAM-A',status:'resolved',resolution_notes:'Verified safe'}]]),res=response();
  await loaded.routes.find(x=>x.path==='/incidents/:id/actions'&&x.method==='post').fn(request('caretaker','1',{action:'resolved',notes:'Verified safe'}),res);
  assert.equal(res.statusCode,200);assert.equal(res.data.replayed,true);assert.ok(!loaded.statements.some(x=>/^UPDATE|^INSERT/.test(x.sql)));
});
test('an in-flight health sample cannot reactivate a device disabled after authentication',async()=>{
  for(const row of [{enabled:0,status:'offline'},{enabled:1,status:'disabled'}]){
    const loaded=await loadRoutes(()=>[[row]],'edge'),res=response();
    const req={monitoringDevice:{device_id:'CAM-A'},body:{capturedAt:new Date().toISOString(),cameraAvailable:true}};
    await loaded.routes.find(x=>x.path==='/health').fn(req,res);
    assert.equal(res.statusCode,403);assert.ok(!loaded.statements.some(x=>/^UPDATE|^INSERT/.test(x.sql)));
  }
});
test('offline worker records one open outage and retries without duplicate alert',async()=>{
  let inserted=0,exists=false;const db={getConnection:async()=>db,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},execute:async(sql)=>{
    if(sql.includes("WHERE enabled=TRUE"))return [[{device_id:'CAM-A',last_seen_at:new Date(0),created_at:new Date(0)}]];
    if(sql.includes('FOR UPDATE'))return [[{device_id:'CAM-A',enabled:1,camera_state:'running',last_seen_at:new Date(0)}]];
    if(sql.includes('SELECT incident_id'))return [exists?[{incident_id:1}]:[]];
    if(sql.includes('INSERT INTO monitoring_incidents')){inserted++;exists=true;}return [{affectedRows:1}];
  }};await runMonitoringMaintenance(db);await runMonitoringMaintenance(db);assert.equal(inserted,1);
});
test('offline maintenance rechecks the locked device timeout and disabled state',async()=>{
  for(const locked of [{settings:{offlineTimeoutSeconds:3600}},{status:'disabled'}]){
    const writes=[],now=new Date();const device={device_id:'CAM-A',enabled:1,camera_state:'running',status:'online',last_seen_at:new Date(now.getTime()-120_000),created_at:new Date(0)};
    const db={getConnection:async()=>db,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},execute:async(sql)=>{
      if(sql.includes('WHERE enabled=TRUE'))return [[device]];
      if(sql.includes('FOR UPDATE'))return [[{...device,...locked}]];
      if(sql.startsWith('DELETE'))return [{affectedRows:0}];writes.push(sql);return [[]];
    }};
    await runMonitoringMaintenance(db,now);assert.deepEqual(writes,[]);
  }
});
test('behavior rules use verified activity and self-reports, never unverified face impressions',()=>{
  const unverified=Array.from({length:3},()=>({activity:'wandering',review_status:'pending'}));assert.deepEqual(evaluateBehaviorSignals(unverified,[]),[]);
  const reasons=evaluateBehaviorSignals(unverified.map(e=>({...e,review_status:'confirmed'})),Array.from({length:3},()=>({category:'negative',emotion_label:'Self-reported'})));
  assert.equal(reasons.length,2);assert.match(reasons[1],/self-reported/);
  assert.deepEqual(evaluateBehaviorSignals([],Array.from({length:3},()=>({category:'negative',emotion_label:'Sad'}))),[]);
});
test('night activity uses configured overnight Colombo period and is opt-in',()=>{
  const events=Array.from({length:2},()=>({activity:'walking',review_status:'confirmed',observed_at:'2026-10-09T17:00:00Z'}));
  assert.equal(evaluateBehaviorSignals(events,[]).length,0);
  assert.equal(evaluateBehaviorSignals(events,[],normalizeBaseline({nightActivityEnabled:true,sleepStart:'22:00',sleepEnd:'06:00'})).length,1);
  assert.throws(()=>normalizeBaseline({nightActivityEnabled:true}));
});

test('behavior worker reads the current care plan and reviewed observations after device locks',async()=>{
  const ops=[];
  const c={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},execute:async(sql)=>{
    ops.push(sql);
    if(sql.includes('FROM monitoring_devices'))return [[{device_id:'CAM-A',enabled:1,status:'online',camera_state:'running'}]];
    if(sql.includes('FROM monitoring_consents'))return [[{status:'granted'}]];
    if(sql.includes('FROM activity_baselines'))return [[{baseline:{repeatWanderingCount:4}}]];
    if(sql.includes('FROM activity_events'))return [Array.from({length:3},()=>({activity:'wandering',review_status:'confirmed'}))];
    if(sql.includes('FROM emotional_states'))return [[]];
    throw Error('Unexpected anomaly write from an obsolete care plan: '+sql);
  }};
  const pool={getConnection:async()=>c,execute:async(sql)=>{
    assert.ok(sql.includes('SELECT b.resident_id'));return [[{resident_id:'R-A',device_id:'CAM-A',baseline:{repeatWanderingCount:2}}]];
  }};
  await runResidentAnomalies(pool);
  assert.ok(ops[0].includes('FOR UPDATE'));assert.ok(ops.findIndex(sql=>sql.includes('FROM activity_events'))>0);
  assert.ok(!ops.some(sql=>sql.startsWith('INSERT')));
});
