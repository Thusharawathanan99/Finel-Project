// Explainable care-plan rules. Counts are observations, not inferred diagnoses.
import {hasActiveConsent,appendAudit} from './monitoringService.js';
import {parseJSON,isEnabled} from './monitoringConfig.js';
export function normalizeBaseline(value) {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw Error('Provide a baseline object');
  const result={};
  for (const [key,v] of Object.entries(value)) {
    if (['sleepStart','sleepEnd'].includes(key)) {
      if(typeof v!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))throw Error('Sleep periods require HH:MM');result[key]=v;
    } else if (key==='nightActivityEnabled') {
      if(typeof v!=='boolean')throw Error('Night activity must be explicitly enabled');result[key]=v;
    } else if (['inactivitySeconds','repeatWanderingCount','distressCheckins'].includes(key)) {
      const limits=key==='inactivitySeconds'?[30,86400]:[2,20];
      if(!Number.isInteger(v)||v<limits[0]||v>limits[1])throw Error('Invalid baseline threshold');result[key]=v;
    } else throw Error('Unknown baseline field');
  }
  if(result.nightActivityEnabled && (!result.sleepStart||!result.sleepEnd||result.sleepStart===result.sleepEnd))throw Error('Night activity requires a distinct start/end sleep period');
  return result;
}
const localMinutes=instant=>{const local=new Date(new Date(instant).getTime()+330*60_000);return local.getUTCHours()*60+local.getUTCMinutes();};
const clockMinutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
export function evaluateBehaviorSignals(events,checkins,baseline={}) {
  const reasons=[];
  const verified=events.filter(e=>e.review_status==='confirmed');
  const wandering=verified.filter(e=>e.activity==='wandering').length;
  if(wandering>=(baseline.repeatWanderingCount||3))reasons.push(`${wandering} caretaker-confirmed wandering observations occurred in the last hour.`);
  const negatives=checkins.filter(e=>e.category==='negative' && e.emotion_label==='Self-reported');
  if(negatives.length>=(baseline.distressCheckins||3))reasons.push(`${negatives.length} negative self-reported check-ins were recorded in the last 24 hours. Verify the resident's current concerns.`);
  if(baseline.nightActivityEnabled && baseline.sleepStart && baseline.sleepEnd) {
    const start=clockMinutes(baseline.sleepStart),end=clockMinutes(baseline.sleepEnd);
    const night=verified.filter(e=>['walking','wandering'].includes(e.activity)).filter(e=>{const m=localMinutes(e.observed_at);return start>end?m>=start||m<end:m>=start&&m<end;});
    if(night.length>=2)reasons.push(`${night.length} verified movement observations occurred during the resident's configured sleep period (Asia/Colombo).`);
  }
  return reasons;
}
export async function runResidentAnomalies(pool,now=new Date()) {
  const [rows]=await pool.execute(`SELECT b.resident_id,b.baseline,MIN(d.device_id) device_id FROM activity_baselines b JOIN monitoring_device_residents a ON a.resident_id=b.resident_id AND a.unassigned_at IS NULL JOIN monitoring_devices d ON d.device_id=a.device_id AND d.enabled=TRUE AND d.status<>'disabled' AND d.camera_state='running' GROUP BY b.resident_id,b.baseline`);
  for(const row of rows) {
    const c=await pool.getConnection();
    try {
      await c.beginTransaction();
      // Serialize with consent, observation review and care-plan changes before
      // reading signals. Earlier snapshots could resurrect a false-positive review.
      const [devices]=await c.execute('SELECT d.device_id,d.enabled,d.status,d.camera_state FROM monitoring_devices d JOIN monitoring_device_residents a ON a.device_id=d.device_id WHERE a.resident_id=? AND a.unassigned_at IS NULL ORDER BY d.device_id FOR UPDATE',[row.resident_id]);
      const device=devices.find(d=>isEnabled(d.enabled)&&d.status!=='disabled'&&d.camera_state==='running');
      if(!device||!await hasActiveConsent(c,row.resident_id,'camera',now)||!await hasActiveConsent(c,row.resident_id,'activity',now)){await c.rollback();continue;}
      const [baselines]=await c.execute('SELECT baseline FROM activity_baselines WHERE resident_id=? FOR UPDATE',[row.resident_id]);
      if(!baselines.length){await c.rollback();continue;}
      const [events]=await c.execute('SELECT activity,observed_at,review_status FROM activity_events WHERE resident_id=? AND observed_at BETWEEN ? AND ? ORDER BY observed_at DESC LIMIT 500',[row.resident_id,new Date(now.getTime()-3600_000),now]);
      let checkins=[];
      if(await hasActiveConsent(c,row.resident_id,'emotion',now))[checkins]=await c.execute("SELECT category,emotion_label,recorded_at FROM emotional_states WHERE resident_id=? AND emotion_label='Self-reported' AND recorded_at BETWEEN ? AND ? ORDER BY recorded_at DESC LIMIT 100",[row.resident_id,new Date(now.getTime()-86_400_000),now]);
      const verifiedReasons=evaluateBehaviorSignals(events,checkins,parseJSON(baselines[0].baseline)||{});
      if(!verifiedReasons.length){await c.rollback();continue;}
      const [existing]=await c.execute("SELECT incident_id FROM monitoring_incidents WHERE resident_id=? AND incident_type='combined_risk' AND (status IN ('open','acknowledged') OR detected_at>?) LIMIT 1",[row.resident_id,new Date(now.getTime()-3600_000)]);
      if(!existing.length){
        const [created]=await c.execute("INSERT INTO monitoring_incidents (resident_id,device_id,incident_type,severity,reason,recommended_action,detected_at) VALUES (?,?,'combined_risk','warning',?,?,?)",[row.resident_id,device.device_id,verifiedReasons.join(' ').slice(0,1000),'Review the observations with the resident and verify whether care assistance is needed. These observations are not a diagnosis.',now]);
        await appendAudit(c,{actorType:'system',actorId:'care-plan-rules-v1',action:'behavior_pattern_flagged',resourceType:'monitoring_incident',resourceId:String(created.insertId),residentId:row.resident_id,details:{reasonCount:verifiedReasons.length}});
      }
      await c.commit();
    }catch(error){await c.rollback().catch(()=>{});throw error;}finally{c.release();}
  }
}
