const assert=require('node:assert/strict');
const {load,hooks,nodes,handler,apiDefaults}=require('./web-regression.cjs');
const photo={dataUrl:'data:image/jpeg;base64,/9j/AA==',width:800,height:600,capturedAt:'2026-10-05T06:00:00.000Z'};
const face={box:{x:.2,y:.1,width:.4,height:.6},confidence:.93,landmarkConfidence:.91,pose:{roll:0,pan:null,tilt:0},quality:{blur:'UNLIKELY',underExposure:'VERY_UNLIKELY'},signals:{joy:'POSSIBLE',sorrow:'UNLIKELY',anger:'VERY_UNLIKELY',surprise:'UNKNOWN'}};
const result=()=>({version:'face-report-v1',provider:'google-cloud-vision',analyzedAt:'2026-10-05T06:00:01.000Z',image:{width:800,height:600},faceCount:1,status:'ready',faces:[structuredClone(face)],issues:[]});
let count=0;
async function check(name,fn){await fn();count++;console.log('PASS '+name);}
async function main(){
  globalThis.fakeAuth={currentUser:{uid:'A'}};globalThis.fakeApi=apiDefaults();
  const {Resident}=await load('1-ui-ux/src/app/models/Resident.ts');
  const {EmotionLoggerModal}=await load('1-ui-ux/src/app/components/EmotionLoggerModal.tsx',{EmotionLoggerModal:null});
  const {LiveResultStrip,LiveFaceResults}=await load('1-ui-ux/src/app/components/LiveFacePanel.tsx');
  const {getLiveFaceCopy,expressionEmoji}=await load('shared/liveFace.js');
  const textOf=tree=>{const visit=node=>Array.isArray(node)?node.map(visit).join(' '):node&&typeof node==='object'?visit(node.props?.children):node??'';return visit(tree);};
  const tracked=(expression='happy')=>({version:'live-face-v1',provider:'face-api.js-local',width:640,height:480,capturedAt:'2026-10-06T06:00:00.000Z',processingTimeMs:75,faces:[{id:'same-session-face',box:face.box,detectionConfidence:.93,scores:{},smoothedScores:{},landmarks:[],expression,expressionConfidence:.85,stable:expression!=='uncertain'}]});
  await check('Inline live results update the expression, matching emoji and measured rate in every language',()=>{
    for(const language of ['en','ta','si']){
      const copy=getLiveFaceCopy(language),render=frame=>textOf(LiveResultStrip({frame,language,active:true,fps:6.25}));
      const first=render(tracked('happy')),second=render(tracked('sad'));
      for(const expected of [copy.liveResults,copy.updating,copy.latestFrame,copy.updateRate,'6.3',copy.expressions.happy,expressionEmoji.happy,'85.0%'])assert.ok(first.includes(expected));
      assert.ok(second.includes(copy.expressions.sad)&&second.includes(expressionEmoji.sad));assert.equal(second.includes(copy.expressions.happy),false);
    }
  });
  await check('Inline live results immediately clear missing faces and hide paused stale results',()=>{
    const frame=tracked();assert.ok(textOf(LiveResultStrip({frame,language:'en',active:true})).includes('Happy'));
    assert.ok(textOf(LiveResultStrip({frame:{...frame,faces:[]},language:'en',active:true})).includes('No faces detected'));
    const paused=textOf(LiveResultStrip({frame,language:'en',active:false,fps:8}));assert.ok(paused.includes('Paused'));assert.equal(paused.includes('Happy'),false);assert.equal(paused.includes('85.0%'),false);
    const loading=textOf(LiveResultStrip({frame:null,language:'en',active:false,loading:true}));assert.ok(loading.includes('Loading local face models'));assert.equal(loading.includes('Paused'),false);
  });
  await check('Uncertain live expression displays unknown probability without a guaranteed label',()=>{
    const copy=getLiveFaceCopy('ta'),text=textOf(LiveResultStrip({frame:tracked('uncertain'),language:'ta',active:true,fps:0}));assert.ok(text.includes(copy.expressions.uncertain)&&text.includes(copy.unknown));assert.equal(text.includes('85.0%'),false);assert.equal(text.includes('0.0'),false);
  });
  await check('Rapid confidence and rate updates do not repeat screen-reader label announcements',()=>{
    const first=LiveFaceResults({frame:tracked(),language:'en',fps:6});const updated=tracked();updated.faces[0].expressionConfidence=.91;
    const second=LiveFaceResults({frame:updated,language:'en',fps:8});
    const status=tree=>textOf(nodes(tree,n=>n.props?.role==='status')[0]);assert.equal(status(first),status(second));assert.ok(textOf(second).includes('91.0%'));assert.ok(textOf(second).includes('8.0'));assert.equal(first.props['aria-live'],undefined);
  });
  await check('All seven raw model scores remain separate from an uncertain supported expression in every language',()=>{
    for(const language of ['en','ta','si']){const copy=getLiveFaceCopy(language),frame=tracked('uncertain');frame.faces[0].scores={angry:.03,disgusted:.02,fearful:.02,happy:.48,neutral:.38,sad:.06,surprised:.01};frame.faces[0].smoothedScores={...frame.faces[0].scores};frame.faces[0].uncertaintyReason='weak-expression-score';const text=textOf(LiveFaceResults({frame,language}));assert.ok(text.includes(copy.notConfirmed)&&text.includes(copy.highestModelScore)&&text.includes(copy.rawModelScores)&&text.includes(copy.uncertaintyReasons['weak-expression-score']));for(const label of ['angry','disgusted','fearful','happy','neutral','sad','surprised'])assert.ok(text.includes(copy.expressions[label]));assert.ok(text.includes('48.0%')&&text.includes('38.0%'));assert.equal(frame.faces[0].expression,'uncertain');}
  });
  await check('One completed-frame observation consumer is mounted only in detailed results with actual camera state',()=>{
    const frame=tracked(),tree=LiveFaceResults({frame,language:'en',active:true}),panels=nodes(tree,n=>n.type?.name==='FacialObservationPanel');assert.equal(panels.length,1);assert.equal(panels[0].props.frame,frame);assert.equal(panels[0].props.active,true);assert.equal(nodes(LiveResultStrip({frame,language:'en',active:true}),n=>n.type?.name==='FacialObservationPanel').length,0);assert.equal(nodes(LiveFaceResults({frame,language:'en',active:true,stale:true}),n=>n.type?.name==='FacialObservationPanel')[0].props.frame,null);
  });
  let resident;
  function setup(initial={}){resident=new Resident('R1','Patient',65);globalThis.fakeAuth.currentUser={uid:'A'};globalThis.fakeApi=apiDefaults();globalThis.hooks=hooks(initial);const render=()=>{globalThis.hooks.reset();return EmotionLoggerModal({resident,onLogged(){},onClose(){}});};render();const providerIndex=globalThis.hooks.values.findIndex(value=>value==='checking');assert.ok(providerIndex>=0);globalThis.hooks.values[providerIndex]='available';return render;}
  await check('A face result never chooses a wellbeing score or writes history',async()=>{
    const render=setup({1:photo});let sent,writes=0;globalThis.fakeApi.emotions.analyzeImage=async image=>{sent=image;return result();};globalThis.fakeApi.emotions.record=async()=>{writes++;};
    await handler(render(),'handleAnalyze')();assert.equal(sent,photo.dataUrl);assert.equal(globalThis.hooks.values[2].faces[0].confidence,.93);assert.equal(globalThis.hooks.values[8],null);assert.equal(writes,0);assert.equal(resident.emotionalStates.length,0);
    await handler(render(),'handleSubmit')();assert.equal(writes,0);
  });
  await check('Zero faces is a retake report, never a fabricated neutral result',async()=>{
    const render=setup({1:photo});globalThis.fakeApi.emotions.analyzeImage=async()=>({...result(),faces:[],faceCount:0,status:'retake',issues:['no_face']});await handler(render(),'handleAnalyze')();assert.equal(globalThis.hooks.values[2].faceCount,0);assert.equal(globalThis.hooks.values[2].status,'retake');assert.equal(globalThis.hooks.values[8],null);
  });
  await check('Coordinates from a different image cannot replace the selected photo',async()=>{
    const render=setup({1:photo});globalThis.fakeApi.emotions.analyzeImage=async()=>({...result(),image:{width:801,height:600}});await handler(render(),'handleAnalyze')();assert.equal(globalThis.hooks.values[2],null);assert.equal(globalThis.hooks.values[6],'FACE_UNAVAILABLE');
  });
  await check('Retaking a photo discards an in-flight cloud result',async()=>{
    const render=setup({1:photo});let resolve;globalThis.fakeApi.emotions.analyzeImage=()=>new Promise(r=>{resolve=r;});const pending=handler(render(),'handleAnalyze')();await handler(render(),'handleRetake')();resolve(result());await pending;assert.equal(globalThis.hooks.values[1],null);assert.equal(globalThis.hooks.values[2],null);assert.equal(globalThis.hooks.values[3],false);
  });
  await check('Closing or changing accounts discards pending analysis',async()=>{
    for(const action of ['close','account']){const render=setup({1:photo});let resolve;globalThis.fakeApi.emotions.analyzeImage=()=>new Promise(r=>{resolve=r;});const pending=handler(render(),'handleAnalyze')();if(action==='close')handler(render(),'handleClose')();else globalThis.fakeAuth.currentUser={uid:'B'};resolve(result());await pending;assert.equal(globalThis.hooks.values[2],null);}
  });
  await check('Missing credentials produces a setup error without fake confidence',async()=>{
    const render=setup({1:photo});globalThis.fakeApi.emotions.analyzeImage=async()=>{throw Object.assign(new Error('setup'),{errorCode:'FACE_NOT_CONFIGURED',status:503});};await handler(render(),'handleAnalyze')();assert.equal(globalThis.hooks.values[2],null);assert.equal(globalThis.hooks.values[6],'FACE_NOT_CONFIGURED');assert.equal(globalThis.hooks.values[3],false);
  });
  await check('Manual score zero is preserved; failed-save retries reuse the observation ID',async()=>{
    const render=setup({7:'Sad',8:0,9:'I need help'});const writes=[];globalThis.fakeApi.emotions.record=async body=>{writes.push(body);throw new Error('offline');};await handler(render(),'handleSubmit')();assert.equal(resident.emotionalStates.length,0);globalThis.fakeApi.emotions.record=async body=>{writes.push(body);return{};};await handler(render(),'handleSubmit')();assert.equal(writes[0].stateScore,0);assert.equal(writes[1].observationId,writes[0].observationId);assert.equal(writes[1].emotionLabel,'Self-reported');assert.match(writes[1].note,/Self-reported.*Sad/);assert.equal(resident.getLatestEmotionalState().stateScore,0);await handler(render(),'handleSubmit')();assert.equal(writes.length,2);
  });
  await check('Late manual-save success cannot mutate an old resident after account change',async()=>{
    const render=setup({8:25});let resolve;globalThis.fakeApi.emotions.record=()=>new Promise(r=>{resolve=r;});const pending=handler(render(),'handleSubmit')();globalThis.fakeAuth.currentUser={uid:'B'};resolve({});await pending;assert.equal(resident.emotionalStates.length,0);
  });
  await check('Every language renders its report and actions in that language',()=>{
    for(const language of ['en','ta','si']){const render=setup({0:language,1:photo,2:result()});const tree=render();assert.equal(nodes(tree,n=>n.props?.role==='dialog')[0].props.lang,language);assert.ok(nodes(tree,n=>n.props?.onClick?.name==='handleDownload').length);assert.equal(globalThis.hooks.values[8],null);}
  });
  const {photoFromCanvas,photoFromFile,faceReportHTML}=await load('1-ui-ux/src/app/services/faceImage.ts');
  await check('Captured photo is bounded to1600px and preview bytes are the analyzed bytes',()=>{
    let drawn;const canvas={getContext:()=>({drawImage:(...args)=>{drawn=args;}}),toDataURL:()=>photo.dataUrl};globalThis.document={createElement:()=>canvas};const source={};const captured=photoFromCanvas(source,3200,2400);assert.equal(captured.width,1600);assert.equal(captured.height,1200);assert.equal(drawn[0],source);assert.deepEqual(drawn.slice(1),[0,0,1600,1200]);assert.equal(captured.dataUrl,photo.dataUrl);assert.throws(()=>photoFromCanvas(source,10000,10000),/INVALID_IMAGE/);
  });
  await check('Unsafe or oversized uploads are rejected before image decoding',async()=>{
    await assert.rejects(()=>photoFromFile({type:'image/svg+xml',size:10}),/INVALID_IMAGE/);await assert.rejects(()=>photoFromFile({type:'image/jpeg',size:11*1024*1024}),/INVALID_IMAGE/);
  });
  await check('Downloaded report includes the exact photo and escapes all report text',()=>{
    const html=faceReportHTML(photo,'<script>bad</script> தமிழ் සිංහල',[face.box],'ta');assert.ok(html.includes(photo.dataUrl));assert.ok(html.includes('lang="ta"'));assert.ok(html.includes('left:20%'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.throws(()=>faceReportHTML({...photo,dataUrl:'javascript:bad'},'',[],'en'),/INVALID_IMAGE/);
  });
  console.log(count+' face website regression scenarios passed; no face data sent to a provider.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
