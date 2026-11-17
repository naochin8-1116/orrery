const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const vm=require('node:vm');const {EventEmitter}=require('node:events');
const {defaults}=require('../src/core.cjs');
async function boot(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'orrery-main-'));const handlers=new Map(),actions=[];let started,window,failDesktop=false;
 class Window extends EventEmitter {
  constructor(options){super();window=this;this.options=options;this.webContents=new EventEmitter();this.webContents.mainFrame={};this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=(...args)=>actions.push(['event',...args]);}
  isDestroyed(){return false;}getNormalBounds(){return {x:10,y:20,width:1200,height:800};}getNativeWindowHandle(){return Buffer.alloc(8,1);}setAlwaysOnTop(on){actions.push(['top',on]);}setSkipTaskbar(on){actions.push(['skip',on]);}setMovable(){}setResizable(){}setBounds(value){actions.push(['bounds',value]);}loadFile(){return Promise.resolve();}show(){}focus(){}
 }
 const app=new EventEmitter();app.getPath=()=>root;app.whenReady=()=>({then:fn=>{started=fn();}});app.isPackaged=true;
 class Tray {setToolTip(){}on(){}setContextMenu(){}destroy(){}}
 const session={defaultSession:{setPermissionRequestHandler(){},setPermissionCheckHandler(){},setDisplayMediaRequestHandler(){}}};
 const electron={app,BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:()=>{}},session,desktopCapturer:{},dialog:{},screen:{getAllDisplays:()=>[{workArea:{x:0,y:0,width:1920,height:1080}}]},Tray,Menu:{buildFromTemplate:x=>x},nativeImage:{createFromBuffer:()=>({})}};
 const windows={runWindows:async(_app,action)=>{actions.push(['native',action]);if(failDesktop&&action==='Desktop')throw Error('Explorer host missing');return {ok:true,style:'123'};},ProcessAudio:class {stop(){}async start(){return true;}}};
 const source=await fs.readFile(path.join(__dirname,'../src/main.cjs'),'utf8');
 const localRequire=name=>name==='electron'?electron:name==='./windows.cjs'?windows:name==='systeminformation'?{}:name.startsWith('./')?require('../src/'+name.slice(2)):require(name);
 vm.runInNewContext(source,{require:localRequire,process:{platform:'win32',resourcesPath:'/resources',env:{}},__dirname:path.resolve(__dirname,'../src'),Buffer,console,fetch,AbortSignal,setTimeout,clearTimeout,Promise});
 await started;
 return {root,window,actions,failDesktop:()=>{failDesktop=true;},invoke:(name,...args)=>handlers.get(name)({sender:window.webContents},...args),unauthorized:name=>handlers.get(name)({sender:{}},{}),cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
test('real main IPC rejects foreign senders and persists settings after successful mode changes',async()=>{const app=await boot();try{
 await assert.rejects(app.unauthorized('save'),/不正な呼び出し/);
 const saved=await app.invoke('save',{...defaults,theme:'CUSTOM',customColor:'#f0a123',panels:{clock:false},windowMode:'topmost'});
 assert.equal(saved.windowMode,'topmost');assert.equal(saved.panels.clock,false);assert.equal(app.actions.some(a=>a[0]==='top'&&a[1]===true),true);
 const disk=JSON.parse(await fs.readFile(path.join(app.root,'settings.json'),'utf8'));assert.equal(disk.settings.customColor,'#f0a123');
 }finally{await app.cleanup();}});
test('a rejected desktop operation preserves the previous settings and surfaces the failure',async()=>{const app=await boot();try{
 app.failDesktop();await assert.rejects(app.invoke('save',{...defaults,windowMode:'desktop'}),/Explorer host missing/);
 assert.equal((await app.invoke('load')).settings.windowMode,'normal');assert.equal(app.actions.some(a=>a[0]==='skip'&&a[1]===true),false);
 }finally{await app.cleanup();}});
