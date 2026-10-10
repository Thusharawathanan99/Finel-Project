const {existsSync}=require('node:fs');
const {resolve}=require('node:path');
const {spawnSync}=require('node:child_process');
const root=resolve(__dirname,'..');
const files=['monitoring.test.mjs','notifications.test.mjs','mobileNotifications.test.mjs'].map(name=>resolve(root,'4-system-engine/api/tests',name));
if(files.some(file=>!existsSync(file)))throw Error('Monitoring verification is incomplete: a required test file is missing.');
const result=spawnSync(process.execPath,['--experimental-vm-modules','--test',...files],{cwd:root,stdio:'inherit',windowsHide:true});
process.exitCode=result.status??1;
