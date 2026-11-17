const api = window.orrery;
const $ = id => document.getElementById(id);
let settings, wakeActive = false, voiceActive = false, processLive = false, processUpdated = 0;
const processBins = new Uint8Array(128);
const themes = { ARC: [92,225,255], EMBER: [255,171,83], MATRIX: [92,255,143], CRIMSON: [255,89,120], MONO: [213,225,232] };
const status = text => { $('status').textContent = text; };
const fmt = (n, digits = 0) => Number(n).toLocaleString('ja-JP', { maximumFractionDigits: digits });
function el(tag, text, cls) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; }
function themeRgb() { return settings.theme === 'CUSTOM' ? settings.customColor.slice(1).match(/../g).map(n=>parseInt(n,16)) : themes[settings.theme]; }
function applySettings() {
  const rgb = themeRgb(); document.documentElement.style.setProperty('--rgb', rgb.join(',')); document.documentElement.style.setProperty('--accent', `rgb(${rgb.join(',')})`);
  $('top').textContent = {normal:'表示: 通常',topmost:'表示: 最前面',desktop:'表示: 背面'}[settings.windowMode];
  document.body.classList.toggle('desktop',settings.windowMode==='desktop');
  for(const panel of document.querySelectorAll('[data-panel]')) panel.hidden = !settings.panels[panel.dataset.panel];
  for(const [id,keys,cls] of [['leftPanels',['clock','system','usage'],'no-left'],['rightPanels',['weather','market'],'no-right']]) { const hidden=keys.every(k=>!settings.panels[k]); $(id).hidden=hidden;document.querySelector('main').classList.toggle(cls,hidden); }
  $('launch').textContent={open:'CODEX / アプリを開く ↗',newChat:'新しいチャットを作成 ↗',voice:'CODEX と話す ↗'}[settings.automation];
  $('launchHelp').textContent=settings.automation==='voice'?'会話中は音声起動を自動で一時停止します':'設定で新規チャット・音声開始の自動操作を選べます';
  sourceLabel();
}
function time() { const now = new Date(); $('clock').textContent = now.toLocaleTimeString('ja-JP', { hour12: false }); $('date').textContent = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }); }
async function metrics() {
  try {
    const m = await api.metrics(); $('host').textContent = `${m.host} / ${m.cores} CORES / UP ${fmt(m.uptime/3600,1)}H`;
    const content = [];
    for (const [name, value] of [['CPU', m.cpu], ['MEMORY', m.memory], ['STORAGE', m.disk]]) {
      const row = el('div', undefined, 'metric'), label = el('div', undefined, 'metric-label'); label.append(el('span', name), el('span', value === null ? 'N/A' : `${fmt(value,1)}%`));
      const bar = el('div', undefined, 'bar'), fill = el('b'); fill.style.setProperty('--value', `${Math.max(0,Math.min(100,value || 0))}%`); bar.append(fill); row.append(label, bar); content.push(row);
    }
    content.push(el('small', `RAM ${fmt(m.totalMemory / 2**30,1)} GB · ${m.battery === null ? 'AC POWER' : `BAT ${m.battery}% ${m.charging ? '充電中' : ''}`}`), el('small', `NET ↓ ${fmt(m.rx/1024,1)} KB/s  ↑ ${fmt(m.tx/1024,1)} KB/s`)); $('metrics').replaceChildren(...content);
  } catch(e) { $('metrics').textContent = `PC情報の取得に失敗: ${e.message}`; }
}
const weatherCodes = code => code === 0 ? '晴れ' : code <= 3 ? '曇り' : code <= 48 ? '霧' : code <= 67 ? '雨' : code <= 77 ? '雪' : code <= 82 ? 'にわか雨' : code <= 86 ? '雪' : '雷雨';
async function weather() {
  try { const w = await api.weather(); const rows = [el('div', w.city, 'muted'), el('div', `${fmt(w.current.temperature_2m,1)}°C`, 'weather-temp'), el('div', weatherCodes(w.current.weather_code), 'muted')];
    w.daily.time.forEach((date,i) => { const row = el('div', undefined, 'forecast'); row.append(el('span', `${date.slice(5)} ${weatherCodes(w.daily.weather_code[i])}`), el('span', `${fmt(w.daily.temperature_2m_min[i])}° / ${fmt(w.daily.temperature_2m_max[i])}°`)); rows.push(row); });
    rows.push(el('small', `Open-Meteo · 更新 ${new Date().toLocaleTimeString('ja-JP')}`)); $('weather').replaceChildren(...rows);
  } catch(e) { $('weather').textContent = `天気を取得できません: ${e.message}`; }
}
async function market() {
  try { const quotes = await api.market(); $('market').replaceChildren(...quotes.map(q => { const row = el('div', undefined, 'quote'); row.append(el('span', q.label)); const info = el('div'); if (q.error) info.append(el('small', '取得できません')); else { info.append(el('strong', fmt(q.price,2))); const change = q.previous ? (q.price/q.previous - 1)*100 : 0; info.append(el('small', `${q.currency} / ${change >= 0 ? '+' : ''}${fmt(change,2)}%`, change >= 0 ? 'up' : 'down')); } row.append(info); return row; }), el('small', `Yahoo Finance · 更新 ${new Date().toLocaleTimeString('ja-JP')}`)); }
  catch(e) { $('market').textContent = `相場を取得できません: ${e.message}`; }
}
let usageBusy = false;
async function usage() {
  if (usageBusy) return; usageBusy = true;
  try { const u = await api.usage(); $('usage').replaceChildren(...(u.available ? [el('div', `${fmt(u.requests)} REQUESTS`), el('small', `入力 ${fmt(u.input)} / 出力 ${fmt(u.output)}`), el('small', `キャッシュ ${fmt(u.cache)}`), el('small', `${u.files}ログ${u.incomplete ? '・一部のみ集計' : ''}`), el('small', u.cost?.priced ? `料金概算 USD ${fmt(u.cost.usd,4)}${u.cost.unpriced ? ` ＋単価未設定 ${u.cost.unpriced}件` : ''}（請求額ではありません）` : '料金概算: 設定からモデルごとの単価を登録')] : [el('div', 'Claudeのログが見つかりません'), el('small', '~/.claude/projects を参照')])); }
  catch(e) { $('usage').textContent = `使用量を取得できません: ${e.message}`; } finally { usageBusy = false; }
}
// Capture is initiated only by a user click. Video tracks required by Chromium are stopped immediately.
let audioContext, analyser, audioSources = new Map(), audioBusy = false;
const bins = new Uint8Array(128);
function sourceLabel() {
  const names=[...audioSources.keys()].map(k=>k==='system'?'SYSTEM':'MIC');if(processLive)names.unshift('APP ONLY');
  $('source').textContent=`SOURCE ▸ ${names.join(' + ') || 'OFF'}`;
  $('systemAudio').textContent=`${settings?.audioMode==='app'?'指定アプリ':'再生音'} ${processLive||audioSources.has('system')?'ON':'OFF'}`;
  $('systemAudio').setAttribute('aria-pressed',String(processLive||audioSources.has('system')));
  $('microphone').textContent=`マイク ${audioSources.has('mic')?'ON':'OFF'}`;
  $('microphone').setAttribute('aria-pressed',String(audioSources.has('mic')));
}
api.onProcessAudio(packet=>{
  if(packet.ended){processLive=false;processBins.fill(0);sourceLabel();status(packet.text);return;}
  processBins.set(packet.bins);processUpdated=performance.now();
});
function stopSource(key) { const item = audioSources.get(key); if (!item) return; audioSources.delete(key); item.source.disconnect(); item.stream.getTracks().forEach(t => t.stop()); sourceLabel(); }
async function toggleAudio(key) {
  if (audioBusy) return;
  if (key==='system' && settings.audioMode==='app') {
    audioBusy=true;try{processLive=await api.processAudio(!processLive);processBins.fill(0);sourceLabel();status(processLive?'指定アプリだけの音を解析中です。PC全体の音への自動切替はしません。':'指定アプリの音声を停止しました');}catch(e){processLive=false;sourceLabel();status(`アプリ音声を開始できません: ${e.message}`);}finally{audioBusy=false;}return;
  }
  if (audioSources.has(key)) { stopSource(key); return; }
  audioBusy = true; let stream;
  try {
    // Invoke capture before awaiting anything else to preserve transient user activation.
    stream = key === 'mic' ? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false }, video: false }) : await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    stream.getVideoTracks().forEach(track => track.stop());
    if (!stream.getAudioTracks().length) throw Error('音声トラックを取得できませんでした');
    if (!audioContext) { audioContext = new AudioContext(); analyser = audioContext.createAnalyser(); analyser.fftSize = 256; analyser.smoothingTimeConstant = .8; }
    await audioContext.resume();
    const source = audioContext.createMediaStreamSource(stream); source.connect(analyser); audioSources.set(key, { stream, source });
    stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => { stopSource(key); status('音声入力が終了しました'); })); sourceLabel(); status('音声の解析中です。録音・送信はしません。');
  } catch(e) { stream?.getTracks().forEach(t => t.stop()); status(`音声を開始できません: ${e.message}`); } finally { audioBusy = false; }
}
$('systemAudio').onclick = () => toggleAudio('system'); $('microphone').onclick = () => toggleAudio('mic');
$('launch').onclick = async () => { try { status(await api.launch()); } catch(e) { status(e.message); } };
function showVoice(state) {
  wakeActive=state.enabled ?? state.active;voiceActive=Boolean(state.session);
  $('wake').textContent=`音声起動 ${voiceActive&&wakeActive?'一時停止':wakeActive?'ON':'OFF'}`;
  $('wake').setAttribute('aria-pressed',String(wakeActive));$('endSession').hidden=!voiceActive;
  if(!voiceActive)$('resumeWake').hidden=true;
}
$('wake').onclick = async () => { try { const state=await api.wake(!wakeActive); showVoice(state);status(state.text); } catch(e) { status(e.message); } };
api.onWake(message=>{showVoice(message);status(message.text);});
$('endSession').onclick=async()=>{try{const state=await api.endSession(false);showVoice(state);status(state.text);}catch(e){status(`音声終了を確認できません: ${e.message}。起動先で終了してから「終了済み」を押してください`);$('resumeWake').hidden=false;}};
$('resumeWake').onclick=async()=>{try{const state=await api.endSession(true);showVoice(state);status(state.text);}catch(e){status(e.message);}};
api.onWindowMode(mode=>{settings={...settings,windowMode:mode,topmost:mode==='topmost'};applySettings();});
$('minimize').onclick = () => api.minimize();
$('top').onclick = async () => { try { const mode=settings.windowMode==='normal'?'topmost':settings.windowMode==='topmost'?'desktop':'normal'; settings = await api.save({ ...settings, windowMode:mode, topmost:mode==='topmost' }); applySettings(); } catch(e) { status(e.message); } };
$('settingsButton').onclick = () => { const form = $('settingsForm'); for (const [key,value] of Object.entries(settings)) { const input = form.elements.namedItem(key); if(key==='panels'){for(const [panel,on] of Object.entries(value)) form.elements.namedItem(`panel_${panel}`).checked=on;} if (input) { if (input.type === 'checkbox') input.checked = value; else input.value = value; } } $('settingsError').textContent = ''; $('settingsDialog').showModal(); };
api.onOpenSettings(()=>$('settingsButton').click());
$('cancelSettings').onclick = () => $('settingsDialog').close();
$('chooseApp').onclick = async () => { try { $('appPath').textContent = await api.chooseApp() || '未設定'; } catch(e) { $('settingsError').textContent = e.message; } };
$('settingsForm').onsubmit = async event => {
  event.preventDefault();const next={...settings,panels:{...settings.panels}};
  for(const key of Object.keys(settings)){const input=event.currentTarget.elements.namedItem(key);if(input)next[key]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;}
  for(const key of Object.keys(next.panels)) next.panels[key]=event.currentTarget.elements.namedItem(`panel_${key}`).checked;
  next.topmost=next.windowMode==='topmost';
  try{settings=await api.save(next);for(const key of [...audioSources.keys()])stopSource(key);processLive=false;applySettings();$('settingsDialog').close();refresh();}catch(e){$('settingsError').textContent=e.message;}
};
let refreshing = false;
async function refresh() { if (refreshing) return; refreshing = true; $('refresh').disabled = true; try { await Promise.allSettled([metrics(), weather(), market(), usage()]); } finally { refreshing = false; $('refresh').disabled = false; } }
$('refresh').onclick = refresh;
const canvas = $('field'), ctx = canvas.getContext('2d');
const particles = Array.from({length:1200}, () => ({ x:Math.random(), y:Math.random(), speed:.15+Math.random()*.7 }));
let lastFrame = 0, phase = 0;
function draw(now) {
  requestAnimationFrame(draw); if (!settings || document.hidden) return;
  const fps = settings.static ? 2 : (audioSources.size || processLive) ? settings.fps : Math.min(12,settings.fps);
  if (now-lastFrame < 1000/fps) return; const dt = Math.min(.1,(now-lastFrame)/1000); lastFrame = now;
  if (!settings.static) phase += dt;
  const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio,2);
  if (canvas.width !== Math.round(w*dpr) || canvas.height !== Math.round(h*dpr)) { canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr); canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; }
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
  const rect = document.querySelector('.center').getBoundingClientRect(), cx = rect.x+rect.width/2, cy = rect.y+rect.height*.40, radius = Math.max(35, Math.min(rect.width*.40,rect.height*.26,(document.querySelector('.controls').getBoundingClientRect().top-cy-18)/1.55));
  if (analyser && audioSources.size) analyser.getByteFrequencyData(bins); else bins.fill(0);
  if(processLive && performance.now()-processUpdated<500) for(let i=0;i<128;i++)bins[i]=Math.max(bins[i],processBins[i]);
  const energy = bins.reduce((a,b)=>a+b,0)/bins.length/255;
  const rgb = themeRgb().join(','); const color = a => `rgba(${rgb},${a})`;
  ctx.strokeStyle = color(.035); ctx.lineWidth=1;
  for(let x=0;x<w;x+=48){ctx.beginPath();ctx.moveTo(x,76);ctx.lineTo(x,h-40);ctx.stroke();}
  for(let y=76;y<h;y+=48){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  const glow=ctx.createRadialGradient(cx,cy,radius*.3,cx,cy,radius*1.7);glow.addColorStop(0,color(.02));glow.addColorStop(.5,color(.055+energy*.16));glow.addColorStop(1,color(0));ctx.fillStyle=glow;ctx.fillRect(rect.x,rect.y,rect.width,rect.height);
  for(let ring=0;ring<5;ring++){const r=radius*(.65+ring*.105);ctx.strokeStyle=color(ring%2?.48:.18);ctx.lineWidth=ring===1?3:1;ctx.beginPath();const start=phase*(ring%2?-.15:.12)+ring;ctx.arc(cx,cy,r,start,start+Math.PI*(ring%2?1.65:2));ctx.stroke();}
  for(let i=0;i<128;i++){const angle=i/128*Math.PI*2;const r=radius*1.15;const length=3+bins[i]/255*radius*.36;ctx.strokeStyle=color(.22+bins[i]/255*.78);ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(cx+Math.cos(angle)*r,cy+Math.sin(angle)*r);ctx.lineTo(cx+Math.cos(angle)*(r+length),cy+Math.sin(angle)*(r+length));ctx.stroke();}
  ctx.fillStyle=color(.2+energy*.65);
  for(let i=0;i<(settings.panels.particles?settings.particles:0);i++){const p=particles[i];const px=(p.x*w+phase*p.speed*8)%w;const py=h-65-p.y*45+Math.sin(px*.009+phase*p.speed)*(5+energy*70);ctx.fillRect(px,py,1.3+energy*2,1.3+energy*2);}
}
window.addEventListener('beforeunload', () => { for(const key of [...audioSources.keys()]) stopSource(key); audioContext?.close();if(processLive)api.processAudio(false).catch(()=>{}); });
(async () => { try { const initial = await api.load(); settings = initial.settings; $('appPath').textContent = initial.executable || '未設定'; applySettings(); showVoice({session:initial.voice?.session,enabled:initial.voice?.enabled,active:false}); time(); setInterval(time,1000); refresh(); setInterval(metrics,3000); setInterval(weather,15*60*1000); setInterval(market,5*60*1000); setInterval(usage,5*60*1000); requestAnimationFrame(draw); status(initial.platform === 'win32' ? '準備完了。再生音またはマイクをONにすると音に反応します。' : '開発プレビュー。再生音・アプリ起動・音声起動はWindowsで利用できます。'); } catch(e) { status(`初期化に失敗: ${e.message}`); } })();
