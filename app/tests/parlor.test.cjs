const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ArcanaEngine } = require('../.test-build/engine/ArcanaEngine.js');
const { DeckRegistry } = require('../.test-build/decks/registry.js');
const { ParlorMachine } = require('../.test-build/parlor/machine.js');
const { focusedCard } = require('../.test-build/parlor/cardFocus.js');
const { defaultSettings, saveSettings, readSettings } = require('../.test-build/parlor/settings.js');
const { narrate, speak, converse, parseNarration, ParlorError } = require('../.test-build/parlor/providers.js');
const { safeAccountReturnTo } = require('../.test-build/auth/api.js');
const {rawDeck}=require('./fixtures.cjs');
const {resolveCardRenderSpec}=require('../.test-build/decks/renderSpec.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const engine = new ArcanaEngine(new DeckRegistry());
const deck = engine.importDeck(rawDeck());
const settings = { ...defaultSettings(), anthropicKey: 'fake-anthropic-key', anthropicModel: 'fake-model', openaiKey: 'fake-openai-key', openaiModel: 'fake-model', elevenKey: 'fake-eleven-key', voiceId: 'fake-voice' };
const narration = reading => ({ cards: reading.placements.map(p => ({ slug: p.card.slug, text: `${p.card.name}: ${p.meaning}` })), synthesis: 'Reflect on the possibilities.' });
const immediateSilent = async (text, signal, show) => { if (!signal.aborted) show(text); };
function setup(overrides = {}) {
  let draws = 0;
  const machine = new ParlorMachine(deck.id, settings, { draw: async (_, q) => { draws++; return engine.castReading(deck.id, 'three-card', q); }, narrate: async (_, reading) => narration(reading), speak: async (_, text, signal, playing) => playing(), readSilently: immediateSilent, ...overrides });
  return { machine, draws: () => draws };
}
async function confirm(machine) { machine.begin(); machine.captions(); await until(machine,'question'); machine.question('A private question'); machine.review(); machine.confirm(); machine.confirm(); }
async function until(machine, phase) {
  if(machine.getSnapshot().phase===phase)return;
  // Crypto/draw completion is asynchronous: a fixed count of setImmediate turns can
  // expire before it finishes on a fast event loop. Observe the actual transition.
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{unsubscribe();reject(new Error(`Expected ${phase}; still ${machine.getSnapshot().phase}`));},2000);
    const unsubscribe=machine.subscribe(()=>{if(machine.getSnapshot().phase===phase){clearTimeout(timer);unsubscribe();resolve();}});
  });
}

for (const source of ['byok','owner']) test(`runtime transcript ${source}: generated is separate from presentation, reset fences late callbacks and new context`,async()=>{
  const events=[];let encounter=1,disposed=false;const audio=[],generated=deferred();
  const configured=source==='owner'?{...settings,anthropicKey:'',elevenKey:'',ownerKeys:{anthropicModel:'claude-test',elevenlabs:true}}:settings;
  const machine=new ParlorMachine(deck.id,configured,{transcript:{event:value=>{if(!disposed)events.push({encounter,...value});},reset:()=>encounter++,dispose:()=>{disposed=true;}},
    draw:async(_,q)=>engine.castReading(deck.id,'three-card',q),narrate:async(_,r)=>{await generated.promise;return {cards:r.placements.map((p,i)=>({slug:p.card.slug,text:`Generated vision ${i}`})),synthesis:'Generated closing'};},
    speak:async(_,text,signal,playing,reading,caption)=>{const done=deferred();audio.push({done,caption,playing,signal});await done.promise;},readSilently:immediateSilent});
  try {
    await confirm(machine);await until(machine,'generating');generated.resolve();await until(machine,'ready');
    assert.equal(events.filter(e=>e.kind==='assistant_generated'&&e.stage==='card').length,3);
    assert.equal(events.filter(e=>e.kind==='presentation_completed'&&e.stage==='card').length,0,'generated future prose is not delivered');
    machine.next();const first=audio.at(-1);first.playing();first.caption('Observed normalized prefix','aligned');machine.openGuide();first.caption('UNOBSERVED_WHILE_PAUSED','aligned');machine.closeGuide();machine.reset();
    const interrupted=events.find(e=>e.kind==='presentation_interrupted'&&e.stage==='card');assert.equal(interrupted.text,'Observed normalized prefix');assert.equal(interrupted.reason,'reset');assert.equal(interrupted.encounter,1);
    const count=events.length;first.caption('OLD_LATE_CAPTION','aligned');first.done.resolve();await tick();assert.equal(events.length,count);
    machine.begin();const second=audio.at(-1);second.done.resolve();await until(machine,'question');machine.submit('NEW_GUEST_ONLY');await until(machine,'ready');
    const fresh=events.filter(e=>e.encounter===2);assert.doesNotMatch(JSON.stringify(fresh),/A private question|Observed normalized prefix|OLD_LATE_CAPTION|UNOBSERVED/);
    assert.match(JSON.stringify(fresh),/NEW_GUEST_ONLY/);assert.equal(machine.getSnapshot().question,'NEW_GUEST_ONLY');
  } finally {audio.forEach(a=>a.done.resolve());machine.dispose();}
});

