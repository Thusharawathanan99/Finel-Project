const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const project = path.resolve(__dirname, '..');
const esbuild = require(path.join(project, '1-ui-ux/node_modules/esbuild'));
const stage = project;
let assertions = 0;

const defaultMocks = {
  apiService: `const api = name => new Proxy({}, { get: (_, method) => (...args) => globalThis.fakeApi[name][method](...args) }); export const prescriptionsApi=api('prescriptions'), emotionsApi=api('emotions'), residentsApi=api('residents'), caretakersApi=api('caretakers'), appointmentsApi=api('appointments'), doctorsApi=api('doctors'), sosApi=api('sos'), complaintsApi=api('complaints'), systemApi=api('system'), mealPlansApi=api('meals'), medicationEventsApi=api('medicationEvents');`,
  storageService: `export const uploadPrescriptionImage = async () => ({url:'offline-image'});`,
  firestoreService: `export const pushEmotionUpdate=async()=>{}; export const pushAlert=async()=>{};`,
  DatasetCollector: `export const datasetCollector = {loadFromLocalStorage(){}, async record(){}, setScope(){}};`,
  ModelAccuracyTracker: `export const modelAccuracyTracker = {setScope(){}};`,
  OCREngine: `export class OCREngine { constructor(){this.modelVersion='test'} }`,
  NLPEngine: `export class NLPEngine {}`,
  EmotionAnalysisEngine: `export class EmotionAnalysisEngine {}`,
  MealPlanEngine: `export const clearMealPlanCache = () => {}; export const clearAllMealPlanCaches = () => {}; export const generateMealPlan = async () => globalThis.plan; export const regenerateMeal = async () => null; export const loadSavedMealPlan = async () => globalThis.savedPlan || null;`,
  geminiService: `export const isGeminiEnabled = () => globalThis.geminiEnabled; export const getGeminiModel=()=>null; export const callWithRetry = async()=>({response:{text:()=>JSON.stringify(globalThis.generatedPlan)}});`,
  firebaseAuthService: `export const createCaretakerAccount=async()=>({caretakerId:'CTNew'}); export const createResidentAccount=async(input)=>({uid:'RNew',residentId:input.residentId||'RNew',name:input.name,email:input.email,role:'patient'}); export const getPasswordValidationError=password=>password.length>=8&&/[a-z]/.test(password)&&/[A-Z]/.test(password)&&/\d/.test(password)?null:'Password is too weak.'; export const getCaretakerPasswordValidationError=password=>password.length<6?'Temporary password must be at least 6 characters.':null; export const getIdToken=async()=>'offline-token'; export const formatAuthErrorMessage=err=>err?.message||String(err||'');`,
  FacialEmotionEngine: `export class FacialEmotionEngine {}`, 
  LiveFaceSession: `export const startLiveFaceDetection=async()=>()=>{}; export const analyzeFacePhoto=async()=>{throw Error('Offline fixture: no camera')};`,
  'firebase': `export const auth = globalThis.fakeAuth;`,
  apiConfig: `export const API_URL='http://offline/api';`,
  'firebase/app': `export const initializeApp=()=>({}); export const deleteApp=async()=>{};`,
  'firebase/auth': `export const createUserWithEmailAndPassword=(...a)=>globalThis.firebaseMock.create(...a), signInWithEmailAndPassword=(...a)=>globalThis.firebaseMock.signIn(...a), getAuth=()=>globalThis.isolatedAuth, deleteUser=(...a)=>globalThis.firebaseMock.delete(...a), sendPasswordResetEmail=(...a)=>globalThis.firebaseMock.reset(...a), signOut=(...a)=>globalThis.firebaseMock.signOut(...a), onAuthStateChanged=()=>()=>{}, updateProfile=(...a)=>globalThis.firebaseMock.update(...a);`,
  react: `export const useState=(...a)=>globalThis.hooks.useState(...a), useRef=(...a)=>globalThis.hooks.useRef(...a), useEffect=fn=>globalThis.hooks.effect?.(fn), useCallback=fn=>fn, useMemo=fn=>fn(), lazy=fn=>fn.toString().match(/default:\\s*\\w+\\.(\\w+)/)?.[1]||fn, Suspense=({children})=>children;`,
  'react/jsx-runtime': `export const Fragment='Fragment'; export const jsx=(type,props)=>({type,props}); export const jsxs=jsx;`,
  recharts: `export const LineChart='LineChart', Line='Line', XAxis='XAxis', YAxis='YAxis', ResponsiveContainer='ResponsiveContainer', CartesianGrid='CartesianGrid', Tooltip='Tooltip';`,
};
for (const name of ['PrescriptionUpload', 'EmotionLoggerModal', 'AppointmentBooking', 'MealPlanView', 'PersistedCareAlerts', 'MonitoringDevices', 'MonitoringIncidents', 'MonitoringConsentPanel', 'MedicationReminders', 'MedicationReminderPanel', 'CareRecordPanel', 'MonitoringReports']) defaultMocks[name] = `export const ${name}='${name}';`;
const icons = ['Shield','Users','Activity','Bell','Settings','Plus','X','Loader2','AlertTriangle','UserPlus','Trash2','Stethoscope','Pencil','MessageSquare','Send','CheckCircle','Eye','EyeOff','Pill','Heart','Utensils','AlertCircle','Calendar','Clock','Upload','User','Home','Phone','MapPin','FileText','ShieldCheck','Mail','Camera','Sparkles','LogOut','MessageSquareWarning','CheckCircle2','Info','TrendingUp','Beaker','RefreshCw','Video'];
defaultMocks['lucide-react'] = icons.map(name => `export const ${name}='${name}';`).join('\n');

