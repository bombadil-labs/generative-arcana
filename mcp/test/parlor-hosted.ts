import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer,request as httpRequest } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { catalog,run,type Connection } from '../scripts/domain-migrations';
import { parlorConfig,ParlorFault,type ParlorConfig } from '../src/parlorConfig';
import { reserveParlor,entitled,type ParlorStore,type ParlorDb } from '../src/parlorStore';
import { inspectEntitlement,applyEntitlement,type EntitlementPlan } from '../src/parlorEntitlement';
import { createParlorHandler } from '../src/parlorApi';
import { createArcanaAdapter } from '../src/hostStore';
import type { UserDeckCatalogRepository } from '../src/userDeckCatalog';

const env:NodeJS.ProcessEnv={PARLOR_MODE:'hosted',BETTER_AUTH_URL:'https://parlor.example.test',ANTHROPIC_API_KEY:'synthetic-server-anthropic',OPENAI_API_KEY:'synthetic-server-openai',ELEVENLABS_API_KEY:'synthetic-server-voice',
  PARLOR_MODELS_JSON:JSON.stringify([{provider:'anthropic',id:'mock-a',maxCostMicrousd:100},{provider:'openai',id:'mock-o',maxCostMicrousd:100}]),PARLOR_VOICE_IDS:'mock-voice',PARLOR_SPEECH_MODEL:'mock-speech',PARLOR_SPEECH_MAX_COST_MICROUSD:'100',
  PARLOR_USER_DAILY_MICROUSD:'100000',PARLOR_GLOBAL_DAILY_MICROUSD:'200000',PARLOR_USER_CONCURRENCY:'1',PARLOR_GLOBAL_CONCURRENCY:'2',PARLOR_MAX_INPUT_BYTES:'64000',PARLOR_MAX_OUTPUT_TOKENS:'2000',PARLOR_MAX_SPEECH_CHARACTERS:'4000',PARLOR_TIMEOUT_MS:'2000',PARLOR_PRICING_REVIEW:'test-only-not-live-pricing',PARLOR_PRICING_EXPIRES_AT:new Date(Date.now()+86400000).toISOString()};
