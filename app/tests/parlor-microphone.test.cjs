const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ScribeMicrophone,transcribeScribe}=require('../.test-build/parlor/microphone.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup({permission='ok',type='audio/webm;codecs=opus',key='synthetic-scribe-key',transcript='An intentional question',deferred=false}={}) {
  let recorder,grant,answer,now=0,requested=0,started=0,stopped=0;
  const submitted=[],requests=[],tracks=[{stop(){this.stops++;},stops:0},{stop(){this.stops++;},stops:0}];
  const stream={getTracks:()=>tracks};
  const runtime={
    now:()=>now,recordingType:()=>type,
    getUserMedia(){requested++;if(permission==='denied')return Promise.reject(new DOMException('private device detail','NotAllowedError'));return permission==='pending'?new Promise(r=>grant=r):Promise.resolve(stream);},
    createRecorder(s,mime){assert.equal(s,stream);assert.equal(mime,type);return recorder={state:'inactive',
      start(interval){assert.equal(interval,250);this.state='recording';started++;this.onstart?.();},
      stop(){this.state='inactive';stopped++;},
    };},
  };
  const mic=new ScribeMicrophone(text=>submitted.push(text),()=>key,runtime,async(audio,k,signal)=>{
    requests.push({audio,key:k,signal});assert.ok(tracks.every(t=>t.stops>0),'tracks stop before transmission');
    return deferred?new Promise(r=>answer=r):transcript;
  });
  return {mic,submitted,requests,tracks,advance:ms=>now+=ms,grant:()=>grant(stream),answer:text=>answer(text),
    get recorder(){return recorder;},get counts(){return {requested,started,stopped};},
    data:blob=>recorder.ondataavailable?.({data:blob??new Blob(['synthetic recording'])}),
    end(){recorder.onstop?.();},
  };
}

test('records only on press and submits one bounded clip after intentional release, with every track already stopped',async()=>{
  const s=setup();try{
    assert.equal(s.counts.requested,0);await s.mic.press();await s.mic.press();assert.equal(s.counts.started,1);
    s.data();assert.equal(s.requests.length,0);s.advance(1000);s.mic.release();s.mic.release();
    assert.equal(s.counts.stopped,1);assert.ok(s.tracks.every(t=>t.stops===1));assert.equal(s.mic.getSnapshot().phase,'finishing');
    assert.equal(s.requests.length,0);s.end();await tick();assert.deepEqual(s.submitted,['An intentional question']);
    assert.equal(s.requests.length,1);assert.equal(s.requests[0].audio.type,'audio/webm;codecs=opus');assert.equal(await s.requests[0].audio.text(),'synthetic recording');assert.equal(s.mic.getSnapshot().phase,'idle');
  }finally{s.mic.dispose();}
});

test('release, cancellation and disposal during permission stop any late stream without starting a recorder',async()=>{
  for(const action of ['release','cancel','dispose']){const s=setup({permission:'pending'});try{
    const pending=s.mic.press();s.mic[action]();s.grant();await pending;
    assert.equal(s.counts.started,0);assert.ok(s.tracks.every(t=>t.stops===1));assert.deepEqual(s.requests,[]);
  }finally{s.mic.dispose();}}
});

test('cancellation and disposal discard buffered audio and fence late recorder events',async()=>{
  for(const action of ['cancel','dispose']){const s=setup();try{
    await s.mic.press();s.data();const lateData=s.recorder.ondataavailable,lateEnd=s.recorder.onstop,lateError=s.recorder.onerror;
    s.mic[action]();lateData({data:new Blob(['late private audio'])});lateEnd();lateError();
    assert.ok(s.tracks.every(t=>t.stops===1));assert.deepEqual(s.requests,[]);assert.deepEqual(s.submitted,[]);
  }finally{s.mic.dispose();}}
});

test('cancel between release and final chunk sends nothing; cancel during transcription aborts and ignores late results',async()=>{
  const s=setup();try{await s.mic.press();s.advance(500);s.mic.release();s.mic.cancel();s.data();s.end();assert.deepEqual(s.requests,[]);}finally{s.mic.dispose();}
  for(const action of ['cancel','dispose']){const d=setup({deferred:true});try{
    await d.mic.press();d.data();d.advance(500);d.mic.release();d.end();assert.equal(d.requests.length,1);
    d.mic[action]();assert.equal(d.requests[0].signal.aborted,true);d.answer('stale response');await tick();assert.deepEqual(d.submitted,[]);
  }finally{d.mic.dispose();}}
});

test('cancelled transcription cannot overwrite a later recording',async()=>{
  const s=setup({deferred:true});try{
    await s.mic.press();s.data();s.advance(500);s.mic.release();s.end();const answerOld=s.answer;s.mic.cancel();
    await s.mic.press();answerOld('stale response');await tick();assert.equal(s.mic.getSnapshot().phase,'listening');assert.deepEqual(s.submitted,[]);
  }finally{s.mic.dispose();}
});

test('denied microphone, unsupported recorder and absent key do not transmit or fall back',async()=>{
  for(const options of [{permission:'denied'},{type:''},{key:''}]){const s=setup(options);try{
    await s.mic.press();assert.equal(s.counts.started,0);assert.equal(s.mic.getSnapshot().phase,'error');assert.deepEqual(s.requests,[]);
    if(options.permission)assert.match(s.mic.getSnapshot().error,/access was denied/);else assert.equal(s.counts.requested,0);
    assert.ok(!s.mic.getSnapshot().error.includes('private device detail'));
  }finally{s.mic.dispose();}}
});