async function load(relative, overrides={}) {
  const mocks = {...defaultMocks, ...overrides};
  const rootPath = fs.existsSync(path.join(stage, relative)) ? path.join(stage, relative) : path.join(project, relative);
  const result = await esbuild.build({
    stdin: { contents: fs.readFileSync(rootPath, 'utf8'), loader: relative.endsWith('.tsx') ? 'tsx' : 'ts', sourcefile: rootPath },
    bundle:true, write:false, format:'cjs', platform:'node', jsx:'automatic', logLevel:'silent',
    define:{'import.meta.env':'{}'},
    plugins:[{name:'offline-fixtures',setup(build){
      build.onResolve({filter:/.*/},args=>{
        const base=path.basename(args.path).replace(/\.(tsx?|js)$/,'');
        const key=Object.hasOwn(mocks,args.path)?args.path:base;
        if (Object.hasOwn(mocks,key) && mocks[key] !== null) return {path:key,namespace:'mock'};
        const importer = args.importer.includes('stdin') ? rootPath : args.importer;
        let resolved=path.resolve(path.dirname(importer), args.path);
        let rel=path.relative(stage,resolved);
        if(rel.startsWith('..')) rel=path.relative(project,resolved);
        for(const suffix of ['','.ts','.tsx','.js']){
          const staged=path.join(stage,rel+suffix), original=path.join(project,rel+suffix);
          if(fs.existsSync(staged)&&fs.statSync(staged).isFile())return{path:staged,namespace:'source'};
          if(fs.existsSync(original)&&fs.statSync(original).isFile())return{path:original,namespace:'source'};
        }
        throw new Error(`Unresolved fixture import ${args.path} from ${importer}`);
      });
      build.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'ts'}));
      build.onLoad({filter:/.*/,namespace:'source'},args=>({contents:fs.readFileSync(args.path,'utf8'),loader:args.path.endsWith('.tsx')?'tsx':'ts'}));
    }}],
  });
  const mod = new Module(rootPath, module);
  mod._compile(result.outputFiles[0].text, rootPath);
  return mod.exports;
}

const apiDefaults = () => ({
  prescriptions:{create:async()=>({}),finishMedication:async()=>({finishedMedication:{id:1,finishedAt:new Date().toISOString()}})},
  emotions:{record:async()=>({})}, residents:{update:async()=>({}),create:async()=>({residentId:'RNew'}),delete:async()=>({})},
  caretakers:{delete:async()=>({})}, appointments:{create:async()=>({appointmentId:'APT-New'})}, system:{createComponent:async()=>({}),updateComponent:async()=>({}),deleteComponent:async()=>({})},
  doctors:{}, sos:{create:async()=>({alertId:1})}, complaints:{}, meals:{save:async()=>({}),getForResident:async()=>({plan:null})},
  medicationEvents:{get:async()=>[],save:async()=>({})},
});
function hooks(initialOverrides={}) {
  const values=[];let index=0;
  return { values, reset(){index=0;}, useState(initial){const i=index++;if(!(i in values))values[i]=Object.hasOwn(initialOverrides,i)?initialOverrides[i]:typeof initial==='function'?initial():initial;return[values[i],value=>{values[i]=typeof value==='function'?value(values[i]):value;}];},useRef(initial){const i=index++;if(!(i in values))values[i]={current:initial};return values[i];} };
}
function nodes(root,predicate){const out=[];const visit=n=>{if(Array.isArray(n)){n.forEach(visit);return;}if(!n||typeof n!=='object')return;if(predicate(n))out.push(n);visit(n.props?.children);};visit(root);return out;}
function handler(root,name){const node=nodes(root,n=>n.props?.onClick?.name===name)[0];assert.ok(node,`UI handler ${name} is reachable`);return node.props.onClick;}
function iconHandler(root,name){const node=nodes(root,n=>typeof n.props?.onClick==='function'&&nodes(n.props.children,c=>c.type===name).length)[0];assert.ok(node,`UI icon action ${name} is reachable`);return node.props.onClick;}
async function check(label,fn){await fn();assertions++;console.log(`PASS ${label}`);}

