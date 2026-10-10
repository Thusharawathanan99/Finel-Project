const {spawnSync}=require('node:child_process');
const {resolve}=require('node:path');
const result=spawnSync(process.env.EDGE_PYTHON||'python',['-m','unittest','discover','-s','tests','-v'],{
  cwd:resolve(__dirname,'../7-monitoring'),stdio:'inherit',windowsHide:true,
});
if(result.error)console.error('Python could not start. Set EDGE_PYTHON to your Python executable.');
process.exitCode=result.status??1;
