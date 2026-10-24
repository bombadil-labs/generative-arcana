const {test}=require('node:test');
const assert=require('node:assert/strict');
const {RadioAudio,radioGain,MAX_RADIO_GAIN,loadRadioRecording,RADIO_RECORDING}=require('../.test-build/parlor/radioAudio.js');
const tick=()=>new Promise(r=>setImmediate(r));
class Param {
  value=0; events=[];
  cancelScheduledValues(time){this.events.push(['cancel',time]);}
  setValueAtTime(value,time){this.events.push(['set',value,time]);}
  linearRampToValueAtTime(value,time){this.events.push(['ramp',value,time]);}
}
class Context {
  state='suspended';currentTime=0;sampleRate=1000;nodes=[];closed=0;suspended=0;destination={};
  node(source=false){const n={gain:new Param(),frequency:new Param(),Q:new Param(),connected:[],disconnected:0,started:0,starts:[],stopped:[],connect(to){this.connected.push(to);return to;},disconnect(){this.disconnected++;},start(...args){this.started++;this.starts.push(args);},stop(time){this.stopped.push(time);}};n.source=source;this.nodes.push(n);return n;}
  createGain(){return this.node();}createBiquadFilter(){return this.node();}createOscillator(){return this.node(true);}createBufferSource(){return this.node(true);}
  createBuffer(_,length){const data=new Float32Array(length);return {getChannelData:()=>data};}
  resume(){this.state='running';return Promise.resolve();}suspend(){this.state='suspended';this.suspended++;return Promise.resolve();}close(){this.state='closed';this.closed++;return Promise.resolve();}
}
function fixture(t,loader,random=()=>0){t.mock.timers.enable({apis:['setTimeout']});const context=new Context();let created=0,loads=0;const sound=new RadioAudio(()=>{created++;return context;},async(...args)=>{loads++;return loader?loader(...args):{duration:180,numberOfChannels:1};},random);return {sound,context,created:()=>created,loads:()=>loads,advance:ms=>t.mock.timers.tick(ms)};}
const master=context=>context.nodes.find(n=>n.connected.includes(context.destination));

test('signal accents need unlocked actual playback, stay short/quiet and obey mute, volume and capture',async t=>{
  const {sound,context,created,advance}=fixture(t);sound.signal('lock');assert.equal(created(),0);
  sound.setState('speaking',false);sound.unlock();await tick();
  const count=()=>context.nodes.filter(n=>n.source).length;
  const initial=count();sound.signal('lock');assert.equal(count(),initial+1);
  const source=context.nodes.filter(n=>n.source).at(-1),gain=context.nodes.at(-1).gain;
  assert.deepEqual(gain.events,[['set',0,0],['ramp',.012*.35,.012],['ramp',0,.075]]);assert.deepEqual(source.stopped,[.075]);assert.equal(source.loop,undefined);
  context.currentTime=.02;sound.setState('listening',true);assert.equal(source.stopped.at(-1),undefined,'capture stops immediately');assert.equal(source.disconnected,1);advance(20);
  sound.signal('loss');assert.equal(count(),initial+1);
  sound.setState('speaking',false);sound.hold(true);sound.signal('lock');assert.equal(count(),initial+1);sound.hold(false);
  sound.setPreferences({muted:false,volume:1});sound.signal('loss');assert.equal(context.nodes.at(-1).gain.events[1][1],.012*.8);advance(200);assert.ok(context.nodes.at(-1).disconnected);
  sound.setPreferences({muted:true,volume:1});sound.signal('lock');advance(100);const muted=count();sound.unlock();sound.signal('loss');assert.equal(count(),muted);
  sound.setPreferences({muted:false,volume:0});sound.unlock();sound.signal('lock');assert.equal(count(),muted);sound.dispose();advance(100);assert.equal(context.closed,1);
});

test('accents cancel on reset/blur/dispose and cannot be queued or resurrect a context',async t=>{
  const {sound,context,advance}=fixture(t);sound.setState('speaking',false);sound.unlock();await tick();sound.signal('lock');
  const sources=()=>context.nodes.filter(n=>n.source);const accent=sources().at(-1);context.currentTime=.01;sound.stop();assert.ok(accent.stopped.at(-1)<=.0161);advance(100);
  const count=sources().length;sound.signal('loss');sound.setState('speaking',false);sound.signal('lock');assert.equal(sources().length,count);
  sound.unlock();await tick();for(let i=0;i<20;i++)sound.signal(i%2?'lock':'loss');assert.ok(context.nodes.filter(n=>n.source&&!n.disconnected).length<=3,'one bed, at most two bounded accents');sound.dispose();advance(100);assert.ok(context.nodes.every(n=>n.disconnected));assert.equal(context.closed,1);
});

test('unsupported accent graph fails quietly without stopping voice or bed, and cleans partial resources',async t=>{
  const {sound,context,advance}=fixture(t);sound.setState('speaking',false);sound.unlock();await tick();context.createBiquadFilter=()=>{throw Error('unsupported');};
  sound.signal('lock');assert.equal(sound.getSnapshot(),'');assert.equal(context.state,'running');assert.equal(context.nodes.at(-1).disconnected,1);sound.dispose();advance(100);assert.equal(context.closed,1);
});

