const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TableGestures,tableInput,tableKey,HOLD_MS,TAP_GAP_MS,SUMMON_MS}=require('../.test-build/parlor/gestures.js');

test('three taps open help only after the gap; five reset without opening help and four do nothing',t=>{
  const events=[];const {controls,tap,tick}=setup(t,{introduction:()=>events.push('guide'),reset:()=>events.push('reset'),captureTap:()=>()=>events.push('advance')});
  for(let i=0;i<3;i++){tap();tick(100);}assert.deepEqual(events,[]);tick(399);assert.deepEqual(events,[]);tick(1);assert.deepEqual(events,['guide']);
  events.length=0;for(let i=0;i<5;i++){tap();tick(100);}tick(1000);assert.deepEqual(events,['reset']);
  events.length=0;for(let i=0;i<4;i++){tap();tick(100);}tick(1000);assert.deepEqual(events,[]);
  for(let i=0;i<3;i++){controls.down('a');controls.down('a',true);controls.down('b');controls.up('a');controls.up('b');tick(100);}tick(500);assert.deepEqual(events,['guide'],'overlap and repeat are not extra gestures');
});

test('help is universal during busy states and a modal close gesture cannot replay as advance',t=>{
  let open=false,busy=true;const events=[];
  const {controls,tap,tick}=setup(t,{captureTap:()=>open?()=>{open=false;events.push('close');}:busy?undefined:()=>events.push('advance'),captureHold:()=>undefined,introduction:()=>{open=true;events.push('guide');},reset:()=>{open=false;events.push('reset');}});
  for(let i=0;i<3;i++)tap();tick(500);assert.equal(open,true);assert.deepEqual(events,['guide']);
  tap();busy=false;tick(500);tick(2000);assert.deepEqual(events,['guide','close']);
  busy=true;for(let i=0;i<3;i++)tap();tick(500);for(let i=0;i<5;i++)tap();tick(500);assert.deepEqual(events,['guide','close','guide','reset']);
  for(let i=0;i<3;i++)tap();controls.cancel();tick(1000);assert.equal(open,false,'cancel fences pending guide opening');
});
function setup(t,overrides={}) {
  t.mock.timers.enable({apis:['setTimeout']});
  const events=[];
  const controls=new TableGestures({captureTap:()=>()=>events.push('advance'),hold:()=>events.push('hold'),release:()=>events.push('release'),cancel:()=>events.push('cancel'),reset:()=>events.push('reset'),...overrides});
  const tap=(id='a')=>{controls.down(id);t.mock.timers.tick(60);controls.up(id);};
  return {controls,events,tap,tick:ms=>t.mock.timers.tick(ms)};
}
test('a quick tap waits for reset disambiguation and never starts a microphone',t=>{
  const {tap,tick,events}=setup(t);tap();tick(TAP_GAP_MS-1);assert.deepEqual(events,[]);tick(1);assert.deepEqual(events,['advance']);
});
test('five consecutive gestures reset once without intermediate advances',t=>{
  const {tap,tick,events}=setup(t);for(let i=0;i<5;i++){tap(i%2?'b':'a');tick(100);}assert.deepEqual(events,['reset']);tick(3000);assert.deepEqual(events,['reset']);
});
test('two to four quick taps coalesce to one advance; a gap starts a new sequence',t=>{
  const {tap,tick,events}=setup(t);for(let i=0;i<4;i++){tap();tick(TAP_GAP_MS-1);}tick(1);assert.deepEqual(events,['advance']);tap();tick(TAP_GAP_MS);assert.deepEqual(events,['advance','advance']);
});
test('hold threshold starts once, auto-repeat is ignored, final release submits once',t=>{
  const {controls,tick,events}=setup(t);controls.down('a');tick(HOLD_MS-1);controls.down('a',true);assert.deepEqual(events,[]);tick(1);controls.down('a',true);tick(600);controls.up('a');controls.up('a');tick(1000);assert.deepEqual(events,['hold','release']);
});
test('overlapping keys and pointers are one held gesture until every release',t=>{
  const {controls,tick,events}=setup(t);controls.down('a');tick(100);controls.down('b');controls.down('pointer:1');tick(HOLD_MS);controls.up('a');controls.up('pointer:1');assert.deepEqual(events,['hold']);controls.up('b');assert.deepEqual(events,['hold','release']);
});
test('overlapping taps count once, not once per key; hold interrupts a reset sequence',t=>{
  const {controls,tap,tick,events}=setup(t);for(let i=0;i<4;i++){controls.down('a');controls.down('b');controls.up('a');controls.up('b');tick(100);}assert.deepEqual(events,[]);controls.down('a');tick(HOLD_MS);controls.up('a');tap();tick(TAP_GAP_MS);assert.deepEqual(events,['hold','release','advance']);
});
test('cancel fences timers and late keyup/autorepeat; dispose cannot restart',t=>{
  const {controls,tap,tick,events}=setup(t);tap();controls.cancel();tick(1000);controls.down('a',true);tick(1000);controls.up('a');assert.deepEqual(events,['cancel']);controls.down('a');tick(HOLD_MS);controls.cancel();controls.up('a');tick(1000);assert.deepEqual(events,['cancel','hold','cancel']);controls.dispose();controls.down('b');tick(3000);assert.deepEqual(events,['cancel','hold','cancel','cancel']);
});
test('tap captures its original state and cannot advance after a late provider result',t=>{
  let snapshot='busy',advances=0;
  const {tap,tick,events}=setup(t,{captureTap:()=>{const before=snapshot;return before==='ready'?()=>{if(snapshot===before)advances++;}:undefined;}});
  tap();snapshot='ready';tick(TAP_GAP_MS);assert.equal(advances,0);
  tap();snapshot='new-card';tick(TAP_GAP_MS);assert.equal(advances,0);
  for(let i=0;i<5;i++){tap();tick(100);}tick(1000);assert.deepEqual(events,['reset']);
});
test('ordinary keys work without a focused button; operator keys and fields remain native',()=>{
  const event={key:'a',code:'KeyA',isComposing:false,metaKey:false,ctrlKey:false,altKey:false};
  assert.equal(tableKey(event,null),'key:KeyA');assert.equal(tableKey({...event,key:' ',code:'Space'},null),'key:Space');
  for(const key of ['Escape','Tab','Shift','Control','Alt','Meta','CapsLock','Dead','Process','Unidentified'])assert.equal(tableKey({...event,key},null),undefined);
  for(const modifier of ['metaKey','ctrlKey','altKey','isComposing'])assert.equal(tableKey({...event,[modifier]:true},null),undefined);
  const {JSDOM}=require('jsdom');const dom=new JSDOM('<input><textarea></textarea><select></select><div contenteditable><span></span></div><button data-parlor-operator><b></b></button><section></section>');
  try {for(const selector of ['input','textarea','select','span','b'])assert.equal(tableKey(event,dom.window.document.querySelector(selector)),undefined);assert.equal(tableKey(event,dom.window.document.querySelector('section')),'key:KeyA');}finally{dom.window.close();}
});

