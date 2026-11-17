const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { defaults } = require('../src/core.cjs');
(async () => {
 const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
 const server = http.createServer((req,res)=>{ const name = req.url.split('?')[0].slice(1) || 'index.html'; if (!['index.html','style.css','renderer.js'].includes(name)) {res.writeHead(404);res.end();return;} res.setHeader('Content-Type', name.endsWith('.css')?'text/css':name.endsWith('.js')?'application/javascript':'text/html'); fs.createReadStream(path.join(__dirname,'../src',name)).pipe(res); });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), headless: true });
 try {
 const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
 const errors = []; page.on('pageerror', e => errors.push(e.message));
 await page.addInitScript(({ settings }) => {
  window.calls = []; let stored = settings;
  window.orrery = {
   load: async () => ({ settings: stored, executable: '', platform: 'win32' }),
   save: async s => { window.calls.push(['save',s]); stored=s; return s; },
   metrics: async () => ({host:'TEST-PC',cores:8,uptime:7200,cpu:32,memory:48,totalMemory:16*2**30,disk:52,battery:null,rx:12000,tx:900}),
   weather: async () => ({city:stored.city,current:{temperature_2m:18.2,weather_code:0},daily:{time:['2026-11-17','2026-11-18'],temperature_2m_min:[10,11],temperature_2m_max:[21,22],weather_code:[0,3]}}),
   market: async () => [{symbol:'JPY=X',label:'USD/JPY',price:150,previous:149,currency:'JPY'},{symbol:'BAD',label:'ERROR CASE',error:'offline'}],
   usage: async () => ({available:false}),
   chooseApp:async ()=>'C:\\Apps\\Codex.exe',launch: async ()=>{throw Error('起動するアプリを設定してください');},wake:async enabled=>({active:enabled,enabled,session:false,text:'待受状態を変更しました'}),
   endSession:async ()=>({active:true,enabled:true,session:false,text:'会話終了'}),processAudio:async enabled=>{window.calls.push(['processAudio',enabled]);return enabled;},
   onProcessAudio:cb=>{window.emitProcessAudio=cb;},onWindowMode:cb=>{window.emitWindowMode=cb;},onOpenSettings:()=>{},
   onWake:cb=>{window.emitWake=cb;},minimize:()=>{window.calls.push(['minimize']);}
  };
 }, {settings:defaults});
 await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
 await page.waitForFunction(()=>document.getElementById('metrics').textContent.includes('32'));
 assert.match(await page.locator('#weather').innerText(),/18.2/);
 assert.match(await page.locator('#market').innerText(),/取得できません/);
 await page.click('#launch'); assert.match(await page.locator('#status').innerText(),/設定してください/);
 await page.click('#settingsButton');
 await page.locator('[name=city]').fill('OSAKA'); await page.locator('[name=theme]').selectOption('EMBER');
 await page.click('#chooseApp'); assert.match(await page.locator('#appPath').innerText(),/Codex.exe/);
 await page.click('button[type=submit]'); await page.waitForFunction(()=>!document.getElementById('settingsDialog').open);
 assert.equal(await page.evaluate(()=>window.calls[0][1].city),'OSAKA');
 await page.click('#top'); assert.match(await page.locator('#top').innerText(),/最前面/);
 await page.click('#wake'); assert.match(await page.locator('#wake').innerText(),/ON/);
 await page.evaluate(()=>window.emitWake({active:false,enabled:true,session:true,text:'会話中'}));
 assert.match(await page.locator('#wake').innerText(),/一時停止/);assert.equal(await page.locator('#endSession').isVisible(),true);
 await page.click('#endSession');assert.equal(await page.locator('#endSession').isVisible(),false);
 await page.evaluate(()=>window.emitWake({active:false,enabled:false,session:false,text:'音声認識を利用できません'})); assert.match(await page.locator('#wake').innerText(),/OFF/);
 await page.evaluate(()=>{ Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>{throw new DOMException('Permission denied','NotAllowedError');}}); document.getElementById('systemAudio').click(); });
 await page.waitForFunction(()=>document.getElementById('status').textContent.includes('音声を開始できません'));
 await page.evaluate(()=>{
  const context = new AudioContext(), oscillator = context.createOscillator(), output = context.createMediaStreamDestination();
  oscillator.connect(output); oscillator.start(); window.testAudioContext=context;
  Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>output.stream,configurable:true});
 });
 await page.click('#systemAudio');
 await page.waitForFunction(()=>document.getElementById('source').textContent.includes('SYSTEM'));
 await page.click('#systemAudio');
 assert.match(await page.locator('#source').innerText(),/OFF/);
 await page.evaluate(()=>window.testAudioContext.close());
 await page.click('#settingsButton');
 await page.locator('[name=theme]').selectOption('CUSTOM');
 await page.locator('[name=customColor]').fill('#ff4499');
 for(const key of ['clock','system','usage','weather','market','particles'])await page.locator(`[name=panel_${key}]`).uncheck();
 await page.locator('[name=audioMode]').selectOption('app');
 await page.locator('[name=automation]').selectOption('voice');
 await page.click('button[type=submit]');
 await page.waitForFunction(()=>document.querySelector('main').classList.contains('no-left'));
 assert.equal(await page.locator('#leftPanels').isVisible(),false);assert.equal(await page.locator('#rightPanels').isVisible(),false);
 assert.match(await page.locator('#launch').innerText(),/話す/);
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent')),'rgb(255,68,153)');
 await page.click('#systemAudio');assert.match(await page.locator('#source').innerText(),/APP ONLY/);
 await page.evaluate(()=>window.emitProcessAudio({bins:Array(128).fill(100)}));
 await page.click('#systemAudio');assert.match(await page.locator('#source').innerText(),/OFF/);
 await page.click('#settingsButton');for(const key of ['clock','system','usage','weather','market','particles'])await page.locator(`[name=panel_${key}]`).check();
 await page.locator('[name=theme]').selectOption('ARC');await page.click('button[type=submit]');
 await page.waitForFunction(()=>!document.getElementById('settingsDialog').open);
 if (process.env.SCREENSHOT_PATH) await page.waitForTimeout(250);
 if (process.env.SCREENSHOT_PATH) await page.screenshot({path:process.env.SCREENSHOT_PATH});
 await page.setViewportSize({width:960,height:680});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(await page.evaluate(()=>document.querySelector('.center').getBoundingClientRect().width>250),true);
 assert.deepEqual(errors,[]);
 console.log('PASS: renderer initialization, telemetry, weather, market failure, settings save/theme, app selection, launch error, topmost, wake state/error, denied audio, synthetic audio start/stop, custom color, hidden-panel layout, native app-audio start/stop, session pause/end, minimum size; no page errors.');
 } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);process.exit(1);});
