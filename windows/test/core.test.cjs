const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaults, validateSettings, aggregateUsage } = require('../src/core.cjs');
test('settings retain defaults and accept valid coordinates and symbols', () => {
  const s = validateSettings({ latitude: -90, longitude: 180, tickers: '^N225:日経,JPY=X:円,BTC-USD:BTC' });
  assert.equal(s.theme, 'ARC'); assert.equal(s.longitude, 180);
  assert.equal(defaults.latitude, 35.6762);
});
test('reject malformed settings at the IPC boundary', () => {
  for (const input of [null, [], { latitude: NaN }, { longitude: 181 }, { particles: 1201 }, { fps: 0 }, { topmost: 'true' }, { theme: '<script>' }, { tickers: '../bad' }, { tickers: Array(11).fill('A').join(',') }, { wakeLocale: 'bad' }]) assert.throws(() => validateSettings(input));
});
function row(id, usage, requestId = 'request') { return JSON.stringify({ type: 'assistant', requestId, message: { id, usage } }); }
test('deduplicate copied logs while retaining final streaming usage', () => {
  const seen = new Map();
  const totals = aggregateUsage([row('a', { input_tokens: 10, output_tokens: 0 }), 'broken json', row('a', { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 50 }), row('a', { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 50 }), row('b', { input_tokens: 5, output_tokens: 3 }), JSON.stringify({ type: 'user', message: { id: 'z', usage: { input_tokens: 1000 } } })], seen);
  assert.deepEqual(totals, { input: 15, output: 23, cache: 50, requests: 2 });
  aggregateUsage([row('a', { input_tokens: 10, output_tokens: 1 })], seen, totals);
  assert.deepEqual(totals, { input: 15, output: 23, cache: 50, requests: 2 });
});
const {estimateCost,restoreBounds}=require('../src/core.cjs');
test('custom color, panel visibility and migrated display modes are validated',()=>{
 const s=validateSettings({theme:'CUSTOM',customColor:'#a1b2c3',panels:{clock:false},windowMode:'desktop',automation:'voice',audioMode:'app'});
 assert.equal(s.panels.clock,false);assert.equal(s.panels.weather,true);assert.equal(defaults.panels.clock,true);assert.equal(s.topmost,false);
 assert.equal(validateSettings({topmost:true}).windowMode,'topmost');
 for(const value of [{customColor:'red'},{panels:[]},{panels:{system:'false'}},{panels:{unknown:true}},{automation:'shell'},{windowMode:'shell'},{audioMode:'any'}])assert.throws(()=>validateSettings(value));
});
test('cost estimates price final deduplicated usage and report unknown models',()=>{
 const seen=new Map();
 const entry=(id,model,input,output)=>JSON.stringify({type:'assistant',requestId:id,message:{id,model,usage:{input_tokens:input,output_tokens:output,cache_read_input_tokens:100000,cache_creation_input_tokens:200000}}});
 aggregateUsage([entry('a','known',1000000,1),entry('a','known',1000000,2000000),entry('a','known',1000000,2000000),entry('b','unknown',10,20)],seen);
 const rate={model:'known',input:3,output:15,cacheRead:.3,cacheWrite:3.75};
 assert.equal(estimateCost(seen,[rate]).usd,33.78);assert.equal(estimateCost(seen,[rate]).unpriced,1);
 assert.equal(estimateCost(seen,[]).priced,0);
 assert.equal(JSON.parse(validateSettings({prices:JSON.stringify([rate])}).prices).length,1);
 for(const prices of ['broken','{}','[{}]',JSON.stringify([rate,rate]),JSON.stringify([{...rate,output:-1}])])assert.throws(()=>validateSettings({prices}));
});
test('saved positions survive monitor changes and negative display coordinates',()=>{
 const displays=[{x:0,y:0,width:1920,height:1080},{x:-1920,y:0,width:1920,height:1080}];
 assert.deepEqual(restoreBounds({x:-1800,y:30,width:1200,height:800},displays),{x:-1800,y:30,width:1200,height:800});
 assert.deepEqual(restoreBounds({x:9000,y:9000,width:1400,height:900},displays),{x:520,y:180,width:1400,height:900});
 assert.deepEqual(restoreBounds({x:0,y:0,width:1e8,height:1e8},displays),{x:0,y:0,width:1920,height:1080});
 assert.equal(restoreBounds({x:'bad'},displays).width,1400);
});
test('explicit environment settings take precedence and are validated',()=>{
 const {withEnvironment}=require('../src/core.cjs');
 const s=withEnvironment(validateSettings({city:'TOKYO',fps:30}),{HUD_CITY:'OSAKA',HUD_FPS:'20',HUD_STATIC:'1',HUD_AUDIO_MODE:'app',HUD_WAKE_PHRASES:'オレリー,hey codex'});
 assert.equal(s.city,'OSAKA');assert.equal(s.fps,20);assert.equal(s.static,true);assert.equal(s.audioMode,'app');
 assert.throws(()=>withEnvironment(s,{HUD_STATIC:'true'}));assert.throws(()=>withEnvironment(s,{HUD_LAT:'wrong'}));assert.throws(()=>validateSettings({wakePhrase:'hello,,world'}));
});