async function main(){
  globalThis.fakeApi=apiDefaults();
  const {Resident}=await load('1-ui-ux/src/app/models/Resident.ts');
  const {EmotionalState}=await load('1-ui-ux/src/app/models/EmotionalState.ts');
  const {Medication}=await load('1-ui-ux/src/app/models/Medication.ts');
  const {Dashboard}=await load('1-ui-ux/src/app/models/Dashboard.ts');
  const {Appointment}=await load('1-ui-ux/src/app/models/Appointment.ts');
  const {Caretaker}=await load('1-ui-ux/src/app/models/Caretaker.ts');
  const {SystemComponent}=await load('1-ui-ux/src/app/models/SystemComponent.ts');
  const resident=new Resident('R1','Resident',65);
  const descending=Array.from({length:10},(_,i)=>new EmotionalState(new Date(2026,9,10-i),90-i));
  resident.emotionalStates=[...descending];
  await check('Latest emotional state does not mutate history',()=>{assert.equal(resident.getLatestEmotionalState().stateScore,90);assert.deepEqual(resident.emotionalStates,descending);});
  const {PatientDashboard}=await load('1-ui-ux/src/app/components/PatientDashboard.tsx');
  await check('Patient chart uses chronological latest seven',()=>{
    globalThis.hooks=hooks({0:'emotions'});
    const tree=PatientDashboard({user:{name:'Resident',role:'patient'},resident,dashboard:{getAppointmentsForResident:()=>[]},onLogout(){},onRefresh(){}});
    const data=nodes(tree,n=>n.type==='LineChart')[0].props.data;
    assert.deepEqual(data.map(d=>d.score),[84,85,86,87,88,89,90]);assert.deepEqual(resident.emotionalStates,descending);
  });
  await check('Failed Rx save then retry produces exactly one local prescription',async()=>{
    const dashboard=new Dashboard();dashboard.addResident(resident);
    globalThis.fakeApi.prescriptions.create=async()=>{throw new Error('offline failure');};
    assert.equal(await dashboard.saveProcessedPrescription('R1','Doctor',[new Medication('Drug','10 mg','daily')],null,'Resident','2026-10-05'),false);
    assert.equal(resident.prescriptions.length,0);
    globalThis.fakeApi.prescriptions.create=async()=>({});
    assert.equal(await dashboard.saveProcessedPrescription('R1','Doctor',[new Medication('Drug','10 mg','daily')],null,'Resident','2026-10-05'),true);
    assert.equal(resident.prescriptions.length,1);
  });
  await check('Appointments hydrate status and include same-day future time',()=>{
    const appointment=Appointment.fromApi({appointment_id:'A1',resident_id:'R1',appointment_date:'2026-10-04',appointment_time:'04:30 PM',status:'rescheduled'});
    assert.equal(appointment.status,'rescheduled');assert.equal(appointment.isUpcoming(new Date(2026,9,4,10)),true);assert.equal(appointment.isUpcoming(new Date(2026,9,4,17)),false);
  });
  const {AdminDashboard}=await load('1-ui-ux/src/app/components/AdminDashboard.tsx');
  await check('Admin resident create waits for persistence and preserves form on failure',async()=>{
    let added=0;const dashboard={residents:[],caretakers:[],systemComponents:[],getActiveEmergencyAlerts:()=>[],getCriticalAlerts:()=>[],getPendingLeaveRequests:()=>[],addResident(){added++;}};
    globalThis.hooks=hooks({1:true});
    // Resident form index depends on preceding hook declarations. Locate it by shape.
    const render=()=>{globalThis.hooks.reset();return AdminDashboard({user:{name:'Admin'},dashboard,onLogout(){},onRefresh(){}});};
    let tree=render();const formIndex=globalThis.hooks.values.findIndex(v=>v&&typeof v==='object'&&'age'in v&&'roomNumber'in v);
    globalThis.hooks.values[formIndex]={...globalThis.hooks.values[formIndex],name:'New Resident',age:'70'};tree=render();
    globalThis.fakeApi.residents.create=async()=>{assert.equal(added,0);throw new Error('create failed');};await handler(tree,'handleAddResident')();assert.equal(added,0);assert.equal(globalThis.hooks.values[1],true);assert.ok(nodes(render(),n=>n.props?.role==='alert').length);
    globalThis.fakeApi.residents.create=async()=>({residentId:'RNew'});await handler(render(),'handleAddResident')();assert.equal(added,1);assert.equal(globalThis.hooks.values[1],false);
  });
  await check('Patient profile failure leaves resident details unchanged',async()=>{
    globalThis.hooks=hooks({0:'profile',6:true});
    const render=()=>{globalThis.hooks.reset();return PatientDashboard({user:{name:'Resident'},resident,dashboard:{getAppointmentsForResident:()=>[]},onLogout(){},onRefresh(){}});};
    let tree=render();
    const profileFormIndex=globalThis.hooks.values.findIndex(v=>v&&typeof v==='object'&&'address'in v&&'emergencyContactPhone'in v);
    globalThis.hooks.values[profileFormIndex]={...globalThis.hooks.values[profileFormIndex],address:'Changed address'};
    tree=render();
    globalThis.fakeApi.residents.update=async()=>{throw new Error('profile failed');};await handler(tree,'handleSaveProfile')();assert.equal(resident.personalDetails.address,undefined);
    globalThis.fakeApi.residents.update=async()=>({});await handler(render(),'handleSaveProfile')();assert.equal(resident.personalDetails.address,'Changed address');
  });
  await check('Admin resident delete failure does not hide resident; success removes assignments',async()=>{
    const dashboard=new Dashboard();dashboard.addResident(resident);const caretaker=new Caretaker('CT1','Carer','carer@example.test','','');caretaker.assignedResidents=['R1'];dashboard.addCaretaker(caretaker);
    globalThis.confirm=()=>true;globalThis.hooks=hooks({0:'residents'});const render=()=>{globalThis.hooks.reset();return AdminDashboard({user:{name:'Admin'},dashboard,onLogout(){},onRefresh(){}});};
    globalThis.fakeApi.residents.delete=async()=>{throw new Error('delete failed');};await iconHandler(render(),'Trash2')();await new Promise(resolve=>setImmediate(resolve));assert.equal(dashboard.residents.length,1);
    globalThis.fakeApi.residents.delete=async()=>({});await iconHandler(render(),'Trash2')();await new Promise(resolve=>setImmediate(resolve));assert.equal(dashboard.residents.length,0);assert.deepEqual(caretaker.assignedResidents,[]);
  });
  await check('Admin caretaker delete waits for API before removal',async()=>{
    const dashboard=new Dashboard();dashboard.addCaretaker(new Caretaker('CT1','Carer','carer@example.test','',''));
    globalThis.hooks=hooks({0:'caretakers'});const render=()=>{globalThis.hooks.reset();return AdminDashboard({user:{name:'Admin'},dashboard,onLogout(){},onRefresh(){}});};
    globalThis.fakeApi.caretakers.delete=async()=>{throw new Error('delete failed');};await iconHandler(render(),'Trash2')();await new Promise(resolve=>setImmediate(resolve));assert.equal(dashboard.caretakers.length,1);
    globalThis.fakeApi.caretakers.delete=async()=>({});await iconHandler(render(),'Trash2')();await new Promise(resolve=>setImmediate(resolve));assert.equal(dashboard.caretakers.length,0);
  });
  await check('Admin system creation and status changes require persisted success',async()=>{
    const dashboard=new Dashboard();globalThis.hooks=hooks({0:'systems',3:true});const render=()=>{globalThis.hooks.reset();return AdminDashboard({user:{name:'Admin'},dashboard,onLogout(){},onRefresh(){}});};let tree=render();
    const formIndex=globalThis.hooks.values.findIndex(v=>v&&typeof v==='object'&&'version'in v&&'description'in v);globalThis.hooks.values[formIndex]={name:'System',version:'1',description:'Test',status:'online'};
    globalThis.fakeApi.system.createComponent=async()=>{throw new Error('create failed');};await handler(render(),'handleAddSystem')();assert.equal(dashboard.systemComponents.length,0);assert.equal(globalThis.hooks.values[3],true);
    globalThis.fakeApi.system.createComponent=async()=>({});await handler(render(),'handleAddSystem')();assert.equal(dashboard.systemComponents.length,1);
    const statusButton=()=>nodes(render(),n=>n.type==='button'&&String(n.props.children).includes('Tap to change'))[0];
    if(statusButton()){
      globalThis.fakeApi.system.updateComponent=async()=>{throw new Error('update failed');};await statusButton().props.onClick();assert.equal(dashboard.systemComponents[0].status,'online');
      globalThis.fakeApi.system.updateComponent=async()=>({});await statusButton().props.onClick();assert.equal(dashboard.systemComponents[0].status,'offline');
    } else throw new Error('System status action is not reachable');
    globalThis.fakeApi.system.deleteComponent=async()=>{throw new Error('delete failed');};await iconHandler(render(),'Trash2')();await new Promise(resolve=>setImmediate(resolve));assert.equal(dashboard.systemComponents.length,1);
    globalThis.fakeApi.system.deleteComponent=async()=>({});await iconHandler(render(),'Trash2')();await new Promise(resolve=>setImmediate(resolve));assert.equal(dashboard.systemComponents.length,0);
  });
  const {CaretakerDashboard}=await load('1-ui-ux/src/app/components/CaretakerDashboard.tsx');
  await check('Caretaker SOS persists assigned resident and keeps failed alert open',async()=>{
    const dashboard=new Dashboard();dashboard.addResident(resident);const carer=new Caretaker('CT1','Carer','carer@example.test','','');carer.assignedResidents=['R1'];dashboard.addCaretaker(carer);
    globalThis.hooks=hooks({5:true,6:'R1'});const render=()=>{globalThis.hooks.reset();return CaretakerDashboard({user:{userId:'CT1',name:'Carer',email:carer.email},dashboard,onLogout(){},onRefresh(){}});};
    globalThis.fakeApi.sos.create=async data=>{assert.equal(data.residentId,'R1');throw new Error('SOS failed');};await handler(render(),'handleEmergencyAlert')();assert.equal(globalThis.hooks.values[5],true);assert.equal(dashboard.emergencyAlerts.length,0);assert.ok(nodes(render(),n=>n.props?.role==='alert').length);
    globalThis.fakeApi.sos.create=async()=>({alertId:1});await handler(render(),'handleEmergencyAlert')();assert.equal(globalThis.hooks.values[5],false);assert.ok(nodes(render(),n=>n.props?.role==='status').length);
  });
  await check('Caretaker appointment failure propagates; success stores backend ID',async()=>{
    const dashboard=new Dashboard();dashboard.addResident(resident);const carer=new Caretaker('CT1','Carer','carer@example.test','','');carer.assignedResidents=['R1'];dashboard.addCaretaker(carer);
    globalThis.hooks=hooks({1:resident,3:true});const render=()=>{globalThis.hooks.reset();return CaretakerDashboard({user:{userId:'CT1',name:'Carer',email:carer.email},dashboard,onLogout(){},onRefresh(){}});};
    const onBook=()=>nodes(render(),n=>n.type==='AppointmentBooking')[0].props.onBook;
    globalThis.fakeApi.appointments.create=async()=>{throw new Error('booking failed');};await assert.rejects(()=>onBook()('Doctor','General',new Date(2026,9,8),'09:00 AM','Reason'),/booking failed/);assert.equal(dashboard.appointments.length,0);assert.equal(globalThis.hooks.values[3],true);
    globalThis.fakeApi.appointments.create=async()=>({appointmentId:'APT-New'});await onBook()('Doctor','General',new Date(2026,9,8),'09:00 AM','Reason');assert.equal(dashboard.appointments[0].appointmentId,'APT-New');assert.equal(globalThis.hooks.values[3],false);
  });
  globalThis.fakeAuth={currentUser:{uid:'face-test'}};
  const {EmotionLoggerModal}=await load('1-ui-ux/src/app/components/EmotionLoggerModal.tsx',{EmotionLoggerModal:null});
  await check('Emotion log only updates resident after successful save',async()=>{
    const loggingResident=new Resident('R1','Resident',65);const before=loggingResident.emotionalStates.length;globalThis.hooks=hooks({7:'Happy',8:95});
    const render=()=>{globalThis.hooks.reset();return EmotionLoggerModal({resident:loggingResident,onLogged(){},onClose(){}});};
    globalThis.fakeApi.emotions.record=async()=>{throw new Error('emotion save failed');};await handler(render(),'handleSubmit')();assert.equal(loggingResident.emotionalStates.length,before);
    globalThis.fakeApi.emotions.record=async()=>({});await handler(render(),'handleSubmit')();assert.equal(loggingResident.emotionalStates.length,before+1);assert.equal(loggingResident.getLatestEmotionalState().stateScore,95);
  });
  globalThis.fakeAuth={currentUser:null};globalThis.isolatedAuth={};
  const fakeUser={uid:'UID1',email:'patient@example.test',getIdToken:async()=>'offline-token'};
  globalThis.fakeAuth.currentUser=fakeUser;
  let created=0,deleted=0;
  globalThis.firebaseMock={create:async()=>{created++;return{user:fakeUser};},signIn:async()=>({user:fakeUser}),delete:async()=>{deleted++;},reset:async()=>{},signOut:async()=>{},update:async()=>{}};
  const auth=await load('1-ui-ux/src/app/services/firebaseAuthService.ts',{firebaseAuthService:null});
  const response=(status,body)=>({status,ok:status>=200&&status<300,json:async()=>body});
  await check('Invalid caretaker is rejected before Firebase creation',async()=>{globalThis.fetch=async()=>response(200,[]);await assert.rejects(()=>auth.signUp('patient@example.test','Password1','Patient','missing'),/caretaker/);assert.equal(created,0);});
  await check('Definitive registration failure deletes newly created Firebase identity',async()=>{
    globalThis.fetch=async url=>url.endsWith('/caretakers')?response(200,[{caretaker_id:'CT1'}]):url.endsWith('/register-patient')?response(409,{error:'Resident cannot be claimed'}):response(404,{});
    await assert.rejects(()=>auth.signUp('patient@example.test','Password1','Patient','CT1','Existing'),/cannot be claimed/);assert.equal(created,1);assert.equal(deleted,1);
  });
  await check('Lost committed registration response is recovered without deleting identity',async()=>{
    globalThis.fetch=async url=>url.endsWith('/caretakers')?response(200,[{caretaker_id:'CT1'}]):url.endsWith('/register-patient')?Promise.reject(new Error('lost response')):response(200,{role:'patient',resident_id:'R1',name:'Patient',email:'patient@example.test'});
    const user=await auth.signUp('patient@example.test','Password1','Patient','CT1');assert.equal(user.residentId,'R1');assert.equal(deleted,1);
  });
  await check('Uncertain registration preserves identity and explains safe retry',async()=>{
    globalThis.fetch=async url=>url.endsWith('/caretakers')?response(200,[{caretaker_id:'CT1'}]):Promise.reject(new Error('network unavailable'));
    await assert.rejects(()=>auth.signUp('patient@example.test','Password1','Patient','CT1'),/Retry Patient Register/);assert.equal(deleted,1);
  });
  await check('Authenticated identity never guesses admin role without backend profile',async()=>{globalThis.fetch=async()=>response(503,{error:'Profile unavailable'});await assert.rejects(()=>auth.fetchUserProfile(fakeUser),/Profile unavailable/);});
  await check('A stale website sign-in never signs out the newly selected account',async()=>{
    let signedOut=0;globalThis.fakeAuth.currentUser=fakeUser;globalThis.firebaseMock.signIn=async()=>({user:fakeUser});globalThis.firebaseMock.signOut=async()=>{signedOut++;};
    globalThis.fetch=async()=>({status:200,ok:true,json:async()=>{globalThis.fakeAuth.currentUser={uid:'different-account'};return{role:'patient',resident_id:'R1',name:'Patient',email:'patient@example.test'};}});
    await assert.rejects(()=>auth.signIn('patient@example.test','password'),/account changed/);assert.equal(signedOut,0);
  });
  await check('Website registration enforces the shared strong-password policy',async()=>{
    await assert.rejects(()=>auth.signUp('patient@example.test','password','Patient','CT1'),/uppercase, lowercase, and a number/);
  });
  await check('Website password reset normalizes email and hides unknown accounts',async()=>{
    let resetArgs;globalThis.firebaseMock.reset=async(...args)=>{resetArgs=args;};
    await auth.requestPasswordReset('  Person@Example.Test  ');assert.equal(resetArgs[0],globalThis.fakeAuth);assert.equal(resetArgs[1],'person@example.test');
    globalThis.firebaseMock.reset=async()=>{throw Object.assign(new Error('missing'),{code:'auth/user-not-found'});};
    await auth.requestPasswordReset('missing@example.test');
    await assert.rejects(()=>auth.requestPasswordReset('not-an-email'),/valid email/);
  });
  await check('Website auth form exposes reset and password visibility controls',async()=>{
    const authSource=fs.readFileSync(path.join(project,'1-ui-ux/src/app/components/SignInSignUp.tsx'),'utf8');
    assert.ok(authSource.includes('Forgot password?'));assert.ok(authSource.includes('Show password'));assert.ok(authSource.includes('New Resident ID (optional)'));
  });
  const completeMeal={name:'Vegetable meal',description:'Rice and vegetables',rationale:'Proposed balanced meal',ingredients:['rice','carrot'],calories:100,protein:5,carbs:10,fat:2,fiber:2,warnings:[],tags:[]};
  const weekdays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  globalThis.geminiEnabled=true;globalThis.generatedPlan={days:weekdays.map(day=>({day,breakfast:completeMeal,morningSnack:completeMeal,lunch:completeMeal,afternoonSnack:completeMeal,dinner:completeMeal})),medicationConsiderations:[],dietaryNotes:'Review with your care team'};
  const meals=await load('1-ui-ux/src/app/ml/meal-plan/MealPlanEngine.ts',{MealPlanEngine:null});
  const request={residentId:'R1',residentName:'Resident',age:65,medications:[],allergies:[],medicalHistory:'',dietaryRestrictions:[]};
  await check('Failed meal persistence rejects generation and does not cache success',async()=>{
    globalThis.fakeApi.meals.save=async()=>{throw new Error('meal save failed');};await assert.rejects(()=>meals.generateMealPlan(request),/meal save failed/);
    globalThis.fakeApi.meals.getForResident=async()=>({plan:null});assert.equal(await meals.loadSavedMealPlan('R1',0),null);
  });
  let savedPlan;
  await check('Successful meal persistence caches only matching complete resident context',async()=>{
    let saves=0;globalThis.fakeApi.meals.save=async()=>{saves++;};savedPlan=await meals.generateMealPlan(request);assert.equal(saves,1);assert.equal(await meals.loadSavedMealPlan('R1',request),savedPlan);assert.equal(await meals.loadSavedMealPlan('R1',0),null);assert.equal(await meals.loadSavedMealPlan('R1',{...request,allergies:['peanut']}),null);
  });
  await check('A regenerated meal is persisted before it changes the displayed plan',async()=>{
    const plan=JSON.parse(JSON.stringify(savedPlan));
    const meal={...completeMeal,name:'Original meal'};plan.days[0].breakfast=meal;
    globalThis.generatedPlan={...meal,name:'Replacement meal',calories:200};
    globalThis.fakeApi.meals.save=async()=>{throw new Error('replacement save failed');};
    await assert.rejects(()=>meals.regenerateMeal(plan,0,'breakfast'),/replacement save failed/);
    assert.equal(plan.days[0].breakfast.name,'Original meal');
    globalThis.fakeApi.meals.save=async(id,saved)=>{assert.equal(id,'R1');assert.equal(saved.days[0].breakfast.name,'Replacement meal');assert.equal(plan.days[0].breakfast.name,'Original meal');};
    await meals.regenerateMeal(plan,0,'breakfast');assert.equal(plan.days[0].breakfast.name,'Replacement meal');assert.equal(plan.days[0].totalCalories,600);
  });
  const loader=await load('1-ui-ux/src/app/services/dashboardLoader.ts');
  globalThis.fakeApi=apiDefaults();
  globalThis.fakeApi.residents.getAll=async()=>[{resident_id:'R1'}];
  globalThis.fakeApi.residents.getById=async()=>({resident_id:'R1',name:'Patient',age:65,allergies:'["Penicillin"]',prescriptions:[{prescription_id:'RX1',date_issued:'2026-10-04',medications:[{drug_name:'Example',dosage:'10mg',frequency:'daily',duration:'7 days',instructions:'After meals',confidence:0.9}]}]});
  globalThis.fakeApi.caretakers.getAll=async()=>[];globalThis.fakeApi.system.getComponents=async()=>[];
  globalThis.fakeApi.appointments.getAll=async()=>[{appointment_id:'A1',resident_id:'R1',appointment_date:'2026-10-08',appointment_time:'09:00 AM',status:'scheduled'}];
  const patient={userId:'UID1',name:'Patient',email:'patient@example.test',role:'patient',residentId:'R1'};
  await check('Dashboard reload preserves medication instructions and hydrates appointments',async()=>{
    const snapshot=await loader.loadDashboardSnapshot(patient);const medication=snapshot.getResident('R1').getAllMedications()[0];
    assert.equal(medication.duration,'7 days');assert.equal(medication.instructions,'After meals');assert.equal(snapshot.appointments[0].appointmentId,'A1');assert.deepEqual(snapshot.residents[0].personalDetails.allergies,['Penicillin']);
  });
  await check('A failed dashboard reload leaves the displayed snapshot intact',async()=>{
    const visible=new Dashboard();visible.addResident(new Resident('old','Existing resident',70));
    globalThis.fakeApi.appointments.getAll=async()=>{throw new Error('appointments unavailable');};
    await assert.rejects(()=>loader.loadDashboardSnapshot(patient),/appointments unavailable/);assert.equal(visible.residents[0].residentId,'old');
    globalThis.fakeApi.appointments.getAll=async()=>[];
  });
  const appMocks={
    WelcomeScreen:`export const WelcomeScreen='WelcomeScreen';`,SignInSignUp:`export const SignInSignUp='SignInSignUp';`,
    PatientDashboard:`export const PatientDashboard='PatientDashboard';`,CaretakerDashboard:`export const CaretakerDashboard='CaretakerDashboard';`,AdminDashboard:`export const AdminDashboard='AdminDashboard';`,
    firebaseAuthService:`export const onAuthStateChange=fn=>{globalThis.authObserver=fn;return()=>{};};export const fetchUserProfile=user=>globalThis.profileLoad(user);export const signOut=async()=>globalThis.authObserver(null);`,
    dashboardLoader:`export const loadDashboardSnapshot=user=>globalThis.snapshotLoad(user);export const publishDashboardSnapshot=(target,snapshot)=>{globalThis.published.push(snapshot.owner);Object.assign(target,snapshot);};`,
  };
  const {default:App}=await load('1-ui-ux/src/app/App.tsx',appMocks);
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
  function mount(){globalThis.hooks=hooks();let committed=false;let effect;globalThis.hooks.effect=fn=>{if(!committed){effect=fn;committed=true;}};const render=()=>{globalThis.hooks.reset();return App();};const tree=render();effect();return{tree,render};}
  await check('Signing out invalidates a pending website session load',async()=>{
    globalThis.published=[];const pending=deferred();globalThis.snapshotLoad=()=>pending.promise;globalThis.profileLoad=async user=>({uid:user.uid,name:'Admin',role:'admin',email:'admin@example.test'});
    const {render}=mount();globalThis.fakeAuth.currentUser={uid:'A'};globalThis.authObserver({uid:'A'});await tick();
    assert.ok(nodes(render(),n=>n.props?.role==='status').length);
    globalThis.fakeAuth.currentUser=null;globalThis.authObserver(null);pending.resolve({owner:'A',residents:[]});await tick();assert.equal(render().type,'SignInSignUp');assert.deepEqual(globalThis.published,[]);
  });
  await check('Only the newest account load can publish a website dashboard',async()=>{
    globalThis.published=[];const pendingA=deferred(),pendingB=deferred();globalThis.snapshotLoad=user=>user.userId==='A'?pendingA.promise:pendingB.promise;
    const {tree,render}=mount();tree.props.onContinue();const signIn=render();const user=id=>({userId:id,name:id,email:`${id}@example.test`,role:'admin'});
    globalThis.fakeAuth.currentUser={uid:'A'};const first=signIn.props.onComplete(user('A'));globalThis.fakeAuth.currentUser={uid:'B'};const second=signIn.props.onComplete(user('B'));
    pendingB.resolve({owner:'B',residents:[]});await second;pendingA.resolve({owner:'A',residents:[]});await first;
    assert.equal(nodes(render(),n=>n.props?.user)[0].props.user.userId,'B');assert.deepEqual(globalThis.published,['B']);
  });
  await check('An unavailable website profile shows a working retry action',async()=>{
    globalThis.published=[];globalThis.profileLoad=async()=>{throw new Error('Profile unavailable');};globalThis.snapshotLoad=async()=>({owner:'A',residents:[]});
    const {render}=mount();globalThis.fakeAuth.currentUser={uid:'A'};globalThis.authObserver({uid:'A'});await tick();assert.ok(nodes(render(),n=>n.props?.role==='alert').length);
    globalThis.profileLoad=async()=>({uid:'A',name:'Admin',role:'admin',email:'admin@example.test'});
    const retry=nodes(render(),n=>n.type==='button'&&n.props.children==='Try Again')[0];await retry.props.onClick();await tick();assert.equal(nodes(render(),n=>n.props?.user)[0].type,'AdminDashboard');assert.deepEqual(globalThis.published,['A']);
  });
  await check('A late login completion cannot start loading under another Firebase identity',async()=>{
    globalThis.published=[];let requests=0;globalThis.snapshotLoad=async()=>{requests++;return{owner:'A',residents:[]};};
    const {tree,render}=mount();tree.props.onContinue();globalThis.fakeAuth.currentUser={uid:'B'};
    await assert.rejects(()=>render().props.onComplete({userId:'A',name:'Old account',email:'old@example.test',role:'admin'}),/account changed/);
    assert.equal(requests,0);assert.deepEqual(globalThis.published,[]);
  });
  const transport=await load('1-ui-ux/src/app/services/apiService.ts',{apiService:null,firebaseAuthService:`export const getIdToken=()=>globalThis.tokenLoad();`});
  await check('A mutation supersedes a pending snapshot and queues fresh care records',async()=>{
    globalThis.published=[];globalThis.fakeAuth.currentUser={uid:'A'};const old=deferred();let calls=0;globalThis.snapshotLoad=async()=>{calls++;if(calls===2)return old.promise;return{owner:calls===1?'initial':'fresh',residents:[]};};globalThis.profileLoad=async()=>({uid:'A',name:'Admin',role:'admin',email:'admin@example.test'});
    const {render}=mount();globalThis.authObserver({uid:'A'});await tick();const props=()=>nodes(render(),n=>n.props?.user)[0].props;props().onRefresh();props().onRefresh();old.resolve({owner:'stale-before-mutation',residents:[]});await tick();assert.equal(calls,3);assert.deepEqual(globalThis.published,['initial','fresh']);
  });
  await check('A prescription without an issue date cannot reach persistence',async()=>{
    globalThis.fakeApi=apiDefaults();let calls=0;globalThis.fakeApi.prescriptions.create=async()=>{calls++;};
    const dashboard=new Dashboard();dashboard.addResident(new Resident('R-date','Patient',65));
    assert.equal(await dashboard.saveProcessedPrescription('R-date','Doctor',[new Medication('Example','10 mg','daily')]),false);assert.equal(calls,0);
  });
  await check('An account change during image upload prevents a prescription write',async()=>{
    globalThis.fakeAuth.currentUser={uid:'A'};globalThis.uploadPending=deferred();const {Dashboard:ScopedDashboard}=await load('1-ui-ux/src/app/models/Dashboard.ts',{storageService:`export const uploadPrescriptionImage=()=>globalThis.uploadPending.promise;`});const d=new ScopedDashboard();d.addResident(new Resident('R-upload','Patient',65));let writes=0;globalThis.fakeApi.prescriptions.create=async()=>{writes++;};
    const saving=d.saveProcessedPrescription('R-upload','Doctor',[new Medication('Example','10mg','daily')],{},'Patient','2026-10-05');globalThis.fakeAuth.currentUser={uid:'B'};globalThis.uploadPending.resolve({url:'offline-image'});assert.equal(await saving,false);assert.equal(writes,0);assert.equal(d.residents[0].prescriptions.length,0);
  });
  await check('An account change during offline emotion analysis prevents a wellness write',async()=>{
    globalThis.fakeAuth.currentUser={uid:'A'};const pending=deferred();const {Dashboard:ScopedDashboard}=await load('1-ui-ux/src/app/models/Dashboard.ts');const d=new ScopedDashboard();d.addResident(new Resident('R-emotion','Patient',65));d.emotionAnalysisEngine={analyzeResident:()=>pending.promise};let writes=0;globalThis.fakeApi.emotions.record=async()=>{writes++;};
    const analyzing=d.analyzeResidentEmotion('R-emotion');await tick();globalThis.fakeAuth.currentUser={uid:'B'};pending.resolve({emotionalState:new EmotionalState(new Date(),30)});await assert.rejects(()=>analyzing,/account changed/);assert.equal(writes,0);assert.equal(d.residents[0].emotionalStates.length,0);
  });
  await check('A lost Rx response retries the same ID and retains review evidence',async()=>{
    const dashboard=new Dashboard();dashboard.addResident(new Resident('R-retry','Patient',65));const medication=new Medication('Example','10 mg','daily');
    medication.needsReview=true;medication.verifiedByUser=true;medication.reviewReasons=['dose conflict'];medication.conflictingFields=['dosage'];medication.sourceDetails={regex:{candidates:[{drugName:'Example',dosage:'5 mg',frequency:'daily'}]}};
    const requests=[];globalThis.fakeApi.prescriptions.create=async data=>{requests.push(data);if(requests.length===1)throw new Error('response lost');return{};};
    assert.equal(await dashboard.saveProcessedPrescription('R-retry','Doctor',[medication],null,'Patient','2026-10-05'),false);
    assert.equal(await dashboard.saveProcessedPrescription('R-retry','Doctor',[medication],null,'Patient','2026-10-05'),true);
    assert.equal(requests[0].prescriptionId,requests[1].prescriptionId);assert.equal(requests[1].medications[0].confirmed,true);assert.deepEqual(requests[1].medications[0].reviewReasons,['dose conflict']);assert.equal(dashboard.residents[0].prescriptions.length,1);
  });
  const textOf=value=>Array.isArray(value)?value.map(textOf).join(' '):value&&typeof value==='object'?textOf(value.props?.children):value===null||value===undefined?'':String(value);
  await check('Patient summary preserves zero wellness and counts every active medicine',()=>{
    const r=new Resident('R-count','Patient',65);
    r.addEmotionalState(new EmotionalState(new Date(),0));r.getAllMedications=()=>Array.from({length:5},(_,i)=>new Medication('Medicine'+i,'10 mg','daily',i+1));
    globalThis.hooks=hooks();const tree=PatientDashboard({user:{name:'Patient'},resident:r,dashboard:{getAppointmentsForResident:()=>[]},onLogout(){},onRefresh(){}});
    assert.ok(/0\s*\/\s*5/.test(textOf(tree)));globalThis.hooks=hooks({0:'emotions'});const emotionsTree=PatientDashboard({user:{name:'Patient'},resident:r,dashboard:{getAppointmentsForResident:()=>[]},onLogout(){},onRefresh(){}});assert.ok(nodes(emotionsTree,n=>n.props?.children===0).length,'a valid zero remains visible');
  });
  await check('Medication buttons persist once and retain failure instead of reporting taken',async()=>{
    const r=new Resident('R-event','Patient',65);const {Prescription}=await load('1-ui-ux/src/app/models/Prescription.ts');const rx=new Prescription('RX-event',new Date(),'Doctor');rx.addMedication(new Medication('Example','10 mg','daily',12));r.addPrescription(rx);
    globalThis.hooks=hooks({0:'medications'});const render=()=>{globalThis.hooks.reset();return PatientDashboard({user:{name:'Patient'},resident:r,dashboard:{getAppointmentsForResident:()=>[]},onLogout(){},onRefresh(){}});};
    const pending=deferred();let calls=0;globalThis.fakeApi.medicationEvents.save=async(id,med,day,status)=>{calls++;assert.equal(id,'R-event');assert.equal(med,12);assert.match(day,/^\d{4}-\d{2}-\d{2}$/);assert.equal(status,'taken');return pending.promise;};
    const click=nodes(render(),n=>n.type==='button'&&n.props.children==='Taken')[0].props.onClick;click();click();assert.equal(calls,1);pending.reject(new Error('check-in unavailable'));await tick();assert.ok(textOf(render()).includes('check-in unavailable'));assert.ok(!textOf(render()).includes('Taken today'));
    globalThis.fakeApi.medicationEvents.save=async()=>({});nodes(render(),n=>n.type==='button'&&n.props.children==='Taken')[0].props.onClick();await tick();assert.ok(textOf(render()).includes('Taken today'));
  });
  const {PersistedCareAlerts}=await load('1-ui-ux/src/app/components/PersistedCareAlerts.tsx',{PersistedCareAlerts:null});
  await check('Failed persisted alert acknowledgement keeps the SOS visible',async()=>{
    globalThis.hooks=hooks({1:[{id:7,resident_name:'Patient',message:'Immediate help',created_at:new Date().toISOString()}]});const render=()=>{globalThis.hooks.reset();return PersistedCareAlerts({caretakerId:'UID-care'});};
    globalThis.fakeApi.sos.resolve=async()=>{throw new Error('resolve unavailable');};await nodes(render(),n=>n.type==='button'&&n.props.children==='Resolve emergency')[0].props.onClick();assert.ok(textOf(render()).includes('Immediate help'));assert.ok(textOf(render()).includes('resolve unavailable'));
    globalThis.fakeApi.sos.resolve=async()=>({});await nodes(render(),n=>n.type==='button'&&n.props.children==='Resolve emergency')[0].props.onClick();assert.ok(!textOf(render()).includes('Immediate help'));
  });
  await check('Wellness alerts render persisted note and a valid zero score',()=>{
    globalThis.hooks=hooks({0:[{id:8,resident_name:'Patient',note:'Please check in',severity:'critical',state_score:0,created_at:new Date().toISOString()}]});const tree=PersistedCareAlerts({includeSos:false});assert.ok(textOf(tree).includes('Please check in'));assert.ok(/Wellness score:\s*0\s*\/\s*100/.test(textOf(tree)));
  });
  await check('An assignment removal immediately hides the previously selected resident',()=>{
    const dashboard=new Dashboard();const r=new Resident('R-unassigned','Private resident',65);dashboard.addResident(r);const caretaker=new Caretaker('CT1','Carer','carer@example.test','','');dashboard.addCaretaker(caretaker);caretaker.assignedResidents=['R-unassigned'];
    globalThis.hooks=hooks({0:'residents',1:r});const render=()=>{globalThis.hooks.reset();return CaretakerDashboard({user:{userId:'CT1',name:'Carer',email:caretaker.email},dashboard,onLogout(){},onRefresh(){}});};assert.ok(textOf(render()).includes('Private resident'));caretaker.assignedResidents=[];dashboard.residents=[];assert.ok(!textOf(render()).includes('Private resident'));
  });
  await check('A wellness average excludes missing observations and preserves measured zero',()=>{
    const dashboard=new Dashboard();const measured=new Resident('R-measured','Measured',65);measured.addEmotionalState(new EmotionalState(new Date(),100));dashboard.addResident(measured);dashboard.addResident(new Resident('R-missing','Missing',65));globalThis.hooks=hooks();const tree=AdminDashboard({user:{name:'Admin'},dashboard,onLogout(){},onRefresh(){}});const average=nodes(tree,n=>n.type==='div'&&nodes(n.props?.children,c=>c.props?.children==='Avg Wellness').length)[0];assert.ok(textOf(average).includes('100'));assert.ok(!/\b50\b/.test(textOf(average)));
  });
  await check('Publishing refreshed records preserves a selected resident reference',()=>{
    const target=new Dashboard();const existing=new Resident('R-stable','Original',65);target.addResident(existing);const snapshot=new Dashboard();snapshot.addResident(new Resident('R-stable','Updated',66));loader.publishDashboardSnapshot(target,snapshot);assert.equal(target.residents[0],existing);assert.equal(existing.name,'Updated');
  });
  const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  const {datasetCollector}=await load('1-ui-ux/src/app/ml/dataset/DatasetCollector.ts',{DatasetCollector:null});
  await check('Optional dataset collection requires consent and excludes raw patient text',async()=>{
    storage.set('careconnect_dataset','RAW Patient Alice');datasetCollector.setScope('A');assert.equal(await datasetCollector.record(null,'RAW Patient Alice',[],.5,'model','upload'),'');assert.equal(storage.has('careconnect_dataset'),false);
    datasetCollector.setEnabled(true);await datasetCollector.record(null,'RAW Patient Alice',[{drugName:'Example',dosage:'10mg',frequency:'daily',wasCorreted:false,originalOCR:'RAW Patient Alice'}],.5,'model','upload');assert.equal(datasetCollector.getAnnotationCount(),1);assert.ok(!datasetCollector.exportAsJSON().includes('RAW Patient Alice'));assert.equal(datasetCollector.getStats().accuracyRate,null);
    datasetCollector.setScope('B');assert.equal(datasetCollector.isEnabled(),false);assert.equal(datasetCollector.getAnnotationCount(),0);datasetCollector.setScope('A');assert.equal(datasetCollector.getAnnotationCount(),1);datasetCollector.setEnabled(false);assert.equal(datasetCollector.getAnnotationCount(),0);
  });
  const {modelAccuracyTracker:tracker}=await load('1-ui-ux/src/app/ml/ensemble/ModelAccuracyTracker.ts',{ModelAccuracyTracker:null});
  await check('Accuracy uses the exact prediction and full source regimen without double counting',()=>{
    tracker.setScope('A');const truth={drugName:'Example',dosage:'10mg',frequency:'daily',duration:'7 days',instructions:'after meals'};
    const id=tracker.recordPrediction([{medication:truth,sources:['regex','donut'],confidence:.5,sourceDetails:{regex:{candidates:[truth]},donut:{candidates:[{...truth,dosage:'5mg'}]}}}]);
    tracker.recordCorrection('wrong-id',[truth]);assert.equal(tracker.getMetrics().ensemble.totalPredictions,0);tracker.recordCorrection(id,[truth]);assert.equal(tracker.getMetrics().ensemble.accuracy,1);assert.equal(tracker.getMetrics().regex.accuracy,1);assert.equal(tracker.getMetrics().donut.accuracy,0);
    tracker.recordCorrection(id,[truth]);assert.equal(tracker.getMetrics().ensemble.totalPredictions,1);tracker.recordCorrection(id,[{...truth,instructions:'before meals'}]);assert.equal(tracker.getMetrics().ensemble.accuracy,0);assert.ok(!tracker.exportMetrics().includes('Example'));tracker.setScope('B');assert.equal(tracker.getRecentPredictions().length,0);
  });
  await check('A prediction that completes after account replacement cannot enter the new scope',()=>{
    tracker.setScope('A');const token=tracker.getScopeToken();tracker.setScope('B');assert.equal(tracker.recordPrediction([{medication:{drugName:'Old account medicine',dosage:'10mg'},sources:['regex'],confidence:.5}],token),'');assert.equal(tracker.getRecentPredictions().length,0);assert.equal(tracker.getMetrics().totalPrescriptions,0);
  });
  await check('An unused model is unscored and source confidence uses its own evidence',()=>{
    tracker.setScope('model-evidence');const truth={drugName:'Example',dosage:'10mg',frequency:'daily'};const id=tracker.recordPrediction([{medication:truth,sources:['regex'],confidence:.6,sourceDetails:{regex:{confidence:.95,candidates:[{...truth,confidence:.95}]}}}]);tracker.recordCorrection(id,[truth]);const metrics=tracker.getMetrics();assert.equal(metrics.donut.totalPredictions,0);assert.equal(metrics.gemini.totalPredictions,0);assert.equal(metrics.regex.averageConfidence,.95);
  });
  await check('Website transport discards JSON received after an account switch',async()=>{
    globalThis.fakeAuth.currentUser={uid:'A'};globalThis.tokenLoad=async()=>'offline-token';
    globalThis.fetch=async()=>({ok:true,status:200,json:async()=>{globalThis.fakeAuth.currentUser={uid:'B'};return{private:'account A'};}});
    await assert.rejects(()=>transport.apiGet('/residents'),/account changed/);
  });
  await check('Website transport never sends an old account request after token resolution',async()=>{
    let requests=0;globalThis.fakeAuth.currentUser={uid:'A'};globalThis.tokenLoad=async()=>{globalThis.fakeAuth.currentUser={uid:'B'};return'old-token';};
    globalThis.fetch=async()=>{requests++;return response(200,{});};
    await assert.rejects(()=>transport.apiPost('/sos-alerts',{residentId:'A'}),/account changed/);assert.equal(requests,0);
  });
  console.log(`${assertions} offline web regression scenarios passed; no live API or Firebase calls.`);
}
module.exports={load,hooks,nodes,handler,apiDefaults};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
