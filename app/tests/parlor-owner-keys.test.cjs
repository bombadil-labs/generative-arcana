const {test}=require('node:test');
const assert=require('node:assert/strict');
const {defaultSettings,useOwnerAnthropic,useOwnerEleven,readySettings,saveSettings,readSettings}=require('../.test-build/parlor/settings.js');
const {readParlorCapabilities,ownerTranscribe}=require('../.test-build/parlor/hosted.js');
const {narrate,converse}=require('../.test-build/parlor/providers.js');
const {ArcanaEngine}=require('../.test-build/engine/ArcanaEngine.js');
const {DeckRegistry}=require('../.test-build/decks/registry.js');
const {rawDeck}=require('./fixtures.cjs');
const ownerKeys={anthropicModel:'claude-test-owner',elevenlabs:true};
const settings={...defaultSettings(),ownerKeys,anthropicModel:ownerKeys.anthropicModel,voiceId:'selected-voice'};
test('owner availability is transient; each explicit browser key takes precedence and providers never cross over',()=>{
  assert.equal(readySettings(settings),true);assert.equal(useOwnerAnthropic(settings),true);assert.equal(useOwnerEleven(settings),true);
  assert.equal(useOwnerAnthropic({...settings,anthropicKey:'my-key'}),false);assert.equal(useOwnerEleven({...settings,elevenKey:'my-voice-key'}),false);
  assert.equal(useOwnerAnthropic({...settings,provider:'openai'}),false);assert.equal(readySettings({...settings,provider:'openai'}),false);
  assert.equal(useOwnerAnthropic({...settings,anthropicModel:'claude-other'}),true);assert.equal(readySettings({...settings,anthropicModel:'claude-other'}),true);
  assert.equal(useOwnerAnthropic({...settings,anthropicModel:'https://wrong.invalid'}),false);
  assert.equal(readySettings({...settings,ownerKeys:undefined}),false);
  const values=new Map(),storage={setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k),removeItem:k=>values.delete(k)};
  saveSettings(storage,'owner',settings,true);assert.ok(![...values.values()].join('').includes('ownerKeys'));assert.equal(readSettings(storage,'owner').settings.ownerKeys,undefined);
});

test('env model/voice defaults seed new settings, while explicit persisted values including silence override them',()=>{
  const values=new Map(),storage={setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k),removeItem:k=>values.delete(k)};
  const defaults={anthropicModel:'claude-sonnet-5-5',voiceId:'env-voice'};
  assert.equal(readSettings(storage,'new',defaults).settings.voiceId,'env-voice');
  assert.equal(readSettings(storage,'new',defaults).settings.anthropicModel,'claude-sonnet-5-5');
  saveSettings(storage,'owner',{...settings,voiceId:'chosen-voice',anthropicModel:'claude-chosen'},true);
  assert.equal(readSettings(storage,'owner',defaults).settings.voiceId,'chosen-voice');assert.equal(readSettings(storage,'owner',defaults).settings.anthropicModel,'claude-chosen');
  saveSettings(storage,'owner',{...settings,voiceId:'',anthropicModel:''},true);
  assert.equal(readSettings(storage,'owner',defaults).settings.voiceId,'');assert.equal(readSettings(storage,'owner',defaults).settings.anthropicModel,'claude-sonnet-5-5');
});

test('Sonnet 5.5 browser calls use documented low-latency tool-free thinking settings',async()=>{
  const original=global.fetch,engine=new ArcanaEngine(new DeckRegistry()),deck=engine.importDeck(rawDeck());const reading=await engine.castReading(deck.id,'three-card','Question');
  try{
    global.fetch=async(url,init)=>{const body=JSON.parse(init.body);assert.equal(body.model,'claude-sonnet-5-5');assert.deepEqual(body.thinking,{type:'between_tools'});assert.deepEqual(body.output_config,{effort:'low'});assert.equal(body.tool_choice,undefined);assert.equal(body.tools,undefined);return Response.json({content:[{type:'text',text:'Answer'}]});};
    assert.equal(await converse({...settings,anthropicKey:'synthetic-byok',anthropicModel:'claude-sonnet-5-5'},reading,[{role:'user',content:'Question'}],new AbortController().signal,1),'Answer');
  }finally{global.fetch=original;}
});
test('capability discovery exposes only validated availability, never restores client-persisted authorization',async()=>{
  const original=global.fetch;try{
    global.fetch=async()=>Response.json({mode:'byok',ownerKeys:{...ownerKeys,secret:'must-not-be-copied'}});
    assert.deepEqual((await readParlorCapabilities(new AbortController().signal)).ownerKeys,ownerKeys);
    for(const value of [{elevenlabs:true,anthropicModel:'https://elsewhere.invalid'}, {elevenlabs:'yes',anthropicModel:null},{...ownerKeys,voiceId:'../../voice'}]){
      global.fetch=async()=>Response.json({mode:'byok',ownerKeys:value});await assert.rejects(readParlorCapabilities(new AbortController().signal));
    }
  }finally{global.fetch=original;}
});
test('blank owner Anthropic key routes same-origin with reading/history; explicit BYOK errors never fall back',async()=>{
  const original=global.fetch,engine=new ArcanaEngine(new DeckRegistry()),deck=engine.importDeck(rawDeck());
  const reading=await engine.castReading(deck.id,'three-card','Question');const result={cards:reading.placements.map(p=>({slug:p.card.slug,text:'Interpretation'})),synthesis:'Closing'};
  const requests=[];try{
    global.fetch=async(url,init)=>{requests.push({url,init});assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.deepEqual(Object.keys(init.headers),['content-type']);return Response.json(url.endsWith('narrate')?result:{text:'Follow-up'});};
    assert.deepEqual(await narrate(settings,reading,new AbortController().signal),result);
    assert.equal(await converse(settings,reading,[{role:'user',content:'What did you mean?'}],new AbortController().signal,1),'Follow-up');
    assert.deepEqual(requests.map(r=>r.url),['/api/parlor/owner/narrate','/api/parlor/owner/converse']);
    const body=JSON.parse(requests[1].init.body);assert.equal(body.revealed,1);assert.equal(body.turns[0].content,'What did you mean?');assert.equal(body.token,reading.token);assert.ok(!('ownerKeys' in body));
    requests.length=0;global.fetch=async(url,init)=>{requests.push({url,init});return new Response('private provider error',{status:401});};
    await assert.rejects(narrate({...settings,anthropicKey:'browser-key'},reading,new AbortController().signal));assert.equal(requests.length,1);assert.equal(requests[0].url,'https://api.anthropic.com/v1/messages');assert.equal(requests[0].init.headers['x-api-key'],'browser-key');
  }finally{global.fetch=original;}
});
test('owner Scribe sends only the intentional clip with abort signal and no credential headers',async()=>{
  const original=global.fetch;try{
    const audio=new Blob(['synthetic intentional audio'],{type:'audio/webm'}),controller=new AbortController();let request;
    global.fetch=async(url,init)=>{request={url,init};return Response.json({text:'Hello'});};
    assert.equal(await ownerTranscribe(audio,controller.signal),'Hello');assert.equal(request.url,'/api/parlor/owner/transcribe');assert.equal(request.init.body,audio);assert.equal(request.init.signal,controller.signal);assert.equal(request.init.credentials,'same-origin');assert.deepEqual(request.init.headers,{'content-type':'audio/webm'});
    global.fetch=async()=>new Response('secret error',{status:403});await assert.rejects(ownerTranscribe(audio,controller.signal),e=>!e.message.includes('secret'));
  }finally{global.fetch=original;}
});
