const {test}=require('node:test');
const assert=require('node:assert/strict');
const {radioState,summonProgress}=require('../.test-build/parlor/radio.js');
const {TableGestures,SUMMON_MS}=require('../.test-build/parlor/gestures.js');
const signal=(phase,mic='idle',audioPlaying=false)=>radioState({phase,audioPlaying},{phase:mic});

test('radio maps each real pending state to indeterminate searching, playback only after audio starts',()=>{
  for(const phase of ['drawing','generating','conversation','calling','speaking'])assert.equal(signal(phase).mode,'searching',phase);
  assert.equal(signal('ready','checking').label,'Opening the microphone');
  assert.equal(signal('ready','finishing').label,'Deciphering your words');
  assert.equal(signal('speaking','idle',true).mode,'speaking');
  assert.equal(signal('calling','idle',true).label,'Contact established');
  assert.equal(signal('awaiting-release').mode,'contact');
  assert.equal(signal('question','listening').mode,'listening');
  for(const phase of ['question','ready','confirm','complete'])assert.equal(signal(phase).mode,'waiting');
});

test('idle/error/pause cannot look busy and stale microphone errors do not mask a new reading',()=>{
  assert.deepEqual(signal('idle','finishing',true),{mode:'quiet',label:''});
  for(const phase of ['error','paused'])assert.equal(signal(phase,'finishing',true).mode,'stopped');
  assert.equal(signal('ready','error').mode,'stopped');
  assert.equal(signal('generating','error').mode,'searching');
  assert.equal(signal('speaking','error',true).mode,'speaking');
});

test('summon sweep shares the actual hold start and seven-second deadline; cancel/reset fences old timers',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let now=10000,start,contact=0;
  t.mock.method(performance,'now',()=>now);
  const controls=new TableGestures({holdDelay:()=>SUMMON_MS,press:at=>start=at,captureTap:()=>undefined,hold:()=>contact++,release:()=>{},cancel:()=>start=undefined,reset:()=>start=undefined});
  const tick=ms=>{now+=ms;t.mock.timers.tick(ms);};
  controls.down('a');assert.equal(start,now);assert.equal(summonProgress(start,now),0);
  tick(3500);assert.equal(summonProgress(start,now),.5);assert.equal(contact,0);
  tick(3499);assert.ok(summonProgress(start,now)<1);assert.equal(contact,0);
  tick(1);assert.equal(summonProgress(start,now),1);assert.equal(contact,1);
  controls.cancel();assert.equal(start,undefined);controls.down('b');tick(1000);controls.cancel();tick(9000);assert.equal(contact,1);
  for(let i=0;i<5;i++){controls.down('a');tick(40);controls.up('a');tick(40);}assert.equal(start,undefined);tick(8000);assert.equal(contact,1);
  controls.down('b');assert.equal(summonProgress(start,now),0);controls.dispose();tick(8000);assert.equal(contact,1);
  assert.equal(summonProgress(100,0),0);assert.equal(summonProgress(0,9000),1);
});
