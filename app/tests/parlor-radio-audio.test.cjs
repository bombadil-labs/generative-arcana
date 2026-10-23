const {test}=require('node:test');
const assert=require('node:assert/strict');
const {RadioAudio,radioGain,MAX_RADIO_GAIN}=require('../.test-build/parlor/radioAudio.js');
const tick=()=>new Promise(r=>setImmediate(r));
class Param {
  value=0; events=[];
  cancelScheduledValues(time){this.events.push(['cancel',time]);}
  setValueAtTime(value,time){this.events.push(['set',value,time]);}
  linearRampToValueAtTime(value,time){this.events.push(['ramp',value,time]);}
}
class Context {
  state='suspended';currentTime=0;sampleRate=1000;nodes=[];closed=0;suspended=0;destination={};
  node(source=false){const n={gain:new Param(),frequency:new Param(),Q:new Param(),connected:[],disconnected:0,started:0,stopped:[],connect(to){this.connected.push(to);return to;},disconnect(){this.disconnected++;},start(){this.started++;},stop(time){this.stopped.push(time);}};n.source=source;this.nodes.push(n);return n;}
  createGain(){return this.node();}createBiquadFilter(){return this.node();}createOscillator(){return this.node(true);}createBufferSource(){return this.node(true);}
  createBuffer(_,length){const data=new Float32Array(length);return {getChannelData:()=>data};}
  resume(){this.state='running';return Promise.resolve();}suspend(){this.state='suspended';this.suspended++;return Promise.resolve();}close(){this.state='closed';this.closed++;return Promise.resolve();}
}
function fixture(t){t.mock.timers.enable({apis:['setTimeout']});const context=new Context();let created=0;const sound=new RadioAudio(()=>{created++;return context;});return {sound,context,created:()=>created,advance:ms=>t.mock.timers.tick(ms)};}
const master=context=>context.nodes.find(n=>n.connected.includes(context.destination));

test('radio level is bounded, quiet at idle/errors/capture, and strongly ducked beneath speech',()=>{
  const prefs={muted:false,volume:1};assert.equal(radioGain('searching',prefs),MAX_RADIO_GAIN);
  assert.ok(radioGain('speaking',prefs)<radioGain('searching',prefs)/10);
  for(const mode of ['quiet','stopped','listening'])assert.equal(radioGain(mode,prefs),0);
  for(const value of [NaN,Infinity,-1])assert.equal(radioGain('searching',{...prefs,volume:value}),0);
  assert.equal(radioGain('searching',{...prefs,volume:99}),MAX_RADIO_GAIN);
  assert.equal(radioGain('searching',{...prefs,muted:true}),0);assert.equal(radioGain('searching',prefs,true),0);assert.equal(radioGain('searching',prefs,false,true),0);
});
test('only an explicit gesture creates/resumes one context; synthesis is bounded and faded',async t=>{
  const {sound,context,created,advance}=fixture(t);sound.setPreferences({muted:false,volume:1});sound.setState('searching',false);assert.equal(created(),0);
  sound.unlock();await tick();assert.equal(created(),1);const gain=master(context).gain;assert.deepEqual(gain.events.at(-1),['ramp',.06,.65]);
  const noise=context.nodes.find(n=>n.buffer);const samples=noise.buffer.getChannelData(0);assert.equal(Math.abs(samples[0]),0);assert.equal(Math.abs(samples.at(-1)),0);assert.ok(samples.every(v=>Math.abs(v)<=1));assert.equal(noise.loop,true);
  assert.equal(context.nodes.filter(n=>n.source).length,2);assert.ok(context.nodes.some(n=>n.type==='lowpass'&&n.frequency.value===1800));assert.ok(context.nodes.some(n=>n.type==='sine'&&n.frequency.value===110));
  context.currentTime=.325;sound.setState('speaking',false);assert.deepEqual(gain.events.at(-2),['set',.03,.325]);assert.deepEqual(gain.events.at(-1),['ramp',.0048,.35000000000000003]);
  context.currentTime=.4;sound.hold(true);assert.equal(gain.events.at(-1)[1],0);sound.setState('searching',true);sound.hold(false);assert.equal(gain.events.at(-1)[1],0);
  sound.setState('searching',false);assert.equal(gain.events.at(-1)[1],.06);sound.unlock();await tick();assert.equal(created(),1);sound.dispose();advance(100);assert.equal(context.closed,1);assert.ok(context.nodes.every(n=>n.disconnected>0));
});
test('mute/reset/blur stop nodes, require a new gesture, preserve mute and never leak contexts',async t=>{
  const {sound,context,created,advance}=fixture(t);sound.setState('tuning',false);sound.unlock();await tick();
  for(let i=0;i<12;i++){sound.stop();advance(70);assert.equal(context.state,'suspended');assert.ok(context.nodes.filter(n=>n.source).every(n=>n.stopped.length));sound.setState('searching',false);assert.equal(context.state,'suspended');sound.unlock();await tick();}
  sound.setPreferences({muted:true,volume:1});advance(70);const count=context.nodes.length;sound.setState('tuning',false);sound.unlock();await tick();assert.equal(context.nodes.length,count);assert.equal(created(),1);
  sound.dispose();advance(100);assert.equal(context.closed,1);sound.unlock();sound.setState('searching',false);await tick();assert.equal(context.nodes.length,count);assert.ok(context.nodes.every(n=>n.disconnected>0));
});
test('late resume cannot resurrect reset/disposed audio; unsupported and rejected contexts fail quietly',async t=>{
  const {sound,context,advance}=fixture(t);let resolve;context.resume=()=>new Promise(r=>resolve=()=>{context.state='running';r();});
  sound.setState('searching',false);sound.unlock();sound.stop();resolve();await tick();assert.equal(context.nodes.length,0);assert.equal(context.state,'suspended');
  sound.unlock();sound.dispose();resolve();await tick();advance(100);assert.equal(context.nodes.length,0);assert.equal(context.closed,1);
  const missing=new RadioAudio(()=>{throw Error('unsupported');});missing.unlock();assert.match(missing.getSnapshot(),/unavailable/);missing.dispose();
  const rejected=new RadioAudio(()=>({...context,resume:()=>Promise.reject(Error('blocked')),suspend:()=>Promise.resolve(),close:()=>Promise.resolve()}));rejected.unlock();await tick();assert.match(rejected.getSnapshot(),/unavailable/);rejected.dispose();advance(100);
});
