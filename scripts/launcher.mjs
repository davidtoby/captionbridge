import { spawn } from 'node:child_process';
import { readFile,writeFile,mkdir,open,unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=new URL('../',import.meta.url);const local=new URL('.local/',root);await mkdir(local,{recursive:true,mode:0o700});
const pidFile=new URL('server.pid',local);const mode=process.argv[2]||'start';
const port=Number(process.env.PORT||8787);const origin=`http://127.0.0.1:${port}`;
async function health(){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)});const d=await r.json();return d.data?.service==='CaptionBridge';}catch{return false;}}
if(mode==='stop'){
  try{
    const pid=Number(await readFile(pidFile,'utf8'));
    // Only stop a PID that still runs this project's exact server entrypoint.
    const {execFileSync}=await import('node:child_process');const args=execFileSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8'});
    if(!args.includes(fileURLToPath(new URL('server/index.js',root))))throw new Error('PID does not match this server');
    process.kill(pid,'SIGTERM');await unlink(pidFile);console.log('Service stopped / 服务已停止');
  }catch{console.log('No matching launcher-managed service found / 没有找到此启动器管理的服务');}
}else{
  if(!await health()){
    if(mode==='open'){console.error('Start the server first / 请先运行 start.command');process.exit(1);}
    const log=await open(new URL('server.log',local),'a',0o600);
    const child=spawn(process.execPath,['--env-file-if-exists=.env',fileURLToPath(new URL('server/index.js',root))],{cwd:fileURLToPath(root),detached:true,stdio:['ignore',log.fd,log.fd],env:process.env});
    await writeFile(pidFile,String(child.pid),{mode:0o600});child.unref();await log.close();
    let ready=false;for(let i=0;i<40;i++){if(await health()){ready=true;break;}await new Promise(r=>setTimeout(r,250));}
    if(!ready){console.error('Service failed to start; see .local/server.log / 服务启动失败，请查看日志');process.exit(1);}
  }
  const connection=JSON.parse(await readFile(new URL('connection.json',local),'utf8'));
  if(connection.serverUrl!==origin)throw new Error('Connection configuration does not match running server');
  const opener=spawn('/usr/bin/open',[connection.setupUrl],{stdio:'ignore'});opener.unref();
  console.log(`CaptionBridge ready at ${origin} / 服务已就绪，已打开安装向导`);
}
