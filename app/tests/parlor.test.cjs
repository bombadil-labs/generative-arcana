const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ArcanaEngine } = require('../.test-build/engine/ArcanaEngine.js');
const { DeckRegistry } = require('../.test-build/decks/registry.js');
const { ParlorMachine } = require('../.test-build/parlor/machine.js');
const { defaultSettings, saveSettings, readSettings } = require('../.test-build/parlor/settings.js');
const { narrate, speak, parseNarration, ParlorError } = require('../.test-build/parlor/providers.js');
const { safeAccountReturnTo } = require('../.test-build/auth/api.js');
const { rawDeck } = require('./fixtures.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const engine = new ArcanaEngine(new DeckRegistry());
const deck = engine.importDeck(rawDeck());
const settings = { ...defaultSettings(), anthropicKey: 'fake-anthropic-key', anthropicModel: 'fake-model', openaiKey: 'fake-openai-key', openaiModel: 'fake-model', elevenKey: 'fake-eleven-key', voiceId: 'fake-voice' };
const narration = reading => ({ cards: reading.placements.map(p => ({ slug: p.card.slug, text: `${p.card.name}: ${p.meaning}` })), synthesis: 'Reflect on the possibilities.' });
function setup(overrides = {}) {
  let draws = 0;
  const machine = new ParlorMachine(deck.id, settings, { draw: async (_, q) => { draws++; return engine.castReading(deck.id, 'three-card', q); }, narrate: async (_, reading) => narration(reading), speak: async (_, text, signal, playing) => playing(), ...overrides });
  return { machine, draws: () => draws };
}
function confirm(machine) { machine.begin(); machine.question('A private question'); machine.review(); machine.confirm(); machine.confirm(); }
async function until(machine, phase) { for (let i=0;i<50 && machine.getSnapshot().phase !== phase;i++) await tick(); assert.equal(machine.getSnapshot().phase, phase); }

test('draw once; failed generation and repeated retry preserve exact identities and question', async () => {
  let calls = 0;
  const { machine, draws } = setup({ narrate: async (_, reading) => { if (++calls === 1) throw new ParlorError('Try again'); return narration(reading); } });
  try {
    confirm(machine); await until(machine, 'error');
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
    confirm(machine); await until(machine, 'generating'); machine.reset(); assert.equal(signal.aborted, true);
    late.resolve(); await tick(); await tick();
    assert.deepEqual(machine.getSnapshot(), { phase:'greeting', question:'', revealed:0, segment:0, caption:'', error:'', turns:[], pendingQuestion:'' });
  } finally { machine.dispose(); }
});
test('cancel during asynchronous draw then retry awaits the same draw', async () => {
  const late = deferred(); let count = 0;
  const { machine } = setup({ draw: async () => { count++; await late.promise; return engine.castReading(deck.id, 'three-card', 'A private question'); } });
  try { confirm(machine); await tick(); machine.cancel(); machine.retry(false); late.resolve(); await until(machine,'ready'); assert.equal(count,1); }
  finally { machine.dispose(); }
});
test('a queued draw keeps its confirmed question across an immediate guest reset', async () => {
  const questions=[];
  const {machine}=setup({draw:async(_,question)=>{questions.push(question);return engine.castReading(deck.id,'three-card',question);}});
  try {
    confirm(machine);machine.reset();machine.begin();machine.question('New guest question');
    await tick();await tick();assert.deepEqual(questions,['A private question']);assert.equal(machine.getSnapshot().reading,undefined);
  } finally { machine.dispose(); }
});
test('flip follows playing; repeat click, audio interruption and stale playing are fenced', async () => {
  let playing, signal; const late = deferred();
  const { machine } = setup({ speak: async (_, text, s, fn) => { playing = fn; signal = s; await late.promise; } });
  try {
    confirm(machine); await until(machine, 'ready'); machine.next(false); machine.next(false);
    assert.equal(machine.getSnapshot().revealed,0); playing(); assert.equal(machine.getSnapshot().revealed,1);
    machine.cancel(); assert.equal(signal.aborted,true); machine.reset(); playing(); late.resolve(); await tick();
    assert.equal(machine.getSnapshot().revealed,0); assert.equal(machine.getSnapshot().caption,'');
  } finally { machine.dispose(); }
});
test('audio failure permits captions; muted repeat clicks do not skip cards', async () => {
  const { machine } = setup({ speak: async () => { throw new ParlorError('Audio unavailable'); } });
  try {
    confirm(machine); await until(machine,'ready'); machine.next(false); await until(machine,'error'); machine.captions(); machine.next(true);
    assert.equal(machine.getSnapshot().revealed,1); assert.equal(machine.getSnapshot().segment,0);
    await new Promise(r=>setTimeout(r,1000)); assert.equal(machine.getSnapshot().segment,1);
  } finally { machine.dispose(); }
});
test('conversation retry does not duplicate turns and reset ignores its late response', async () => {
  const late = deferred(); let attempts = 0;
  const { machine, draws } = setup({ converse: async () => { if (++attempts === 1) throw new ParlorError('retry'); await late.promise; return 'answer'; } });
  try {
    confirm(machine); await until(machine,'ready');
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
    global.fetch=async()=>new Response(new Blob(['audio'],{type:'audio/mpeg'}));
    URL.createObjectURL=()=> 'blob:synthetic'; URL.revokeObjectURL=()=>revoked++;
    global.Audio=class { constructor(){player=this;} play(){return Promise.resolve();} pause(){paused++;} removeAttribute(){} load(){} };
    const abort=new AbortController(); const pending=speak(settings,'caption',abort.signal,()=>played++);
    for (let i=0;i<50 && !player;i++) await new Promise(r=>setTimeout(r,2));
    assert.ok(player); player.onplaying(); abort.abort();
    await assert.rejects(pending,e=>e.name==='AbortError'); assert.equal(played,1); assert.equal(revoked,1); assert.ok(paused); assert.equal(player.onplaying,null);
  } finally { global.fetch=original.fetch; global.Audio=original.Audio; URL.createObjectURL=original.create; URL.revokeObjectURL=original.revoke; }
});
