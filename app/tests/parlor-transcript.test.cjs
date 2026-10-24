const {test}=require('node:test');
const assert=require('node:assert/strict');
const {RuntimeTranscript,TRANSCRIPT_BATCH_BYTES,TRANSCRIPT_QUEUE_BYTES}=require('../.test-build/parlor/runtimeTranscript.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function drain(log){for(let i=0;i<100&&log.queue.length;i++){await log.flush();await tick();}assert.equal(log.queue.length,0);}

test('transport keeps native fetch receiver semantics instead of binding the transcript sink',async()=>{
  const bodies=[];
  async function send(_,init){'use strict';assert.equal(this,undefined);const body=JSON.parse(init.body);bodies.push(body);return Response.json(body.start?{token:'receipt'}:{accepted:body.events.length});}
  const log=new RuntimeTranscript([],send);
  try{log.event({kind:'user_input',text:'synthetic fetch input'});await drain(log);assert.equal(bodies.length,2);assert.equal(bodies[1].events[0].kind,'user_input');}finally{log.dispose();}
});

test('transcript queue redacts before Unicode chunking, projects fields, bounds batches and preserves reconstructable text',async()=>{
  const bodies=[];const secret='synthetic-local-secret';
  const log=new RuntimeTranscript([secret],async(_,init)=>{bodies.push(JSON.parse(init.body));assert.ok(Buffer.byteLength(init.body)<=TRANSCRIPT_BATCH_BYTES);return Response.json(init.body.includes('"start"')?{token:'receipt'}:{accepted:1});});
  try {
    const text='🌙'.repeat(999)+secret+'\n'+('synthetic scene '.repeat(400));
    log.event({kind:'assistant_generated',text,model:secret,settings:{key:secret},audio:'private',error:{body:secret}});
    await drain(log);const events=bodies.flatMap(b=>b.events??[]);
    assert.equal(events.map(e=>e.text).join(''),text.replace(secret,'[redacted]'));
    assert.ok(events.every((e,i)=>e.part===i&&e.parts===events.length&&e.eventId===events[0].eventId));
    assert.doesNotMatch(JSON.stringify(bodies),/synthetic-local-secret|settings|audio|error/);
    assert.ok(events.every(e=>e.model==='[redacted]'));
  } finally {log.dispose();}
});

test('reset while start/submission is pending cannot assign old guest text to the new encounter; retries keep IDs',async()=>{
  const start=deferred(),bodies=[];let starts=0,tries=0;
  const log=new RuntimeTranscript([],async(_,init)=>{const body=JSON.parse(init.body);bodies.push(body);if(body.start){if(++starts===1){await start.promise;return Response.json({token:'old-receipt'});}return Response.json({token:'new-receipt'});}if(++tries===1)throw new Error('synthetic acknowledgement loss');return Response.json({accepted:body.events.length});});
  try{
    log.event({kind:'user_input',text:'OLD_GUEST'});const first=log.flush();log.reset();log.event({kind:'user_input',text:'NEW_GUEST'});start.resolve();await first;await drain(log);
    const old=bodies.filter(b=>b.token==='old-receipt'),fresh=bodies.filter(b=>b.token==='new-receipt');
    assert.ok(old.length>=2&&fresh.length);assert.match(JSON.stringify(old),/OLD_GUEST/);assert.doesNotMatch(JSON.stringify(old),/NEW_GUEST/);assert.match(JSON.stringify(fresh),/NEW_GUEST/);assert.doesNotMatch(JSON.stringify(fresh),/OLD_GUEST/);
    assert.deepEqual(old[0],old[1]);assert.equal(starts,2);
  }finally{log.dispose();}
});

test('logout/unmount discards queued text, aborts pending requests and ignores late registration',async()=>{
  const pending=deferred(),bodies=[];let signal;
  const log=new RuntimeTranscript(['synthetic-key'],async(_,init)=>{signal=init.signal;bodies.push(JSON.parse(init.body));await pending.promise;return Response.json({token:'late'});});
  log.event({kind:'user_input',text:'do not submit'});const flushing=log.flush();log.dispose();assert.equal(signal.aborted,true);pending.resolve();await flushing;
  log.event({kind:'user_input',text:'after logout'});await log.flush();assert.equal(bodies.length,1);assert.equal(log.queue.length,0);assert.deepEqual(log.secrets,[]);
});

test('queue overflow and permanent transport errors are bounded with no endless retry',async()=>{
  let calls=0;const log=new RuntimeTranscript([],async()=>{calls++;throw new Error('synthetic failure');});
  for(let i=0;i<100;i++)log.event({kind:'assistant_generated',text:'x'.repeat(30_000)});
  assert.ok(Buffer.byteLength(JSON.stringify(log.queue.map(p=>p.event)))<=TRANSCRIPT_QUEUE_BYTES);assert.ok(log.dropped>0);
  await drain(log);assert.equal(calls,1);log.dispose();
});

test('auth revocation stops queued submission without retaining guest text',async()=>{
  const log=new RuntimeTranscript([],async()=>new Response('',{status:403}));log.event({kind:'user_input',text:'synthetic'});await log.flush();assert.equal(log.disposed,true);assert.equal(log.queue.length,0);
});
