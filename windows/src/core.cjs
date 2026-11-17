const themes = ['ARC', 'EMBER', 'MATRIX', 'CRIMSON', 'MONO', 'CUSTOM'];
const panels = ['clock', 'system', 'usage', 'weather', 'market', 'particles'];
const defaults = Object.freeze({ city: 'TOKYO', latitude: 35.6762, longitude: 139.6503, tickers: '^N225:NIKKEI 225,JPY=X:USD/JPY,BTC-USD:BITCOIN', theme: 'ARC', customColor: '#5ce1ff', static: false, particles: 350, fps: 30, topmost: false, windowMode: 'normal', automation: 'open', audioMode: 'system', wakePhrase: 'オレリー', wakeLocale: 'ja-JP', panels: Object.freeze(Object.fromEntries(panels.map(k => [k, true]))), prices: '[]' });
function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('設定が不正です');
  const s = { ...defaults, panels: { ...defaults.panels } };
  for (const k of ['city', 'tickers', 'wakePhrase', 'wakeLocale']) {
    if (input[k] !== undefined) {
      if (typeof input[k] !== 'string' || !input[k].trim() || input[k].length > (k === 'tickers' ? 500 : 80)) throw Error(`${k} を確認してください`);
      s[k] = input[k].trim();
    }
  }
  for (const [k, min, max] of [['latitude', -90, 90], ['longitude', -180, 180], ['particles', 0, 1200], ['fps', 10, 60]]) {
    if (input[k] !== undefined) {
      if (typeof input[k] !== 'number' || !Number.isFinite(input[k]) || input[k] < min || input[k] > max) throw Error(`${k} が範囲外です`);
      s[k] = input[k];
    }
  }
  for (const [key, allowed] of [['theme', themes], ['windowMode', ['normal','topmost','desktop']], ['automation', ['open','newChat','voice']], ['audioMode',['system','app']]]) {
    if (input[key] !== undefined) { if (!allowed.includes(input[key])) throw Error(`${key} が不正です`); s[key] = input[key]; }
  }
  if (input.customColor !== undefined) { if (typeof input.customColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.customColor)) throw Error('色は #RRGGBB で指定してください'); s.customColor = input.customColor; }
  for (const k of ['static', 'topmost']) { if (input[k] !== undefined) { if (typeof input[k] !== 'boolean') throw Error(`${k} が不正です`); s[k] = input[k]; } }
  if (input.windowMode === undefined && s.topmost) s.windowMode = 'topmost';
  s.topmost = s.windowMode === 'topmost';
  if (input.panels !== undefined) {
    if (!input.panels || typeof input.panels !== 'object' || Array.isArray(input.panels)) throw Error('パネル設定が不正です');
    for (const key of Object.keys(input.panels)) { if (!panels.includes(key) || typeof input.panels[key] !== 'boolean') throw Error('パネル設定が不正です'); s.panels[key] = input.panels[key]; }
  }
  if (input.prices !== undefined) {
    if (typeof input.prices !== 'string' || input.prices.length > 12000) throw Error('単価設定が不正です');
    let rows; try { rows = JSON.parse(input.prices); } catch { throw Error('単価設定はJSON配列で指定してください'); }
    if (!Array.isArray(rows) || rows.length > 50) throw Error('単価は50モデルまでです');
    const models = new Set();
    for (const row of rows) {
      if (!row || typeof row.model !== 'string' || !row.model.trim() || row.model.length > 100 || models.has(row.model)) throw Error('モデル名は空欄・重複なしで指定してください');
      models.add(row.model);
      for (const key of ['input','output','cacheRead','cacheWrite']) if (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0 || row[key] > 10000) throw Error('単価は0〜10000の数値で指定してください');
    }
    s.prices = JSON.stringify(rows);
  }
  const tickers = s.tickers.split(',');
  if (tickers.length > 10 || tickers.some(t => !/^[A-Za-z0-9^=.\-]{1,25}(:[^,]{1,40})?$/.test(t.trim()))) throw Error('銘柄は「シンボル:表示名」を10件まで指定してください');
  if(s.wakePhrase.split(',').length>8 || s.wakePhrase.split(',').some(v=>!v.trim()))throw Error('合図は空欄なしで8件まで指定してください');
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(s.wakeLocale)) throw Error('音声認識言語を確認してください');
  return s;
}
// Keep each request's largest counters: streaming updates and resumed/copied logs must not double count.
function aggregateUsage(lines, seen = new Map(), totals = { input: 0, output: 0, cache: 0, requests: 0 }) {
  for (const line of lines) {
    let row; try { row = JSON.parse(line); } catch { continue; }
    const message = row?.message;
    if (row?.type !== 'assistant' || !message?.usage || !message.id) continue;
    const id = `${row.requestId || ''}:${message.id}`;
    const values = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].map(k => { const n = Number(message.usage[k]); return Number.isFinite(n) ? Math.max(0,n) : 0; });
    const previous = seen.get(id);
    if (!previous) totals.requests++;
    totals.input += Math.max(0, values[0] - (previous?.values[0] || 0));
    totals.output += Math.max(0, values[1] - (previous?.values[1] || 0));
    totals.cache += Math.max(0, values[2] - (previous?.values[2] || 0)) + Math.max(0, values[3] - (previous?.values[3] || 0));
    seen.set(id, { model: message.model || previous?.model || 'unknown', values: values.map((v, i) => Math.max(v, previous?.values[i] || 0)) });
  }
  return totals;
}
function estimateCost(seen, prices) {
  const rates = new Map(prices.map(r => [r.model, r])); let usd = 0, unpriced = 0;
  for (const record of seen.values()) {
    const rate = rates.get(record.model);
    if (!rate) { unpriced++; continue; }
    usd += record.values.reduce((sum,n,i) => sum + n * rate[['input','output','cacheRead','cacheWrite'][i]], 0) / 1e6;
  }
  return { usd, unpriced, priced: seen.size - unpriced };
}
function restoreBounds(saved, displays) {
  const fallback = { width: 1400, height: 900 };
  if (!saved || !['x','y','width','height'].every(k => Number.isFinite(saved[k]))) return fallback;
  const target = displays.find(d => saved.x < d.x+d.width && saved.x+saved.width > d.x && saved.y < d.y+d.height && saved.y+saved.height > d.y) || displays[0];
  if (!target) return fallback;
  const width = Math.min(Math.max(960, Math.round(saved.width)),target.width), height = Math.min(Math.max(680, Math.round(saved.height)),target.height);
  return { width, height, x: Math.round(Math.min(Math.max(target.x,saved.x),target.x+target.width-width)), y: Math.round(Math.min(Math.max(target.y,saved.y),target.y+target.height-height)) };
}
module.exports = { defaults, validateSettings, aggregateUsage, estimateCost, restoreBounds };

function withEnvironment(base, env) {
  const next={...base};
  const fields={HUD_CITY:'city',HUD_LAT:'latitude',HUD_LON:'longitude',HUD_TICKERS:'tickers',HUD_GRAINS:'particles',HUD_FPS:'fps',HUD_WAKE_PHRASES:'wakePhrase',HUD_WAKE_LOCALE:'wakeLocale',HUD_THEME:'theme',HUD_COLOR:'customColor',HUD_AUDIO_MODE:'audioMode',HUD_WINDOW_MODE:'windowMode',HUD_AUTOMATION:'automation',HUD_PRICES:'prices'};
  for(const [name,key] of Object.entries(fields)) if(env[name]!==undefined)next[key]=['latitude','longitude','particles','fps'].includes(key)?Number(env[name]):env[name];
  if(env.HUD_STATIC!==undefined){if(!['0','1'].includes(env.HUD_STATIC))throw Error('HUD_STATIC は 0 または 1 で指定してください');next.static=env.HUD_STATIC==='1';}
  return validateSettings(next);
}
module.exports.withEnvironment=withEnvironment;
