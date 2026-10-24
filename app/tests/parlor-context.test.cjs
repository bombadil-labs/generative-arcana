const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {ArcanaEngine}=require('../.test-build/engine/ArcanaEngine.js');
const {DeckRegistry}=require('../.test-build/decks/registry.js');
const {encodeReading}=require('../.test-build/reading/encode.js');
const {resolveCardRenderSpec}=require('../.test-build/decks/renderSpec.js');
const {narrate,converse,instructions}=require('../.test-build/parlor/providers.js');
const {conversationContext,narrationContext,CONTEXT_TOO_LARGE}=require('../.test-build/parlor/context.js');
const {ownerRequest,hostedRequest}=require('../.test-build/parlor/hosted.js');
const {defaultSettings,characters}=require('../.test-build/parlor/settings.js');
const {rawDeck}=require('./fixtures.cjs');

async function fixture(){
  // Optional executor-local manifest validates exact private authored scenes
  // without publishing that deck's contents into the public test repository.
  const manifest=process.env.PARLOR_CONTEXT_FIXTURE?JSON.parse(readFileSync(process.env.PARLOR_CONTEXT_FIXTURE,'utf8')):{data:rawDeck()};
  const engine=new ArcanaEngine(new DeckRegistry()),deck=engine.importDeck(manifest.data);
  const chosen=deck.data.cards['zeppelin-host']&&deck.data.cards['major-13']?['zeppelin-host','major-13',deck.cards.find(c=>!['zeppelin-host','major-13'].includes(c.slug)).slug]:deck.cards.slice(0,3).map(c=>c.slug);
  return engine.resolveReading(await encodeReading(deck,'three-card','How might I find my place?',chosen.map((slug,i)=>({slug,reversed:i===1}))),deck.id);
}
const unpack=text=>JSON.parse(text.split('AUTHORED VISION SOURCES\n')[1].split('\n\nCARD IDENTITIES')[0]);
function assertSources(context,reading,count){
  assert.equal(context.cards.length,count);
  for(const [i,source] of context.cards.entries()){
    const p=reading.placements[i];
    assert.deepEqual(source.card,p.card,'entire authored card survives, including both meanings, visuals and extensions');
    assert.deepEqual(source.renderSpec,resolveCardRenderSpec(reading.deck,p.card),'full inherited render specification survives');
    assert.equal(source.renderSpec.render.scene.description,p.card.visuals.detailed_description);
    assert.deepEqual(source.positionContext,p.position);
    assert.equal(source.narrativeFrame,['Past','Present','Future'][i]);
    assert.equal(source.meaning,p.meaning);assert.equal(source.reversed,p.reversed);
  }
}

test('both BYOK providers receive full authored scenes for three visions and synthesis, then only revealed scenes for discussion',async()=>{
  const reading=await fixture(),original=global.fetch;let calls=0,body;
  try{
    global.fetch=async(url,init)=>{calls++;body=JSON.parse(init.body);const system=body.system??body.messages[0].content;
      const text=system.includes('Return only JSON')?JSON.stringify({cards:reading.placements.map(p=>({slug:p.card.slug,text:'A synthetic vision.'})),synthesis:'A synthetic closing.'}):'A synthetic answer.';
      return String(url).includes('anthropic')?Response.json({content:[{type:'text',text}]}):Response.json({choices:[{message:{content:text}}]});};
    for(const provider of ['anthropic','openai']){
      const settings={...defaultSettings(),provider,anthropicKey:'test-a',openaiKey:'test-o',anthropicModel:'test-model',openaiModel:'test-model'};
      const before=calls;await narrate(settings,reading,new AbortController().signal);assert.equal(calls,before+1,'one request still produces all visions and closing');
      assertSources(unpack(body.messages.at(-1).content),reading,3);
      assert.ok(body.messages.every(t=>typeof t.content==='string'),'text only; no image blocks');
      for(const count of [1,2,3]){
        const turns=[{role:'user',content:'The first vision was spoken.'},{role:'assistant',content:'A prior completed interpretation.'},{role:'user',content:'What did you mean?'}];
        await converse(settings,reading,turns,new AbortController().signal,count);
        const system=body.system??body.messages[0].content,context=JSON.parse(system.slice(system.lastIndexOf('\n')+1));
        assertSources(context,reading,count);
        for(const p of reading.placements.slice(count))assert.ok(!system.includes(p.card.visuals.detailed_description),'no future scene');
        assert.deepEqual(body.messages.slice(provider==='openai'?1:0),turns,'completed spoken history and latest question stay intact');
      }
    }
  }finally{global.fetch=original;}
});

