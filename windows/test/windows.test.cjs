const {test}=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');
const {runWindows,ProcessAudio}=require('../src/windows.cjs');
function child(){const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new PassThrough();c.kill=()=>{c.killed=true;setImmediate(()=>c.emit('close',0));};return c;}
test('Windows helpers receive structured arguments without invoking a shell',async()=>{
 let observed;const spawn=(exe,args,options)=>{observed={exe,args,options};const c=child();setImmediate(()=>{c.stdout.write('{"ok":true,"style":"123"}');c.emit('close',0);});return c;};
 assert.equal((await runWindows({isPackaged:false},'Desktop',{handle:'123'},spawn)).style,'123');assert.equal(observed.options.shell,false);
 assert.ok(observed.args.includes('Desktop'));assert.ok(observed.args.includes('123'));
 await assert.rejects(runWindows({},'arbitrary',{},spawn));
});
test('a failed UI helper rejects instead of claiming successful automation',async()=>{
 const spawn=()=>{const c=child();setImmediate(()=>{c.stderr.write('Voice controls unavailable');c.emit('close',1);});return c;};
 await assert.rejects(runWindows({isPackaged:false},'Voice',{executable:'C:\\Apps\\Codex.exe'},spawn),/unavailable/);
});
test('process-audio packets are validated, and capture stops on request',async()=>{
 let c;const packets=[];const audio=new ProcessAudio({executable:'helper.exe',notify:p=>packets.push(p),spawnProcess:()=>{c=child();setImmediate(()=>c.stdout.write('{"ready":true}\n'));return c;}});
 await audio.start('C:\\Apps\\Codex.exe');
 c.stdout.write(JSON.stringify({bins:Array(128).fill(50)})+'\n');c.stdout.write(JSON.stringify({bins:[999]})+'\n');c.stdout.write('not json\n');
 assert.equal(packets.length,1);assert.equal(packets[0].bins[0],50);audio.stop();assert.equal(c.killed,true);
});
test('process-audio failure cannot silently fall back to a system capture',async()=>{
 const packets=[];const audio=new ProcessAudio({executable:'helper.exe',notify:p=>packets.push(p),spawnProcess:()=>{const c=child();setImmediate(()=>{c.stderr.write('Target not found');c.emit('close',1);});return c;}});
 await assert.rejects(audio.start('missing.exe'),/Target not found/);assert.equal(audio.child,null);assert.equal(packets[0].ended,true);
});
