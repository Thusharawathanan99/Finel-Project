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

router.get('/storage/prescriptions/:residentId/image-url', async (req, res) => {
  if (!req.user?.uid || !req.user.profile) return res.status(401).json({ error: 'Authentication required' });
  if (!['admin', 'patient', 'caretaker'].includes(req.user.role) || !canAccessResident(req, req.params.residentId)) {
    return res.status(403).json({ error: 'Prescription image access is limited to authorized care staff and resident' });
  }
  const storagePath = req.query.path;
  if (!storagePath || typeof storagePath !== 'string' || !storagePath.startsWith(`prescriptions/${req.params.residentId}/`)) {
    return res.status(400).json({ error: 'Invalid prescription image path for this resident' });
  }
  try {
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) return res.status(404).json({ error: 'Prescription image not found' });
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000,
    });
    return res.json({ url, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() });
  } catch (err) {
    console.error('[Prescription storage signed URL]', err.message);
    return res.status(503).json({ error: 'Secure image access token generation unavailable' });
  }
});

export default router;
