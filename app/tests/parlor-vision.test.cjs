const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ArcanaEngine}=require('../.test-build/engine/ArcanaEngine.js');
const {DeckRegistry}=require('../.test-build/decks/registry.js');
const {rawDeck}=require('./fixtures.cjs');
const {defaultSettings}=require('../.test-build/parlor/settings.js');
const {narrate,converse,stepContext}=require('../.test-build/parlor/providers.js');
const {supportsVision,visionMessages,visionPlacements,optionalVision,VISION_BYTES}=require('../.test-build/parlor/vision.js');
const {ArtworkVision}=require('../.test-build/parlor/artworkVision.js');
const {ParlorMachine}=require('../.test-build/parlor/machine.js');
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(){const engine=new ArcanaEngine(new DeckRegistry()),deck=engine.importDeck(rawDeck());return engine.castReading(deck.id,'three-card','A private question');}
const settings={...defaultSettings(),anthropicKey:'synthetic-a',anthropicModel:'claude-sonnet-5-5',openaiKey:'synthetic-o',openaiModel:'gpt-4.1',elevenKey:'synthetic-e',voiceId:'synthetic-voice'};
const image=slug=>({slug,mediaType:'image/webp',data:Buffer.from('synthetic-image').toString('base64')});
const input=r=>({images:r.cards.map(c=>image(c.slug)),artwork:r.cards.map(c=>({slug:c.slug,packId:'selected-set',version:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',deckRevision:1}))});
const wait=async(fn)=>{for(let i=0;i<100&&!fn();i++)await tick();assert.ok(fn());};

test('vision compatibility is explicit and image payloads are bounded, labeled, inline and placed once',()=>{
  assert.equal(supportsVision('anthropic','claude-sonnet-5-5'),true);assert.equal(supportsVision('openai','gpt-4.1'),true);
  for(const model of ['custom','claude-sonnet-5-5-malicious','https://elsewhere.invalid/'])assert.equal(supportsVision('anthropic',model),false);
  const turns=[{role:'user',content:'Earlier'},{role:'assistant',content:'Delivered'},{role:'user',content:'Now'}];
  for(const provider of ['anthropic','openai']){
    const messages=visionMessages(provider,turns,[image('selected-card')]);assert.deepEqual(messages.slice(0,2),turns.slice(0,2));
    assert.equal(messages[2].content.length,3);assert.match(messages[2].content[0].text,/selected-card/);assert.equal(messages[2].content[2].text,'Now');
    const block=messages[2].content[1];if(provider==='anthropic')assert.equal(block.source.type,'base64');else assert.match(block.image_url.url,/^data:image\/webp;base64,/);
    assert.equal(typeof turns[2].content,'string');
  }
  assert.throws(()=>visionMessages('anthropic',turns,[image('a'),image('a')]));
  assert.throws(()=>visionMessages('anthropic',turns,[{...image('a'),data:'a'.repeat(VISION_BYTES*2)}]));
  assert.throws(()=>visionMessages('anthropic',turns,[{...image('a'),data:'https://private.invalid'}]));
});

test('BYOK reads one intended image, discussion/closing only revealed images; no repeated image history or future metadata',async()=>{
  const reading=await fixture(),original=global.fetch,requests=[];
  try{
    global.fetch=async(url,init)=>{const body=JSON.parse(init.body);requests.push({url,init,body});const system=body.system??body.messages[0].content;
      const text=system.includes('Return only JSON')?JSON.stringify({text:'A figure moves through the mist.'}):'That movement suggests a choice.';
      return String(url).includes('anthropic')?Response.json({content:[{type:'text',text}]}):Response.json({choices:[{message:{content:text}}]});};
    for(const provider of ['anthropic','openai']){
      const selected={...settings,provider};
      for(let segment=0;segment<4;segment++){
        const result=await narrate(selected,reading,new AbortController().signal,segment,[],input(reading));
        const request=requests.at(-1),messages=request.body.messages,content=messages.at(-1).content;
        assert.equal(content.filter(p=>p.type===(provider==='anthropic'?'image':'image_url')).length,segment===3?3:1);
        const context=JSON.parse(content.at(-1).text);assert.deepEqual(context.cards.map(c=>c.slug),segment===3?reading.placements.map(p=>p.card.slug):[reading.placements[segment].card.slug]);
        if(segment<3){assert.equal(result.cards[segment].text,'A figure moves through the mist.');assert.equal(result.cards.filter(c=>c.text).length,1);assert.equal(result.synthesis,'');}
        assert.equal(request.init.redirect,'error');assert.equal(request.init.credentials,'omit');
      }
      const history=[{role:'user',content:'A vision'},{role:'assistant',content:'The completed interpretation.'},{role:'user',content:'What did you mean?'}];
      await converse(selected,reading,history,new AbortController().signal,1,input(reading));
      const last=requests.at(-1).body;assert.equal(last.messages.at(-1).content.filter(p=>p.type===(provider==='anthropic'?'image':'image_url')).length,1);
      const context=JSON.parse((last.system??last.messages[0].content).split('\n').at(-1));assert.deepEqual(context.cards.map(c=>c.slug),[reading.placements[0].card.slug]);
      assert.equal(last.messages.at(-2).content,'The completed interpretation.');assert.ok(!JSON.stringify(history).includes('base64'));
      await narrate({...selected,anthropicModel:'unknown',openaiModel:'unknown'},reading,new AbortController().signal,0,[],input(reading));
      const fallback=requests.at(-1).body;assert.equal(typeof fallback.messages.at(-1).content,'string');assert.match(fallback.system??fallback.messages[0].content,/do not invent visual traits, clothing or gender/);
    }
  }finally{global.fetch=original;}
});

test('owner sends version references only; BYOK takes precedence; cancellation dispatches nothing',async()=>{
  const reading=await fixture(),original=global.fetch,requests=[];
  try{
    global.fetch=async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});return String(url).startsWith('/api/')?Response.json({text:'A figure.'}):Response.json({content:[{type:'text',text:'{"text":"A figure."}'}]});};
    const owner={...settings,anthropicKey:'',ownerKeys:{anthropicModel:'claude-sonnet-5-5',elevenlabs:true}};
    await narrate(owner,reading,new AbortController().signal,0,[],input(reading));
    assert.equal(requests[0].url,'/api/parlor/owner/narrate');assert.deepEqual(requests[0].body.artwork,[input(reading).artwork[0]]);assert.ok(!JSON.stringify(requests[0]).includes('base64'));
    await narrate({...owner,anthropicKey:'supplied-key'},reading,new AbortController().signal,0,[],input(reading));assert.equal(requests[1].url,'https://api.anthropic.com/v1/messages');
    const controller=new AbortController();controller.abort();await assert.rejects(narrate(settings,reading,controller.signal,0,[],input(reading)));assert.equal(requests.length,2);
  }finally{global.fetch=original;}
});

test('artwork loader uses displayed blob/pack/version and orientation, bounds cache, and never fetches arbitrary URLs',async()=>{
  const reading=await fixture(),oldBitmap=global.createImageBitmap,oldDocument=global.document,oldFetch=global.fetch;
  const loaded=[],rotations=[];let decodes=0,closed=0,encoded=0;
  const states=new Map(reading.placements.map((p,i)=>[p.card.slug,{status:'ready',url:'blob:display-only',blob:new Blob(['original'],{type:'image/webp'}),artwork:{id:`version-${i}`,cardSlug:p.card.slug,deckId:reading.deck.id,packId:'selected-set',deckRevision:1,width:945,height:1663,byteLength:8}}]));
  const store={deckId:reading.deck.id,deckRevision:1,packId:'selected-set',load:async slug=>loaded.push(slug),get:slug=>states.get(slug)};
  try{
    global.fetch=()=>{throw Error('No fetch is allowed');};
    global.createImageBitmap=async blob=>{decodes++;assert.equal(blob,states.get(loaded.at(-1)).blob);return {width:945,height:1663,close(){closed++;}};};
    global.document={createElement:()=>({width:0,height:0,getContext:()=>({translate(){},rotate:value=>rotations.push(value),drawImage(){}}),toBlob(fn,type){encoded++;assert.equal(type,'image/webp');fn(new Blob(['prepared'],{type}));}})};
    const loader=new ArtworkVision(store),first=await loader.load(settings,reading,0,new AbortController().signal,0);
    assert.deepEqual(loaded,[reading.placements[0].card.slug]);assert.equal(first.artwork[0].packId,'selected-set');assert.equal(first.images[0].slug,reading.placements[0].card.slug);assert.equal(rotations.length,reading.placements[0].reversed?1:0);
    await loader.load(settings,reading,1,new AbortController().signal);assert.equal(encoded,1,'prepared bytes reused within this encounter');
    loader.clear();await loader.load(settings,reading,1,new AbortController().signal);assert.equal(encoded,2,'reset discards prepared bytes');
    store.packId='different-set';assert.deepEqual(await loader.load(settings,reading,1,new AbortController().signal),{artwork:[],images:[]});
    store.packId='selected-set';const owner={...settings,anthropicKey:'',ownerKeys:{anthropicModel:'claude-sonnet-5-5',elevenlabs:true}};
    const ownerLoader=new ArtworkVision(store),ownerInput=await ownerLoader.load(owner,reading,0,new AbortController().signal,0);assert.equal(ownerInput.artwork.length,1);assert.equal(ownerInput.images.length,0);assert.equal(encoded,2);assert.equal(decodes,closed);
  }finally{global.createImageBitmap=oldBitmap;global.document=oldDocument;global.fetch=oldFetch;}
});

test('broken or absent artwork falls back; late decode after reset cannot populate cache or return old images',async()=>{
  const reading=await fixture(),old=global.createImageBitmap,late=deferred();let closed=0;
  const p=reading.placements[0],state={status:'ready',blob:new Blob(['x'],{type:'image/webp'}),artwork:{id:'id',cardSlug:p.card.slug,deckId:reading.deck.id,packId:'selected-set',deckRevision:1,width:10,height:10,byteLength:1}};
  const store={deckId:reading.deck.id,deckRevision:1,packId:'selected-set',load:async()=>{},get:()=>state};
  const owner={...settings,anthropicKey:'',ownerKeys:{anthropicModel:'claude-sonnet-5-5',elevenlabs:true}},loader=new ArtworkVision(store),controller=new AbortController();
  try{
    global.createImageBitmap=async()=>{throw Error('Broken image');};assert.deepEqual(await loader.load(owner,reading,0,controller.signal,0),{artwork:[],images:[]});
    global.createImageBitmap=async()=>late.promise;const pending=loader.load(owner,reading,0,controller.signal,0);await tick();loader.clear();controller.abort();await assert.rejects(pending);
    late.resolve({width:10,height:10,close(){closed++;}});await tick();assert.equal(closed,1);
    assert.deepEqual(await new ArtworkVision(null).load(settings,reading,1,new AbortController().signal),{artwork:[],images:[]});
  }finally{global.createImageBitmap=old;}
});

test('optional image deadline falls back and aborts work; caller cancellation is not swallowed',async()=>{
  const old=global.setTimeout;let timedOut,workSignal;
  try{
    global.setTimeout=fn=>{timedOut=fn;return 0;};
    const pending=optionalVision(async s=>{workSignal=s;return new Promise(()=>{});},new AbortController().signal,[]);timedOut();assert.deepEqual(await pending,[]);assert.equal(workSignal.aborted,true);
  }finally{global.setTimeout=old;}
  const controller=new AbortController(),pending=optionalVision(()=>new Promise(()=>{}),controller.signal,[]);controller.abort();await assert.rejects(pending);
});

test('per-card inference starts only on advance; failure/retry retains draw and step; reset fences late vision and model results',async()=>{
  const reading=await fixture(),calls=[],visuals=[],late=deferred();let draws=0,fail=false,delay=false,clear=0;
  const machine=new ParlorMachine(reading.deck.id,settings,{draw:async()=>{draws++;return reading;},vision:async(_,r,revealed,signal,segment)=>{visuals.push({revealed,segment,signal});return input(r);},clearVision:()=>clear++,narrate:async(_,r,s,segment,turns)=>{calls.push({segment,s,turns});if(fail){fail=false;throw Error('Synthetic failure');}if(delay)await late.promise;return {cards:r.placements.map((p,i)=>({slug:p.card.slug,text:i===segment?`Vision ${i}.`:''})),synthesis:segment===3?'Closing.':''};},speak:async(_,t,s,playing)=>playing(),readSilently:async(t,s,show)=>show(t),converse:async()=> 'Discussion.'});
  try{
    machine.begin();await wait(()=>machine.getSnapshot().phase==='question');machine.submit('A query');await wait(()=>machine.getSnapshot().phase==='ready');assert.deepEqual(calls.map(c=>c.segment),[0]);
    machine.next();await wait(()=>machine.getSnapshot().segment===1);assert.equal(machine.getSnapshot().revealed,1);await tick();assert.equal(calls.length,1,'no next-card prefetch');
    fail=true;machine.next();machine.next();await wait(()=>machine.getSnapshot().phase==='error');assert.equal(machine.getSnapshot().segment,1);assert.equal(machine.getSnapshot().revealed,1);
    machine.retry();machine.retry();await wait(()=>machine.getSnapshot().segment===2);assert.deepEqual(calls.map(c=>c.segment),[0,1,1]);assert.equal(draws,1);assert.equal(machine.getSnapshot().revealed,2);
    delay=true;machine.next();await wait(()=>calls.length===4);const request=calls.at(-1);machine.reset();assert.equal(request.s.aborted,true);late.resolve();await tick();assert.equal(machine.getSnapshot().phase,'idle');assert.equal(machine.getSnapshot().reading,undefined);assert.ok(clear);
    assert.deepEqual(visuals.map(v=>v.segment),[0,1,1,2]);assert.deepEqual(calls[1].turns.map(t=>t.content),['The spirit has described vision 1.','Vision 0.']);
  }finally{late.resolve();machine.dispose();}
});
