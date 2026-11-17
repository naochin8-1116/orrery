const {test}=require('node:test');const assert=require('node:assert/strict');
const {VoiceSession}=require('../src/session.cjs');
function setup(){const calls=[];return {calls,s:new VoiceSession({start:()=>calls.push('start'),stop:()=>calls.push('stop'),notify:packet=>calls.push(packet)})};}
test('voice sessions pause listening and resume only after an explicit end',()=>{
 const {s,calls}=setup();s.setListening(true);assert.equal(s.state('').active,true);s.begin();assert.equal(s.state('').active,false);assert.equal(s.state('').enabled,true);assert.throws(()=>s.begin());s.started();assert.equal(s.state('').session,true);
 const starts=calls.filter(v=>v==='start').length;s.setListening(true);assert.equal(calls.filter(v=>v==='start').length,starts);s.end();assert.equal(s.state('').active,true);
});
test('turning listening off during a session prevents a later automatic restart',()=>{const {s,calls}=setup();s.setListening(true);s.begin();s.started();s.setListening(false);const n=calls.length;s.end();assert.equal(s.state('').active,false);assert.ok(!calls.slice(n).includes('start'));});
test('an uncertain UI operation keeps listening paused until the user ends the session',()=>{const {s}=setup();s.setListening(true);s.begin();s.fail(true);assert.equal(s.state('').session,true);assert.equal(s.state('').active,false);s.end();assert.equal(s.state('').active,true);});
test('a failed startup rolls back the listening flag',()=>{const s=new VoiceSession({start:()=>{throw Error('not available');},stop:()=>{},notify:()=>{}});assert.throws(()=>s.setListening(true));assert.equal(s.enabled,false);});