test('short, empty, oversized and overlong recordings are discarded before any upload',async()=>{
  for(const kind of ['short','empty','large','long']){const s=setup();try{
    await s.mic.press();s.advance(kind==='short'?20:kind==='long'?60001:500);
    if(kind!=='empty')s.data(new Blob([kind==='large'?new Uint8Array(8_000_001):'synthetic recording']));
    s.mic.release();s.end();await tick();assert.deepEqual(s.requests,[]);assert.equal(s.mic.getSnapshot().phase,'error');assert.ok(s.tracks.every(t=>t.stops>0));
  }finally{s.mic.dispose();}}
});

test('recorder errors and unexpected endings stop tracks without sending; a fresh press can recover',async()=>{
  for(const event of ['onerror','onstop']){const s=setup();try{
    await s.mic.press();s.data();s.recorder[event]();assert.equal(s.mic.getSnapshot().phase,'error');assert.ok(s.tracks.every(t=>t.stops>0));assert.deepEqual(s.requests,[]);
    await s.mic.press();assert.equal(s.counts.started,2);
  }finally{s.mic.dispose();}}
});

test('silence produces an explicit no-speech error, never a reading',async()=>{
  const s=setup({transcript:''});try{await s.mic.press();s.data();s.advance(500);s.mic.release();s.end();await tick();assert.match(s.mic.getSnapshot().error,/No speech/);assert.deepEqual(s.submitted,[]);}finally{s.mic.dispose();}
});

test('permission, recording, recorder-finalization and transcription timeouts clean up without retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const p=setup({permission:'pending'});const pending=p.mic.press();t.mock.timers.tick(60000);p.grant();await pending;assert.ok(p.tracks.every(t=>t.stops));assert.match(p.mic.getSnapshot().error,/timed out/);p.mic.dispose();
  const r=setup();await r.mic.press();r.data();t.mock.timers.tick(60000);assert.ok(r.tracks.every(t=>t.stops));assert.deepEqual(r.requests,[]);r.mic.dispose();
  const f=setup();await f.mic.press();f.advance(500);f.mic.release();t.mock.timers.tick(5000);assert.match(f.mic.getSnapshot().error,/did not finish/);assert.deepEqual(f.requests,[]);f.mic.dispose();
  const d=setup({deferred:true});await d.mic.press();d.data();d.advance(500);d.mic.release();d.end();t.mock.timers.tick(45000);assert.equal(d.requests[0].signal.aborted,true);d.answer('too late');await tick();assert.deepEqual(d.submitted,[]);assert.equal(d.requests.length,1);d.mic.dispose();
});

test('Scribe uses fixed batch endpoint, existing key and multipart audio with no extra paid features',async()=>{
  const original=global.fetch;
  try{
    for(const type of ['audio/webm;codecs=opus','audio/mp4']){
      let calls=0;const controller=new AbortController();
      global.fetch=async(url,options)=>{calls++;assert.equal(url,'https://api.elevenlabs.io/v1/speech-to-text');assert.equal(options.method,'POST');assert.deepEqual(options.headers,{'xi-api-key':'synthetic-existing-key'});assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.signal,controller.signal);
        assert.deepEqual([...options.body.keys()].sort(),['diarize','file','model_id','tag_audio_events','timestamps_granularity','webhook']);
        assert.equal(options.body.get('model_id'),'scribe_v2');assert.equal(options.body.get('diarize'),'false');assert.equal(options.body.get('tag_audio_events'),'false');assert.equal(options.body.get('timestamps_granularity'),'none');assert.equal(options.body.get('webhook'),'false');assert.equal(options.body.get('file').type,type);assert.equal(await options.body.get('file').text(),'intentional audio');return Response.json({text:'  My spoken query  '});};
      assert.equal(await transcribeScribe(new Blob(['intentional audio'],{type}),'synthetic-existing-key',controller.signal),'My spoken query');assert.equal(calls,1);
    }
  }finally{global.fetch=original;}
});

test('Scribe bounds and validates responses, refuses redirects/errors and ignores cancellation without exposing provider details',async()=>{
  const original=global.fetch,key='synthetic-private-key',audio=new Blob(['intentional audio'],{type:'audio/webm'});
  try{
    for(const response of [Response.json({detail:key},{status:401}),Response.json({text:key}),Response.json({text:'x'.repeat(1201)}),Response.json({text:42}),new Response('not JSON'),new Response('x'.repeat(64_001))]){
      let calls=0;global.fetch=async()=>{calls++;return response;};
      await assert.rejects(transcribeScribe(audio,key,new AbortController().signal),error=>!error.message.includes(key));assert.equal(calls,1);
    }
    let calls=0;const controller=new AbortController();controller.abort();global.fetch=async()=>{calls++;return Response.json({text:'late'});};
    await assert.rejects(transcribeScribe(audio,key,controller.signal));assert.equal(calls,0);
    const late=new AbortController();global.fetch=async()=>{late.abort();return Response.json({text:'late'});};await assert.rejects(transcribeScribe(audio,key,late.signal));
  }finally{global.fetch=original;}
});