test('runtime transcript records missing delivery as unknown and silent pages individually, never substitutes unread script',async()=>{
  const events=[];let fail=false;const {machine}=setup({transcript:{event:e=>events.push(e),reset:()=>{},dispose:()=>{}},
    speak:async()=>{if(fail)throw new Error('RAW_SECRET_ERROR');},
    readSilently:async(text,signal,show)=>{for(const page of ['Beginning page','Middle page','Ending page'])show(page);}});
  try {
    machine.begin();await until(machine,'question');const complete=events.find(e=>e.kind==='presentation_completed');assert.equal(complete.timing,'unknown');assert.equal(complete.text,undefined);
    machine.reset();machine.begin();machine.captions();await until(machine,'question');assert.deepEqual(events.filter(e=>e.kind==='presentation_progress'&&e.timing==='silent').map(e=>e.text),['Beginning page','Middle page','Ending page']);
    fail=true;machine.reset();machine.begin();await until(machine,'error');const failed=events.filter(e=>e.kind==='presentation_interrupted').at(-1);assert.equal(failed.timing,'unknown');assert.equal(failed.text,undefined);assert.equal(failed.reason,'failed');assert.doesNotMatch(JSON.stringify(events),/RAW_SECRET_ERROR/);
  }finally{machine.dispose();}
});

test('three guide pages keep the reading paused until the final tap and reset discards the page',async()=>{
  const {machine}=setup();
  try {
    machine.openGuide();assert.equal(machine.getSnapshot().guidePage,0);assert.equal(machine.presentationPause.paused,true);
    machine.advanceGuide();assert.equal(machine.getSnapshot().guidePage,1);assert.equal(machine.presentationPause.paused,true);
    machine.openGuide();assert.equal(machine.getSnapshot().guidePage,1,'repeat triple does not restart a page');
    machine.advanceGuide();assert.equal(machine.getSnapshot().guidePage,2);assert.equal(machine.presentationPause.paused,true);
    machine.advanceGuide();assert.equal(machine.getSnapshot().guideOpen,false);assert.equal(machine.getSnapshot().guidePage,undefined);assert.equal(machine.presentationPause.paused,false);assert.equal(machine.getSnapshot().phase,'idle');
    machine.openGuide();machine.advanceGuide();machine.reset();machine.advanceGuide();assert.equal(machine.getSnapshot().guidePage,undefined);assert.equal(machine.getSnapshot().phase,'idle');
  } finally {machine.dispose();}
});

test('deck guide pauses inference and speech completion without retries, context changes or duplicate history',async()=>{
  const generated=deferred(),audio=[];let requests=0;
  const {machine,draws}=setup({narrate:async(_,reading)=>{requests++;await generated.promise;return narration(reading);},speak:async(_,text,signal,playing,reading,caption,waiting,pause)=>{const done=deferred();audio.push({done,playing,caption,signal,pause});await done.promise;}});
  try{
    machine.openGuide();machine.begin();machine.advance();machine.submit('ignored');assert.equal(machine.getSnapshot().phase,'idle');machine.closeGuide();
    await confirm(machine);await until(machine,'generating');const before=machine.getSnapshot();machine.openGuide();generated.resolve();await tick();assert.equal(machine.getSnapshot().phase,'generating');assert.equal(machine.getSnapshot().reading,before.reading);assert.equal(machine.getSnapshot().question,before.question);
    machine.advance();machine.submit('ignored');machine.closeGuide();await until(machine,'ready');assert.equal(draws(),1);assert.equal(requests,1);
    machine.next();const first=audio.at(-1);first.playing();first.caption('Already spoken','aligned');machine.openGuide();first.playing();first.caption('Must not appear','aligned');first.done.resolve();await tick();assert.equal(machine.getSnapshot().caption,'Already spoken');assert.equal(machine.getSnapshot().audioPlaying,false);assert.equal(machine.getSnapshot().segment,0);assert.deepEqual(machine.getSnapshot().turns,[]);
    machine.closeGuide();await until(machine,'ready');assert.equal(machine.getSnapshot().segment,1);assert.equal(machine.getSnapshot().turns.length,2);machine.openGuide();machine.closeGuide();await tick();assert.equal(machine.getSnapshot().turns.length,2);assert.equal(requests,1);
    machine.next();const second=audio.at(-1);machine.openGuide();machine.reset();assert.equal(second.signal.aborted,true);second.playing();second.caption('Old guest','aligned');second.done.resolve();await tick();assert.equal(machine.getSnapshot().guideOpen,undefined);assert.equal(machine.getSnapshot().phase,'idle');assert.equal(machine.getSnapshot().caption,'');assert.deepEqual(machine.getSnapshot().turns,[]);
  }finally{audio.forEach(a=>a.done.resolve());machine.dispose();}
});

