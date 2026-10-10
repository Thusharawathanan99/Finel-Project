// Actual caregiver component handlers with isolated hooks, clocks, identity and API doubles.
// No alerts are sent; no database, push service or real account is used.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {load,hooks,nodes}=require('./web-regression.cjs');
const project=path.resolve(__dirname,'..');
const parser=createRequire(path.join(project,'5-patient/package.json'))('@babel/parser');
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const alert={id:11,resident_id:'R1',resident_name:'Synthetic resident',message:'Patient-reported urgent help',is_resolved:0,created_at:'2026-10-06T12:00:00Z'};

function clocks(){
  let seq=0;const timers=new Map(),intervals=new Map();
  return{timers,intervals,setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    setInterval:(fn,ms)=>{const id=++seq;intervals.set(id,{fn,ms});return id;},clearInterval:id=>intervals.delete(id),
    async poll(){for(const timer of [...intervals.values()])timer.fn();await settle();},
    async timeout(milliseconds=8000){const row=[...timers.entries()].find(([,timer])=>timer.ms===milliseconds);assert.ok(row);timers.delete(row[0]);row[1].fn();await settle();}};
}
function events(){const listeners=new Map();return{listeners,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);},fire:type=>listeners.get(type)?.()};}

async function webFixture(api={}){
  const names=['document','window','setTimeout','clearTimeout','setInterval','clearInterval','hooks','fakeAuth','fakeApi'];
  const saved=Object.fromEntries(names.map(name=>[name,{exists:Object.hasOwn(globalThis,name),value:globalThis[name]}]));
  const clock=clocks(),doc=events(),win=events(),pendingEffects=[];
  Object.assign(globalThis,{document:{...doc,visibilityState:'visible'},window:win,fakeAuth:{currentUser:{uid:'care-A'}},
    fakeApi:{emotions:{getWellnessAlerts:async()=>[],acknowledgeWellness:async()=>({}),...api.emotions},sos:{getActive:async()=>[alert],resolve:async()=>({isResolved:true}),...api.sos}},hooks:hooks()});
  const {PersistedCareAlerts}=await load('1-ui-ux/src/app/components/PersistedCareAlerts.tsx',{PersistedCareAlerts:null});
  for(const name of ['setTimeout','clearTimeout','setInterval','clearInterval'])globalThis[name]=clock[name];
  globalThis.hooks.effect=fn=>pendingEffects.push(fn);
  const render=()=>{globalThis.hooks.reset();return PersistedCareAlerts({caretakerId:'care-A'});};
  render();globalThis.hooks.effect=()=>{};
  const cleanup=pendingEffects.map(fn=>fn());await settle();
  return{clock,doc,win,render,values:globalThis.hooks.values,auth:globalThis.fakeAuth,
    async stop(){cleanup.forEach(fn=>fn?.());await settle();},
    async close(){cleanup.forEach(fn=>fn?.());await settle();for(const[name,old]of Object.entries(saved)){if(old.exists)globalThis[name]=old.value;else delete globalThis[name];}}};
}

test('caregiver website polls every2s, refreshes on focus and publishes persisted alert content',async()=>{
  let calls=0;const f=await webFixture({sos:{getActive:async options=>{calls++;assert.ok(options.signal instanceof AbortSignal);return[alert];}}});
  try{assert.equal(calls,1);assert.equal([...f.clock.intervals.values()][0].ms,2000);assert.equal(f.values[1][0].id,11);assert.ok(f.values[7]);
    await f.clock.poll();assert.equal(calls,2);f.win.fire('focus');await settle();assert.equal(calls,3);
    const tree=f.render();assert.ok(nodes(tree,node=>node.type==='p'&&node.props.children===alert.message).length);
  }finally{await f.close();}
});

