export function validPrescriptionImageReference(residentId,imagePath,imageUrl,bucket=process.env.FIREBASE_STORAGE_BUCKET||process.env.VITE_FIREBASE_STORAGE_BUCKET){
  if(!imagePath&&!imageUrl)return true;
  if(!bucket||typeof imagePath!=='string'||typeof imageUrl!=='string'||imagePath.length>1000||
    !imagePath.startsWith(`prescriptions/${residentId}/`)||imagePath.slice(`prescriptions/${residentId}/`.length).includes('/')||
    /[\\\x00-\x1f]/.test(imagePath))return false;
  try{
    const url=new URL(imageUrl),match=/^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname);
    return url.protocol==='https:'&&url.hostname==='firebasestorage.googleapis.com'&&!url.username&&!url.password&&!url.port&&
      Boolean(match)&&decodeURIComponent(match[1])===bucket&&decodeURIComponent(match[2])===imagePath;
  }catch{return false;}
}
