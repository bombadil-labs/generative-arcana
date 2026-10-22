const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TableGestures,tableKey,HOLD_MS,TAP_GAP_MS,SUMMON_MS}=require('../.test-build/parlor/gestures.js');
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
