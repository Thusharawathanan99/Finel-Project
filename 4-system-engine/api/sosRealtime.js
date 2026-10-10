import {EventEmitter} from 'node:events';
import {effectiveResidentIds} from './careScope.js';
export const sosChanges=new EventEmitter();
sosChanges.setMaxListeners(100);

export const sosSelect=`SELECT a.*,CASE WHEN u.role='caretaker' THEN u.name ELSE NULL END caretaker_name,
  COALESCE(NULLIF(CONCAT_WS(' / ',NULLIF(r.room_number,''),CASE WHEN r.floor_number IS NULL THEN NULL ELSE CONCAT('Floor ',r.floor_number) END),''),'Unspecified location') location
  FROM sos_alerts a LEFT JOIN users u ON u.id=a.requested_by_uid LEFT JOIN residents r ON r.resident_id=a.resident_id`;

export async function streamResidentScope(connection,user){
  if(user.tokenExpiresAt&&user.tokenExpiresAt<=Date.now())throw Error('Session expired');
  const [profiles]=await connection.execute('SELECT id,role,resident_id FROM users WHERE id=? LIMIT 1',[user.uid]);
  if(!profiles.length||profiles[0].id!==user.uid||profiles[0].role!==user.role)throw Error('Account access changed');
  if(user.role==='admin')return null;
  if(user.role!=='caretaker')throw Error('Staff access required');
  const [staff]=await connection.execute('SELECT caretaker_id FROM caretakers WHERE LOWER(email)=LOWER(?) AND is_active=TRUE',[user.email]);
  return effectiveResidentIds(connection,staff.map(row=>row.caretaker_id));
}
export function createSosStream(connection,{intervalMs=2000,lifetimeMs=60000}={}){
  return async(req,res)=>{
    if(!req.user?.uid||!req.user.profile)return res.status(401).json({error:'Authentication required'});
    if(!['admin','caretaker'].includes(req.user.role))return res.status(403).json({error:'Staff emergency stream access required'});
    let closed=false,busy=false,previous=null,interval,lifetime;
    const close=()=>{if(closed)return;closed=true;clearInterval(interval);clearTimeout(lifetime);sosChanges.off('change',refresh);if(!res.writableEnded)res.end();};
    const refresh=async()=>{
      if(closed||busy)return;busy=true;
      try{
        const scope=await streamResidentScope(connection,req.user);
        let rows=[];
        if(scope===null||scope.length){
          [rows]=await connection.execute(`${sosSelect} WHERE a.is_resolved=FALSE${scope===null?'':` AND a.resident_id IN (${scope.map(()=>'?').join(',')})`} ORDER BY a.created_at DESC LIMIT 100`,scope||[]);
        }
        if(closed)return;
        const snapshot=JSON.stringify(rows);
        if(snapshot!==previous){previous=snapshot;res.write(`event: alerts\ndata: ${snapshot}\n\n`);}
        else res.write(': heartbeat\n\n');
      }catch{close();}finally{busy=false;}
    };
    res.status(200);res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders?.();
    req.on('close',close);res.on?.('error',close);
    interval=setInterval(refresh,intervalMs);interval.unref?.();lifetime=setTimeout(close,lifetimeMs);lifetime.unref?.();
    sosChanges.on('change',refresh);await refresh();
  };
}