test('caregiver website timeout bounds hung authentication/feed work and permits the next foreground refresh',async()=>{
  let calls=0;const blocked=deferred(),signals=[];
  const f=await webFixture({emotions:{getWellnessAlerts:()=>blocked.promise},sos:{getActive:options=>{calls++;signals.push(options.signal);return blocked.promise;}}});
  try{await f.clock.poll();await f.clock.poll();assert.equal(calls,1);
    await f.clock.timeout();assert.equal(signals[0].aborted,true);assert.match(f.values[2].sos,/timed out/);
    await f.clock.poll();assert.equal(calls,2);
  }finally{await f.close();blocked.resolve([]);await settle();}
});

test('website hiding or unmounting aborts pending reads and ignores their late private results',async()=>{
  const blocked=deferred();let calls=0,signal;
  const f=await webFixture({sos:{getActive:options=>{calls++;signal=options.signal;return blocked.promise;}}});
  try{globalThis.document.visibilityState='hidden';f.doc.fire('visibilitychange');await settle();assert.equal(signal.aborted,true);
    await f.clock.poll();assert.equal(calls,1);blocked.resolve([alert]);await settle();assert.equal(f.values[1].length,0);
    await f.stop();assert.equal(f.clock.intervals.size,0);assert.equal(f.clock.timers.size,0);assert.equal(f.doc.listeners.size,0);
  }finally{await f.close();}
});

test('website UID changes discard a previous caregiver feed response',async()=>{
  const blocked=deferred(),f=await webFixture({sos:{getActive:()=>blocked.promise}});
  try{f.auth.currentUser={uid:'care-B'};blocked.resolve([alert]);await settle();assert.equal(f.values[1].length,0);}
  finally{await f.close();}
});

test('website resolving an alert cannot be undone by an older pending feed response',async()=>{
  const stale=deferred();let reads=0,resolves=0;
  const f=await webFixture({sos:{getActive:()=>++reads===1?Promise.resolve([alert]):reads===2?stale.promise:Promise.resolve([]),resolve:async()=>{resolves++;return{isResolved:true};}}});
  try{await f.clock.poll();const button=nodes(f.render(),node=>node.type==='button'&&node.props.children==='Resolve emergency')[0];
    assert.ok(button);await button.props.onClick();await settle();stale.resolve([alert]);await settle();
    assert.equal(resolves,1);assert.equal(f.values[1].length,0);
  }finally{await f.close();}
});

const malformedFeeds=[[null],[{...alert,id:0}],[{...alert,id:'11'}],[{...alert,resident_name:null}],
  [{...alert,resident_id:''}],[{...alert,message:{unexpected:'object'}}],[{...alert,created_at:'not-a-date'}]];
test('website rejects malformed SOS entries with a visible error instead of a rendering crash',async()=>{
  for(const rows of malformedFeeds){
    const f=await webFixture({sos:{getActive:async()=>rows}});
    try{assert.equal(f.values[1].length,0);assert.match(f.values[2].sos,/feed is invalid/);assert.doesNotThrow(()=>f.render());}
    finally{await f.close();}
  }
  const f=await webFixture({sos:{getActive:async()=>[{...alert,created_at:new Date(alert.created_at)}]}});
  try{assert.equal(f.values[1][0].id,11);}finally{await f.close();}
});

test('website resolve and wellness acknowledgement timeouts preserve alerts and release the action lock for retry',async()=>{
  for(const kind of ['sos','wellness']){
    const blocked=deferred();let calls=0,signal;
    const wellness={...alert,severity:'warning',state_score:22};
    const action=(...args)=>{calls++;signal=args.at(-1).signal;return blocked.promise;};
    const f=await webFixture({sos:{getActive:async()=>kind==='sos'?[alert]:[],resolve:action},emotions:{getWellnessAlerts:async()=>kind==='wellness'?[wellness]:[],acknowledgeWellness:action}});
    try{
      const label=kind==='sos'?'Resolve emergency':'Acknowledge wellness alert';
      const button=()=>nodes(f.render(),node=>node.type==='button'&&node.props.children===label)[0];
      const pending=button().props.onClick();await settle();assert.equal(calls,1);
      await f.clock.timeout(10000);await pending;
      assert.equal(signal.aborted,true);assert.equal(f.values[kind==='sos'?1:0].length,1);assert.equal(f.values[3],null);
      assert.match(f.values[2].action,/could not be confirmed/);
      globalThis.fakeApi.sos.getActive=async()=>[];globalThis.fakeApi.emotions.getWellnessAlerts=async()=>[];
      if(kind==='sos')globalThis.fakeApi.sos.resolve=async()=>{calls++;return{isResolved:true};};
      else globalThis.fakeApi.emotions.acknowledgeWellness=async()=>{calls++;return{};};
      await button().props.onClick();await settle();assert.equal(calls,2);assert.equal(f.values[kind==='sos'?1:0].length,0);
    }finally{await f.close();blocked.resolve({});await settle();}
  }
});

