import { appendAudit } from './monitoringService.js';
import { parseJSON, DEFAULT_SETTINGS, isEnabled } from './monitoringConfig.js';
import { runResidentAnomalies } from './behaviorAnomalies.js';

export async function runMonitoringMaintenance(pool, now = new Date(), { retentionDays = 30 } = {}) {
  const [devices] = await pool.execute("SELECT device_id,last_seen_at,created_at,last_health,settings FROM monitoring_devices WHERE enabled=TRUE AND camera_state='running' AND status<>'disabled'");
  for (const device of devices) {
    const settings={...DEFAULT_SETTINGS,...parseJSON(device.settings)};
    const last=new Date(device.last_seen_at||device.created_at);
    const cameraFailed=parseJSON(device.last_health)?.cameraAvailable === false;
    if (!cameraFailed && now.getTime()-last.getTime()<settings.offlineTimeoutSeconds*1000) continue;
    const c=await pool.getConnection();
    try {
      await c.beginTransaction();
      const [locked]=await c.execute('SELECT device_id,camera_state,enabled,status,last_seen_at,created_at,last_health,settings FROM monitoring_devices WHERE device_id=? FOR UPDATE',[device.device_id]);
      if (!locked.length || !isEnabled(locked[0].enabled) || locked[0].status==='disabled' || locked[0].camera_state!=='running') {await c.rollback();continue;}
      const current=locked[0];
      const currentSettings={...DEFAULT_SETTINGS,...parseJSON(current.settings)};
      const currentCameraFailed=parseJSON(current.last_health)?.cameraAvailable===false;
      const currentLast=new Date(current.last_seen_at||current.created_at||device.created_at);
      if (!currentCameraFailed && now.getTime()-currentLast.getTime()<currentSettings.offlineTimeoutSeconds*1000) {await c.rollback();continue;}
      const [open]=await c.execute("SELECT incident_id FROM monitoring_incidents WHERE device_id=? AND incident_type='device_offline' AND status IN ('open','acknowledged') LIMIT 1",[device.device_id]);
      await c.execute("UPDATE monitoring_devices SET status='offline' WHERE device_id=?",[device.device_id]);
      if(!open.length) {
        await c.execute("INSERT INTO monitoring_incidents (device_id,incident_type,severity,reason,recommended_action,detected_at) VALUES (?,'device_offline','warning',?,?,?)",[device.device_id,currentCameraFailed?'The device reported a camera connection failure.':'The monitoring heartbeat exceeded the configured timeout.','Check power, camera and network connectivity. Verify resident safety while monitoring is unavailable.',now]);
        await appendAudit(c,{actorType:'system',actorId:'monitoring-maintenance',action:'device_offline_detected',resourceType:'monitoring_device',resourceId:device.device_id});
      }
      await c.commit();
    } catch(error) {await c.rollback().catch(()=>{});throw error;} finally {c.release();}
  }
  // Only derived observations and telemetry expire; consent/audit/incident records
  // remain reviewable. No camera image storage exists in this pipeline.
  if (Number.isInteger(retentionDays) && retentionDays>=1 && retentionDays<=3650) {
    const before=new Date(now.getTime()-retentionDays*86_400_000);
    await pool.execute('DELETE FROM monitoring_device_health WHERE captured_at < ?',[before]);
    await pool.execute("DELETE a FROM activity_events a LEFT JOIN monitoring_incidents i ON i.event_id=a.event_id AND i.status IN ('open','acknowledged') WHERE a.observed_at < ? AND i.incident_id IS NULL",[before]);
  }
}
export function startMonitoringMaintenance(pool) {
  let running=false;
  const cycle=async()=>{if(running)return;running=true;try{await runMonitoringMaintenance(pool,new Date(),{retentionDays:Number(process.env.MONITORING_RETENTION_DAYS||30)});await runResidentAnomalies(pool);}catch(error){console.error('[Monitoring maintenance]',error.code||'CYCLE_FAILED');}finally{running=false;}};
  const timer=setInterval(cycle,30_000);timer.unref();void cycle();return ()=>clearInterval(timer);
}