test('quiet-cue start and cursor survive short waits, silence and resets without restarting a passage',async t=>{
  const {sound,context,loads,advance}=fixture(t,undefined,()=>.6);sound.setState('searching',false);sound.unlock();await tick();
  const sources=()=>context.nodes.filter(n=>n.source);assert.deepEqual(sources()[0].starts[0],[0,95.2]);
  context.currentTime=10;sound.setState('speaking',false);context.currentTime=15;sound.hold(true);sound.setState('listening',true);assert.equal(sources().length,1,'duck without restarting');
  context.currentTime=20;sound.stop();advance(100);sound.setState('searching',false);sound.hold(false);sound.unlock();await tick();assert.deepEqual(sources()[1].starts[0],[20,115.2]);assert.equal(loads(),1);
  context.currentTime=100;sound.stop();advance(100);sound.unlock();await tick();assert.ok(Math.abs(sources()[2].starts[0][1]-15.2)<1e-8,'wrap only after full source duration');sound.dispose();advance(100);
});

test('late asset/decode completion after reset, mute, timeout or disposal cannot play',async t=>{
  let resolve,signal;const {sound,context,advance}=fixture(t,(_,s)=>{signal=s;return new Promise(r=>resolve=r);});
  for(const action of ['reset','mute','timeout','dispose']){
    sound.setPreferences({muted:false,volume:.35});sound.setState('searching',false);sound.unlock();await tick();
    if(action==='reset')sound.stop();else if(action==='mute')sound.setPreferences({muted:true,volume:.35});else if(action==='timeout')advance(20001);else sound.dispose();
    assert.equal(signal.aborted,true);resolve({duration:180,numberOfChannels:1});await tick();advance(100);assert.equal(context.nodes.length,0);
    if(action==='timeout')assert.match(sound.getSnapshot(),/unavailable/);
  }
  assert.equal(context.closed,1);
});

test('asset/decode failure is quiet, bounded and retryable only by a later gesture',async t=>{
  let bad=true;const {sound,context,loads,advance}=fixture(t,async()=>{if(bad)throw Error('decode');return {duration:180,numberOfChannels:1};});
  sound.setState('searching',false);sound.unlock();await tick();assert.match(sound.getSnapshot(),/unavailable/);assert.equal(context.nodes.length,0);advance(100);
  sound.setState('speaking',false);await tick();assert.equal(loads(),1);bad=false;sound.unlock();await tick();assert.equal(sound.getSnapshot(),'');assert.equal(loads(),2);sound.dispose();advance(100);
});

test('recording transport is private and bounded; auth errors, HTML, decode failures and aborts fail closed',async()=>{
  const original=global.fetch;let decoded=0;const context={decodeAudioData:async()=>{decoded++;return {duration:180,numberOfChannels:1};}};
  try{
    const controller=new AbortController();global.fetch=async(url,init)=>{assert.equal(url,RADIO_RECORDING);assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.signal,controller.signal);return new Response(new Uint8Array([1,2]),{headers:{'content-type':'audio/mpeg'}});};
    await loadRadioRecording(context,controller.signal);assert.equal(decoded,1);
    for(const response of [new Response('',{status:401}),new Response('sign in',{headers:{'content-type':'text/html'}}),new Response(new Uint8Array(5_000_001),{headers:{'content-type':'audio/mpeg'}})]){global.fetch=async()=>response;await assert.rejects(loadRadioRecording(context,new AbortController().signal));}assert.equal(decoded,1);
    global.fetch=async()=>new Response(new Uint8Array([1]),{headers:{'content-type':'audio/mpeg'}});
    await assert.rejects(loadRadioRecording({decodeAudioData:async()=>({duration:2,numberOfChannels:1})},new AbortController().signal));
    const aborted=new AbortController();aborted.abort();await assert.rejects(loadRadioRecording(context,aborted.signal));assert.equal(decoded,1);
  }finally{global.fetch=original;}
});

test('radio level is bounded, quiet at idle/errors/capture, and strongly ducked beneath speech',()=>{
  const prefs={muted:false,volume:1};assert.equal(radioGain('searching',prefs),MAX_RADIO_GAIN);
  assert.ok(radioGain('speaking',prefs)<radioGain('searching',prefs)/10);
  for(const mode of ['quiet','stopped','listening'])assert.equal(radioGain(mode,prefs),0);
  for(const value of [NaN,Infinity,-1])assert.equal(radioGain('searching',{...prefs,volume:value}),0);
  assert.equal(radioGain('searching',{...prefs,volume:99}),MAX_RADIO_GAIN);
  assert.equal(radioGain('searching',{...prefs,muted:true}),0);assert.equal(radioGain('searching',prefs,true),0);assert.equal(radioGain('searching',prefs,false,true),0);
});
test('only an explicit gesture loads/plays one unamplified recording, with smooth fades and no synth layer',async t=>{
  const {sound,context,created,loads,advance}=fixture(t);sound.setPreferences({muted:false,volume:1});sound.setState('searching',false);assert.equal(created(),0);assert.equal(loads(),0);
  sound.unlock();await tick();assert.equal(created(),1);assert.equal(loads(),1);const gain=master(context).gain;assert.deepEqual(gain.events.at(-1),['ramp',1,.65]);
  const recording=context.nodes.find(n=>n.buffer);assert.equal(recording.loop,true);assert.equal(recording.buffer.duration,180);
  assert.equal(context.nodes.filter(n=>n.source).length,1);assert.equal(context.nodes.length,2);
  context.currentTime=.325;sound.setState('speaking',false);assert.deepEqual(gain.events.at(-2),['set',.5,.325]);assert.deepEqual(gain.events.at(-1),['ramp',.08,.35000000000000003]);
  context.currentTime=.4;sound.hold(true);assert.equal(gain.events.at(-1)[1],0);sound.setState('searching',true);sound.hold(false);assert.equal(gain.events.at(-1)[1],0);
  sound.setState('searching',false);assert.equal(gain.events.at(-1)[1],1);sound.unlock();await tick();assert.equal(created(),1);assert.equal(loads(),1);sound.dispose();advance(100);assert.equal(context.closed,1);assert.ok(context.nodes.every(n=>n.disconnected>0));
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
