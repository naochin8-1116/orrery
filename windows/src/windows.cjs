const { spawn } = require('node:child_process');
const path = require('node:path');
const { createInterface } = require('node:readline');
function helperPath(app, name) { return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(__dirname, name); }
function runWindows(app, action, options = {}, spawnProcess = spawn) {
  if (!['NewChat','Voice','StopVoice','Desktop','Restore'].includes(action)) return Promise.reject(Error('不正なWindows操作'));
  return new Promise((resolve,reject) => {
    const args = ['-NoProfile','-NonInteractive','-File',helperPath(app,'windows.ps1'),'-Action',action];
    if (options.executable) args.push('-Executable',options.executable);
    if (options.handle) args.push('-Handle',options.handle);
    if (options.style) args.push('-Style',options.style);
    const child = spawnProcess('powershell.exe',args,{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
    let output='',errors='',done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer); error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(Error('Windows操作がタイムアウトしました'));},35000);
    child.stdout.on('data',chunk=>{output=(output+chunk.toString('utf8')).slice(-16000);});
    child.stderr.on('data',chunk=>{errors=(errors+chunk.toString('utf8')).slice(-4000);});
    child.once('error',e=>finish(e));
    child.once('close',code=>{if(code!==0)return finish(Error(errors||'Windows操作に失敗しました'));try{const result=JSON.parse(output.trim());if(result.ok!==true)throw Error();finish(null,result);}catch{finish(Error('Windows補助プログラムの応答が不正です'));}});
  });
}
class ProcessAudio {
  constructor({ executable, notify, spawnProcess = spawn }) { this.executable = executable; this.notify = notify; this.spawn = spawnProcess; this.child = null; }
  stop() { const child=this.child;this.child=null;if(child){child.stdin.end('\n');child.kill();} }
  start(target) {
    this.stop();
    return new Promise((resolve,reject) => {
      const child=this.spawn(this.executable,[target],{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});this.child=child;
      let ready=false,done=false,errorText='';
      const finish=error=>{if(done)return;done=true;clearTimeout(timer);if(error){if(this.child===child)this.stop();reject(error);}else resolve(true);};
      const timer=setTimeout(()=>finish(Error('アプリ音声の取得開始がタイムアウトしました')),15000);
      const reader=createInterface({input:child.stdout});
      reader.on('line',line=>{
        if(this.child!==child)return;
        if(line.length>4096)return;
        let packet;try{packet=JSON.parse(line);}catch{return;}
        if(packet.ready===true){ready=true;finish();return;}
        if(ready&&Array.isArray(packet.bins)&&packet.bins.length===128&&packet.bins.every(n=>Number.isInteger(n)&&n>=0&&n<=255))this.notify({bins:packet.bins});
      });
      child.stderr.on('data',data=>{errorText=(errorText+data.toString('utf8')).slice(-2000);});
      child.on('error',error=>{finish(error);});
      child.on('close',()=>{reader.close();if(this.child===child){this.child=null;this.notify({ended:true,text:errorText||'対象アプリの音声取得を終了しました'});}if(!ready)finish(Error(errorText||'音声取得を開始できませんでした'));});
    });
  }
}
module.exports = { helperPath, runWindows, ProcessAudio };