test('website cleanup cancels a pending resolution and cannot remove an alert from a late response',async()=>{
  const blocked=deferred();let signal;
  const f=await webFixture({sos:{resolve:(id,by,options)=>{signal=options.signal;return blocked.promise;}}});
  const button=nodes(f.render(),node=>node.type==='button'&&node.props.children==='Resolve emergency')[0],pending=button.props.onClick();
  await f.stop();assert.equal(signal.aborted,true);await pending;blocked.resolve({isResolved:true});await settle();
  assert.equal(f.values[1].length,1);assert.equal(f.clock.timers.size,0);await f.close();
});

function mobileFixture(fetchFeed){
  const filename=path.join(project,'6-caretaker/src/screens/DashboardScreen.js'),source=fs.readFileSync(filename,'utf8');
  const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});
  const declarations=ast.program.body.filter(node=>node.type==='VariableDeclaration').flatMap(node=>node.declarations);
  const fn=declarations.find(node=>node.id.name==='DashboardScreen').init,ret=fn.body.body.find(node=>node.type==='ReturnStatement');
  const poll=declarations.find(node=>node.id.name==='POLL_INTERVAL_MS').init.value;
  const values=[],effects=[],clock=clocks(),listeners=new Map(),appListeners=new Map(),auth={currentUser:{uid:'care-A'}};
  let stateIndex=0,focused=true;
  const navigation={isFocused:()=>focused,addListener:(event,callback)=>{listeners.set(event,callback);return()=>listeners.delete(event);}};
  const React={useState:initial=>{const id=stateIndex++;values[id]=initial;return[initial,next=>values[id]=typeof next==='function'?next(values[id]):next];},
    useRef:value=>({current:value}),useCallback:fn=>fn,useEffect:fn=>effects.push(fn)};
  const Animated={Value:class{},loop:()=>({start(){},stop(){}}),sequence:()=>[],timing:()=>({})};
  const AppState={currentState:'active',addEventListener:(event,fn)=>{appListeners.set(event,fn);return{remove:()=>appListeners.delete(event)};}};
  const context=vm.createContext({React,Animated,AppState,auth,AbortController,Date,Promise,console,...clock,POLL_INTERVAL_MS:poll,useScreenRefresh(){},
    apiFetch:fetchFeed,Alert:{alert(){}},signOut:async()=>{}});
  const factory=vm.runInContext('('+source.slice(fn.start,fn.body.start)+'{'+source.slice(fn.body.start+1,ret.start)+';return{fetchAlerts,resolveSOS};})',context);
  const handlers=factory({navigation}),cleanup=effects.map(effect=>effect());
  return{values,clock,auth,handlers,async app(state){AppState.currentState=state;appListeners.get('change')?.(state);await settle();},
    async focus(value){focused=value;listeners.get(value?'focus':'blur')?.();await settle();},
    async close(){cleanup.forEach(fn=>fn?.());await settle();assert.equal(appListeners.size,0);assert.equal(listeners.size,0);}};
}
const response=rows=>({ok:true,json:async()=>rows});