test('reset starts a new provider context without the previous guest query, discussion or delivered text',async()=>{
  const requests=[];let generation=0;
  const {machine}=setup({narrate:async(_,reading)=>{requests.push({kind:'reading',question:reading.question});const out=narration(reading);out.cards[0].text=++generation===1?'PRIVATE_OLD_DELIVERED':'NEW_DELIVERED';return out;},converse:async(_,reading,turns,signal,revealed)=>{requests.push({kind:'discussion',question:reading.question,turns, revealed});return 'PRIVATE_OLD_ANSWER';}});
  try{
    await confirm(machine);await until(machine,'ready');machine.next();await until(machine,'ready');machine.ask('PRIVATE_OLD_FOLLOWUP');await until(machine,'ready');assert.match(JSON.stringify(machine.getSnapshot().turns),/PRIVATE_OLD/);
    machine.openGuide();machine.reset();assert.deepEqual(machine.getSnapshot().turns,[]);assert.equal(machine.getSnapshot().reading,undefined);assert.equal(machine.getSnapshot().userText,'');
    machine.begin();await until(machine,'question');machine.submit('NEW_GUEST_QUERY');await until(machine,'ready');machine.next();await until(machine,'ready');machine.ask('NEW_GUEST_FOLLOWUP');await until(machine,'ready');
    const fresh=requests.slice(2);assert.equal(fresh.length,2);assert.doesNotMatch(JSON.stringify(fresh),/PRIVATE_OLD|A private question/);assert.match(JSON.stringify(fresh),/NEW_GUEST_QUERY/);assert.match(JSON.stringify(fresh),/NEW_DELIVERED/);
  }finally{machine.dispose();}
});

test('visual card focus follows existing reveal and discussion state, with no extra advance and no stale focus after reset',async()=>{
  const audio=[];const response=deferred();const {machine,draws}=setup({speak:async(_,text,signal,playing)=>{const done=deferred();audio.push({done,playing});await done.promise;},converse:async()=>response.promise});
  const focus=()=>focusedCard(machine.getSnapshot());
  try{
    await confirm(machine);await until(machine,'ready');assert.equal(focus(),null);
    machine.advance();assert.equal(focus(),null);const first=audio.at(-1);first.playing();assert.equal(focus(),0);first.done.resolve();await until(machine,'ready');assert.equal(focus(),0);
    machine.submit('A discussion');assert.equal(focus(),0);response.resolve('A response');await until(machine,'speaking');assert.equal(focus(),0);const answer=audio.at(-1);answer.playing();answer.done.resolve();await until(machine,'ready');assert.equal(focus(),0);
    machine.advance();assert.equal(focus(),null);assert.equal(machine.getSnapshot().revealed,1);const second=audio.at(-1);second.playing();assert.equal(focus(),1);machine.cancel();assert.equal(focus(),1);
    machine.reset();assert.equal(focus(),null);second.playing();second.done.resolve();await tick();assert.equal(focus(),null);assert.equal(machine.getSnapshot().reading,undefined);assert.equal(draws(),1);
  }finally{audio.forEach(a=>a.done.resolve());machine.dispose();}
});

test('silent presentation gates advance and discussion until the ending is read; pause, retry and reset fence late pages',async()=>{
  let paging=false,speechCalls=0;const pages=[];
  const {machine}=setup({speak:async(_,text,s,playing)=>{speechCalls++;playing();},readSilently:async(text,signal,show)=>{
    if(!paging){show(text);return;}const done=deferred();pages.push({text,signal,show,done});await done.promise;
  }});
  try{
    await confirm(machine);await until(machine,'ready');paging=true;machine.next(true);const first=pages[0];
    for(const text of ['Beginning.','Middle.','The ending.']){
      first.show(text);machine.advance();machine.submit('Too early');assert.equal(machine.getSnapshot().phase,'speaking');assert.equal(machine.getSnapshot().segment,0);assert.equal(machine.getSnapshot().caption,text);assert.deepEqual(machine.getSnapshot().turns,[]);
    }
    first.done.resolve();await until(machine,'ready');assert.equal(machine.getSnapshot().turns.at(-1).content,first.text);assert.equal(machine.getSnapshot().segment,1);
    machine.next(true);const cancelled=pages[1];cancelled.show('Before pause');machine.cancel();assert.equal(cancelled.signal.aborted,true);cancelled.show('Late page');assert.equal(machine.getSnapshot().caption,'Before pause');
    const spoken=speechCalls;machine.retry();assert.equal(pages.length,3);assert.equal(speechCalls,spoken,'silent retry stays silent');machine.reset();pages[2].show('After reset');pages[2].done.resolve();cancelled.done.resolve();await tick();assert.equal(machine.getSnapshot().phase,'idle');assert.equal(machine.getSnapshot().caption,'');assert.deepEqual(machine.getSnapshot().turns,[]);
  }finally{pages.forEach(p=>p.done.resolve());machine.dispose();}
});

test('tap can begin an open reading; busy taps never queue another card',async()=>{
  const questions=[];const late=deferred();
  const {machine}=setup({draw:async(_,q)=>{questions.push(q);return engine.castReading(deck.id,'three-card',q);},narrate:async(_,r)=>{await late.promise;return narration(r);}});
  try {machine.begin();machine.captions();await until(machine,'question');machine.advance();machine.advance();await until(machine,'generating');machine.advance();late.resolve();await until(machine,'ready');assert.deepEqual(questions,['']);assert.equal(machine.getSnapshot().revealed,0);assert.equal(machine.getSnapshot().userText,'');machine.advance();await until(machine,'ready');assert.equal(machine.getSnapshot().revealed,1);assert.equal(machine.getSnapshot().segment,1);}finally{machine.dispose();}
});

