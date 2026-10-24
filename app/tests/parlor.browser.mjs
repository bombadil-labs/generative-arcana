// One browser/context/server. Every account/provider request and microphone is synthetic.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {preview} from 'vite';
import ts from 'typescript';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const ownerMode=process.env.PARLOR_OWNER_BROWSER==='1';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright-core');
const data=JSON.parse(await readFile(resolve(root,'../decks/deep-time/deck.json'),'utf8'));
const deck={id:'parlor-fixture',slug:data.slug,name:data.name,tagline:'Synthetic browser fixture',revision:1,visibility:'private',createdAt:'',updatedAt:'',manifest:{data,tagline:'Synthetic fixture'}};
const evidence=resolve(root,'../..','parlor-conversation-verification');
let server,browser,context,page,authenticated=false,allowed=true,calls=0,mode='ok',release;
const speechRequests=[],scribeRequests=[],scribeTypes=[];let scribeMode='ok',scribeRelease,ttsMode='ok',ttsRelease;
const artSizes=[[945,1663],[958,1642],[971,1619],[1024,1536]];let artIndex=0,longNarration=false;const artFixtures=[];
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
const button=name=>page.getByRole('button',{name,exact:true});
const stage=()=>page.getByLabel('Interactive reading',{exact:true});
const phase=state=>page.locator('.parlor-ritual[data-phase="'+state+'"]');
const cue=()=>page.getByLabel('Table instructions',{exact:true});
async function advance(){await tap();await page.clock.fastForward(500);}
const caption=()=>page.getByLabel('Narrator transcript',{exact:true});
async function finishAudio(){await page.evaluate(()=>{const a=window.__audio;a.currentTime=900;a.ontimeupdate?.();a.onended?.();});}
async function waitAudio(previous){await page.waitForFunction(n=>window.__audioCount>n,previous);}
async function audioCount(){return page.evaluate(()=>window.__audioCount);}
async function radioLevel(){return page.evaluate(()=>window.__radioLevel());}
async function radio(mode){await page.locator(`.parlor-radio[data-mode="${mode}"]`).waitFor();}
async function pending(get){const end=Date.now()+5000;while(!get()&&Date.now()<end)await new Promise(r=>setTimeout(r,20));assert.ok(get(),'fixture request arrived');}
const idleText='Press and hold the button to make contact with the beyond';
async function idle(){await page.locator('.parlor-idle').waitFor();assert.equal((await page.locator('.parlor-show').innerText()).trim(),idleText);assert.equal(await page.locator('.parlor-card,.parlor-slot,.parlor-caption,.parlor-radio').count(),0);}
async function summon(finish=true){
  await idle();const n=await audioCount(),mic=await page.evaluate(()=>window.__micRequests);await page.keyboard.down('a');await page.locator('.parlor-summoning').waitFor();assert.equal(await page.locator('.parlor-slot').count(),3);
  await page.clock.fastForward(7000);await waitAudio(n);assert.match(speechRequests.at(-1).text,/release the button/);assert.equal(await page.evaluate(()=>window.__micRequests),mic);await finishAudio();await page.getByText('Release the button.',{exact:true}).waitFor();assert.equal(await audioCount(),n+1);
  await page.keyboard.up('a');await waitAudio(n+1);assert.match(speechRequests.at(-1).text,/I am the spirit/);assert.equal(await page.evaluate(()=>window.__micRequests),mic);assert.equal(await caption().innerText(),'');
  if(finish){await finishAudio();await phase('question').waitFor();}
}
async function begin(){await button('Start the show').click();await summon();}
async function talk(text,control=false){
  const target=control==='touch'?button('Hold to talk'):stage();await page.evaluate(text=>window.__utterance=text,text);
  const previousWords=await page.getByLabel('Your words',{exact:true}).innerText();
  if(control==='touch')await target.dispatchEvent('pointerdown',{pointerId:9,pointerType:'touch',button:0,isPrimary:true});
  else {await target.focus();await page.keyboard.down(control==='enter'?'Enter':'Space');}
  await cue().getByText('Speak now.',{exact:true}).waitFor();
  await radio('listening');
  assert.equal(await radioLevel(),0,'ambience stays silent throughout microphone capture');
  if(text==='A synthetic spoken query')await capture('radio-listening');
  const before=scribeRequests.length;await page.waitForTimeout(300);assert.equal(scribeRequests.length,before,'no upload while held');
  assert.equal(await page.getByLabel('Your words',{exact:true}).innerText(),previousWords,'batch transcript is not simulated while recording');
  if(control==='touch')await target.dispatchEvent('pointerup',{pointerId:9,pointerType:'touch',button:0,isPrimary:true});
  else await page.keyboard.up(control==='enter'?'Enter':'Space');
  assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false,'release stops all tracks');
  if(scribeMode==='ok' && await page.evaluate(()=>window.__micMode!=='empty'))await page.waitForFunction(text=>document.querySelector('.parlor-user-transcript').textContent===text,text);
}
async function ignoredBusy(pointer=false){
  const before={calls,mic:await page.evaluate(()=>window.__micRequests),audio:await audioCount(),paused:await page.evaluate(()=>window.__audioPaused)};
  const down=()=>pointer?button('Hold to talk').dispatchEvent('pointerdown',{pointerId:19,pointerType:'touch',button:0,isPrimary:true}):page.keyboard.down('b');
  const up=()=>pointer?button('Hold to talk').dispatchEvent('pointerup',{pointerId:19,pointerType:'touch',button:0,isPrimary:true}):page.keyboard.up('b');
  if(pointer)assert.equal(await button('Hold to talk').getAttribute('aria-disabled'),'true');else await stage().focus();
  await down();await up();await page.clock.fastForward(600);await down();await page.clock.fastForward(600);await up();await page.clock.fastForward(600);
  if(pointer){await down();await button('Hold to talk').dispatchEvent('pointercancel',{pointerId:19,pointerType:'touch'});await up();}
  assert.deepEqual({calls,mic:await page.evaluate(()=>window.__micRequests),audio:await audioCount(),paused:await page.evaluate(()=>window.__audioPaused)},before,'busy input cannot advance, record, interrupt or prepare extra audio');
}
async function escape(){await page.keyboard.press('Escape');await button('Start the show').waitFor();assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Start the show');assert.equal(await page.locator('.parlor-card').count(),0);await page.clock.fastForward(100);assert.equal(await page.evaluate(()=>window.__radioContexts.every(c=>c.state==='closed')),true,'exit closes every ambience context');}
async function capture(name){if(await page.locator('.parlor-show').count()){assert.equal(await page.locator('.parlor-show button,.parlor-show input,.parlor-show summary').count(),0,'guest projection has no controls');assert.equal(await page.locator('.parlor-cue').count(),1);assert.equal(await page.locator('.parlor-radio-label,.parlor-status,.parlor-control-hint').count(),0);if((await page.viewportSize()).width>=900 && !(await page.locator('.parlor-idle').count())){const scene=await page.locator('.parlor-scene').boundingBox(),hint=await cue().boundingBox(),stageBox=await stage().boundingBox();assert.ok(hint.x>=scene.x+scene.width+20,'side cue cannot overlap cards or captions');assert.ok(stageBox.y>=0 && stageBox.y+stageBox.height<=(await page.viewportSize()).height+1,'projected scene fits vertically');}}await page.evaluate(()=>window.scrollTo(0,0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:resolve(evidence,name+'.png'),fullPage:true});}
async function tap(key='a'){await page.keyboard.press(key);}
async function resetEncounter(){const saved=await page.evaluate(()=>JSON.stringify(localStorage));const n=await audioCount();for(let i=0;i<5;i++)await tap();await idle();assert.equal(await radioLevel(),0,'reset fades ambience to silence');assert.equal(await audioCount(),n,'reset is silent');assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);assert.equal(await page.evaluate(()=>JSON.stringify(localStorage)),saved,'reset preserves saved keys and choices');}
async function artwork(){
  await page.waitForFunction(()=>[...document.querySelectorAll('.parlor-artwork img')].every(img=>img.complete&&img.naturalWidth>0));
  const slots=await page.locator('.parlor-card').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return [r.width,r.height];}));
  for(const [w,h] of slots){assert.ok(Math.abs(w/h-2/3)<.01);assert.ok(Math.abs(w-slots[0][0])<1);assert.ok(Math.abs(h-slots[0][1])<1);}
  const images=await page.locator('.parlor-artwork img').evaluateAll(nodes=>nodes.map(img=>{const r=img.getBoundingClientRect(),card=img.closest('.parlor-card').getBoundingClientRect(),style=getComputedStyle(img);return {natural:[img.naturalWidth,img.naturalHeight],fit:style.objectFit,opacity:style.opacity,inset:Math.min(r.left-card.left,r.top-card.top,card.right-r.right,card.bottom-r.bottom),width:r.width,height:r.height};}));
  assert.ok(images.length);for(const img of images){assert.deepEqual(img.natural,artSizes[artIndex]);assert.equal(img.fit,'contain');assert.equal(img.opacity,'1');assert.ok(img.inset>=6,'full artwork stays inside rounded frame');const scale=Math.min(img.width/img.natural[0],img.height/img.natural[1]);assert.ok(img.natural[0]*scale<=img.width+.1&&img.natural[1]*scale<=img.height+.1);}
}
try{
  await mkdir(evidence,{recursive:true});server=await preview({root,preview:{host:'127.0.0.1',port:4187,strictPort:true}});
  browser=await chromium.launch({headless:true,...(process.env.PARLOR_BROWSER?{executablePath:process.env.PARLOR_BROWSER}:{channel:'msedge'})});
  context=await browser.newContext({viewport:{width:1280,height:960},reducedMotion:'reduce',hasTouch:true});context.setDefaultTimeout(12000);
  await context.addInitScript(()=>{
    // Stub the output device as well as TTS: automated UI tests emit no real sound.
    window.__radioContexts=[];window.__radioUnavailable=false;
    class Param {value=0;target=0;cancelScheduledValues(){}setValueAtTime(value){this.value=value;}linearRampToValueAtTime(value){this.target=value;}}
    window.AudioContext=class {
      state='suspended';sampleRate=8000;nodes=[];destination={};
      constructor(){if(window.__radioUnavailable)throw Error('Synthetic unavailable Web Audio');window.__radioContexts.push(this);}
      get currentTime(){return performance.now()/1000;}
      node(source=false){const owner=this;const n={gain:new Param(),frequency:new Param(),Q:new Param(),source,disconnected:false,stopped:false,master:false,connect(to){if(to===owner.destination)this.master=true;return to;},disconnect(){this.disconnected=true;},start(){},stop(){this.stopped=true;}};this.nodes.push(n);return n;}
      createGain(){return this.node();}createBiquadFilter(){return this.node();}createBufferSource(){return this.node(true);}createOscillator(){return this.node(true);}
      createBuffer(_,size){const data=new Float32Array(size);return {getChannelData:()=>data};}
      decodeAudioData(){return Promise.resolve({duration:180,numberOfChannels:1});}
      resume(){this.state='running';return Promise.resolve();}suspend(){this.state='suspended';return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}
    };
    window.__radioLevel=()=>Math.max(0,...window.__radioContexts.flatMap(c=>c.state==='running'?c.nodes.filter(n=>n.master&&!n.disconnected).map(n=>n.gain.target):[]));
    window.__audioCount=0;window.__audioPaused=0;window.__audioCleared=0;window.__micStarts=0;window.__micRequests=0;window.__micMode='ok';window.__utterance='';window.__tracks=[];window.__mimeType='audio/webm;codecs=opus';
    window.Audio=class{
      currentTime=0;
      constructor(){window.__audio=this;window.__audioCount++;}
      play(){queueMicrotask(()=>this.onplaying?.());return Promise.resolve();}
      pause(){window.__audioPaused++;}
      removeAttribute(){window.__audioCleared++;}load(){}
    };
    window.SpeechRecognition=class{constructor(){throw Error('No browser speech fallback allowed');}};
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async options=>{
      if(window.__radioLevel()!==0)throw Error('Ambience must be silent before microphone access');
      window.__micRequests++;
      if(JSON.stringify(options)!==JSON.stringify({audio:true}))throw Error('Audio only');
      if(window.__micMode==='denied')throw new DOMException('Synthetic denial','NotAllowedError');
      const stream=()=>{const track={stopped:false,stop(){this.stopped=true;}};window.__tracks.push(track);return {getTracks:()=>[track]};};
      return window.__micMode==='pending'?new Promise(resolve=>window.__grant=()=>resolve(stream())):stream();
    }});
    window.MediaRecorder=class{
      state='inactive';
      static isTypeSupported(type){return type===window.__mimeType;}
      constructor(stream,options){window.__mic=this;this.stream=stream;this.mimeType=options.mimeType;}
      start(){if(window.__radioLevel()!==0)throw Error('Ambience during capture');this.state='recording';window.__micStarts++;queueMicrotask(()=>this.onstart?.());}
      stop(){if(window.__radioLevel()!==0)throw Error('Ambience before tracks stopped');this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(window.__micMode==='empty'?[]:['synthetic intentional recording'],{type:this.mimeType})});this.onstop?.();});}
    };
  });
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    if(path==='/assets/parlor-radio-recording.mp3'){
      assert.equal(url.origin,'http://127.0.0.1:4187');assert.equal(authenticated&&allowed,true,'private recording only requested during owner encounter');
      return route.fulfill({contentType:'audio/mpeg',body:Buffer.from([73,68,51])});
    }
    const ownerLanguage=path==='/api/parlor/owner/narrate'||path==='/api/parlor/owner/converse';
    if(url.hostname==='api.anthropic.com'||url.hostname==='api.openai.com'||ownerLanguage){
      assert.equal(ownerLanguage,ownerMode,'owner mode never sends browser requests to paid language providers');
      calls++;if(mode==='error')return json(route,{},429);
      const request=route.request().postDataJSON(),prompt=ownerLanguage?'':request.messages.at(-1).content;
      const identities=ownerLanguage?(path.endsWith('narrate')?JSON.parse(Buffer.from(request.token,'base64url')).c.map(([slug])=>({slug,name:slug})):null):prompt.includes('CARD IDENTITIES IN ORDER\n')?JSON.parse(prompt.split('CARD IDENTITIES IN ORDER\n')[1]):null;
      if(!identities)assert.doesNotMatch(JSON.stringify(ownerLanguage?request.turns:request.messages),/\[(?:sighs|exhales|sarcastic|curious)\]/,'history has no delivery tags');
      const text=identities?JSON.stringify({cards:identities.map(card=>({slug:card.slug,text:`[sarcastic] ${card.name} invites you to reflect on this position. Its authored meaning opens a possibility.${longNarration?' Reflect on the choice before you, and consider what you might learn by making room for another possibility.'.repeat(14):''}`})),synthesis:'The cards invite reflection and a choice that remains yours.'}):'[curious] Stay with the meaning that resonates. What possibility does it open for you?';
      if(mode==='delay')await new Promise(r=>release=r);
      return json(route,ownerLanguage?(identities?JSON.parse(text):{text}):{content:[{type:'text',text}]});
    }
    if(url.hostname==='api.elevenlabs.io'||path==='/api/parlor/owner/speech'||path==='/api/parlor/owner/transcribe'){
      assert.equal(path.startsWith('/api/parlor/owner/'),ownerMode,'owner mode never sends browser requests to ElevenLabs');
      if(path==='/v1/speech-to-text'||path==='/api/parlor/owner/transcribe'){
        assert.equal(route.request().method(),'POST');assert.equal(route.request().headers()['xi-api-key'],ownerMode?undefined:'synthetic-voice-key');
        const body=route.request().postDataBuffer().toString();if(!ownerMode){assert.match(body,/name="model_id"\r\n\r\nscribe_v2/);assert.match(body,/name="tag_audio_events"\r\n\r\nfalse/);}assert.match(body,/synthetic intentional recording/);scribeRequests.push(body);scribeTypes.push(route.request().headers()['content-type']);
        assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false,'tracks stopped before request');
        const text=await page.evaluate(()=>window.__utterance);if(scribeMode==='delay')await new Promise(r=>scribeRelease=r);
        return json(route,scribeMode==='error'?{detail:'synthetic error'}:{text:scribeMode==='silent'?'':text},scribeMode==='error'?401:200);
      }
      assert.equal(path,ownerMode?'/api/parlor/owner/speech':'/v1/text-to-speech/synthetic-selected-voice/with-timestamps');const request=route.request().postDataJSON();if(ownerMode)assert.equal(request.voiceId,'synthetic-selected-voice');else assert.equal(request.model_id,'eleven_v3');speechRequests.push(request);
      assert.ok((request.text.match(/\[[^\]]+\]/g)||[]).length<=1);if(ttsMode==='error')return json(route,ownerMode?{error:'provider_access_refused'}:{},ownerMode?502:503);
      if(ttsMode==='delay')await new Promise(r=>ttsRelease=r);
      const characters=[...request.text];return json(route,{audio_base64:Buffer.from('synthetic audio').toString('base64'),alignment:{characters,character_start_times_seconds:characters.map((_,i)=>i*.025),character_end_times_seconds:characters.map((_,i)=>(i+1)*.025)}});
    }
    if(url.hostname!=='127.0.0.1')return route.abort();
    if(path==='/auth/session')return json(route,authenticated?{authenticated:true,accountId:'synthetic-owner',parlorAllowed:allowed,user:{email:'fixture@example.test'}}:{authenticated:false});
    if(path==='/api/parlor/capabilities')return json(route,{mode:'byok',...(ownerMode?{ownerKeys:{anthropicModel:'claude-test-owner',elevenlabs:true}}:{})});
    if(path==='/api/me/decks')return json(route,[deck]);
    if(path==='/api/decks/parlor-fixture')return json(route,deck);
    if(path.startsWith('/api/decks/parlor-fixture/artwork/assets/'))return json(route,{},404);
    if(/^\/api\/decks\/parlor-fixture\/cards\/[^/]+\/artwork\/image$/.test(path))return route.fulfill({contentType:'image/webp',body:artFixtures[artIndex]});
    if(path.startsWith('/api/decks/parlor-fixture/artwork'))return json(route,{enabled:true,deckRevision:1,packId:'saved-artwork',packs:[{id:'saved-artwork',label:'Saved artwork',cardCount:Object.keys(data.cards).length,complete:true}],cards:Object.values(data.cards).map(card=>({slug:card.slug,name:card.name,artwork:{id:`synthetic-art-${artIndex}-${card.slug}`,deckId:deck.id,cardSlug:card.slug,packId:'saved-artwork',mediaType:'image/webp',width:artSizes[artIndex][0],height:artSizes[artIndex][1],byteLength:artFixtures[artIndex].length,integrity:'synthetic',deckRevision:1}}))});
    if(path.startsWith('/api/'))return json(route,{},404);
    return route.continue();
  });
  page=await context.newPage();await page.clock.install();
  // Decode the exact approved MP3, then verify the real gain envelope with a
  // constant synthetic source offline. Nothing connects to speakers or a mic.
  const radioSource=ts.transpileModule(await readFile(resolve(root,'src/parlor/radioAudio.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const radioBytes=(await readFile(resolve(root,'public/assets/parlor-radio-recording.mp3'))).toString('base64');
  const offline=await page.evaluate(async({source,encoded})=>{
    const exports={};new Function('exports',source)(exports);
    const rate=48000,context=new OfflineAudioContext(1,rate*3,rate);let now=0;
    const decoded=await context.decodeAudioData(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)).buffer),recorded=decoded.getChannelData(0);let recordingPeak=0;for(const v of recorded)recordingPeak=Math.max(recordingPeak,Math.abs(v));
    const recording={duration:decoded.duration,channels:decoded.numberOfChannels,sampleRate:decoded.sampleRate,peak:recordingPeak,first:recorded[0],last:recorded.at(-1)};
    const adapter={get currentTime(){return now;},state:'running',sampleRate:rate,destination:context.destination,resume:()=>Promise.resolve(),suspend:()=>Promise.resolve(),close:()=>Promise.resolve()};
    for(const method of ['createGain','createBufferSource','createBuffer','createBiquadFilter','createOscillator'])adapter[method]=context[method].bind(context);
    const testBuffer=context.createBuffer(1,rate*180,rate);testBuffer.getChannelData(0).fill(.05);
    const bed=new exports.RadioAudio(()=>adapter,async()=>testBuffer,()=>0);bed.setPreferences({muted:false,volume:1});bed.setState('searching',false);
    bed.unlock();for(let i=0;i<8;i++)await Promise.resolve();
    now=1;bed.setState('speaking',false);now=1.8;bed.setState('listening',true);
    const buffer=await context.startRendering(),samples=buffer.getChannelData(0);
    const rms=(start,end)=>{const segment=samples.slice(start*rate,end*rate);return Math.sqrt(segment.reduce((sum,n)=>sum+n*n,0)/segment.length);};
    let peak=0,ordinaryStep=0,transitionStep=0;for(let i=1;i<samples.length;i++){peak=Math.max(peak,Math.abs(samples[i]));const step=Math.abs(samples[i]-samples[i-1]);if([1,1.025,1.8,1.825].some(time=>Math.abs(i/rate-time)<.005))transitionStep=Math.max(transitionStep,step);else ordinaryStep=Math.max(ordinaryStep,step);}
    bed.dispose();return {recording,search:rms(.75,.95),speech:rms(1.35,1.7),silent:rms(2,2.5),peak,ordinaryStep,transitionStep};
  },{source:radioSource,encoded:radioBytes});
  console.log('Approved recording decode and offline gain envelope:',JSON.stringify(offline));assert.ok(Math.abs(offline.recording.duration-180)<.01);assert.equal(offline.recording.channels,1);assert.equal(offline.recording.sampleRate,48000);assert.ok(offline.recording.peak<.19);assert.equal(offline.recording.first,0);assert.equal(offline.recording.last,0);
  assert.ok(offline.search>.049&&offline.peak<.051);assert.ok(offline.speech<offline.search*.12);assert.equal(offline.silent,0);assert.ok(offline.transitionStep<.0001,'gain fades produce no abrupt step');
  for(const size of artSizes){const encoded=await page.evaluate(([w,h])=>{const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const c=canvas.getContext('2d');c.fillStyle='#30283d';c.fillRect(0,0,w,h);c.strokeStyle='#e9c98a';c.lineWidth=12;c.strokeRect(6,6,w-12,h-12);c.fillStyle='#f3c282';c.font='60px serif';c.fillText(`${w} x ${h}`,50,100);c.fillRect(0,h-50,w,50);return canvas.toDataURL('image/webp').split(',')[1];},size);artFixtures.push(Buffer.from(encoded,'base64'));}
  await page.goto('http://127.0.0.1:4187/parlor');await page.getByText('Parlor access is restricted.',{exact:true}).waitFor();assert.equal(await page.locator('input[type=password]').count(),0);
  authenticated=true;allowed=false;await page.reload();await page.getByText('Parlor access is restricted.',{exact:true}).waitFor();assert.equal(await button('Parlor').count(),0);
  allowed=true;await page.reload();
  await page.getByLabel('Anthropic API key',{exact:true}).fill(ownerMode?'':'synthetic-browser-key');await page.getByLabel('Anthropic model ID',{exact:true}).fill(ownerMode?'claude-test-owner':'synthetic-model');
  await page.getByLabel('ElevenLabs API key',{exact:true}).fill(ownerMode?'':'synthetic-voice-key');await page.getByLabel('ElevenLabs voice ID',{exact:true}).fill('synthetic-selected-voice');await page.getByLabel('Remember keys on this device (plaintext)').check();
  await page.reload();assert.equal(await page.getByLabel('ElevenLabs voice ID',{exact:true}).inputValue(),'synthetic-selected-voice');assert.equal(await page.locator('textarea').count(),0);await capture('setup');
  const before=await audioCount();await button('Start the show').click();await idle();assert.equal(await audioCount(),before);assert.equal(calls,0);
  assert.equal(await page.evaluate(()=>window.__radioContexts.length),0,'no AudioContext before a deliberate summon gesture');
  // Touching/dragging the blank scene never starts a summon, recording or ambience.
  await stage().dispatchEvent('pointerdown',{pointerId:9,pointerType:'touch',button:0,isPrimary:true});await page.clock.fastForward(7100);await stage().dispatchEvent('pointermove',{pointerId:9,clientY:100});await stage().dispatchEvent('pointercancel',{pointerId:9});await idle();assert.equal(await audioCount(),before);assert.equal(await page.evaluate(()=>window.__micRequests),0);assert.equal(await page.evaluate(()=>window.__radioContexts.length),0);
  // Early physical-key release and lost focus return to blank without voice or microphone.
  for(const cancel of ['release','blur']){
    await page.keyboard.down('a');
    await page.locator('.parlor-summoning').waitFor();await radio('tuning');assert.equal(await page.locator('.parlor-slot').count(),3);assert.equal(await page.locator('.radio-needle').evaluate(el=>getComputedStyle(el).animationName),'none');assert.equal(await page.locator('.parlor-radio').evaluate(el=>el.style.getPropertyValue('--contact')),'0');
    if(cancel==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    await page.keyboard.up('a');await idle();await page.clock.fastForward(7100);assert.equal(await audioCount(),before);assert.equal(await page.evaluate(()=>window.__micRequests),0);
  }
  await page.emulateMedia({reducedMotion:'no-preference'});await page.keyboard.down('a');await radio('tuning');
  const progress=()=>page.locator('.parlor-radio').evaluate(el=>Number(el.style.getPropertyValue('--contact')));
  assert.ok(await progress()<.15);await page.clock.fastForward(3300);const halfway=await progress();assert.ok(halfway>.4&&halfway<.65);await capture('radio-summon-halfway');
  await page.clock.fastForward(2900);assert.ok(await progress()>.85);assert.equal(await audioCount(),before);await capture('radio-summon-near-contact');await page.keyboard.up('a');await idle();
  await page.keyboard.down('a');await radio('tuning');assert.ok(await progress()<.15,'new summon starts at zero');await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);await page.clock.fastForward(1000);await page.waitForFunction(()=>document.querySelector('.parlor-radio').style.getPropertyValue('--contact')==='0');await capture('radio-reduced-tuning');await page.keyboard.up('a');await idle();
  const cueAudio=await audioCount();await page.keyboard.down('a');await page.clock.fastForward(7000);await waitAudio(cueAudio);await page.evaluate(()=>window.__oldCue=window.__audio.onended);await page.keyboard.up('a');await resetEncounter();await page.evaluate(()=>window.__oldCue?.());await idle();assert.equal(await audioCount(),cueAudio+1,'reset cancels introduction after a late release cue');
  // Release-cue failure can be retried by a deliberate tap without enabling a microphone.
  ttsMode='error';await page.keyboard.down('a');await page.clock.fastForward(7000);await page.locator(`.parlor-cue[role="alert"][aria-description*="${ownerMode?'account provider refused access':'Audio is unavailable'}"]`).waitFor();await radio('stopped');assert.equal(await caption().innerText(),'');await capture('radio-error');await page.keyboard.up('a');await page.clock.fastForward(700);assert.equal(calls,0,'failed summon release never starts narration');assert.equal(await page.locator('.parlor-card').count(),0);await phase('error').waitFor();ttsMode='ok';const retryCue=await audioCount();await tap();await page.clock.fastForward(500);await waitAudio(retryCue);await finishAudio();await waitAudio(retryCue+1);await finishAudio();await phase('question').waitFor();assert.equal(calls,0,'recovered intro still waits for a query or new tap');assert.equal(await page.evaluate(()=>window.__micRequests),0);await resetEncounter();
  await capture('idle-contact');await summon(false);assert.equal(await page.locator('.parlor-card').count(),0);
  await page.evaluate(()=>{window.__audio.currentTime=.5;window.__audio.ontimeupdate();});assert.ok((await caption().innerText()).length>0);assert.ok(!(await caption().innerText()).includes('speak your question'));assert.ok(!(await caption().innerText()).includes('['));
  await page.waitForTimeout(150);assert.ok(!(await caption().innerText()).includes('speak your question'));await page.keyboard.down('b');await finishAudio();await page.clock.fastForward(500);assert.equal(await page.evaluate(()=>window.__micRequests),0,'a hold started during introduction cannot turn into recording');await page.keyboard.up('b');
  const first=await audioCount();mode='delay';await talk('A synthetic spoken query');await radio('searching');await pending(()=>release);await ignoredBusy();assert.equal(await caption().innerText(),'');
  await page.emulateMedia({reducedMotion:'no-preference'});assert.equal(await page.locator('.radio-needle').evaluate(el=>getComputedStyle(el).animationName),'radio-search');await capture('radio-inference-search');assert.equal(await progress(),0,'no invented inference percent');
  await page.waitForFunction(()=>window.__radioLevel()>0);const searchingLevel=await radioLevel();assert.ok(searchingLevel>0&&searchingLevel<=1);
  for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:390,height:844}]){await page.setViewportSize(viewport);await capture(`radio-search-${viewport.width}`);}await page.setViewportSize({width:1280,height:960});
  ttsMode='delay';release();release=null;mode='ok';await pending(()=>ttsRelease);await ignoredBusy();await cue().getByText('The voice is taking shape.',{exact:true}).waitFor();await radio('searching');assert.equal(await page.locator('.is-revealed').count(),0);assert.equal(await caption().innerText(),'');await capture('radio-voice-search');
  assert.equal(await page.locator('.parlor-cue-title').innerText(),'The voice is taking shape.');
  await page.emulateMedia({reducedMotion:'reduce'});assert.deepEqual(await page.locator('.radio-needle,.radio-wave,.parlor-radio-halo').evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).animationName)),['none','none','none']);await capture('radio-reduced-search');ttsRelease();ttsRelease=null;ttsMode='ok';await waitAudio(first);await radio('speaking');assert.equal(await page.locator('.is-revealed').count(),1);assert.equal(await caption().innerText(),'');assert.equal(await page.locator('.parlor-show button').count(),0);await capture('radio-speaking');await ignoredBusy();
  await page.evaluate(()=>window.__audio.onwaiting());await radio('searching');assert.equal(await caption().innerText(),'');await page.evaluate(()=>window.__audio.onplaying());await radio('speaking');
  assert.ok(await radioLevel()<searchingLevel/10,'actual voice playback strongly ducks the ambience');
  await finishAudio();await phase('ready').waitFor();await page.waitForTimeout(250);assert.equal(await page.locator('.is-revealed').count(),1);await artwork();await capture('first-card-desktop');
  for(const text of ['Tell me more about this card','How does that connect to my question?']){const count=await audioCount();await talk(text,true);await waitAudio(count);assert.equal(await page.locator('.is-revealed').count(),1);assert.equal(await caption().innerText(),'');await finishAudio();await phase('ready').waitFor();}
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.__mimeType='audio/mp4');
  const mobile=await audioCount();await talk('A keyboard-controlled mobile discussion','enter');await waitAudio(mobile);await finishAudio();await phase('ready').waitFor();if(ownerMode)assert.equal(scribeTypes.at(-1),'audio/mp4');else assert.match(scribeRequests.at(-1),/recording.m4a/);await artwork();await capture('discussion-mobile');
  await page.evaluate(()=>window.__mimeType='audio/webm;codecs=opus');await page.setViewportSize({width:1280,height:960});
  for(let revealed=2;revealed<=3;revealed++){const count=await audioCount();await advance();await waitAudio(count);assert.equal(await page.locator('.is-revealed').count(),revealed);await finishAudio();}
  await phase('ready').waitFor();assert.match(await cue().innerText(),/hear the closing/);await capture('third-card-closing-cue');const closing=await audioCount();await advance();await waitAudio(closing);await finishAudio();await phase('complete').waitFor();assert.match(await cue().innerText(),/ask about the reading.*five times/s);await capture('complete-followup-cue');assert.equal(await page.locator('.parlor-show button').count(),0);
  // Permission denial, pending permission, blur and cancelled gestures never upload.
  let previousCalls=calls,previousScribe=scribeRequests.length;await page.evaluate(()=>window.__micMode='denied');await stage().focus();await page.keyboard.down('Space');await page.locator('.parlor-cue[role="alert"][aria-description*="Microphone access was denied"]').waitFor();await page.keyboard.up('Space');assert.equal(calls,previousCalls);
  const starts=await page.evaluate(()=>window.__micStarts);await page.evaluate(()=>window.__micMode='pending');await stage().focus();await page.keyboard.down('Space');await page.waitForFunction(()=>!!window.__grant);await page.keyboard.up('Space');await page.evaluate(()=>window.__grant());assert.equal(await page.evaluate(()=>window.__micStarts),starts);assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);
  await page.evaluate(()=>window.__micMode='ok');await stage().focus();await page.keyboard.down('Space');await cue().getByText('Speak now.',{exact:true}).waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('Space');assert.equal(calls,previousCalls);assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);
  await stage().focus();await page.keyboard.down('Space');await cue().getByText('Speak now.',{exact:true}).waitFor();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});await page.keyboard.up('Space');assert.equal(calls,previousCalls);assert.equal(scribeRequests.length,previousScribe);assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);
  await page.evaluate(()=>window.__micMode='empty');await talk('This clip is empty','enter');await page.locator('.parlor-cue[role="alert"][aria-description*="No audio was captured"]').waitFor();assert.equal(scribeRequests.length,previousScribe);
  await page.evaluate(()=>window.__micMode='ok');scribeMode='silent';await talk('No speech',true);await page.locator('.parlor-cue[role="alert"][aria-description*="No speech was heard"]').waitFor();assert.equal(calls,previousCalls);
  scribeMode='error';await talk('A transcription error',true);await page.locator('.parlor-cue[role="alert"][aria-description*="Scribe could not transcribe"]').waitFor();assert.equal(calls,previousCalls);
  scribeMode='delay';await talk('A cancelled transcription',true);await cue().getByText('Finding your words.',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.parlor-cue-title').textContent.includes('Finding your words'));await radio('searching');await capture('radio-transcription');await ignoredBusy();assert.ok(scribeRelease);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));scribeRelease();scribeRelease=null;scribeMode='ok';await radio('waiting');await page.waitForTimeout(150);assert.equal(calls,previousCalls);
  // Global table controls need no button focus. Five taps never leak an advance or recording.
  await page.getByLabel('Interactive reading',{exact:true}).focus();const requestsBefore=await page.evaluate(()=>window.__micRequests);const callsBefore=calls;
  await resetEncounter();assert.equal(calls,callsBefore);assert.equal(await page.evaluate(()=>window.__micRequests),requestsBefore);assert.equal(await page.locator('.parlor-show textarea,.parlor-show input').count(),0);await summon();
  const openAudio=await audioCount();await tap();await waitAudio(openAudio);assert.equal(await page.locator('.is-revealed').count(),1);assert.equal(await page.evaluate(()=>window.__micRequests),requestsBefore);
  // A busy tap cannot execute later just because speech completed inside its timeout.
  await tap();await finishAudio();await page.waitForTimeout(600);assert.equal(await page.locator('.is-revealed').count(),1);
  const heldStarts=await page.evaluate(()=>window.__micStarts);await page.evaluate(()=>window.__utterance='Overlapping keyboard discussion');
  await page.keyboard.down('a');await page.keyboard.down('b');await page.keyboard.down('a');await cue().getByText('Speak now.',{exact:true}).waitFor();await page.waitForTimeout(300);await page.keyboard.up('a');assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),true,'second key keeps intentional gesture held');await page.keyboard.up('b');await page.waitForFunction(()=>document.querySelector('.parlor-user-transcript').textContent==='Overlapping keyboard discussion');assert.equal(await page.evaluate(()=>window.__micStarts),heldStarts+1);await cue().getByText('Listen.',{exact:true}).waitFor();await finishAudio();
  const nextAudio=await audioCount();await tap('c');await waitAudio(nextAudio);assert.equal(await page.locator('.is-revealed').count(),2);
  // Reset during audio clears cards/history; captured callbacks cannot revive that reading.
  await page.evaluate(()=>window.__oldCallbacks=[window.__audio.onended,window.__audio.ontimeupdate]);await resetEncounter();await page.evaluate(()=>window.__oldCallbacks.forEach(fn=>fn?.()));await page.waitForTimeout(600);assert.equal(await page.locator('.parlor-card').count(),0);
  ttsMode='delay';const cancelledVoice=await audioCount();await page.keyboard.down('a');await page.clock.fastForward(7000);await pending(()=>ttsRelease);await radio('searching');await page.keyboard.up('a');await resetEncounter();ttsRelease();ttsRelease=null;ttsMode='ok';await page.waitForTimeout(150);await idle();assert.equal(await audioCount(),cancelledVoice,'late TTS response cannot revive the apparatus or player');
  await summon();scribeMode='delay';const resetCalls=calls;await talk('Old guest transcription',true);await cue().getByText('Finding your words.',{exact:true}).waitFor();await page.getByLabel('Interactive reading',{exact:true}).focus();await resetEncounter();scribeRelease();scribeRelease=null;scribeMode='ok';await page.waitForTimeout(200);assert.equal(calls,resetCalls);assert.equal(await page.locator('.parlor-card').count(),0);
  await summon();mode='delay';await talk('Old guest reading',true);await page.waitForFunction(()=>document.querySelector('.parlor-cue-title').textContent.includes('gathering'));await resetEncounter();release();release=null;mode='ok';await page.waitForTimeout(200);assert.equal(await page.locator('.parlor-card').count(),0);
  // Genuine decoded WebP fixtures at all four observed source sizes, desktop/projector and phone.
  await escape();for(artIndex=0;artIndex<artSizes.length;artIndex++){
    await page.reload();assert.equal(await page.getByLabel('ElevenLabs voice ID',{exact:true}).inputValue(),'synthetic-selected-voice');
    const setupMic=await page.evaluate(()=>window.__micRequests);await page.getByLabel('ElevenLabs voice ID',{exact:true}).focus();for(let i=0;i<5;i++)await page.keyboard.press('ArrowLeft');await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>window.__micRequests),setupMic);assert.equal(await page.locator('.parlor-show').count(),0);
    await begin();const sizeAudio=await audioCount();await tap();await waitAudio(sizeAudio);await finishAudio();
    for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:390,height:844}]){await page.setViewportSize(viewport);await artwork();await capture(`artwork-${artSizes[artIndex].join('x')}-${viewport.width}`);}
    await page.setViewportSize({width:1280,height:960});await escape();
  }artIndex=0;await begin();const resumed=await audioCount();await talk('A new guest',true);await waitAudio(resumed);await finishAudio();
  // Cancellation fences late LLM and late speech, preserves no guest data on return.
  mode='delay';const count=await audioCount();await talk('A delayed discussion',true);await page.waitForFunction(()=>document.querySelector('.parlor-cue-title').textContent.includes('considering'));assert.ok(release);await escape();release();mode='ok';await page.waitForTimeout(150);assert.equal(await audioCount(),count);
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('synthetic spoken query')),false);
  // Real browser touch input scrolls the spoken caption and the tall page. It
  // must not be interpreted as a tap/hold or leak a delayed encounter action.
  longNarration=true;await begin();const longAudio=await audioCount();await tap();await waitAudio(longAudio);await finishAudio();await phase('ready').waitFor();await page.setViewportSize({width:390,height:640});
  const scrollRequests={calls,scribe:scribeRequests.length,audio:await audioCount(),mic:await page.evaluate(()=>window.__micRequests)};
  const cdp=await context.newCDPSession(page);
  async function swipe(target){
    const box=await target.boundingBox();assert.ok(box);const x=Math.round(box.x+box.width/2),bottom=Math.min((await page.viewportSize()).height-30,box.y+box.height-15),top=Math.max(30,box.y+15);assert.ok(bottom-top>60,'swipe target is visible');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:bottom}]});
    for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:bottom-(bottom-top)*i/8}]});await page.waitForTimeout(25);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(300);
  }
  await caption().scrollIntoViewIfNeeded();assert.ok(await caption().evaluate(el=>el.scrollHeight>el.clientHeight+100),'fixture produces a genuinely scrollable caption');
  assert.equal(await caption().evaluate(el=>{for(let n=el;n;n=n.parentElement)if(getComputedStyle(n).touchAction==='none')return false;return true;}),true,'no guest ancestor blocks native touch panning');
  await swipe(caption());assert.ok(await caption().evaluate(el=>el.scrollTop)>0,'native touch scrolls the caption');
  await page.setViewportSize({width:390,height:360});await page.evaluate(()=>window.scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight+100),'mobile scene really overflows the page');
  await swipe(page.locator('.parlor-table'));assert.ok(await page.evaluate(()=>window.scrollY)>0,'native touch scrolls the page from the card scene');
  for(const end of ['pointerup','pointercancel']){await caption().dispatchEvent('pointerdown',{pointerId:17,pointerType:'touch',button:0,isPrimary:true});await page.clock.fastForward(600);await caption().dispatchEvent('pointermove',{pointerId:17,clientY:20});await caption().dispatchEvent(end,{pointerId:17,pointerType:'touch'});}
  await page.clock.fastForward(600);assert.deepEqual({calls,scribe:scribeRequests.length,audio:await audioCount(),mic:await page.evaluate(()=>window.__micRequests)},scrollRequests,'scroll, held drag and cancellation never request a microphone, provider or advance');assert.equal(await page.locator('.is-revealed').count(),1);
  await stage().focus();await advance();await waitAudio(scrollRequests.audio);await finishAudio();assert.equal(await page.locator('.is-revealed').count(),2,'deliberate physical input still advances after scrolling');
  await cdp.detach();await escape();longNarration=false;await page.setViewportSize({width:1280,height:960});
  await page.getByLabel('Show operator controls while testing',{exact:true}).check();
  await begin();const n=await audioCount();await talk('Pause this reading',true);await waitAudio(n);await button('Pause reading').click();await button('Retry this step').waitFor();assert.ok(await page.evaluate(()=>window.__audioCleared>0));await button('Read without audio').click();await phase('ready').waitFor();
  const touchAudio=await audioCount();await talk('Intentional operator touch discussion','touch');await waitAudio(touchAudio);await finishAudio();await phase('ready').waitFor();
  const cancelledInput={calls,scribe:scribeRequests.length};
  for(const event of ['pointercancel','lostpointercapture']){const target=button('Hold to talk');await target.dispatchEvent('pointerdown',{pointerId:9,pointerType:'touch',button:0,isPrimary:true});await cue().getByText('Speak now.',{exact:true}).waitFor();await target.dispatchEvent(event,{pointerId:9,pointerType:'touch'});await target.dispatchEvent('pointerup',{pointerId:9,pointerType:'touch'});assert.deepEqual({calls,scribe:scribeRequests.length},cancelledInput);assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);}
  await page.locator('.parlor-sound-options summary').click();await page.getByLabel('Mute radio ambience',{exact:true}).check();assert.equal(await radioLevel(),0);
  const radioVolume=page.getByLabel('Radio ambience volume',{exact:true});await radioVolume.focus();await page.keyboard.press('End');assert.equal(await radioVolume.inputValue(),'100');assert.equal(await radioLevel(),0);assert.equal(await page.locator('.is-revealed').count(),1,'sound controls do not reset the reading');
  await page.getByLabel('Mute radio ambience',{exact:true}).uncheck();await page.waitForFunction(()=>window.__radioLevel()>0);assert.ok(await radioLevel()<=1);await page.locator('.parlor-sound-options summary').click();
  assert.equal(await page.locator('.is-revealed').count(),1);
  await stage().focus();await page.keyboard.down('Space');await cue().getByText('Speak now.',{exact:true}).waitFor();await escape();await page.keyboard.up('Space');assert.equal(await page.locator('.parlor-show').count(),0);
  await page.evaluate(()=>window.__radioUnavailable=true);await begin();await page.locator('.parlor-sound-options summary').click();await page.getByText('Radio ambience is unavailable. The reading continues.',{exact:true}).waitFor();await escape();await page.evaluate(()=>window.__radioUnavailable=false);
  // The explicit operator button retains only the reset exception while busy.
  // Late provider/audio callbacks after each five-tap reset must stay inert.
  for(const pendingKind of ['speech','inference','transcription','voice']){
    await begin();const busyAudio=await audioCount();
    if(pendingKind==='inference')mode='delay';if(pendingKind==='transcription')scribeMode='delay';if(pendingKind==='voice')ttsMode='delay';
    await talk('Reset during '+pendingKind,true);
    if(pendingKind==='speech')await waitAudio(busyAudio);
    if(pendingKind==='inference')await pending(()=>release);
    if(pendingKind==='transcription')await pending(()=>scribeRelease);
    if(pendingKind==='voice')await pending(()=>ttsRelease);
    await ignoredBusy();await ignoredBusy(true);
    await page.evaluate(()=>window.__busyCallbacks=[window.__audio?.onended,window.__audio?.ontimeupdate]);
    const countBeforeReset=await audioCount();
    for(let i=0;i<5;i++){await button('Hold to talk').dispatchEvent('pointerdown',{pointerId:21,pointerType:'touch',button:0,isPrimary:true});await button('Hold to talk').dispatchEvent('pointerup',{pointerId:21,pointerType:'touch'});}
    await idle();assert.equal(await radioLevel(),0);assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);
    release?.();release=null;scribeRelease?.();scribeRelease=null;ttsRelease?.();ttsRelease=null;mode=scribeMode=ttsMode='ok';
    await page.evaluate(()=>window.__busyCallbacks.forEach(fn=>fn?.()));await page.clock.fastForward(1200);await page.waitForTimeout(100);await idle();assert.equal(await audioCount(),countBeforeReset,'late work cannot resurrect reset');await escape();
  }
  await page.getByLabel('Show operator controls while testing',{exact:true}).uncheck();
  await begin();await stage().focus();await page.keyboard.down('Space');await cue().getByText('Speak now.',{exact:true}).waitFor();authenticated=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('Parlor access is restricted.',{exact:true}).waitFor();assert.equal(await page.locator('.parlor-show').count(),0);
  await page.clock.fastForward(100);assert.equal(await page.evaluate(()=>window.__radioContexts.every(c=>c.state==='closed')),true,'logout closes ambience contexts');
  assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);await page.keyboard.up('Space');assert.ok(speechRequests.length>=8);assert.ok(scribeRequests.length>=8);console.log('PASS: global tap/hold/five-tap reset, overlapping keys and repeat, no tap microphone access, late transcription/narration/reading fences, saved choices retained, setup exclusion, four artwork proportions on desktop/mobile, v3 selected voice and aligned captions, per-card discussion, explicit advance, held-only Scribe v2, native touch caption/page scrolling without encounter input, explicit operator touch and cancellation, busy keyboard/pointer lock with five-tap reset and no replay, MP4, denial/empty/error/cancellation, Escape/logout cleanup. Synthetic providers and microphone only.');
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:resolve(evidence,'failure.png'),fullPage:true});throw error;}
finally{release?.();scribeRelease?.();ttsRelease?.();await context?.close();await browser?.close();await new Promise(r=>server?.httpServer?server.httpServer.close(r):r());console.log('Cleanup: browser, context and local preview closed.');}
