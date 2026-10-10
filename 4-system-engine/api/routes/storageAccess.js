import {Router} from 'express';
import admin from 'firebase-admin';
import {canAccessResident} from '../middleware/authorization.js';
const router=Router();
router.post('/storage/prescriptions/:residentId/access',async(req,res)=>{
  if(!req.user?.uid||!req.user.profile)return res.status(401).json({error:'Authentication required'});
  if(!['patient','caretaker'].includes(req.user.role)||!canAccessResident(req,req.params.residentId))return res.status(403).json({error:'Prescription image access is limited to the resident and assigned care staff'});
  try{
    const expiresAt=new Date(Date.now()+60_000);
    await admin.firestore().doc(`storage_access/${req.user.uid}/residents/${req.params.residentId}`).set({role:req.user.role,expiresAt});
    return res.json({uid:req.user.uid,residentId:req.params.residentId,expiresAt:expiresAt.toISOString()});
  }catch(error){console.error('[Prescription storage]',error.code||'GRANT_UNAVAILABLE');return res.status(503).json({error:'Secure image storage access is unavailable; save reviewed prescription details without an image and try later'});}
});
export default router;