test('idle summon never draws; early release returns blank; release cue precedes introduction',async()=>{
  const spoken=[];const pending=[];const {machine,draws}=setup({speak:async(_,text,s,playing)=>{spoken.push(text);playing();const d=deferred();pending.push(d);await d.promise;}});
  try {
    assert.equal(machine.getSnapshot().phase,'idle');machine.summon();assert.equal(machine.getSnapshot().phase,'summoning');machine.releaseSummon();assert.equal(machine.getSnapshot().phase,'idle');assert.deepEqual(spoken,[]);
    machine.summon();machine.contact();assert.equal(machine.getSnapshot().phase,'calling');assert.match(spoken[0],/signal holds/);assert.doesNotMatch(spoken[0],/button|release|press|tap|click|reset|advance/i);pending[0].resolve();await until(machine,'awaiting-release');await tick();assert.equal(spoken.length,1,'no introduction while still held');assert.equal(draws(),0);
    machine.releaseSummon();assert.equal(spoken.length,2);assert.match(spoken[1],/I am the spirit/);pending[1].resolve();await until(machine,'question');assert.equal(draws(),0);assert.deepEqual(machine.getSnapshot().turns,[]);
  }finally{pending.forEach(p=>p.resolve());machine.dispose();}
});

test('release during cue waits for it to finish; reset and focus cancellation fence late summon audio',async()=>{
  const spoken=[];const pending=[];const signals=[];const {machine}=setup({speak:async(_,text,s,playing,reading,caption)=>{spoken.push(text);signals.push(s);const d=deferred();pending.push({d,playing,caption});await d.promise;}});
  try {
    machine.summon();machine.contact();machine.releaseSummon();assert.equal(spoken.length,1);pending[0].d.resolve();await until(machine,'speaking');assert.equal(spoken.length,2);machine.reset();assert.equal(signals[1].aborted,true);pending[1].playing();pending[1].caption('stale','aligned');pending[1].d.resolve();await tick();assert.equal(machine.getSnapshot().phase,'idle');assert.equal(machine.getSnapshot().caption,'');
    machine.summon();machine.contact();machine.cancel();assert.equal(signals[2].aborted,true);pending[2].d.resolve();await tick();assert.equal(machine.getSnapshot().phase,'idle');assert.equal(spoken.length,3);
  }finally{pending.forEach(p=>p.d.resolve());machine.dispose();}
});

test('delivery annotations stay out of completed narration and discussion history',async()=>{
  const histories=[];const {machine}=setup({narrate:async(_,r)=>({cards:r.cards.map(c=>({slug:c.slug,text:'[sarcastic] A perfectly ordinary existential problem.'})),synthesis:'[sighs] There is still a choice.'}),converse:async(_,r,turns)=>{histories.push(turns);return '[curious] What might you try?';}});
  try {await confirm(machine);await until(machine,'ready');machine.next(true);await until(machine,'ready');assert.equal(machine.getSnapshot().caption,'A perfectly ordinary existential problem.');machine.submit('What do you mean?');await until(machine,'ready');assert.ok(!JSON.stringify(histories).includes('[sarcastic]'));assert.equal(machine.getSnapshot().turns.at(-1).content,'What might you try?');}finally{machine.dispose();}
});

test('failed summon audio never reveals script, completes or draws; late callbacks are fenced before retry/reset',async()=>{
  for(const releaseEarly of [true,false]){
    const pending=[];const {machine,draws}=setup({speak:async(_,text,signal,playing,r,caption)=>{const d=deferred();pending.push({d,signal,playing,caption});await d.promise;throw new ParlorError('Synthetic audio failure');}});
    try{
      machine.summon();machine.contact();if(releaseEarly)machine.releaseSummon();
      pending[0].d.resolve();await until(machine,'error');assert.equal(pending[0].signal.aborted,true);
      if(!releaseEarly)machine.releaseSummon();pending[0].playing();pending[0].caption('Unheard script','aligned');await tick();
      assert.equal(machine.getSnapshot().phase,'error');assert.equal(machine.getSnapshot().caption,'');assert.equal(machine.getSnapshot().audioPlaying,false);assert.equal(draws(),0);
      machine.retry();assert.equal(machine.getSnapshot().phase,'calling');machine.reset();pending[1].playing();pending[1].caption('Stale script','aligned');pending[1].d.resolve();await tick();assert.equal(machine.getSnapshot().phase,'idle');assert.equal(machine.getSnapshot().caption,'');assert.equal(draws(),0);
    }finally{pending.forEach(p=>p.d.resolve());machine.dispose();}
  }
});

test('missing account voice is an error; explicit silence remains distinct and still waits for physical release',async()=>{
  for(const silent of [false,true]){
    let draws=0,speeches=0;const machine=new ParlorMachine(deck.id,{...settings,elevenKey:'',voiceId:'',ownerKeys:{anthropicModel:'claude-owner',elevenlabs:true},silent},{draw:async()=>{draws++;throw Error('must not draw');},speak:async()=>{speeches++;},readSilently:immediateSilent});
    try{machine.summon();machine.contact();await until(machine,silent?'awaiting-release':'error');assert.equal(speeches,0);assert.equal(draws,0);
      if(!silent){assert.equal(machine.getSnapshot().caption,'');assert.match(machine.getSnapshot().error,/Select an ElevenLabs voice/);machine.releaseSummon();assert.equal(machine.getSnapshot().phase,'error');}
      else{assert.equal(machine.getSnapshot().timing,'silent');machine.releaseSummon();await until(machine,'question');machine.releaseSummon();assert.equal(machine.getSnapshot().phase,'question');}
      assert.equal(draws,0);
    }finally{machine.dispose();}
  }
});

