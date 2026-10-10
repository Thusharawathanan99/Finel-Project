// Synthetic fixtures and real SQL/handlers, enclosed in one rolled-back transaction.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import pool from '../db.js';
import caretakerRoutes from '../routes/caretakers.js';
import residentsRoutes from '../routes/residents.js';
import sosRoutes from '../routes/sos.js';
import {effectiveResidentIds,colomboDay} from '../careScope.js';
import {createSosStream} from '../sosRealtime.js';
const id=()=>`TEST-${randomUUID()}`;
const residentId=id(),original=id(),replacement=id(),adminUid=id(),caretakerUid=id(),today=colomboDay();
let connection;
const originalExecute=pool.execute,originalConnection=pool.getConnection;
const response=()=>({statusCode:200,status(code){this.statusCode=code;return this;},json(data){this.data=data;return this;}});
try{
  connection=await pool.getConnection();await connection.beginTransaction();
  await connection.execute('INSERT INTO residents (resident_id,name,room_number,floor_number) VALUES (?,?,?,?)',[residentId,'Synthetic resident','T-1','2']);
  for(const [caretakerId,name]of [[original,'Synthetic original'],[replacement,'Synthetic replacement']])await connection.execute('INSERT INTO caretakers (caretaker_id,name,email,is_active) VALUES (?,?,?,TRUE)',[caretakerId,name,`${caretakerId}@example.invalid`]);
  await connection.execute("INSERT INTO users (id,name,email,role) VALUES (?,?,?,'admin'),(?,?,?,'caretaker')",[adminUid,'Synthetic reviewer',`${adminUid}@example.invalid`,caretakerUid,'Synthetic replacement',`${replacement}@example.invalid`]);
  await connection.execute('INSERT INTO caretaker_residents (caretaker_id,resident_id) VALUES (?,?)',[original,residentId]);
  pool.execute=(...args)=>connection.execute(...args);
  pool.getConnection=async()=>({execute:(...args)=>connection.execute(...args),beginTransaction:()=>connection.query('SAVEPOINT test_feature'),commit:async()=>{},rollback:()=>connection.query('ROLLBACK TO SAVEPOINT test_feature'),release:()=>{}});
  const admin={uid:adminUid,role:'admin',email:`${adminUid}@example.invalid`,profile:{name:'Synthetic reviewer'}};
  const invoke=async(router,method,path,req,status=200)=>{
    const route=router.stack.find(item=>item.route?.path===path&&item.route.methods[method]);const res=response();
    await route.route.stack[0].handle({user:admin,body:{},params:{},query:{},residentScope:null,...req},res);assert.equal(res.statusCode,status,res.data?.error);return res.data;
  };
  const leave=await invoke(caretakerRoutes,'post','/:id/leave-requests',{user:{uid:id(),role:'caretaker',profile:{name:'Synthetic original'}},authorizedCaretakerId:original,params:{id:original},body:{startDate:today,endDate:today,reason:'Synthetic request',caretakerName:'Spoofed name'}},201);
  const review={params:{caretakerId:original,requestId:leave.requestId},body:{status:'approved',temporaryReplacement:replacement,reviewedBy:'Spoofed reviewer'}};
  assert.deepEqual(await effectiveResidentIds(connection,[replacement],today),[]);
  await invoke(caretakerRoutes,'put','/:caretakerId/leave-requests/:requestId',review);
  assert.deepEqual(await effectiveResidentIds(connection,[original],today),[]);
  assert.deepEqual(await effectiveResidentIds(connection,[replacement],today),[residentId]);
  const tomorrow=new Date(Date.parse(`${today}T00:00:00Z`)+86400000).toISOString().slice(0,10);
  assert.deepEqual(await effectiveResidentIds(connection,[replacement],tomorrow),[]);assert.deepEqual(await effectiveResidentIds(connection,[original],tomorrow),[residentId]);
  assert.equal((await invoke(caretakerRoutes,'put','/:caretakerId/leave-requests/:requestId',review)).replayed,true);
  await invoke(caretakerRoutes,'put','/:caretakerId/leave-requests/:requestId',{...review,body:{status:'rejected'}},409);
  const [saved]=await connection.execute('SELECT caretaker_name,reviewed_by,temporary_replacement FROM leave_requests WHERE request_id=?',[leave.requestId]);
  assert.equal(saved[0].caretaker_name,'Synthetic original');assert.equal(saved[0].reviewed_by,'Synthetic reviewer');assert.equal(saved[0].temporary_replacement,replacement);
  const residentList=await invoke(residentsRoutes,'get','/',{});const resident=residentList.find(row=>row.resident_id===residentId);assert.equal(Number(resident.medication_count),0);assert.equal(Number(resident.prescription_count),0);
  await invoke(sosRoutes,'post','/sos-alerts',{user:{uid:caretakerUid,role:'caretaker',profile:{name:'Synthetic replacement'}},residentScope:[residentId],body:{residentId,requestId:randomUUID(),message:'Synthetic panic alert'}},201);
  const alerts=await invoke(sosRoutes,'get','/sos-alerts',{});const alert=alerts.find(row=>row.resident_id===residentId);assert.equal(alert.caretaker_name,'Synthetic replacement');assert.match(alert.location,/T-1/);
  const req=new EventEmitter();req.user=admin;const frames=[];const res={status(){return this;},set(){return this;},flushHeaders(){},write(frame){frames.push(frame);},end(){this.writableEnded=true;}};
  await createSosStream(connection)(req,res);req.emit('close');assert.ok(frames.some(frame=>frame.includes('event: alerts')&&frame.includes('Synthetic panic alert')));
  await invoke(caretakerRoutes,'put','/reassign-resident',{body:{residentId,fromCaretakerId:original,toCaretakerId:null}});
  assert.deepEqual(await effectiveResidentIds(connection,[replacement],today),[]);
  await connection.rollback();
  const [remaining]=await connection.execute('SELECT COUNT(*) count FROM residents WHERE resident_id=?',[residentId]);assert.equal(Number(remaining[0].count),0);
  console.log('PASS real SQL leave approval/replay/expiry, temporary scopes, unassignment, profile summaries and authenticated SOS stream; all synthetic rows rolled back.');
}catch(error){if(connection)await connection.rollback().catch(()=>{});console.error(error.message);process.exitCode=1;}
finally{pool.execute=originalExecute;pool.getConnection=originalConnection;connection?.release();await pool.end();}