test('summoning has a separate seven-second threshold, early release and overlapping keys',t=>{
  const states=[];let idle=true;
  const {controls,tick}=setup(t,{holdDelay:()=>idle?SUMMON_MS:HOLD_MS,press:()=>states.push('press'),captureHold:()=>()=>states.push('contact'),lift:()=>states.push('lift'),release:()=>states.push('released')});
  controls.down('a');tick(6999);assert.deepEqual(states,['press']);controls.up('a');tick(1000);assert.deepEqual(states,['press','lift']);
  states.length=0;controls.down('a');controls.down('b');tick(7000);assert.deepEqual(states,['press','contact']);controls.up('a');assert.deepEqual(states,['press','contact']);controls.up('b');assert.deepEqual(states,['press','contact','lift','released']);
});

test('reset/cancel during summoning fences the seven-second timer and the captured hold intent',t=>{
  let contacts=0;const {controls,tap,tick,events}=setup(t,{holdDelay:()=>SUMMON_MS,captureHold:()=>()=>contacts++});
  controls.down('a');tick(5000);controls.cancel();controls.up('a');tick(3000);assert.equal(contacts,0);
  for(let i=0;i<5;i++){tap();tick(100);}tick(10000);assert.equal(contacts,0);assert.deepEqual(events,['cancel','reset']);
});