test('voice waiting ends only on actual playback; reset/error/pause fence stale playback indicators',async()=>{
  const pending=[];let fail=false;const {machine}=setup({speak:async(_,text,s,playing,r,c,waiting)=>{const d=deferred();pending.push({d,playing,waiting});await d.promise;if(fail)throw new Error('synthetic');}});
  try {
    machine.begin();assert.equal(machine.getSnapshot().audioPlaying,false);pending[0].playing();assert.equal(machine.getSnapshot().audioPlaying,true);pending[0].waiting();assert.equal(machine.getSnapshot().audioPlaying,false);pending[0].playing();assert.equal(machine.getSnapshot().audioPlaying,true);
    machine.cancel();assert.equal(machine.getSnapshot().phase,'paused');assert.equal(machine.getSnapshot().audioPlaying,false);pending[0].playing();assert.equal(machine.getSnapshot().audioPlaying,false);pending[0].d.resolve();await tick();
    machine.retry();assert.equal(machine.getSnapshot().audioPlaying,false);fail=true;pending[1].d.resolve();await until(machine,'error');assert.equal(machine.getSnapshot().audioPlaying,false);
    machine.reset();pending[1].playing();assert.equal(machine.getSnapshot().phase,'idle');assert.equal(machine.getSnapshot().audioPlaying,undefined);
  }finally{pending.forEach(p=>p.d.resolve());machine.dispose();}
});

test('reset during completed-card discussion clears history and fences late answer',async()=>{
  const late=deferred();let signal;
  const {machine}=setup({converse:async(_,r,turns,s)=>{signal=s;await late.promise;return 'Old guest answer';}});
  try {await confirm(machine);await until(machine,'ready');machine.next(true);await until(machine,'ready');assert.ok(machine.getSnapshot().turns.length);machine.submit('Old guest follow-up');await until(machine,'conversation');machine.reset();machine.begin();machine.captions();await until(machine,'question');assert.equal(signal.aborted,true);late.resolve();await tick();await tick();assert.equal(machine.getSnapshot().reading,undefined);assert.deepEqual(machine.getSnapshot().turns,[]);assert.equal(machine.getSnapshot().userText,'');assert.equal(machine.getSnapshot().question,'');assert.ok(!machine.getSnapshot().caption.includes('Old guest'));}finally{machine.dispose();}
});