assert.equal(parlorConfig({}).mode,'disabled');assert.equal(parlorConfig({PARLOR_MODE:'byok'}).mode,'byok');
for(const key of ['ANTHROPIC_API_KEY','PARLOR_MODELS_JSON','PARLOR_USER_DAILY_MICROUSD','PARLOR_GLOBAL_DAILY_MICROUSD','PARLOR_USER_CONCURRENCY','PARLOR_MAX_INPUT_BYTES','PARLOR_PRICING_REVIEW','PARLOR_PRICING_EXPIRES_AT'])assert.throws(()=>parlorConfig({...env,[key]:''}));
assert.throws(()=>parlorConfig({...env,PARLOR_MODE:'auto'}));assert.throws(()=>parlorConfig({...env,PARLOR_PRICING_EXPIRES_AT:'2000-01-01'}));
const config=parlorConfig(env),db=new PGlite();
const connection:Connection={query:async(sql,values)=>values?db.query(sql,values):{rows:(await db.exec(sql)).at(-1)?.rows??[]}};
const entries=await catalog();let server:ReturnType<typeof createServer>|undefined;
let principal:string|null='usr_host',calls=0,providerMode='ok',seenBody='',heldStarted:()=>void=()=>{},aborted=0,entitlementGate:Promise<void>|undefined;
const store:ParlorStore={entitled:async id=>{await entitlementGate;return entitled(db as ParlorDb,id);},reserve:(r,c)=>db.transaction(tx=>reserveParlor(tx as ParlorDb,r,c)),finish:async(id,op,success)=>{await db.query("UPDATE arcana_parlor_usage SET status=$3,active_until=CASE WHEN $3='complete' THEN clock_timestamp() ELSE active_until END WHERE principal_id=$1 AND operation_id=$2",[id,op,success?'complete':'uncertain']);}};
try {
  await run(connection,entries,'apply');
  await db.query("INSERT INTO arcana_external_identities(issuer,subject,principal_id) VALUES('https://parlor.example.test/api/auth','verified-host','usr_host'),('https://parlor.example.test/api/auth','verified-other','usr_other')");
  const grant:EntitlementPlan={operationId:randomUUID(),issuer:'https://parlor.example.test/api/auth',subject:'verified-host',expectedPrincipal:'usr_host',action:'grant',expiresAt:new Date(Date.now()+86400000).toISOString(),evidenceReference:'mock-verified-session'};
  assert.equal((await inspectEntitlement(db as ParlorDb,grant)).alreadyApplied,false);
  assert.equal(await store.entitled('usr_host'),false,'plan makes no grant');
  await assert.rejects(inspectEntitlement(db as ParlorDb,{...grant,expectedPrincipal:'usr_other'}));
  await db.transaction(tx=>applyEntitlement(tx as ParlorDb,grant));await db.transaction(tx=>applyEntitlement(tx as ParlorDb,grant));
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int AS n FROM arcana_entitlement_audit')).rows[0].n,1);
  assert.equal(await store.entitled('usr_host'),true);
  await db.transaction(tx=>applyEntitlement(tx as ParlorDb,{...grant,operationId:randomUUID(),subject:'verified-other',expectedPrincipal:'usr_other'}));
  const r=()=>({principal:'usr_host',operation:randomUUID(),kind:'narrate' as const,provider:'anthropic',model:'mock-a',cost:60,inputBytes:100,outputLimit:2000});
  for(const global of [false,true]) {
    const c={...config,userDailyMicrousd:global?1000:100,globalDailyMicrousd:global?100:1000,userConcurrency:4,globalConcurrency:4};
    const outcomes=await Promise.allSettled([store.reserve(r(),c),store.reserve({...r(),principal:global?'usr_other':'usr_host'},c)]);
    assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1,'atomic budget admits only one');
    assert.equal(Number((await db.query<{n:string}>('SELECT sum(reserved_microusd) AS n FROM arcana_parlor_usage')).rows[0].n),60);
    await db.exec('DELETE FROM arcana_parlor_usage');
  }
  const one=r();await store.reserve(one,config);await assert.rejects(store.reserve({...r()},config),(e:unknown)=>e instanceof ParlorFault&&e.status===429);
  await assert.rejects(store.reserve(one,config),(e:unknown)=>e instanceof ParlorFault&&e.status===409);
  await store.finish(one.principal,one.operation,false);assert.equal(Number((await db.query<{reserved_microusd:string}>('SELECT reserved_microusd FROM arcana_parlor_usage')).rows[0].reserved_microusd),60);
  await db.exec('DELETE FROM arcana_parlor_usage');
  // Simulate a transaction begun on an earlier day: admission and insert use the post-lock instant.
  const future='2050-01-02T00:00:01.000Z';
  const atMidnight=(tx:ParlorDb):ParlorDb=>({query:(sql,values)=>sql==='SELECT clock_timestamp() AS instant'?Promise.resolve({rows:[{instant:future}]}):tx.query(sql,values)});
  const midnightConfig={...config,userDailyMicrousd:100,globalDailyMicrousd:100,userConcurrency:4,globalConcurrency:4};
  await db.transaction(tx=>reserveParlor(atMidnight(tx as ParlorDb),r(),midnightConfig));
  assert.equal(new Date((await db.query<{created_at:Date}>('SELECT created_at FROM arcana_parlor_usage')).rows[0].created_at).toISOString(),future);
  await assert.rejects(db.transaction(tx=>reserveParlor(atMidnight(tx as ParlorDb),r(),midnightConfig)),(e:unknown)=>e instanceof ParlorFault&&e.status===429);
  await db.exec('DELETE FROM arcana_parlor_usage');
  const raw=JSON.parse(await readFile(new URL('../../decks/deep-time/deck.json',import.meta.url),'utf8'));
  const adapter=createArcanaAdapter();adapter.engine.importDeck(raw,{runtimeId:'hosted-deck'});const reading=await adapter.engine.castReading('hosted-deck','three-card','Private question never persisted');
  const narration={cards:reading.placements.map(p=>({slug:p.card.slug,text:'Synthetic narration.'})),synthesis:'Synthetic synthesis.'};
  const catalogFixture={get:async(id:string)=>id==='hosted-deck'?{id,ownerId:'usr_host',slug:raw.slug,manifest:{data:raw},visibility:'private',revision:1}:null} as unknown as UserDeckCatalogRepository;
  const providerFetch:typeof fetch=async(input,init)=>{
    calls++;seenBody=String(init?.body);const url=String(input);
    assert.equal(init?.redirect,'error');assert.equal(init?.method,'POST');
    assert.ok(url.startsWith('https://api.anthropic.com/')||url.startsWith('https://api.openai.com/')||url.startsWith('https://api.elevenlabs.io/'));
    if(providerMode==='hold'){heldStarted();return new Promise((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>{aborted++;reject(new Error('cancelled'));},{once:true});});}
    if(providerMode==='error')return new Response('synthetic-server-anthropic',{status:429});
    if(providerMode==='logout')principal=null;
    if(providerMode==='revoke')await db.query("UPDATE arcana_entitlements SET revoked_at=now() WHERE principal_id='usr_host'");
    if(url.includes('elevenlabs'))return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'audio/mpeg'}});
    const prompt=JSON.parse(seenBody);const isNarration=seenBody.includes('CARD IDENTITIES IN ORDER');
    const content=providerMode==='echo'?JSON.stringify({...narration,synthesis:'synthetic-server-anthropic'}):isNarration?JSON.stringify(narration):'Synthetic follow-up.';
    if(url.includes('openai')){assert.equal(prompt.store,false);return Response.json({choices:[{message:{content}}]});}
    return Response.json({content:[{type:'text',text:content}]});
  };
  const handler=createParlorHandler({config,store,principal:{resolve:async()=>principal?{id:principal}:null},catalog:catalogFixture,fetch:providerFetch});
  server=createServer((req,res)=>{void handler(req,res);});await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as {port:number}).port;
  const request=(kind:string,extra:Record<string,unknown>={},origin=config.origin,signal?:AbortSignal)=>fetch(`http://127.0.0.1:${port}/api/parlor/${kind}`,{method:'POST',headers:{origin,'content-type':'application/json'},signal,body:JSON.stringify({operationId:randomUUID(),deckId:'hosted-deck',token:reading.token,provider:'anthropic',model:'mock-a',character:'keeper',...extra})});
  const caps=()=>fetch(`http://127.0.0.1:${port}/api/parlor/capabilities`);
  await db.exec('ALTER TABLE arcana_entitlements RENAME TO unavailable_entitlements');assert.equal((await caps()).status,503);await db.exec('ALTER TABLE unavailable_entitlements RENAME TO arcana_entitlements');
  await db.query("UPDATE arcana_entitlements SET expires_at=now()-interval '1 second' WHERE principal_id='usr_host'");assert.equal((await caps()).status,403);await db.query("UPDATE arcana_entitlements SET expires_at=now()+interval '1 day' WHERE principal_id='usr_host'");
  const expiry=config.pricingExpires;config.pricingExpires=0;assert.equal((await caps()).status,503);config.pricingExpires=expiry;
  // Response deadline holds even while a store call or request body is stalled.
  config.timeoutMs=30;let unblock:()=>void=()=>{};entitlementGate=new Promise(resolve=>{unblock=resolve;});
  assert.equal((await request('narrate')).status,408);unblock();entitlementGate=undefined;await new Promise(resolve=>setTimeout(resolve,20));assert.equal(calls,0);
  await new Promise<void>((resolve,reject)=>{
    const slow=httpRequest({hostname:'127.0.0.1',port,path:'/api/parlor/narrate',method:'POST',headers:{origin:config.origin,'content-type':'application/json','content-length':'100'}},response=>{try{assert.equal(response.statusCode,408);response.resume();resolve();}catch(error){reject(error);}finally{slow.destroy();}});
    slow.on('error',error=>reject(error));slow.write('{');
  });
  config.timeoutMs=2000;assert.equal(calls,0);
  principal=null;assert.equal((await request('narrate')).status,401);principal='usr_missing';assert.equal((await caps()).status,403);principal='usr_host';
  assert.equal((await request('narrate',{},'https://evil.test')).status,403);assert.equal(calls,0);
  assert.equal((await request('narrate',{},'')).status,403);
  for(const patch of [{model:'unrestricted'},{provider:'evil'},{character:'evil'},{deckId:'other-deck'},{token:'bad'},{apiKey:'must-not-be-accepted'}])assert.notEqual((await request('narrate',patch)).status,200);
  assert.equal(calls,0);const configResponse=await(await caps()).text();assert.ok(!configResponse.includes('synthetic-server'));assert.ok(!configResponse.includes('maxCost'));
  const operationId=randomUUID();assert.equal((await request('narrate',{operationId})).status,200);assert.equal(calls,1);
  assert.equal((await request('narrate',{operationId})).status,409);assert.equal(calls,1);
  assert.equal((await request('narrate',{provider:'openai',model:'mock-o'})).status,200);
  assert.equal((await request('converse',{turns:[{role:'user',content:'Private follow-up never persisted'}]})).status,200);
  assert.equal((await request('speech',{text:'Memory-only audio words',voiceId:'mock-voice'})).status,200);
  assert.equal((await request('speech',{text:'a'.repeat(4001),voiceId:'mock-voice'})).status,400);
  assert.equal((await request('speech',{text:'Hello',voiceId:'unknown'})).status,400);
  const limitBefore=calls;config.maxInputBytes=1;assert.equal((await request('narrate')).status,413);assert.equal(calls,limitBefore);config.maxInputBytes=64000;
  for(const mode of ['echo','error','revoke','logout']) {
    providerMode=mode;const response=await request('narrate');assert.notEqual(response.status,200);assert.ok(!(await response.text()).includes('synthetic-server'));
    principal='usr_host';await db.query("UPDATE arcana_entitlements SET revoked_at=NULL WHERE principal_id='usr_host'");
    await db.query('UPDATE arcana_parlor_usage SET active_until=now()');
  }
  providerMode='hold';config.timeoutMs=25;const timeout=await request('narrate');assert.notEqual(timeout.status,200);assert.ok(aborted>0);config.timeoutMs=2000;
  await db.query('UPDATE arcana_parlor_usage SET active_until=now()');
  const abort=new AbortController();const started=new Promise<void>(resolve=>{heldStarted=resolve;});const pending=request('narrate',{},config.origin,abort.signal);await started;abort.abort();await assert.rejects(pending);
  for(let i=0;i<20&&aborted<2;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(aborted>=2);
  const usage=JSON.stringify((await db.query('SELECT * FROM arcana_parlor_usage')).rows);
  for(const forbidden of ['Private question','Private follow-up','Memory-only audio','Synthetic narration','synthetic-server',reading.token])assert.ok(!usage.includes(forbidden),'ledger stores metadata only');
  assert.ok((await db.query("SELECT 1 FROM arcana_parlor_usage WHERE status='uncertain'")).rows.length);
  const revoke={...grant,operationId:randomUUID(),action:'revoke' as const,expiresAt:undefined};await db.transaction(tx=>applyEntitlement(tx as ParlorDb,revoke));
  assert.equal((await caps()).status,403);const before=calls;assert.equal((await request('narrate')).status,403);assert.equal(calls,before);
  console.log('PASS hosted config, migration, verified audited grants/revokes, atomic user/global reservations, concurrency, duplicate IDs, HTTP session/origin/deck/model/voice gates, all three mocked providers, key redaction, timeout/logout/revocation/cancel fencing, conservative uncertain charges and metadata-only ledger.');
}finally{server?.closeAllConnections();if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await db.close();}
