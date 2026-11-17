const { app, BrowserWindow, ipcMain, session, desktopCapturer, dialog, screen, Tray, Menu, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const si = require('systeminformation');
const { VoiceSession } = require('./session.cjs');
const { runWindows, ProcessAudio } = require('./windows.cjs');
const { defaults, validateSettings, aggregateUsage, estimateCost, restoreBounds, withEnvironment } = require('./core.cjs');
let tray, windowMode = 'normal', desktopStyle, normalBounds, processAudio;
let win, settings = { ...defaults }, executable = '', bounds, recognizer, saving = Promise.resolve();
const file = () => path.join(app.getPath('userData'), 'settings.json');
async function persist() {
  const data = JSON.stringify({ settings, executable, bounds });
  saving = saving.catch(() => {}).then(async () => { await fs.writeFile(file() + '.tmp', data); await fs.rename(file() + '.tmp', file()); });
  return saving;
}
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Orrery/0.1' } });
  if (!response.ok) throw Error(`取得先の応答: ${response.status}`);
  return response.json();
}
function sendWake(message) { if (win && !win.isDestroyed()) win.webContents.send('wake-status', message); }
const voiceSession = new VoiceSession({ start: () => startWake(), stop: () => stopWake(), notify: sendWake });
async function launch() {
  if (process.platform !== 'win32') throw Error('アプリ起動はWindowsで利用できます');
  if (!executable) throw Error('設定から起動するCodexなどの実行ファイルを選んでください');
  if (voiceSession.busy) throw Error('アプリ操作中です');
  const voice = settings.automation === 'voice';
  if (voice) voiceSession.begin();
  else voiceSession.busy = true;
  let automationAttempted = false;
  try {
    await fs.access(executable);
    await new Promise((resolve, reject) => { const child = spawn(executable, [], { detached: true, stdio: 'ignore', shell: false }); child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); }); });
    if (settings.automation !== 'open') {
      automationAttempted = true;
      await runWindows(app, settings.automation === 'voice' ? 'Voice' : 'NewChat', { executable });
    }
    if (voice) voiceSession.started();
    return settings.automation === 'voice' ? '新しいチャットと音声会話を開始しました。会話終了は「会話終了」を押してください。' : settings.automation === 'newChat' ? '新しいチャットを作成しました。' : 'アプリを開きました。設定から新規チャット・音声開始の自動操作を選べます。';
  } catch (error) { if (voice) voiceSession.fail(automationAttempted); throw error; }
  finally { voiceSession.busy = false; }
}
async function endVoiceSession(force = false) {
  if (typeof force !== 'boolean') throw Error('不正な入力');
  if (voiceSession.busy) throw Error('アプリ操作中です');
  voiceSession.busy=true;
  try { if (voiceSession.active && !force) await runWindows(app, 'StopVoice', { executable }); return voiceSession.end(); }
  finally { voiceSession.busy=false; }
}
function windowHandle() {
  const buffer = win.getNativeWindowHandle();
  return (buffer.length === 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0))).toString();
}
let modeChange = Promise.resolve();
function applyWindowMode(mode) {
  const work = modeChange.catch(()=>{}).then(()=>applyMode(mode)); modeChange=work;return work;
}
async function applyMode(mode) {
  if (mode === windowMode) return;
  if (mode === 'desktop' && process.platform !== 'win32') throw Error('デスクトップ背面配置はWindows専用です');
  if (windowMode === 'desktop') {
    await runWindows(app,'Restore',{handle:windowHandle(),style:desktopStyle});
    win.setSkipTaskbar(false); win.setResizable(true); win.setMovable(true);
    if (normalBounds) win.setBounds(normalBounds);
    windowMode = 'normal';
  }
  if (mode === 'desktop') {
    normalBounds=win.getNormalBounds(); win.setAlwaysOnTop(false);
    try {
      const result = await runWindows(app,'Desktop',{handle:windowHandle()}); desktopStyle=result.style;
      win.setSkipTaskbar(true); win.setMovable(false); win.setResizable(false);
    } catch(error) { win.setAlwaysOnTop(windowMode==='topmost'); throw error; }
  } else win.setAlwaysOnTop(mode === 'topmost');
  windowMode=mode;
}
function stopWake() { if (recognizer) { recognizer.kill(); recognizer = null; } }
function startWake() {
  if (process.platform !== 'win32') throw Error('端末内の音声起動はWindows専用です');
  if (!executable) throw Error('先に起動するアプリを設定してください');
  stopWake();
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', (app.isPackaged ? path.join(process.resourcesPath, 'wake.ps1') : path.join(__dirname, 'wake.ps1')), '-Phrase', settings.wakePhrase, '-Locale', settings.wakeLocale], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  recognizer = child;
  let last = 0, errorText = '';
  createInterface({ input: child.stdout }).on('line', line => {
    if (recognizer !== child) return;
    if (line.trim() === 'READY') voiceSession.state('音声起動: 待受中');
    if (line.trim() === 'WAKE' && !voiceSession.active && !voiceSession.busy && Date.now() - last > 6000) { last = Date.now(); launch().then(text => voiceSession.state(text)).catch(e => voiceSession.state(e.message)); }
  });
  child.stderr.on('data', data => { errorText = (errorText + data.toString()).slice(-1500); });
  child.on('error', e => { if (recognizer === child) { recognizer = null; voiceSession.enabled=false; voiceSession.state(e.message); } });
  child.on('exit', () => { if (recognizer === child) { recognizer = null; voiceSession.enabled=false; voiceSession.state(errorText || '音声起動を終了しました'); } });
}
async function usage() {
  const root = path.join(os.homedir(), '.claude', 'projects');
  const totals = { input: 0, output: 0, cache: 0, requests: 0 };
  const seen = new Map();
  let files = 0, incomplete = false;
  async function walk(dir, depth = 0) {
    if (depth > 8) { incomplete = true; return; }
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (files >= 2000) { incomplete = true; return; }
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(target, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files++;
        // Stream rather than load long conversation logs into memory.
        const stream = require('node:fs').createReadStream(target, { encoding: 'utf8' });
        const lines = createInterface({ input: stream, crlfDelay: Infinity });
        try { for await (const line of lines) aggregateUsage([line], seen, totals); }
        catch { incomplete = true; } finally { lines.close(); stream.destroy(); }
      }
    }
  }
  try { await walk(root); } catch (e) { if (e.code === 'ENOENT') return { available: false }; throw e; }
  return { available: true, ...totals, files, incomplete, cost: estimateCost(seen, JSON.parse(settings.prices)) };
}
app.whenReady().then(async () => {
  try { const stored = JSON.parse(await fs.readFile(file(), 'utf8')); settings = validateSettings(stored.settings); executable = typeof stored.executable === 'string' ? stored.executable : ''; bounds = stored.bounds; } catch {}
  let startupError='';
  try { settings=withEnvironment(settings,process.env); } catch(e) { startupError=e.message; }
  if(process.env.HUD_APP_PATH){if(path.isAbsolute(process.env.HUD_APP_PATH) && path.extname(process.env.HUD_APP_PATH).toLowerCase()==='.exe')executable=process.env.HUD_APP_PATH;else startupError='HUD_APP_PATH は .exe の絶対パスで指定してください';}
  const localPage = path.join(__dirname, 'index.html');
  bounds = restoreBounds(bounds, screen.getAllDisplays().map(d => d.workArea));
  processAudio = new ProcessAudio({ executable: app.isPackaged ? path.join(process.resourcesPath,'process-audio','Orrery.ProcessAudio.exe') : path.join(__dirname,'../native/ProcessAudio/publish/Orrery.ProcessAudio.exe'), notify: packet => { if(win && !win.isDestroyed()) win.webContents.send('process-audio',packet); } });
  function trusted(contents) { return contents === win?.webContents; }
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => callback(trusted(contents) && permission === 'media' && (details.mediaTypes || []).every(t => t === 'audio')));
  session.defaultSession.setPermissionCheckHandler((contents, permission) => trusted(contents) && permission === 'media');
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (request.frame !== win?.webContents.mainFrame || !request.userGesture || process.platform !== 'win32') return callback({});
      const screens = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      if (!screens.length) return callback({});
      callback({ video: screens[0], audio: 'loopback' });
    } catch { callback({}); }
  });
  win = new BrowserWindow({ ...bounds, minWidth: Math.min(960,bounds.width), minHeight: Math.min(680,bounds.height), backgroundColor: '#03090f', title: 'ORRERY', autoHideMenuBar: true, alwaysOnTop: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  function handle(name, fn) { ipcMain.handle(name, async (event, ...args) => { if (!trusted(event.sender)) throw Error('不正な呼び出し'); return fn(...args); }); }
  handle('load', () => ({ settings, executable, platform: process.platform, voice: { session: voiceSession.active, enabled: voiceSession.enabled } }));
  handle('save', async input => { const next = withEnvironment(validateSettings(input),process.env); if (voiceSession.active || voiceSession.busy) throw Error('会話・アプリ操作を終了してから設定を変更してください'); await applyWindowMode(next.windowMode); settings=next; processAudio.stop(); win.webContents.send('process-audio',{ended:true,text:'設定変更のためアプリ音声を停止しました'}); voiceSession.disable(); await persist(); return settings; });
  handle('choose-app', async () => { const result = await dialog.showOpenDialog(win, { title: '起動するアプリを選択', properties: ['openFile'], filters: [{ name: 'Windowsアプリ', extensions: ['exe'] }] }); if (!result.canceled) { if (voiceSession.active || voiceSession.busy) throw Error('会話・アプリ操作を終了してから起動先を変更してください'); const selected = result.filePaths[0]; if (path.extname(selected).toLowerCase() !== '.exe') throw Error('.exeファイルを選んでください'); processAudio.stop(); win.webContents.send('process-audio',{ended:true,text:'起動先の変更により音声を停止しました'}); voiceSession.disable(); executable = selected; await persist(); } return executable; });
  handle('launch', launch);
  handle('end-session', endVoiceSession);
  handle('wake', enabled => { if (typeof enabled !== 'boolean') throw Error('不正な入力'); return voiceSession.setListening(enabled); });
  handle('process-audio', async enabled => { if(typeof enabled!=='boolean')throw Error('不正な入力'); if(!enabled){processAudio.stop();return false;} if(process.platform!=='win32')throw Error('アプリ別の音声取得はWindows専用です'); if(!executable)throw Error('設定から対象アプリを選んでください'); await processAudio.start(executable); return true; });
  handle('metrics', async () => {
    const [load, mem, disks, battery, network] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize(), si.battery(), si.networkStats()]);
    const primary = disks.find(d => process.platform === 'win32' ? /^C:/i.test(d.mount) : d.mount === '/') || disks[0];
    return { host: os.hostname(), platform: os.platform(), cores: os.cpus().length, uptime: os.uptime(), cpu: load.currentLoad, memory: mem.active / mem.total * 100, totalMemory: mem.total, disk: primary?.use ?? null, battery: battery.hasBattery ? battery.percent : null, charging: battery.isCharging, rx: network.reduce((n, s) => n + Math.max(0, s.rx_sec || 0), 0), tx: network.reduce((n, s) => n + Math.max(0, s.tx_sec || 0), 0) };
  });
  handle('weather', async () => {
    const s = settings;
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({ latitude: s.latitude, longitude: s.longitude, current: 'temperature_2m,weather_code', daily: 'temperature_2m_max,temperature_2m_min,weather_code', timezone: 'auto', forecast_days: 5 });
    const data = await json(url); return { ...data, city: s.city };
  });
  handle('market', async () => Promise.all(settings.tickers.split(',').map(async ticker => {
    const [symbol, label = symbol] = ticker.trim().split(':');
    try { const data = await json(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=15m`); const meta = data.chart?.result?.[0]?.meta; if (!Number.isFinite(meta?.regularMarketPrice)) throw Error('データなし'); return { symbol, label, price: meta.regularMarketPrice, previous: meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice, currency: meta.currency }; }
    catch (e) { return { symbol, label, error: e.message }; }
  })));
  handle('usage', usage);
  ipcMain.on('minimize', e => { if (trusted(e.sender)) win.minimize(); });
  ipcMain.on('close', e => { if (trusted(e.sender)) win.close(); });
  let closing = false;
  win.on('close', event => {
    if (closing) return;
    event.preventDefault(); closing = true; bounds = windowMode==='desktop' && normalBounds ? normalBounds : win.getNormalBounds(); stopWake(); processAudio.stop(); tray?.destroy();
    persist().catch(() => {}).finally(() => win.destroy());
  });
  await win.loadFile(localPage);
  if (process.platform === 'win32') {
    tray = new Tray(nativeImage.createFromBuffer(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGklEQVR4nGOIefj/PyWYYdSAUQNGDRguBgAAOvE7LpKqiYUAAAAASUVORK5CYII=','base64')));
    tray.setToolTip('ORRERY — クリックで通常表示に戻す');
    async function switchMode(mode) { try { await applyWindowMode(mode); settings={...settings,windowMode:mode,topmost:mode==='topmost'}; await persist(); win.webContents.send('window-mode',mode); if(mode!=='desktop'){win.show();win.focus();} } catch(e){voiceSession.state(e.message);} }
    tray.on('click',()=>switchMode('normal'));
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:'通常表示に戻す',click:()=>switchMode('normal')},
      {label:'常に最前面',click:()=>switchMode('topmost')},
      {label:'デスクトップ背面',click:()=>switchMode('desktop')},
      {type:'separator'}, {label:'設定',click:async()=>{await switchMode('normal');win.webContents.send('open-settings');}},
      {label:'終了',click:()=>win.close()}
    ]));
  }
  if(startupError)voiceSession.state(startupError);
  try { await applyWindowMode(settings.windowMode); }
  catch(e) { settings={...settings,windowMode:'normal',topmost:false}; await persist(); win.webContents.send('window-mode','normal'); voiceSession.state(e.message); }

});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { stopWake(); processAudio?.stop(); });
