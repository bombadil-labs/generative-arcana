const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ParlorMachine}=require('../.test-build/parlor/machine.js');
const {defaultSettings}=require('../.test-build/parlor/settings.js');
const {introduce,narrate,converse}=require('../.test-build/parlor/providers.js');
const {parseOpening,openingHistory,openingInstructions}=require('../.test-build/parlor/opening.js');
const {guestCue}=require('../.test-build/parlor/cue.js');
const {ArcanaEngine}=require('../.test-build/engine/ArcanaEngine.js');
const {DeckRegistry}=require('../.test-build/decks/registry.js');
const {rawDeck}=require('./fixtures.cjs');
const engine=new ArcanaEngine(new DeckRegistry()),deck=engine.importDeck(rawDeck());
const settings={...defaultSettings(),anthropicKey:'synthetic-anthropic-key',anthropicModel:'claude-test'};
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(m,phase){for(let i=0;i<300;i++){if(m.getSnapshot().phase===phase)return;await new Promise(r=>setTimeout(r,5));}assert.equal(m.getSnapshot().phase,phase);}
function fixture(overrides={}) {
  const requests=[],events=[];
  const m=new ParlorMachine(deck.id,settings,{
    transcript:{event:e=>events.push(e),reset:()=>events.push({kind:'reset'}),dispose:()=>{}},
    introduce:async(_,id,text)=>{requests.push({kind:'introduction',id,text});return {text:'A mystery is welcome. Is there something you would like to ask?',hasQuestion:false};},
    draw:async(id,question)=>{requests.push({kind:'draw',question});return engine.castReading(id,'three-card',question);},
    narrate:async(_,reading,signal,opening)=>{requests.push({kind:'narrate',opening});return {cards:reading.placements.map(p=>({slug:p.card.slug,text:'A supplied vision.'})),synthesis:'A reflection.'};},
    converse:async(_,r,turns)=>{requests.push({kind:'discussion',turns});return 'A brief reply.';},
    readSilently:async(text,s,show)=>{if(!s.aborted)show(text);},...overrides
  });return {m,requests,events};
}
test('optional alias/refusal is an introduction, not a query; skip needs no model or name',async()=>{
  for(const input of ['Call me River','No name, thank you']){
    const {m,requests,events}=fixture();try{
      m.begin();await until(m,'question');assert.equal(m.getSnapshot().opening,true);
      m.submit(input);await until(m,'question');assert.equal(m.getSnapshot().opening,false);assert.equal(m.getSnapshot().question,'');assert.equal(m.getSnapshot().reading,undefined);
      assert.deepEqual(requests.map(x=>x.kind),['introduction']);assert.equal(m.getSnapshot().turns[0].content,input);
      m.submit('What might I explore?');await until(m,'ready');assert.equal(requests[1].question,'What might I explore?');assert.equal(requests[2].opening[0].content,input);
      m.next();await until(m,'ready');m.ask('Tell me more');await until(m,'ready');assert.equal(requests.at(-1).turns[0].content,input);
      assert.ok(events.some(e=>e.kind==='user_input'&&e.stage==='greeting'&&e.text===input));
      m.reset();assert.deepEqual(m.getSnapshot().turns,[]);assert.equal(m.getSnapshot().userText,'');assert.equal(m.getSnapshot().question,'');
      m.begin();await until(m,'question');m.advance();await until(m,'question');assert.equal(m.getSnapshot().opening,false);assert.deepEqual(m.getSnapshot().turns,[]);
      m.submit('NEXT_GUEST');await until(m,'ready');assert.deepEqual(requests.at(-1).opening,[]);assert.equal(requests.at(-2).question,'NEXT_GUEST');
    }finally{m.dispose();}
  }
});
test('an immediate question waits for completed acknowledgement and explicit confirmation; busy input is never replayed',async()=>{
  const reply=deferred(),page=deferred();let hold=false;
  const {m,requests}=fixture({introduce:async()=>reply.promise,readSilently:async(text,s,show)=>{show(text);if(hold)await page.promise;}});
  try{
    m.begin();await until(m,'question');hold=true;m.submit('Could a change of work suit me?');m.advance();m.submit('ignored');assert.equal(m.getSnapshot().phase,'conversation');
    reply.resolve({text:'Let us leave that possibility open for a moment.',hasQuestion:true});await until(m,'speaking');m.advance();assert.equal(requests.length,0);assert.equal(m.getSnapshot().turns.length,0,'uncompleted reply never enters history');
    hold=false;page.resolve();await until(m,'question');assert.equal(requests.length,0);assert.equal(m.getSnapshot().question,'Could a change of work suit me?');assert.match(guestCue(m.getSnapshot(),{phase:'idle'}).title,/Press once to explore/);
    m.advance();m.advance();await until(m,'ready');assert.equal(requests.filter(r=>r.kind==='draw').length,1);assert.equal(requests[0].question,'Could a change of work suit me?');
  }finally{m.dispose();}
});
test('opening retry, guide pause, cancellation and reset fence inference and presentation without drawing',async()=>{
  const pending=[];let failed=true;
  const {m,requests}=fixture({introduce:async(_,id,text,signal)=>{if(failed)throw Error('synthetic failure');const d=deferred();pending.push({...d,signal});return d.promise;}});
  try{
    m.begin();await until(m,'question');m.submit('PRIVATE_ALIAS');await until(m,'error');assert.equal(m.getSnapshot().reading,undefined);
    failed=false;m.retry();m.openGuide();pending[0].resolve({text:'What would you like to ask?',hasQuestion:false});await tick();assert.equal(m.getSnapshot().phase,'conversation');m.closeGuide();await until(m,'question');
    m.reset();m.begin();await until(m,'question');m.submit('OLD_GUEST');m.cancel();assert.equal(pending[1].signal.aborted,true);m.retry();assert.equal(pending.length,3);
    m.reset();pending[1].resolve({text:'STALE',hasQuestion:true});pending[2].resolve({text:'STALE',hasQuestion:true});await tick();assert.equal(m.getSnapshot().phase,'idle');assert.equal(m.getSnapshot().caption,'');assert.deepEqual(m.getSnapshot().turns,[]);assert.equal(requests.length,0);
  }finally{pending.forEach(p=>p.resolve({text:'late',hasQuestion:false}));m.dispose();}
});
test('opening parser rejects extra fields, unbounded prose and malformed history; guidance is optional and control-free',()=>{
  for(const bad of [{text:'x',hasQuestion:'true'},{text:'x',hasQuestion:false,name:'private'},{text:'x'.repeat(1201),hasQuestion:false},null])assert.throws(()=>parseOpening(bad));
  for(const bad of [[{role:'user',content:'x'}],[{role:'assistant',content:'x'},{role:'user',content:'y'}],[{role:'user',content:'x'.repeat(1201)},{role:'assistant',content:'y'}]])assert.throws(()=>openingHistory(bad));
  const prompt=openingInstructions(settings);assert.match(prompt,/Never require a name/);assert.match(prompt,/do not presume distress/);assert.match(prompt,/no visions yet/);assert.match(prompt,/never starts a reading/);
});
test('BYOK and owner introduction uses no card/token, preserves credentials precedence and validates decoded output',async()=>{
  const saved=global.fetch,calls=[];let response={text:'A name is optional. What would you like to ask?',hasQuestion:false};
  global.fetch=async(url,init)=>{calls.push({url,init,body:JSON.parse(init.body)});return Response.json(String(url).startsWith('/api/')?response:{content:[{type:'text',text:JSON.stringify(response)}]});};
  try{
    const s={...settings,ownerKeys:{anthropicModel:'claude-test',elevenlabs:true}};
    await introduce(s,deck.id,'River',new AbortController().signal);assert.equal(calls[0].url,'https://api.anthropic.com/v1/messages');assert.equal(calls[0].body.messages[0].content,'River');assert.equal(calls[0].init.credentials,'omit');assert.doesNotMatch(JSON.stringify(calls[0].body),/placements|detailed_description|AUTHORED VISION SOURCES/);
    await introduce({...s,anthropicKey:''},deck.id,'River',new AbortController().signal);assert.equal(calls[1].url,'/api/parlor/owner/introduce');assert.deepEqual(Object.keys(calls[1].body).sort(),['character','deckId','model','provider','text']);assert.equal(calls[1].init.credentials,'same-origin');
    response={text:settings.anthropicKey,hasQuestion:false};await assert.rejects(introduce(s,deck.id,'hello',new AbortController().signal));
    await assert.rejects(introduce({...s,hosted:true},deck.id,'hello',new AbortController().signal));assert.equal(calls.length,3,'legacy hosted introduction never bypasses metering');
  }finally{global.fetch=saved;}
});
test('completed opening reaches BYOK narration and discussion, with query kept separate',async()=>{
  const saved=global.fetch,calls=[],reading=await engine.castReading(deck.id,'three-card','ACTUAL_QUERY');
  const opening=[{role:'user',content:'Call me River'},{role:'assistant',content:'What would you like to ask?'}];
  global.fetch=async(url,init)=>{const body=JSON.parse(init.body);calls.push(body);return Response.json({content:[{type:'text',text:body.system.includes('Return only JSON')?JSON.stringify({cards:reading.placements.map(p=>({slug:p.card.slug,text:'A vision.'})),synthesis:'A reflection.'}):'A response.'}]});};
  try{await narrate(settings,reading,new AbortController().signal,opening);await converse(settings,reading,[...opening,{role:'user',content:'A followup'}],new AbortController().signal,1);assert.deepEqual(calls[0].messages.slice(0,2),opening);assert.match(calls[0].messages[2].content,/ACTUAL_QUERY/);assert.deepEqual(calls[1].messages.slice(0,2),opening);}finally{global.fetch=saved;}
});