test('ordinary actions are unavailable during every busy phase and microphone operation',()=>{
  for(const phase of ['summoning','calling','awaiting-release','confirm','drawing','generating','speaking','conversation']){
    assert.deepEqual(tableInput({phase,segment:1},{phase:'idle'},true),{tap:false,hold:undefined},phase);
  }
  assert.deepEqual(tableInput({phase:'ready',segment:0},{phase:'idle'},true),{tap:false,hold:undefined},'first-card transition');
  for(const phase of ['checking','listening','finishing'])for(const state of ['idle','question','ready','complete','paused','error']){
    assert.deepEqual(tableInput({phase:state,segment:1},{phase},true),{tap:false,hold:undefined},`${state}/${phase}`);
  }
  assert.deepEqual(tableInput({phase:'idle',segment:0},{phase:'idle'},true),{tap:false,hold:'summon'});
  assert.deepEqual(tableInput({phase:'ready',segment:1},{phase:'idle'},true),{tap:true,hold:'speak'});
  assert.deepEqual(tableInput({phase:'ready',segment:1},{phase:'idle'},false),{tap:true,hold:undefined});
});

test('busy key and pointer gestures have no side effects or replay; five taps always reset',t=>{
  let state={phase:'speaking',segment:1},mic={phase:'idle'};
  const events=[];
  const {controls,tap,tick}=setup(t,{
    captureTap:()=>tableInput(state,mic,true).tap?()=>events.push('advance'):undefined,
    captureHold:()=>tableInput(state,mic,true).hold?()=>events.push('record'):undefined,
    press:()=>events.push('press'),lift:()=>events.push('lift'),release:()=>events.push('release'),cancel:()=>events.push('cancel'),reset:()=>events.push('reset'),
  });
  for(const phase of ['calling','confirm','drawing','generating','speaking','conversation','transcribing'])for(const key of ['key:Space','pointer:9']){
    state={phase:phase==='transcribing'?'ready':phase,segment:1};mic={phase:phase==='transcribing'?'finishing':'idle'};
    tap(key);state={phase:'ready',segment:1};mic={phase:'idle'};tick(1000);assert.deepEqual(events,[],'ignored tap never replays after ready');
    state={phase:'speaking',segment:1};controls.down(key);state={phase:'ready',segment:1};tick(HOLD_MS+100);controls.up(key);tick(1000);assert.deepEqual(events,[],'ignored hold never starts after ready');
    state={phase:'speaking',segment:1};controls.down(key);controls.cancelGesture();controls.up(key);tick(1000);assert.deepEqual(events,[],'cancelling ignored input does not stop narration');
    state={phase:phase==='transcribing'?'ready':phase,segment:1};mic={phase:phase==='transcribing'?'finishing':'idle'};
    for(let i=0;i<5;i++){tap(key);tick(100);}assert.deepEqual(events,['reset'],`${phase}/${key} reset`);events.length=0;
  }
});

test('release of an accepted hold still runs after the state becomes busy',t=>{
  let available=true;const events=[];
  const {controls,tick}=setup(t,{captureTap:()=>undefined,captureHold:()=>available?()=>events.push('hold'):undefined,press:()=>events.push('press'),lift:()=>events.push('lift'),release:()=>events.push('release')});
  controls.down('key:Space');tick(HOLD_MS);available=false;controls.up('key:Space');assert.deepEqual(events,['press','hold','lift','release']);
});

test('summon release stays consumed when lift changes state or synchronously cancels the gesture',t=>{
  let phase='idle',advances=0,cancelOnLift=false;
  const {controls,tick}=setup(t,{holdDelay:()=>SUMMON_MS,captureTap:()=>phase==='question'?()=>advances++:undefined,captureHold:()=>()=>{phase='awaiting-release';},lift:()=>{phase='question';if(cancelOnLift)controls.cancelGesture();},release:()=>{}});
  controls.down('key:Space');tick(SUMMON_MS);controls.up('key:Space');controls.up('key:Space');tick(TAP_GAP_MS);assert.equal(advances,0);
  phase='idle';cancelOnLift=true;controls.down('key:Space');tick(SUMMON_MS);controls.up('key:Space');tick(TAP_GAP_MS);assert.equal(advances,0);
  cancelOnLift=false;controls.down('key:Space');controls.up('key:Space');tick(TAP_GAP_MS);assert.equal(advances,1,'a new deliberate tap is independent');
});