test('full scenes, overrides, inherited directives and extension fields are not clipped or replaced by titles',async()=>{
  const base=await fixture(),p=base.placements[0];
  const scene='BEGIN depicted adult woman. '+('A cream envelope lies between both hands. '.repeat(100))+'END no aircraft indoors.';
  const card={...p.card,visuals:{...p.card.visuals,detailed_description:scene,style_override:'ink',content_override:'Keep the envelope sealed'},authorNote:{evidence:'full extension'}};
  const reading={...base,placements:[{...p,card},...base.placements.slice(1)]};
  const source=unpack(narrationContext(reading)).cards[0];
  assert.equal(source.card.visuals.detailed_description,scene);assert.equal(source.renderSpec.render.scene.description,scene);
  assert.equal(source.renderSpec.render.scene.contentOverride,'Keep the envelope sealed');assert.deepEqual(source.card.authorNote,card.authorNote);
  assert.deepEqual(source.renderSpec,resolveCardRenderSpec(reading.deck,card));
});

test('missing scene is explicitly marked without inventing depiction; unrevealed cards are not resolved',async()=>{
  const base=await fixture(),p=base.placements[0],card={...p.card,visuals:undefined};
  const reading={...base,placements:[{...p,card},{...base.placements[1],card:{...base.placements[1].card,station_slug:'invalid-hidden-station'}},base.placements[2]]};
  const context=JSON.parse(conversationContext(reading,1));
  assert.equal(context.cards[0].visualGrounding,'no_authored_scene');assert.equal(context.cards[0].renderSpec.render.scene.description,'');
  assert.equal(context.cards[0].card.visuals,undefined);assert.equal(context.cards.length,1);
});

test('oversize UTF-8 context is rejected before dispatch without silently shortening scenes or history; abort never dispatches',async()=>{
  const base=await fixture(),original=global.fetch;let calls=0;
  const settings={...defaultSettings(),anthropicKey:'synthetic',anthropicModel:'synthetic'};
  const reading={...base,placements:base.placements.map(p=>({...p,card:{...p.card,visuals:{detailed_description:'界'.repeat(12000)}}}))};
  try{global.fetch=async()=>{calls++;throw new Error('must not dispatch');};
    await assert.rejects(narrate(settings,reading,new AbortController().signal),e=>e.message===CONTEXT_TOO_LARGE);
    await assert.rejects(converse(settings,base,[{role:'user',content:'界'.repeat(24000)}],new AbortController().signal,1),e=>e.message===CONTEXT_TOO_LARGE);
    const abort=new AbortController();abort.abort();await assert.rejects(narrate(settings,base,abort.signal),{name:'AbortError'});
    assert.equal(calls,0);
  }finally{global.fetch=original;}
});

test('owner and legacy hosted oversize errors explain rejection without exposing response details',async()=>{
  const reading=await fixture(),original=global.fetch;
  try{global.fetch=async()=>Response.json({error:'context_too_large',private:'not shown'},{status:413});
    await assert.rejects(ownerRequest('narrate',{},new AbortController().signal),e=>e.message===CONTEXT_TOO_LARGE);
    await assert.rejects(hostedRequest('narrate',defaultSettings(),reading,new AbortController().signal),e=>e.message===CONTEXT_TOO_LARGE);
  }finally{global.fetch=original;}
});

test('persona prioritizes accurate scenes and engaged substance, not mandatory sighs or stock scripts',()=>{
  const prompt=instructions(defaultSettings());
  for(const text of ['card.visuals.detailed_description','Preserve the exact depicted people','never infer gender','take precedence','no_authored_scene','Vary the interpretation, not depicted facts','most segments need none','No obligatory sigh','latest question','concise substance before atmosphere','Avoid stock lead-ins','unsure who is listening','know nothing of cards, Tarot or LLMs'])assert.ok(prompt.includes(text),text);
  assert.doesNotMatch(characters.keeper.greeting,/\[sighs\]|Another interruption|Still\.\.\./);
  assert.match(characters.keeper.direction,/active curiosity/);
});