test('draw once; failed generation and repeated retry preserve exact identities and question', async () => {
  let calls = 0;
  const { machine, draws } = setup({ narrate: async (_, reading) => { if (++calls === 1) throw new ParlorError('Try again'); return narration(reading); } });
  try {
    await confirm(machine); await until(machine, 'error');
    const reading = machine.getSnapshot().reading;
    machine.retry(false); machine.retry(false); await until(machine, 'ready');
    assert.equal(draws(), 1); assert.equal(calls, 2); assert.equal(machine.getSnapshot().reading, reading);
    assert.equal(new Set(reading.cards.map(c=>c.slug)).size, 3);
  } finally { machine.dispose(); }
});
test('reset fences a late generation response and clears every guest field', async () => {
  const late = deferred(); let signal;
  const { machine } = setup({ narrate: async (_, reading, s) => { signal = s; await late.promise; return narration(reading); } });
  try {
    await confirm(machine); await until(machine, 'generating'); machine.reset(); assert.equal(signal.aborted, true);
    late.resolve(); await tick(); await tick();
    assert.deepEqual(machine.getSnapshot(), { phase:'idle', question:'', revealed:0, segment:0, caption:'', timing:'aligned', error:'', turns:[], pendingQuestion:'', userText:'' });
  } finally { machine.dispose(); }
});
test('cancel during asynchronous draw then retry awaits the same draw', async () => {
  const late = deferred(); let count = 0;
  const { machine } = setup({ draw: async () => { count++; await late.promise; return engine.castReading(deck.id, 'three-card', 'A private question'); } });
  try { await confirm(machine); await tick(); machine.cancel(); machine.retry(false); late.resolve(); await until(machine,'ready'); assert.equal(count,1); }
  finally { machine.dispose(); }
});
test('a queued draw keeps its confirmed question across an immediate guest reset', async () => {
  const questions=[];
  const {machine}=setup({draw:async(_,question)=>{questions.push(question);return engine.castReading(deck.id,'three-card',question);}});
  try {
    await confirm(machine);machine.reset();machine.begin();machine.captions();await until(machine,'question');machine.question('New guest question');
    await tick();await tick();assert.deepEqual(questions,['A private question']);assert.equal(machine.getSnapshot().reading,undefined);
  } finally { machine.dispose(); }
});
test('flip follows playing; repeat click, audio interruption and stale playing are fenced', async () => {
  let playing, signal; const late = deferred();
  const { machine } = setup({ speak: async (_, text, s, fn) => { playing = fn; signal = s; await late.promise; } });
  try {
    await confirm(machine); await until(machine, 'ready'); machine.next(false); machine.next(false);
    assert.equal(machine.getSnapshot().revealed,0); playing(); assert.equal(machine.getSnapshot().revealed,1);
    machine.cancel(); assert.equal(signal.aborted,true); machine.reset(); playing(); late.resolve(); await tick();
    assert.equal(machine.getSnapshot().revealed,0); assert.equal(machine.getSnapshot().caption,'');
  } finally { machine.dispose(); }
});
test('audio failure permits captions; muted repeat clicks do not skip cards', async () => {
  const { machine } = setup({ speak: async () => { throw new ParlorError('Audio unavailable'); } });
  try {
    await confirm(machine); await until(machine,'ready'); machine.next(false); await until(machine,'error'); machine.captions(); machine.next(true);
    assert.equal(machine.getSnapshot().revealed,1); assert.equal(machine.getSnapshot().segment,0);
    await tick(); assert.equal(machine.getSnapshot().segment,1);
  } finally { machine.dispose(); }
});
test('conversation retry does not duplicate turns and reset ignores its late response', async () => {
  const late = deferred(); let attempts = 0;
  const { machine, draws } = setup({ converse: async () => { if (++attempts === 1) throw new ParlorError('retry'); await late.promise; return 'answer'; } });
  try {
    await confirm(machine); await until(machine,'ready');
    for (let i=0;i<4;i++) { machine.next(false); await until(machine,i===3?'complete':'ready'); }
    machine.ask('Follow up'); machine.ask('Duplicate'); await until(machine,'error');
    machine.retry(false); machine.retry(false); machine.reset(); late.resolve(); await tick();
    assert.equal(attempts,2); assert.equal(draws(),1); assert.deepEqual(machine.getSnapshot().turns,[]);
  } finally { machine.dispose(); }
});
test('remember is explicit, account scoped, reversible and tolerant of denied storage', () => {
  const values = new Map(); const storage = { getItem:k=>values.get(k)??null, setItem:(k,v)=>values.set(k,v), removeItem:k=>values.delete(k) };
  saveSettings(storage,'a',settings,false); assert.equal(values.size,0);
  saveSettings(storage,'a',{...settings,provider:'openai'},true); assert.equal(readSettings(storage,'a').remember,true); assert.equal(readSettings(storage,'a').settings.provider,'openai'); assert.equal(readSettings(storage,'b').settings.anthropicKey,'');
  assert.equal([...values.values()][0].includes('private question'),false);
  saveSettings(storage,'a',settings,false); assert.equal(values.size,0);
  assert.equal(saveSettings({ removeItem(){ throw Error(); } },'a',settings,false),false);
});
test('literal parlor return is narrow; queries, external URLs and encoded variants fail closed', () => {
  for (const value of ['/parlor','/parlor/']) assert.equal(safeAccountReturnTo(value),'/parlor');
  for (const value of ['/parlor?question=x','//evil.test/parlor','/parlor#x','/%70arlor','/parlor/../evil']) assert.equal(safeAccountReturnTo(value),'/#/my-decks');
});
test('provider payloads use fixed origins, authored meanings and exact card identities; sanitize errors', async () => {
  const reading = await engine.castReading(deck.id,'three-card','private question');
  const original = global.fetch; const calls = [];
  try {
    for (const provider of ['anthropic','openai']) {
      global.fetch = async (url, init) => { calls.push({url, init}); const text=JSON.stringify(narration(reading)); return Response.json(provider==='anthropic'?{content:[{type:'text',text}]}:{choices:[{message:{content:text}}]}); };
      await narrate({...settings,provider},reading,new AbortController().signal);
      const body=JSON.parse(calls.at(-1).init.body); const content=body.messages.at(-1).content;
      for (const placement of reading.placements) { assert.ok(content.includes(placement.card.slug)); assert.ok(content.includes(placement.meaning)); }
      assert.equal(calls.at(-1).init.credentials,'omit'); assert.equal(calls.at(-1).init.redirect,'error');
      assert.equal(body.model,'fake-model');
      if(provider==='openai') assert.equal(body.store,false);
      else assert.equal(calls.at(-1).init.headers['anthropic-dangerous-direct-browser-access'],'true');
    }
    global.fetch=async()=>Response.json({ message: settings.anthropicKey },{status:401});
    await assert.rejects(narrate(settings,reading,new AbortController().signal),e=>!e.message.includes(settings.anthropicKey));
    global.fetch=async()=>Response.json({content:[{type:'text',text:settings.anthropicKey}]});
    await assert.rejects(narrate(settings,reading,new AbortController().signal),e=>!e.message.includes(settings.anthropicKey));
    const echoed=narration(reading);echoed.cards[0].text=settings.elevenKey;
    const escaped=JSON.stringify(echoed).replace(settings.elevenKey,[...settings.elevenKey].map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join(''));
    global.fetch=async()=>Response.json({content:[{type:'text',text:escaped}]});
    await assert.rejects(narrate(settings,reading,new AbortController().signal),e=>!e.message.includes(settings.elevenKey));
    const invalid=narration(reading); invalid.cards.reverse(); assert.throws(()=>parseNarration(JSON.stringify(invalid),reading));
  } finally { global.fetch=original; }
});
test('audio releases its object URL and player on abort without accepting late playback', async () => {
  const original={fetch:global.fetch,Audio:global.Audio,create:URL.createObjectURL,revoke:URL.revokeObjectURL};
  let player,revoked=0,paused=0,played=0;
  try {
    global.fetch=async()=>Response.json({audio_base64:btoa('audio'),alignment:null});
    URL.createObjectURL=()=> 'blob:synthetic'; URL.revokeObjectURL=()=>revoked++;
    global.Audio=class { constructor(){player=this;} play(){return Promise.resolve();} pause(){paused++;} removeAttribute(){} load(){} };
    const abort=new AbortController(); const pending=speak(settings,'caption',abort.signal,()=>played++);
    for (let i=0;i<50 && !player;i++) await new Promise(r=>setTimeout(r,2));
    assert.ok(player); player.onplaying(); abort.abort();
    await assert.rejects(pending,e=>e.name==='AbortError'); assert.equal(played,1); assert.equal(revoked,1); assert.ok(paused); assert.equal(player.onplaying,null);
  } finally { global.fetch=original.fetch; global.Audio=original.Audio; URL.createObjectURL=original.create; URL.revokeObjectURL=original.revoke; }
});

