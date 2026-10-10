// Actual SQL integration using only synthetic rows inside one rolled-back
// transaction. No Firebase identity, existing resident, push or camera is used.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pool from '../db.js';
import {recordActivityEvent,hasActiveConsent} from '../monitoringService.js';
import {runResidentAnomalies} from '../behaviorAnomalies.js';
import {materializeReminders,calendarDay,doseInstant} from '../medicationScheduling.js';
import pushDevices from '../routes/pushDevices.js';
import monitoringRoutes from '../routes/monitoring.js';
import {enqueue,deliveryStillRelevant,registrationKey} from '../notificationService.js';
const residentId=`TEST-${randomUUID()}`,deviceId=`TEST-${randomUUID()}`,rxId=`TEST-${randomUUID()}`;
let connection;
try{
  connection=await pool.getConnection();await connection.beginTransaction();
  await connection.execute('INSERT INTO residents (resident_id,name) VALUES (?,?)',[residentId,'Synthetic integration fixture']);
  await connection.execute("INSERT INTO monitoring_devices (device_id,name,device_type,enabled,camera_state,created_by_uid) VALUES (?,?,'simulator',TRUE,'running',?)",[deviceId,'Synthetic integration camera','synthetic-test']);
  await connection.execute('INSERT INTO monitoring_device_residents (device_id,resident_id,assigned_by_uid) VALUES (?,?,?)',[deviceId,residentId,'synthetic-test']);
  for(const scope of ['camera','activity'])await connection.execute("INSERT INTO monitoring_consents (resident_id,scope,status,granted_by_uid,subject_role,notes) VALUES (?,?,'granted',?,'resident',?)",[residentId,scope,'synthetic-test','Synthetic fixture, not participant consent']);
  // Service savepoints preserve the outer rollback; no service commit is durable.
  const adapter={execute:(...args)=>connection.execute(...args),getConnection:async()=>({execute:(...args)=>connection.execute(...args),beginTransaction:()=>connection.query('SAVEPOINT test_event'),commit:async()=>{},rollback:()=>connection.query('ROLLBACK TO SAVEPOINT test_event'),release:()=>{}})};
  const event={requestId:randomUUID(),residentId,activity:'fall',confidence:0.9,observedAt:new Date().toISOString(),modelVersion:'synthetic-sequence-v1',evidence:{trackId:1,durationMs:1500}};
  const first=await recordActivityEvent(adapter,{device_id:deviceId},event);assert.equal(first.status,201);assert.ok(first.body.incidentId);
  const replay=await recordActivityEvent(adapter,{device_id:deviceId},event);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
  const conflict=await recordActivityEvent(adapter,{device_id:deviceId},{...event,confidence:0.8});assert.equal(conflict.status,409);
  // A device clock ahead by one minute must not create an impossible negative
  // response time. Execute the real acknowledgement, listing and report handlers
  // against MySQL; only the report read is scoped to this synthetic device.
  const future=await recordActivityEvent(adapter,{device_id:deviceId},{...event,requestId:randomUUID(),observedAt:new Date(Date.now()+60_000).toISOString()});
  assert.equal(future.status,201);
  await connection.execute("UPDATE monitoring_incidents SET status='acknowledged',acknowledged_at=? WHERE incident_id=?",[new Date(Date.parse(event.observedAt)+30_000),first.body.incidentId]);
  const originalMonitoringExecute=pool.execute,originalMonitoringConnection=pool.getConnection;
  pool.execute=(sql,values=[])=>sql.includes('FROM monitoring_incidents GROUP BY')
    ?connection.execute(sql.replace('FROM monitoring_incidents GROUP BY','FROM monitoring_incidents WHERE device_id=? GROUP BY'),[deviceId])
    :connection.execute(sql,values);
  pool.getConnection=adapter.getConnection;
  try{
    const invoke=async(method,path,req={},expectedStatus=200)=>{
      const handler=monitoringRoutes.stack.find(item=>item.route?.path===path&&item.route.methods[method]).route.stack[0].handle;
      const result={statusCode:200,status(code){this.statusCode=code;return this;},json(data){this.data=data;return this;}};
      await handler({user:{uid:'synthetic-test',role:'admin',profile:{}},params:{},query:{},body:{},...req},result);
      assert.equal(result.statusCode,expectedStatus,result.data?.error);return result.data;
    };
    await invoke('post','/incidents/:id/actions',{params:{id:String(future.body.incidentId)},body:{action:'acknowledged'}});
    const incidents=await invoke('get','/incidents',{query:{all:'true',residentId}});
    assert.equal(incidents.find(row=>Number(row.incident_id)===Number(future.body.incidentId)).response_time_seconds,null);
    assert.equal(incidents.find(row=>Number(row.incident_id)===Number(first.body.incidentId)).response_time_seconds,30);
    const report=await invoke('get','/report'),fall=report.metrics.find(row=>row.incident_type==='fall');
    assert.equal(Number(fall.incident_count),2);assert.equal(Number(fall.clock_skew_count),1);assert.equal(Number(fall.average_response_seconds),30);
    const walking=await recordActivityEvent(adapter,{device_id:deviceId},{...event,requestId:randomUUID(),activity:'walking'});
    assert.equal(walking.status,201);assert.equal(walking.body.incidentId,null);
    const reviewRequest={params:{id:residentId,eventId:walking.body.eventId},body:{status:'confirmed',notes:'Synthetic fixture: caretaker confirmed walking'}};
    const review=await invoke('post','/residents/:id/events/:eventId/review',reviewRequest);assert.equal(review.reviewStatus,'confirmed');
    assert.equal((await invoke('post','/residents/:id/events/:eventId/review',reviewRequest)).replayed,true);
    await invoke('post','/residents/:id/events/:eventId/review',{...reviewRequest,params:{id:residentId,eventId:first.body.eventId}},409);
    await invoke('put','/residents/:id/baseline',{params:{id:residentId},body:{baseline:{repeatWanderingCount:2}}});
    for(let i=0;i<2;i++){
      const wandering=await recordActivityEvent(adapter,{device_id:deviceId},{...event,requestId:randomUUID(),activity:'wandering'});
      assert.equal(wandering.status,201);
      await invoke('post','/incidents/:id/actions',{params:{id:String(wandering.body.incidentId)},body:{action:'resolved',notes:'Synthetic confirmed observation, resident safe'}});
    }
    await runResidentAnomalies(adapter);await runResidentAnomalies(adapter);
    const [patterns]=await connection.execute("SELECT COUNT(*) count FROM monitoring_incidents WHERE resident_id=? AND incident_type='combined_risk'",[residentId]);
    assert.equal(Number(patterns[0].count),1);
    await connection.execute('UPDATE monitoring_devices SET settings=? WHERE device_id=?',[JSON.stringify({inactivitySeconds:900,enabledActivities:['fall','walking']}),deviceId]);
    await invoke('put','/devices/:id',{params:{id:deviceId},body:{settings:{offlineTimeoutSeconds:120}}});
    const [configured]=await connection.execute('SELECT settings FROM monitoring_devices WHERE device_id=?',[deviceId]);
    const settings=typeof configured[0].settings==='string'?JSON.parse(configured[0].settings):configured[0].settings;
    assert.equal(settings.inactivitySeconds,900);assert.deepEqual(settings.enabledActivities,['fall','walking']);assert.equal(settings.offlineTimeoutSeconds,120);
  }finally{pool.execute=originalMonitoringExecute;pool.getConnection=originalMonitoringConnection;}
  await connection.execute("INSERT INTO monitoring_consents (resident_id,scope,status,granted_by_uid,subject_role) VALUES (?,'camera','withdrawn',?,'resident')",[residentId,'synthetic-test']);
  assert.equal(await hasActiveConsent(connection,residentId,'camera'),false);
  assert.equal((await recordActivityEvent(adapter,{device_id:deviceId},{...event,requestId:randomUUID()})).status,403);
  const day=calendarDay();await connection.execute('INSERT INTO prescriptions (prescription_id,resident_id,date_issued) VALUES (?,?,?)',[rxId,residentId,day]);
  const [medicine]=await connection.execute("INSERT INTO medications (prescription_id,drug_name,dosage,confirmed,needs_review) VALUES (?,?,'synthetic',TRUE,FALSE)",[rxId,'Synthetic medicine — never administered']);
  await connection.execute('INSERT INTO medication_schedules (resident_id,medication_id,times,weekdays,start_date,created_by_uid) VALUES (?,?,?,?,?,?)',[residentId,medicine.insertId,JSON.stringify(['08:00','20:00']),JSON.stringify([0,1,2,3,4,5,6]),day,'synthetic-test']);
  await materializeReminders(connection,new Date(),{residentId,day});await materializeReminders(connection,new Date(),{residentId,day});
  const [doses]=await connection.execute('SELECT scheduled_at FROM medication_reminders WHERE resident_id=? ORDER BY scheduled_at',[residentId]);assert.equal(doses.length,2);assert.equal(doses[0].scheduled_at.toISOString(),doseInstant(day,'08:00').toISOString());
  // Exercise the production registration route and enqueue SQL inside this
  // transaction. Its commits/releases become savepoint operations, so no
  // account registration or provider delivery survives the test.
  const ownerUid=`test-push-${randomUUID()}`,installationId=randomUUID(),installationKey='a'.repeat(64),projectId=randomUUID();
  const pushToken=`ExpoPushToken[${randomUUID().replaceAll('-','')}]`;
  await connection.execute("INSERT INTO users (id,name,email,role,resident_id) VALUES (?,? ,?,'patient',?)",[ownerUid,'Synthetic push account',`${ownerUid}@example.invalid`,residentId]);
  const savedGetConnection=pool.getConnection;
  const pushConnection={execute:(...args)=>connection.execute(...args),beginTransaction:()=>connection.query('SAVEPOINT test_push_route'),commit:async()=>{},rollback:()=>connection.query('ROLLBACK TO SAVEPOINT test_push_route'),release:()=>{}};
  pool.getConnection=async()=>pushConnection;
  try{
    const route=method=>pushDevices.stack.find(item=>item.route?.path==='/push-devices'&&item.route.methods[method]).route.stack[0].handle;
    const call=async(method,body,uid=ownerUid)=>{const result={statusCode:200,status(code){this.statusCode=code;return this;},json(data){this.data=data;return this;}};await route(method)({body,user:{uid,role:'patient',profile:{}}},result);assert.equal(result.statusCode,200,result.data?.error);return result.data;};
    const registration={installationId,installationKey,projectId,token:pushToken,platform:'android'};
    const registered=await call('post',registration);
    const [reminders]=await connection.execute('SELECT * FROM medication_reminders WHERE resident_id=? ORDER BY scheduled_at',[residentId]);
    const reminder=reminders[0],cycleNow=new Date(reminder.scheduled_at.getTime()+60_000);
    const source={key:`medication:${reminder.reminder_id}:${reminder.delivery_round}`,type:'medication',id:reminder.reminder_id,residentId};
    await enqueue(connection,source,cycleNow);await enqueue(connection,source,cycleNow);
    const [firstRows]=await connection.execute('SELECT * FROM push_deliveries WHERE device_id=?',[registered.deviceId]);
    assert.equal(firstRows.length,1);assert.equal(firstRows[0].registration_version,1);
    assert.equal(firstRows[0].source_key,`${source.key}:${registrationKey(firstRows[0])}`);
    assert.ok(await deliveryStillRelevant(connection,firstRows[0],cycleNow));
    await call('delete',{installationId,installationKey});await call('post',registration);await call('post',registration);
    const [reenabled]=await connection.execute('SELECT registration_version FROM push_devices WHERE device_id=?',[registered.deviceId]);assert.equal(reenabled[0].registration_version,2);
    await enqueue(connection,source,cycleNow);await enqueue(connection,source,cycleNow);
    const [renewedRows]=await connection.execute('SELECT * FROM push_deliveries WHERE device_id=? ORDER BY delivery_id',[registered.deviceId]);
    assert.equal(renewedRows.length,2);assert.equal(renewedRows[0].status,'cancelled');assert.equal(renewedRows[1].registration_version,2);
    assert.notEqual(renewedRows[0].source_key,renewedRows[1].source_key);assert.equal(renewedRows[1].source_key,`${source.key}:${registrationKey(renewedRows[1])}`);
    assert.equal(await deliveryStillRelevant(connection,renewedRows[0],cycleNow),null);assert.ok(await deliveryStillRelevant(connection,renewedRows[1],cycleNow));
    await call('post',registration,'different-synthetic-owner');
    await call('post',{...registration,token:`ExpoPushToken[${randomUUID().replaceAll('-','')}]`},'different-synthetic-owner');
    const [rotated]=await connection.execute('SELECT registration_version FROM push_devices WHERE device_id=?',[registered.deviceId]);assert.equal(rotated[0].registration_version,4);
  }finally{pool.getConnection=savedGetConnection;}
  await connection.rollback();
  const [remaining]=await connection.execute('SELECT COUNT(*) AS count FROM residents WHERE resident_id=?',[residentId]);assert.equal(Number(remaining[0].count),0);
  const [remainingPush]=await connection.execute('SELECT COUNT(*) AS count FROM push_devices WHERE installation_id=?',[installationId]);assert.equal(Number(remainingPush[0].count),0);
  console.log('PASS actual MySQL consent, incident response reports, verified activity review/anomaly rules, partial settings, timezone doses and push delivery generations; every synthetic row rolled back.');
}catch(error){if(connection)await connection.rollback().catch(()=>{});console.error(error.message);process.exitCode=1;}finally{connection?.release();await pool.end();}
