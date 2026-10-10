import admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';
import pool from './db.js';
import { effectiveResidentIds } from './careScope.js';

export async function careRecipients(connection,residentId){
  const [accounts]=await connection.execute("SELECT id,email,role,resident_id FROM users WHERE role IN ('admin','patient','caretaker')");
  const ids=[];
  for(const account of accounts){
    if(account.role==='admin'||account.role==='patient'&&account.resident_id===residentId){ids.push(account.id);continue;}
    if(account.role!=='caretaker')continue;
    const [staff]=await connection.execute('SELECT caretaker_id FROM caretakers WHERE LOWER(email)=LOWER(?) AND is_active=TRUE',[account.email]);
    if((await effectiveResidentIds(connection,staff.map(row=>row.caretaker_id))).includes(residentId))ids.push(account.id);
  }
  return [...new Set(ids)];
}
export function careSignal(kind,details={}){
  // This is an invalidation signal. Clients fetch clinical content through the
  // authenticated SQL API; cloud listeners never contain faces, audio or notes.
  return {kind,version:randomUUID(),changedAt:new Date(),experimental:details.provenance==='experimental-assessment',
    reviewRequired:details.provenance==='experimental-assessment'||details.reviewRequired===true};
}
export async function publishCareUpdate(kind,residentId,details={}){
  if(process.env.FIREBASE_REALTIME_ENABLED!=='true')return {published:false,reason:'not_configured'};
  let timer;
  try{
    const publish=async()=>{
      const recipients=await careRecipients(pool,residentId);
      if(!recipients.length)return {published:false,reason:'no_recipients'};
      const db=admin.firestore(),signal=careSignal(kind,details);
      const outcomes=await Promise.allSettled(recipients.map(uid=>db.doc(`users/${uid}/care_updates/latest`).set(signal)));
      return {published:outcomes.every(result=>result.status==='fulfilled')};
    };
    return await Promise.race([publish(),new Promise(resolve=>{timer=setTimeout(()=>resolve({published:false,reason:'timeout'}),3000);})]);
  }catch(error){console.error('[Care realtime]',error.code||'PUBLISH_UNAVAILABLE');return {published:false,reason:'unavailable'};}
  finally{clearTimeout(timer);}
}
export async function publishEmotionObservation(req,result,body){
  if(!req.user?.uid||result.status>=300)return {published:false,reason:'not_committed'};
  return publishCareUpdate('emotion',body.residentId,body);
}