test('ether greeting omits control instructions and no cards are drawn until a query is submitted',async()=>{
  const speech=deferred();let caption,spoken;const {machine,draws}=setup({speak:async(_,text,signal,playing,reading,update)=>{spoken=text;caption=update;playing();await speech.promise;}});
  try{machine.begin();assert.match(spoken,/spirit of the ether/);assert.doesNotMatch(spoken,/button|press|hold|release|tap|click|reset|advance|cards|deck|spread/i);assert.equal(machine.getSnapshot().question,'');assert.equal(machine.getSnapshot().caption,'');assert.equal(draws(),0);machine.submit('too early');assert.equal(draws(),0);caption('Come closer','aligned');assert.equal(machine.getSnapshot().caption,'Come closer');speech.resolve();await until(machine,'question');machine.submit('My spoken query');await until(machine,'ready');assert.equal(draws(),1);assert.equal(machine.getSnapshot().userText,'My spoken query');}finally{machine.dispose();}
});

test('audio ended without playing cannot reveal the unspoken transcript or count as completion',async()=>{
  const original={fetch:global.fetch,Audio:global.Audio,create:URL.createObjectURL,revoke:URL.revokeObjectURL};let player,revoked=0;const captions=[];
  try{
    global.fetch=async()=>Response.json({audio_base64:btoa('synthetic audio')});URL.createObjectURL=()=>'blob:synthetic';URL.revokeObjectURL=()=>revoked++;
    global.Audio=class{constructor(){player=this;}play(){return Promise.resolve();}pause(){}removeAttribute(){}load(){}};
    const pending=speak(settings,'Unspoken script',new AbortController().signal,()=>assert.fail('never played'),undefined,text=>captions.push(text));
    for(let i=0;i<50&&!player;i++)await new Promise(r=>setTimeout(r,2));assert.ok(player);player.onended();await assert.rejects(pending,/Audio is unavailable/);assert.deepEqual(captions,[]);assert.equal(revoked,1);
  }finally{global.fetch=original.fetch;global.Audio=original.Audio;URL.createObjectURL=original.create;URL.revokeObjectURL=original.revoke;}
});
test('each card waits for explicit advance and permits repeated spoken discussion without drawing again',async()=>{
  const seen=[];const {machine,draws}=setup({converse:async(_,reading,turns,signal,revealed)=>{seen.push({turns,revealed});return 'A spoken answer.';},speak:async(_,text,signal,playing,reading,caption)=>{playing();caption(text,'aligned');}});
  try{await confirm(machine);await until(machine,'ready');machine.next();await until(machine,'ready');assert.equal(machine.getSnapshot().revealed,1);await tick();assert.equal(machine.getSnapshot().segment,1);
    for(let n=0;n<12;n++){machine.ask(`Follow-up ${n}`);await until(machine,'ready');assert.equal(machine.getSnapshot().segment,1);assert.equal(machine.getSnapshot().caption,'A spoken answer.');}
    assert.equal(seen.length,12);assert.ok(seen.every(x=>x.revealed===1&&x.turns.length<=19));assert.equal(machine.getSnapshot().turns.length,20);
    machine.next();await until(machine,'ready');assert.equal(machine.getSnapshot().revealed,2);assert.equal(draws(),1);
  }finally{machine.dispose();}
});
test('discussion audio retry reuses the answer and never skips the current card',async()=>{
  let generated=0,spoken=0;const {machine}=setup({converse:async()=>{generated++;return 'Answer';},speak:async(_,text,signal,playing,reading,caption)=>{if(text==='Answer'&&++spoken===1)throw new ParlorError('Audio failed');playing();caption(text,'aligned');}});
  try{await confirm(machine);await until(machine,'ready');machine.next();await until(machine,'ready');machine.ask('Why?');await until(machine,'error');assert.equal(machine.getSnapshot().turns.length,2);machine.retry();await until(machine,'ready');assert.equal(generated,1);assert.equal(spoken,2);assert.equal(machine.getSnapshot().turns.length,4);assert.equal(machine.getSnapshot().segment,1);}finally{machine.dispose();}
});