test('caregiver mobile checks every2s only while active and focused, then refreshes immediately on return',async()=>{
  let calls=0;const f=mobileFixture(async endpoint=>{calls++;return response(endpoint==='/sos-alerts'?[alert]:[]);});
  try{assert.equal([...f.clock.intervals.values()][0].ms,2000);await f.clock.poll();assert.equal(calls,2);assert.equal(f.values[6][0].id,11);assert.ok(f.values[10]);
    await f.app('background');await f.clock.poll();assert.equal(calls,2);
    await f.app('active');assert.equal(calls,4);
    await f.focus(false);await f.clock.poll();assert.equal(calls,4);
    await f.focus(true);assert.equal(calls,6);
  }finally{await f.close();assert.equal(f.clock.timers.size,0);assert.equal(f.clock.intervals.size,0);}
});

test('caregiver mobile bounds stalled requests, prevents overlapping polls and keeps timeout errors visible',async()=>{
  let calls=0;const blocked=deferred(),signals=[];
  const f=mobileFixture((endpoint,options)=>{calls++;signals.push(options.signal);return blocked.promise;});
  try{await f.clock.poll();await f.clock.poll();assert.equal(calls,2);
    await f.clock.timeout();assert.ok(signals.every(signal=>signal.aborted));assert.match(f.values[8],/could not be loaded/);
    await f.clock.poll();assert.equal(calls,4);
  }finally{await f.close();blocked.resolve(response([]));await settle();}
});

test('caregiver mobile discards in-flight alerts after an account change or screen cleanup',async()=>{
  for(const change of ['uid','cleanup']){
    const blocked=deferred(),f=mobileFixture(()=>blocked.promise);
    await f.clock.poll();if(change==='uid')f.auth.currentUser={uid:'care-B'};else await f.close();
    blocked.resolve(response([alert]));await settle();assert.equal(f.values[6].length,0);
    await f.close();assert.equal(f.clock.timers.size,0);assert.equal(f.clock.intervals.size,0);
  }
});

test('caregiver mobile rejects malformed SOS entries without replacing its feed with unrenderable rows',async()=>{
  for(const rows of malformedFeeds){
    const f=mobileFixture(async endpoint=>response(endpoint==='/sos-alerts'?rows:[]));
    try{await f.clock.poll();assert.equal(f.values[6].length,0);assert.match(f.values[8],/could not be loaded/);}
    finally{await f.close();}
  }
});

test('caregiver mobile resolution timeout retains the alert and permits a safe retry',async()=>{
  const blocked=deferred();let calls=0,signal,confirmed=false;
  const f=mobileFixture((endpoint,options)=>{
    if(options?.method==='PUT'){calls++;signal=options.signal;return calls===1?blocked.promise:Promise.resolve(response({isResolved:true}));}
    return Promise.resolve(response(endpoint==='/sos-alerts'&&!confirmed?[alert]:[]));
  });
  try{await f.clock.poll();const pending=f.handlers.resolveSOS(11);await settle();assert.equal(calls,1);
    await f.clock.timeout(10000);await pending;assert.equal(signal.aborted,true);assert.equal(f.values[6].length,1);
    assert.equal(f.values[11],null);assert.match(f.values[8],/Resolution could not be confirmed/);
    confirmed=true;await f.handlers.resolveSOS(11);assert.equal(calls,2);assert.equal(f.values[6].length,0);
  }finally{await f.close();blocked.resolve(response({isResolved:true}));await settle();}
});

test('caregiver mobile cleanup aborts an in-flight resolve and prevents late alert removal',async()=>{
  const blocked=deferred();let signal;
  const f=mobileFixture((endpoint,options)=>options?.method==='PUT'?(signal=options.signal,blocked.promise):Promise.resolve(response(endpoint==='/sos-alerts'?[alert]:[])));
  await f.clock.poll();const pending=f.handlers.resolveSOS(11);await settle();await f.close();assert.equal(signal.aborted,true);await pending;
  blocked.resolve(response({isResolved:true}));await settle();assert.equal(f.values[6].length,1);assert.equal(f.clock.timers.size,0);
});
