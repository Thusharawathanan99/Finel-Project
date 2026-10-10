const assert=require('node:assert/strict');
const {load,hooks,nodes,handler}=require('./web-regression.cjs');
const textOf=tree=>Array.isArray(tree)?tree.map(textOf).join(' '):tree&&typeof tree==='object'?textOf(tree.props?.children):tree??'';
const epoch=Date.parse('2026-10-09T06:00:00Z');
// Explicit synthetic landmarks for component integration checks only, never app predictions.
function frame(ms=0){
 const p=Array.from({length:68},()=>({x:.5,y:.5}));
 [[36,.3,.35],[37,.33,.335],[38,.37,.335],[39,.4,.35],[40,.37,.365],[41,.33,.365],[42,.6,.35],[43,.63,.335],[44,.67,.335],[45,.7,.35],[46,.67,.365],[47,.63,.365],[30,.5,.5],[48,.4,.65],[54,.6,.65],[60,.4,.65],[61,.45,.63],[62,.5,.63],[63,.55,.63],[64,.6,.65],[65,.55,.67],[66,.5,.67],[67,.45,.67]].forEach(([i,x,y])=>p[i]={x,y});
 const scores={angry:.01,disgusted:.01,fearful:.01,happy:.85,neutral:.1,sad:.01,surprised:.01};
 return{version:'live-face-v1',provider:'face-api.js-local',width:640,height:480,capturedAt:new Date(epoch+ms).toISOString(),completedAt:new Date(epoch+ms+200).toISOString(),processingTimeMs:190,faces:[{id:'synthetic-track',evidenceMode:'temporal',stable:true,expression:'happy',expressionConfidence:.85,scores,smoothedScores:scores,detectionConfidence:.95,box:{x:.2,y:.1,width:.6,height:.8},landmarks:p,imageQuality:{version:'face-image-quality-v1',sampleWidth:32,sampleHeight:32,meanLuminance:130,darkFraction:.01,clippedFraction:.01,laplacianVariance:100,eyeTiltDegrees:0}}]};
}
function lifecycle(){
 const state=hooks(),dependencies=[],pending=[],cleanups=[];let index=0;
 return{...state,reset(){state.reset();index=0;},useEffect(fn,deps){const i=index++,prior=dependencies[i];if(!prior||deps.some((d,j)=>!Object.is(d,prior[j]))){dependencies[i]=deps;pending.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}},flush(){pending.splice(0).forEach(fn=>fn());},unmount(){cleanups.forEach(fn=>fn?.());}};
}
async function main(){
 const {FacialObservationPanel}=await load('1-ui-ux/src/app/components/FacialObservationPanel.tsx',{react:`export const useState=(...a)=>globalThis.hooks.useState(...a),useRef=(...a)=>globalThis.hooks.useRef(...a),useEffect=(...a)=>globalThis.hooks.useEffect(...a);`});
 const {getFacialObservationCopy}=await load('shared/facialObservations.js');
 const {FaceMonitoringGuide}=await load('1-ui-ux/src/app/components/FaceMonitoringGuide.tsx');
 const {getFaceGuideCopy}=await load('shared/faceGuide.js');
 let count=0;const check=async(name,fn)=>{await fn();count++;console.log('PASS '+name);};
 const setup=(language='en')=>{globalThis.hooks=lifecycle();let props={frame:frame(),language};return{render(change={}){props={...props,...change};globalThis.hooks.reset();FacialObservationPanel(props);globalThis.hooks.flush();globalThis.hooks.reset();return FacialObservationPanel(props);}};};
 await check('Actual completed-frame consumer exposes geometric ratios and limitations in all three languages',()=>{
  for(const language of ['en','ta','si']){const ui=setup(language),tree=ui.render(),t=getFacialObservationCopy(language),text=textOf(tree);assert.ok(text.includes(t.title)&&text.includes(t.states.observing)&&text.includes(t.notice)&&text.includes(t.privacy)&&text.includes(t.notHealth));assert.ok(text.includes('0.225')&&text.includes('0.150'));for(const label of Object.values(t.metrics))assert.ok(text.includes(label));assert.equal(nodes(tree,n=>n.type==='button'&&n.props.onClick?.name==='calibrate')[0].props.disabled,true);globalThis.hooks.unmount();}
 });
 await check('Consent checkbox starts session calibration; explicit delete resets consent and calibration',()=>{
  const ui=setup();let tree=ui.render();assert.equal(nodes(tree,n=>n.type==='input')[0].props.checked,false);nodes(tree,n=>n.type==='input')[0].props.onChange({target:{checked:true}});tree=ui.render();assert.equal(nodes(tree,n=>n.props?.onClick?.name==='calibrate')[0].props.disabled,false);handler(tree,'calibrate')();tree=ui.render();assert.ok(textOf(tree).includes(getFacialObservationCopy().baselineStatuses.collecting));handler(tree,'deleteCalibration')();tree=ui.render();assert.equal(nodes(tree,n=>n.type==='input')[0].props.checked,false);assert.ok(textOf(tree).includes(getFacialObservationCopy().baselineStatuses.off));
 });
 await check('Loss and ambiguous tracking withhold current measurements and clear calibration',()=>{
  const ui=setup();let tree=ui.render();nodes(tree,n=>n.type==='input')[0].props.onChange({target:{checked:true}});handler(ui.render(),'calibrate')();const ambiguous=frame(1000);ambiguous.faces.push({...ambiguous.faces[0],id:'other'});tree=ui.render({frame:ambiguous});assert.ok(textOf(tree).includes(getFacialObservationCopy().reasons['multiple-faces']));assert.equal(textOf(tree).includes('0.225'),false);tree=ui.render({frame:null});assert.ok(textOf(tree).includes(getFacialObservationCopy().states.unavailable));assert.equal(nodes(tree,n=>n.props?.onClick?.name==='downloadObservations')[0].props.disabled,true);
 });
 await check('Isolated snapshots and uploaded photos never offer active temporal calibration',()=>{
  const isolated=frame();isolated.faces[0].evidenceMode='single-frame';const ui=setup();let tree=ui.render({frame:isolated});assert.ok(textOf(tree).includes(getFacialObservationCopy().reasons['sampled-only']));nodes(tree,n=>n.type==='input')[0].props.onChange({target:{checked:true}});tree=ui.render();assert.equal(nodes(tree,n=>n.props?.onClick?.name==='calibrate')[0].props.disabled,true);tree=ui.render({frame:frame(1000),photo:true});assert.equal(nodes(tree,n=>n.props?.onClick?.name==='calibrate').length,0);
 });
 await check('Observation export is a real local UTF8 file containing sampled facts and privacy limits',async()=>{
  const originalDocument=globalThis.document,create=URL.createObjectURL,revoke=URL.revokeObjectURL,set=globalThis.setTimeout;let blob,clicked=false,removed=false,revoked=false;
  try{URL.createObjectURL=value=>{blob=value;return'blob:private-test';};URL.revokeObjectURL=()=>{revoked=true;};globalThis.setTimeout=fn=>{fn();return 1;};globalThis.document={body:{appendChild(){}},createElement:()=>({click(){clicked=true;},remove(){removed=true;}})};const ui=setup('ta'),tree=ui.render();handler(tree,'downloadObservations')();const text=await blob.text(),t=getFacialObservationCopy('ta');assert.ok(clicked&&removed&&revoked);assert.ok(text.includes(t.report)&&text.includes(t.timeline)&&text.includes(t.notice));assert.equal(/delivery confirmed|heart attack detected|99%/.test(text),false);}
  finally{globalThis.document=originalDocument;URL.createObjectURL=create;URL.revokeObjectURL=revoke;globalThis.setTimeout=set;}
 });
 await check('Educational photos never mount in a closed guide or during active camera processing',()=>{
  for(const language of ['en','ta','si']){globalThis.hooks=hooks();let tree=FaceMonitoringGuide({language,active:false});assert.equal(nodes(tree,n=>n.type==='img').length,0);tree.props.onToggle({currentTarget:{open:true}});globalThis.hooks.reset();tree=FaceMonitoringGuide({language,active:true});assert.equal(nodes(tree,n=>n.type==='img').length,0);assert.ok(textOf(tree).includes(getFaceGuideCopy(language).cameraOffGuide));}
 });
 await check('Explicitly expanded stopped-camera guide shows all original assets and cautious localized education',()=>{
  for(const language of ['en','ta','si']){globalThis.hooks=hooks({0:true});const tree=FaceMonitoringGuide({language,active:false}),t=getFaceGuideCopy(language),images=nodes(tree,n=>n.type==='img');assert.equal(images.length,3);assert.deepEqual(images.map(n=>n.props.src),['/face-guide/facial-movement.png','/face-guide/rest.png','/face-guide/care-support.png']);for(const image of images)assert.ok(image.props.alt.includes(t.notice));assert.ok(textOf(tree).includes(t.asymmetryText)&&textOf(tree).includes(t.restText));assert.equal(nodes(tree,n=>n.type==='svg'&&n.props.role==='img').length,1);}
 });
 console.log(count+' website facial observation scenarios passed; synthetic component input only, no camera or medical accuracy measurement.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