test('follow-up provider requests retain completed narration and discussion across cards, excluding future content',async()=>{
  const original=global.fetch;
  try{for(const provider of ['anthropic','openai','hosted']){
    const requests=[];let answerNumber=0;
    global.fetch=async(url,init)=>{const body=JSON.parse(init.body);requests.push(body);const text=`DISCUSSION_REPLY_${++answerNumber}`;return Response.json(provider==='hosted'?{text}:provider==='anthropic'?{content:[{type:'text',text}]}:{choices:[{message:{content:text}}]});};
    const machine=new ParlorMachine(deck.id,{...settings,provider:provider==='openai'?'openai':'anthropic',hosted:provider==='hosted'}, {
      draw:async(_,q)=>engine.castReading(deck.id,'three-card',q),
      narrate:async(_,reading)=>({cards:reading.placements.map((p,i)=>({slug:p.card.slug,text:`CARD_NARRATION_${i+1}`})),synthesis:'CLOSING_NARRATION'}),
      speak:async(_,text,signal,playing,reading,caption)=>{playing();caption(text,'aligned');},
      readSilently:immediateSilent,
    });
    try{
      await confirm(machine);await until(machine,'ready');machine.next();await until(machine,'ready');
      machine.ask('What did you mean by that?');await until(machine,'ready');
      const turns=body=>provider==='hosted'?body.turns:body.messages.filter(turn=>turn.role!=='system');
      assert.deepEqual(turns(requests[0]).map(turn=>turn.content),['The spirit has described vision 1.','CARD_NARRATION_1','What did you mean by that?']);
      for(const unseen of ['CARD_NARRATION_2','CARD_NARRATION_3','CLOSING_NARRATION'])assert.ok(!JSON.stringify(requests[0]).includes(unseen),`${provider} excludes ${unseen}`);
      machine.next();await until(machine,'ready');machine.ask('How does this connect to what we discussed?');await until(machine,'ready');
      assert.deepEqual(turns(requests[1]).map(turn=>turn.content),['The spirit has described vision 1.','CARD_NARRATION_1','What did you mean by that?','DISCUSSION_REPLY_1','The spirit has described vision 2.','CARD_NARRATION_2','How does this connect to what we discussed?']);
      for(const unseen of ['CARD_NARRATION_3','CLOSING_NARRATION'])assert.ok(!JSON.stringify(requests[1]).includes(unseen));
      machine.next();await until(machine,'ready');machine.ask('Stay with the third card');await until(machine,'ready');
      assert.ok(JSON.stringify(requests[2]).includes('CARD_NARRATION_3'));assert.ok(!JSON.stringify(requests[2]).includes('CLOSING_NARRATION'));
      machine.next();await until(machine,'complete');machine.ask('What did the closing mean?');await until(machine,'complete');
      assert.ok(JSON.stringify(requests[3]).includes('CLOSING_NARRATION'));
    }finally{machine.dispose();}
  }}finally{global.fetch=original;}
});

test('cancelled or failed narration is not committed; completed caption retry commits exactly once',async()=>{
  const late=deferred();let attempts=0;
  const {machine}=setup({speak:async(_,text,signal,playing,reading)=>{if(!reading)return;playing();if(++attempts===1)await late.promise;else throw new ParlorError('Audio failed');}});
  try{
    await confirm(machine);await until(machine,'ready');machine.next();assert.equal(machine.getSnapshot().revealed,1);assert.deepEqual(machine.getSnapshot().turns,[]);
    machine.cancel();late.resolve();await tick();assert.deepEqual(machine.getSnapshot().turns,[]);
    machine.retry();await until(machine,'error');assert.deepEqual(machine.getSnapshot().turns,[]);
    machine.captions();await until(machine,'ready');assert.equal(machine.getSnapshot().turns.length,2);assert.equal(machine.getSnapshot().turns[1].content,machine.getSnapshot().narration.cards[0].text);
    machine.retry();assert.equal(machine.getSnapshot().turns.length,2);
  }finally{machine.dispose();}
});
test('discussion context includes only revealed meanings and current card, never hidden card identities',async()=>{
  const draw=await engine.castReading(deck.id,'three-card','Question');const original=global.fetch;let body;
  // Random authored card names can also be ordinary words in the persona prompt.
  // Distinct markers make hidden-context assertions deterministic and unambiguous.
  // Engine readings are frozen. Clone rather than silently assigning to a frozen fixture.
  const reading={...draw,placements:draw.placements.map((p,i)=>({...p,card:{...p.card,name:`CONTEXT_CARD_${i+1}`},meaning:`CONTEXT_MEANING_${i+1}`}))};
  assert.equal(reading.placements[0].card.name,'CONTEXT_CARD_1');
  try{global.fetch=async(_,init)=>{body=JSON.parse(init.body);return Response.json({content:[{type:'text',text:'A thoughtful answer.'}]});};
    for(const revealed of [0,1,2,3]){
      await converse(settings,reading,[{role:'user',content:'Tell me more'}],new AbortController().signal,revealed);
      const context=JSON.parse(body.system.slice(body.system.lastIndexOf('\n')+1));
      assert.deepEqual(context.cards,reading.placements.slice(0,revealed).map((p,index)=>({name:p.card.name,position:p.position.name,reversed:p.reversed,meaning:p.meaning,narrativeFrame:['Past','Present','Future'][index],positionContext:p.position,visualGrounding:'authored_scene',card:p.card,renderSpec:resolveCardRenderSpec(reading.deck,p.card)})));
      assert.equal(context.currentCard,reading.placements[revealed-1]?.card.name);
      for(const hidden of reading.placements.slice(revealed)){assert.ok(!body.system.includes(hidden.card.name));assert.ok(!body.system.includes(hidden.meaning));}
    }
  }finally{global.fetch=original;}
});
