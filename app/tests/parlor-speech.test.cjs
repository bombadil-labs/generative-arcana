const {test}=require('node:test');
const assert=require('node:assert/strict');
const {speak}=require('../.test-build/parlor/providers.js');
const {parseAlignment,spokenCaption,boundedSpeechBody,captionAlignment,plainSpeech,speechPayload}=require('../.test-build/parlor/speech.js');
const {defaultSettings}=require('../.test-build/parlor/settings.js');
const settings={...defaultSettings(),elevenKey:'synthetic-key',voiceId:'the-selected-voice'};
const alignment={characters:['O','n','e',' ','t','w','o'],character_start_times_seconds:[0,.1,.2,.3,1,1.1,1.2],character_end_times_seconds:[.1,.2,.3,.4,1.1,1.2,1.3]};
const tick=()=>new Promise(r=>setImmediate(r));

test('v3 delivery is allowlisted, restrained and separate from visible words',()=>{
  assert.equal(speechPayload('[sighs] Hello. [sarcastic] Still here? [explosion]'),'[sighs] Hello. Still here?');
  assert.equal(plainSpeech('[sighs] Hello. [sarcastic] Still here?'),'Hello. Still here?');
  assert.equal(speechPayload('[unrecognized command] Ordinary words.'),'Ordinary words.');
  assert.equal(plainSpeech('Hello. [unfinished'),'Hello.');
});

test('full raw alignment removes tags before any prefix, retaining normalized words and original times',()=>{
  const chars=['[si','ghs] ','Two',' ','cards','.'];const raw={characters:chars,character_start_times_seconds:[0,1,2,3,4,5],character_end_times_seconds:[1,2,3,4,5,6]};
  const visible=captionAlignment(raw);assert.equal(spokenCaption(visible,1),'');assert.equal(spokenCaption(visible,2),'');assert.equal(spokenCaption(visible,3),'Two');assert.equal(spokenCaption(visible,4),'Two ');assert.equal(spokenCaption(visible,6),'Two cards.');
  assert.deepEqual(visible.character_end_times_seconds,[2,3,4,5,6]);assert.deepEqual(raw.characters,chars);
  const normalized=captionAlignment(alignment);assert.equal(spokenCaption(normalized,.3),'One');assert.deepEqual(normalized.character_end_times_seconds,alignment.character_end_times_seconds);
});
test('alignment validates shape and monotonic finite times; captions follow actual character ends',()=>{
  assert.ok(parseAlignment(alignment));assert.equal(spokenCaption(alignment,0),'');assert.equal(spokenCaption(alignment,.3),'One');assert.equal(spokenCaption(alignment,.8),'One ');assert.equal(spokenCaption(alignment,1.3),'One two');
  for(const value of [null,{}, {...alignment,characters:[]},{...alignment,character_end_times_seconds:[.1]}, {...alignment,character_end_times_seconds:[.1,.2,NaN,.4,1.1,1.2,1.3]}, {...alignment,character_start_times_seconds:[0,.1,.2,.3,1,.9,1.2]}])assert.equal(parseAlignment(value),undefined);
});
test('v3 retains selected voice and reveals no future text during delayed, paused or stalled playback',async()=>{
  const old={fetch:global.fetch,Audio:global.Audio,create:URL.createObjectURL,revoke:URL.revokeObjectURL};let player,request,revoked=0,played=0;const captions=[];
  try{
    global.fetch=async(url,init)=>{request={url,init};return Response.json({audio_base64:btoa('audio'),normalized_alignment:alignment});};
    URL.createObjectURL=()=> 'blob:mock';URL.revokeObjectURL=()=>revoked++;
    global.Audio=class{currentTime=0;constructor(){player=this;}play(){return Promise.resolve();}pause(){}removeAttribute(){}load(){}};
    // Provider normalization differs from the request: show the aligned words, not original digits.
    const pending=speak(settings,'1 2',new AbortController().signal,()=>played++,undefined,(text,timing)=>captions.push({text,timing}));
    for(let i=0;i<30&&!player;i++)await tick();assert.ok(player);
    assert.equal(request.url,'https://api.elevenlabs.io/v1/text-to-speech/the-selected-voice/with-timestamps');assert.equal(JSON.parse(request.init.body).model_id,'eleven_v3');assert.equal(request.init.credentials,'omit');assert.equal(request.init.redirect,'error');
    player.currentTime=.3;player.ontimeupdate();assert.deepEqual(captions,[],'nothing before actual playing');
    player.currentTime=0;player.onplaying();assert.equal(played,1);assert.deepEqual(captions.at(-1),{text:'',timing:'aligned'});
    player.currentTime=.3;player.ontimeupdate();assert.equal(captions.at(-1).text,'One');
    await tick();player.ontimeupdate();assert.equal(captions.at(-1).text,'One','wall time cannot advance captions');
    player.currentTime=1.3;player.ontimeupdate();player.onended();await pending;assert.equal(captions.at(-1).text,'One two');assert.equal(revoked,1);assert.equal(player.ontimeupdate,null);
  }finally{Object.assign(global,{fetch:old.fetch,Audio:old.Audio});URL.createObjectURL=old.create;URL.revokeObjectURL=old.revoke;}
});
test('missing/invalid alignment uses truthful segment-end reveal and never fakes word timing',async()=>{
  const old={fetch:global.fetch,Audio:global.Audio};
  try{for(const value of [null,{characters:['bad']},{characters:['[sighs]'],character_start_times_seconds:[0],character_end_times_seconds:[1]}]){let player;const captions=[];
    global.fetch=async()=>Response.json({audio_base64:btoa('audio'),alignment:value});
    global.Audio=class{currentTime=0;constructor(){player=this;}play(){return Promise.resolve();}pause(){}removeAttribute(){}load(){}};
    const pending=speak(settings,'No reading ahead',new AbortController().signal,()=>{},undefined,(text,timing)=>captions.push({text,timing}));
    for(let i=0;i<30&&!player;i++)await tick();player.onplaying();player.currentTime=100;player.ontimeupdate();assert.deepEqual(captions,[{text:'',timing:'segment'}]);player.onended();await pending;assert.deepEqual(captions.at(-1),{text:'No reading ahead',timing:'segment'});
  }}finally{Object.assign(global,old);}
});
test('oversized, corrupt or credential-echo speech responses fail before creating a player',async()=>{
  const old={fetch:global.fetch,Audio:global.Audio};let players=0;
  try{
    global.Audio=class{constructor(){players++;}};
    for(const body of [{audio_base64:'%%%'},{audio_base64:''},{audio_base64:btoa('audio'),alignment:{characters:[settings.elevenKey],character_start_times_seconds:[0],character_end_times_seconds:[1]}}]){
      global.fetch=async()=>Response.json(body);await assert.rejects(speak(settings,'text',new AbortController().signal,()=>{}));
    }
    assert.equal(players,0);await assert.rejects(boundedSpeechBody(new Response('12345'),4));
  }finally{Object.assign(global,old);}
});
