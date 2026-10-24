import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { parlorConfig } from '../src/parlorConfig';
import { createParlorHandler } from '../src/parlorApi';
import { PARLOR_OWNER } from '../src/parlorAccess';
import { createArcanaAdapter } from '../src/hostStore';
import { defaultSettings } from '../../app/src/parlor/settings';
import { narrationInstructions, discussionInstructions } from '../../app/src/parlor/providers';
import type { UserDeckCatalogRepository } from '../src/userDeckCatalog';

const origin = new URL(PARLOR_OWNER.issuer).origin;
const env = { PARLOR_MODE:'byok', PARLOR_OWNER_KEYS_ENABLED:'true', BETTER_AUTH_URL:origin, PARLOR_OWNER_ANTHROPIC_MODEL:'claude-test-owner', PARLOR_OWNER_ELEVENLABS_VOICE_ID:'env-voice', ANTHROPIC_API_KEY:'synthetic-owner-anthropic-secret', ELEVENLABS_API_KEY:'synthetic-owner-eleven-secret' };
assert.equal(parlorConfig({...env,PARLOR_OWNER_KEYS_ENABLED:undefined}).ownerKeys,undefined);
assert.equal(parlorConfig({...env,PARLOR_MODE:'disabled'}).ownerKeys,undefined);
assert.throws(()=>parlorConfig({...env,PARLOR_OWNER_ANTHROPIC_MODEL:'https://attacker.invalid/model'}));
assert.throws(()=>parlorConfig({...env,PARLOR_OWNER_ELEVENLABS_VOICE_ID:'../../voice'}));
assert.throws(()=>parlorConfig({...env,BETTER_AUTH_URL:origin+'/path'}));
const raw=JSON.parse(await readFile(new URL('../../decks/deep-time/deck.json',import.meta.url),'utf8'));
const adapter=createArcanaAdapter();adapter.engine.importDeck(raw,{runtimeId:'owner-deck'});
const reading=await adapter.engine.castReading('owner-deck','three-card','A private question');
const narration={cards:reading.placements.map(p=>({slug:p.card.slug,text:'A mock interpretation.'})),synthesis:'A mock synthesis.'};
const base={deckId:'owner-deck',token:reading.token,character:'keeper',provider:'anthropic',model:'claude-test-owner'};
const catalog={get:async(id:string)=>id==='owner-deck'?{id,ownerId:'usr_owner',manifest:{data:raw}}:null} as unknown as UserDeckCatalogRepository;
let config=parlorConfig(env), identityMode='owner', revoked=false, authFails=false, limited=false, limitFails=false, calls=0, responseMode='ok';
let upstreamStatus=200;
let dispatches:{url:string;headers:Headers;body:unknown}[]=[];
let pending:Promise<void>|undefined, release:()=>void=()=>{}, started:()=>void=()=>{};
let limitGate:Promise<void>|undefined, limitStarted:()=>void=()=>{}, lastSignal:AbortSignal|null|undefined;
const authenticator={authenticate:async()=>{
  if(authFails)throw new Error(env.ANTHROPIC_API_KEY);
  if(identityMode==='anonymous'||revoked)return null;
  return {identity:identityMode==='owner'?PARLOR_OWNER:identityMode==='issuer'?{...PARLOR_OWNER,issuer:'https://preview.invalid/api/auth'}:{...PARLOR_OWNER,subject:'other'},email:'mbilokonsky@gmail.com',displayName:'Mykola Bilokonsky'};
}};
const provider:typeof fetch=async(input,init)=>{
  calls++; lastSignal=init?.signal; const url=String(input), headers=new Headers(init?.headers), body=init?.body instanceof FormData?init.body:JSON.parse(String(init?.body));
  dispatches.push({url,headers,body});assert.equal(init?.redirect,'error');assert.equal(init?.method,'POST');
  started();if(pending)await pending;
  if(init?.signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(upstreamStatus!==200)return new Response(env.ANTHROPIC_API_KEY,{status:upstreamStatus,headers:{'x-private-detail':env.ELEVENLABS_API_KEY}});
  if(responseMode==='invalid-json')return new Response(env.ANTHROPIC_API_KEY);
  if(responseMode==='invalid-reading')return Response.json({content:[{type:'text',text:'{"cards":[]}'}]});
  if(responseMode==='error')return new Response(env.ELEVENLABS_API_KEY,{status:400});
  if(responseMode==='throw')throw new Error(env.ANTHROPIC_API_KEY);
  if(responseMode==='logout')revoked=true;
  if(responseMode==='echo')return Response.json({text:env.ANTHROPIC_API_KEY,content:[{type:'text',text:env.ANTHROPIC_API_KEY}]});
  if(url.includes('/speech-to-text')){assert.ok(body instanceof FormData);assert.equal(headers.get('xi-api-key'),env.ELEVENLABS_API_KEY);assert.equal(body.get('model_id'),'scribe_v2');assert.equal(body.get('webhook'),'false');return Response.json({text:'What do you mean?',discarded_metadata:'not returned'});}
  if(url.includes('/text-to-speech/')){
    assert.equal(headers.get('xi-api-key'),env.ELEVENLABS_API_KEY);assert.equal(body.model_id,'eleven_v3');
    const words=responseMode==='alignment-echo'?env.ANTHROPIC_API_KEY:'[sighs] Hello';
    const audio=responseMode==='audio-echo'?Buffer.from(env.ELEVENLABS_API_KEY):Buffer.from([73,68,51,0,1,2]);
    return Response.json({audio_base64:audio.toString('base64'),normalized_alignment:{characters:[...words],character_start_times_seconds:[...words].map((_,i)=>i/10),character_end_times_seconds:[...words].map((_,i)=>(i+1)/10)},discarded_metadata:'not returned'});
  }
  assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(headers.get('x-api-key'),env.ANTHROPIC_API_KEY);assert.ok(['claude-test-owner','claude-sonnet-5-5'].includes(body.model));assert.equal(body.max_tokens,2000);
  assert.ok(body.system.startsWith(body.system.includes('Return only JSON')?narrationInstructions(defaultSettings()):discussionInstructions(defaultSettings())),'owner uses the same ether/control-free prompt as BYOK');
  if(body.system.includes('Return only JSON'))assert.deepEqual(JSON.parse(body.messages[0].content.split('CARD IDENTITIES IN ORDER\n')[1]).map((p:{narrativeFrame:string})=>p.narrativeFrame),['Past','Present','Future']);
  if(body.model==='claude-sonnet-5-5'){assert.deepEqual(body.thinking,{type:'between_tools'});assert.deepEqual(body.output_config,{effort:'low'});assert.equal(body.tools,undefined);assert.equal(body.tool_choice,undefined);}
  else {assert.equal(body.thinking,undefined);assert.equal(body.output_config,undefined);}
  return Response.json({content:[{type:'text',text:body.system.includes('Return only JSON')?JSON.stringify(narration):'A mock follow-up.'}]});
};
// Deliberately permissive page admission models a future allowed nonowner. The credential
// boundary must still independently reject them. Real signed-session admission is in parlor-access.ts.
const server=createServer((req,res)=>{void createParlorHandler({config,authorize:async()=>true,authenticator,principal:{resolve:async()=>revoked?null:{id:'usr_owner'}},catalog,ownerAllowRequest:async()=>{limitStarted();await limitGate;if(limitFails)throw new Error(env.ELEVENLABS_API_KEY);return !limited;},fetch:provider})(req,res);});
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();assert.ok(address&&typeof address!=='string');const local=`http://127.0.0.1:${address.port}`;
async function call(kind:string,data:unknown={},extra:Record<string,string>={},signal?:AbortSignal){
  const speech=kind==='transcribe';return fetch(local+'/api/parlor/owner/'+kind,{method:'POST',headers:{origin,'content-type':speech?'audio/webm':'application/json','x-owner-id':PARLOR_OWNER.subject,'x-user-email':'mbilokonsky@gmail.com',...extra},body:speech?new Uint8Array([1,2,3]):JSON.stringify(data),signal});
}
async function denied(kind:string,data:unknown,status:number,headers:Record<string,string>={}){const before=calls;const r=await call(kind,data,headers);assert.equal(r.status,status,`${identityMode} ${kind}`);const body=await r.text();for(const key of Object.values(config.ownerKeys?.keys??{}))if(key)assert.ok(!body.includes(key));assert.equal(calls,before,'no provider dispatch');}
try{
  const caps=await (await fetch(local+'/api/parlor/capabilities')).json();assert.deepEqual(caps.ownerKeys,{anthropicModel:'claude-test-owner',elevenlabs:true,voiceId:'env-voice'});assert.ok(!JSON.stringify(caps).includes('secret'));
  for(const method of ['GET','OPTIONS']){const before=calls;const r=await fetch(local+'/api/parlor/owner/narrate',{method});assert.equal(r.status,405);assert.deepEqual(await r.json(),{error:'post_required'});assert.equal(calls,before,'opening the endpoint is not a provider request');}
  for(const mode of ['other','issuer','anonymous']){identityMode=mode;const otherCaps=await (await fetch(local+'/api/parlor/capabilities')).json();assert.equal(otherCaps.mode,'byok');assert.equal(otherCaps.ownerKeys,undefined);for(const kind of ['narrate','converse','speech','transcribe'])await denied(kind,{...base,text:'Hello',voiceId:'voice'},mode==='anonymous'?401:403);}
  identityMode='owner';authFails=true;for(const kind of ['narrate','speech','transcribe'])await denied(kind,base,503);authFails=false;
  for(const kind of ['narrate','converse','speech','transcribe']){
    const data=kind==='converse'?{...base,turns:[{role:'user',content:'What did you mean?'}],revealed:1}:kind==='speech'?{text:'[sighs] Hello',voiceId:'my-selected-voice'}:base;
    const r=await call(kind,data);assert.equal(r.status,200,kind);assert.equal(r.headers.get('cache-control'),'private, no-store');const result=await r.json();assert.equal(result.discarded_metadata,undefined);
    if(kind==='speech'){assert.ok(dispatches.at(-1)!.url.endsWith('/my-selected-voice/with-timestamps'));assert.ok(result.normalized_alignment);}
    if(kind==='converse'){const body=dispatches.at(-1)!.body as {system:string};const context=JSON.parse(body.system.slice(body.system.lastIndexOf('\n')+1));assert.equal(context.cards.length,1);}
  }
  for(const kind of ['narrate','converse']){const data={...base,model:'claude-sonnet-5-5',...(kind==='converse'?{turns:[{role:'user',content:'Follow up'}],revealed:1}:{})};assert.equal((await call(kind,data)).status,200,'owner can explicitly override default model');}
  await denied('narrate',{...base,provider:'openai'},400);await denied('narrate',{...base,model:'https://other.invalid/model'},400);await denied('narrate',{...base,model:'gpt-other'},400);
  await denied('narrate',{...base,deckId:'someone-elses-deck'},404);await denied('narrate',{...base,owner:true},400);await denied('speech',{text:'Hello',voiceId:'../../other'},400);
  await denied('narrate',{...base,token:'malformed-token'},400);
  await denied('speech',{text:'Hello',voiceId:'voice'},403,{origin:'https://attacker.invalid'});await denied('speech',{text:'x'.repeat(4001),voiceId:'voice'},400);
  for(const [key,kinds] of [['ANTHROPIC_API_KEY',['narrate','converse']],['ELEVENLABS_API_KEY',['speech','transcribe']]] as const){config=parlorConfig({...env,[key]:''});for(const kind of kinds)await denied(kind,kind==='speech'?{text:'Hello',voiceId:'voice'}:base,503);}
  config=parlorConfig({...env,PARLOR_OWNER_KEYS_ENABLED:'false'});await denied('speech',{text:'Hello',voiceId:'voice'},503);config=parlorConfig(env);
  limited=true;await denied('speech',{text:'Hello',voiceId:'voice'},429);limited=false;limitFails=true;await denied('speech',{text:'Hello',voiceId:'voice'},503);limitFails=false;
  for(const kind of ['narrate','converse','speech','transcribe'])for(const [status,code] of [[400,'provider_request_rejected'],[401,'provider_access_refused'],[403,'provider_access_refused'],[404,'provider_resource_unavailable'],[422,'provider_request_rejected'],[429,'provider_rate_limited'],[500,'provider_unavailable'],[503,'provider_unavailable']] as const){
    upstreamStatus=status;const before=calls;const data=kind==='converse'?{...base,turns:[{role:'user',content:'Follow up'}],revealed:1}:kind==='speech'?{text:'Hello',voiceId:'voice'}:base;
    const r=await call(kind,data);assert.equal(r.status,status===429?429:502);assert.deepEqual(await r.json(),{error:code});assert.equal(r.headers.get('x-private-detail'),null);assert.equal(calls,before+1,'one POST, no retries or credential fallback');
  }upstreamStatus=200;
  for(const mode of ['invalid-json','invalid-reading']){responseMode=mode;const r=await call('narrate',base);assert.equal(r.status,502);assert.deepEqual(await r.json(),{error:'unusable_provider_response'});}responseMode='ok';
  for(const mode of ['error','throw','echo','alignment-echo','audio-echo']){responseMode=mode;const r=await call('speech',{text:'Hello',voiceId:'voice'});assert.ok(r.status>=400);const body=await r.text();assert.ok(!body.includes(env.ANTHROPIC_API_KEY)&&!body.includes(env.ELEVENLABS_API_KEY));}
  responseMode='logout';assert.equal((await call('speech',{text:'Hello',voiceId:'voice'})).status,401);revoked=false;responseMode='ok';
  pending=new Promise(r=>{release=r;});const startedPromise=new Promise<void>(r=>{started=r;});const late=call('speech',{text:'Hello',voiceId:'voice'});await startedPromise;identityMode='other';release();assert.equal((await late).status,403);pending=undefined;identityMode='owner';
  let unlockLimit:()=>void=()=>{};limitGate=new Promise(r=>{unlockLimit=r;});const atLimit=new Promise<void>(r=>{limitStarted=r;});const beforeDispatch=calls;
  const blocked=call('speech',{text:'Hello',voiceId:'voice'});await atLimit;identityMode='other';unlockLimit();assert.equal((await blocked).status,403);assert.equal(calls,beforeDispatch);identityMode='owner';limitGate=undefined;
  pending=new Promise(r=>{release=r;});const atProvider=new Promise<void>(r=>{started=r;});const controller=new AbortController();
  const cancelled=call('speech',{text:'Hello',voiceId:'voice'},{},controller.signal);await atProvider;
  const upstreamAborted=new Promise<void>(r=>lastSignal!.addEventListener('abort',()=>r(),{once:true}));controller.abort();await assert.rejects(cancelled);await upstreamAborted;assert.equal(lastSignal!.aborted,true);release();pending=undefined;
  // Legacy hosted mode cannot make the owner's existing env keys available to another entitled user.
  config={...parlorConfig(env),mode:'hosted',keys:{anthropic:env.ANTHROPIC_API_KEY,elevenlabs:env.ELEVENLABS_API_KEY}};identityMode='other';
  assert.equal((await (await fetch(local+'/api/parlor/capabilities')).json()).mode,'byok');
  for(const kind of ['narrate','converse','speech']){const before=calls;const r=await fetch(local+'/api/parlor/'+kind,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(base)});assert.equal(r.status,403);assert.equal(calls,before);}
  console.log('PASS owner-only server keys: independent stable identity, future permitted nonowner BYOK, all four provider routes, missing config/keys, mismatches, origin/deck/input gates, shared-limit failures, output/key redaction, late identity changes, legacy hosted isolation; synthetic providers only.');
}finally{release();await new Promise<void>(r=>server.close(()=>r()));}
