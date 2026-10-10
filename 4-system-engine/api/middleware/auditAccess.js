import pool from '../db.js';
import {appendAudit} from '../monitoringService.js';

// Log authorized access attempts without copying clinical content or query values.
export async function auditAccessMiddleware(req,res,next) {
  if(req.method!=='GET'||!req.user?.profile||!/^\/(residents|prescriptions|appointments|emotions|sos-alerts)(?:\/|$)/.test(req.path))return next();
  try {
    await appendAudit(pool,{actorType:'user',actorId:req.user.uid,action:'record_access',resourceType:'api_record',resourceId:req.path.slice(0,128)});
    return next();
  }catch(error){console.error('[Record audit]',error.code||'AUDIT_FAILED');return res.status(503).json({error:'Record access could not be audited. Please retry.'});}
}
