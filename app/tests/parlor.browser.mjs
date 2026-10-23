// One browser/context/server. Every account/provider request and microphone is synthetic.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {preview} from 'vite';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright-core');
const data=JSON.parse(await readFile(resolve(root,'../decks/deep-time/deck.json'),'utf8'));
const deck={id:'parlor-fixture',slug:data.slug,name:data.name,tagline:'Synthetic browser fixture',revision:1,visibility:'private',createdAt:'',updatedAt:'',manifest:{data,tagline:'Synthetic fixture'}};
const evidence=resolve(root,'../..','parlor-conversation-verification');
let server,browser,context,page,authenticated=false,allowed=true,calls=0,mode='ok',release;
const speechRequests=[],scribeRequests=[];let scribeMode='ok',scribeRelease,ttsMode='ok',ttsRelease;
const artSizes=[[945,1663],[958,1642],[971,1619],[1024,1536]];let artIndex=0;const artFixtures=[];
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
const button=name=>page.getByRole('button',{name,exact:true});
const caption=()=>page.getByLabel('Narrator transcript',{exact:true});
async function finishAudio(){await page.evaluate(()=>{const a=window.__audio;a.currentTime=900;a.ontimeupdate?.();a.onended?.();});}
async function waitAudio(previous){await page.waitForFunction(n=>window.__audioCount>n,previous);}
async function audioCount(){return page.evaluate(()=>window.__audioCount);}
async function radio(mode){await page.locator(`.parlor-radio[data-mode="${mode}"]`).waitFor();}
async function pending(get){const end=Date.now()+5000;while(!get()&&Date.now()<end)await new Promise(r=>setTimeout(r,20));assert.ok(get(),'fixture request arrived');}
const idleText='Press and hold the button to make contact with the beyond';
async function idle(){await page.locator('.parlor-idle').waitFor();assert.equal((await page.locator('.parlor-show').innerText()).trim(),idleText);assert.equal(await page.locator('.parlor-card,.parlor-slot,.parlor-caption,.parlor-radio').count(),0);}
async function summon(finish=true){
  await idle();const n=await audioCount(),mic=await page.evaluate(()=>window.__micRequests);await page.keyboard.down('a');await page.locator('.parlor-summoning').waitFor();assert.equal(await page.locator('.parlor-slot').count(),3);
  await page.clock.fastForward(7000);await waitAudio(n);assert.match(speechRequests.at(-1).text,/release the button/);assert.equal(await page.evaluate(()=>window.__micRequests),mic);await finishAudio();await page.getByText('Release the button.',{exact:true}).waitFor();assert.equal(await audioCount(),n+1);
  await page.keyboard.up('a');await waitAudio(n+1);assert.match(speechRequests.at(-1).text,/I am the spirit/);assert.equal(await page.evaluate(()=>window.__micRequests),mic);assert.equal(await caption().innerText(),'');
  if(finish){await finishAudio();await button('Begin an open reading').waitFor();}
}
async function begin(){await button('Start the show').click();await summon();}
async function talk(text,control=false){
  const target=button('Hold to talk');await page.evaluate(text=>window.__utterance=text,text);
  const previousWords=await page.getByLabel('Your words',{exact:true}).innerText();
  if(control==='touch')await target.dispatchEvent('pointerdown',{pointerId:9,pointerType:'touch',button:0,isPrimary:true});
  else if(control){await target.focus();await page.keyboard.down(control==='enter'?'Enter':'Space');}else{await target.hover();await page.mouse.down();}
  await page.getByText('Recording while held. Release to transcribe.',{exact:true}).waitFor();
  await radio('listening');
  if(text==='A synthetic spoken query')await capture('radio-listening');
  const before=scribeRequests.length;await page.waitForTimeout(300);assert.equal(scribeRequests.length,before,'no upload while held');
  assert.equal(await page.getByLabel('Your words',{exact:true}).innerText(),previousWords,'batch transcript is not simulated while recording');
  if(control==='touch')await target.dispatchEvent('pointerup',{pointerId:9,pointerType:'touch',button:0,isPrimary:true});
  else if(control)await page.keyboard.up(control==='enter'?'Enter':'Space');else{await page.mouse.move(2,2);await page.mouse.up();}
  assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false,'release stops all tracks');
  if(scribeMode==='ok' && await page.evaluate(()=>window.__micMode!=='empty'))await page.waitForFunction(text=>document.querySelector('.parlor-user-transcript').textContent===text,text);
}
async function escape(){await page.keyboard.press('Escape');await button('Start the show').waitFor();assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Start the show');assert.equal(await page.locator('.parlor-card').count(),0);}
async function capture(name){await page.evaluate(()=>window.scrollTo(0,0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:resolve(evidence,name+'.png'),fullPage:true});}
async function tap(key='a'){await page.keyboard.press(key);}
async function resetEncounter(){const saved=await page.evaluate(()=>JSON.stringify(localStorage));const n=await audioCount();for(let i=0;i<5;i++)await tap();await idle();assert.equal(await audioCount(),n,'reset is silent');assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);assert.equal(await page.evaluate(()=>JSON.stringify(localStorage)),saved,'reset preserves saved keys and choices');}
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
      start(){this.state='recording';window.__micStarts++;queueMicrotask(()=>this.onstart?.());}
      stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(window.__micMode==='empty'?[]:['synthetic intentional recording'],{type:this.mimeType})});this.onstop?.();});}
    };
  });
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    if(url.hostname==='api.anthropic.com'||url.hostname==='api.openai.com'){
      calls++;if(mode==='error')return json(route,{},429);
      const request=route.request().postDataJSON(),prompt=request.messages.at(-1).content;
      const identities=prompt.includes('CARD IDENTITIES IN ORDER\n')?JSON.parse(prompt.split('CARD IDENTITIES IN ORDER\n')[1]):null;
      if(!identities)assert.doesNotMatch(JSON.stringify(request.messages),/\[(?:sighs|exhales|sarcastic|curious)\]/,'history has no delivery tags');
      const text=identities?JSON.stringify({cards:identities.map(card=>({slug:card.slug,text:`[sarcastic] ${card.name} invites you to reflect on this position. Its authored meaning opens a possibility.`})),synthesis:'The cards invite reflection and a choice that remains yours.'}):'[curious] Stay with the meaning that resonates. What possibility does it open for you?';
      if(mode==='delay')await new Promise(r=>release=r);
      return json(route,{content:[{type:'text',text}]});
    }
    if(url.hostname==='api.elevenlabs.io'){
      if(path==='/v1/speech-to-text'){
        assert.equal(route.request().method(),'POST');assert.equal(route.request().headers()['xi-api-key'],'synthetic-voice-key');
        const body=route.request().postDataBuffer().toString();assert.match(body,/name="model_id"\r\n\r\nscribe_v2/);assert.match(body,/synthetic intentional recording/);assert.match(body,/name="tag_audio_events"\r\n\r\nfalse/);scribeRequests.push(body);
        assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false,'tracks stopped before request');
        const text=await page.evaluate(()=>window.__utterance);if(scribeMode==='delay')await new Promise(r=>scribeRelease=r);
        return json(route,scribeMode==='error'?{detail:'synthetic error'}:{text:scribeMode==='silent'?'':text},scribeMode==='error'?401:200);
      }
      assert.equal(path,'/v1/text-to-speech/synthetic-selected-voice/with-timestamps');const request=route.request().postDataJSON();assert.equal(request.model_id,'eleven_v3');speechRequests.push(request);
      assert.ok((request.text.match(/\[[^\]]+\]/g)||[]).length<=1);if(ttsMode==='error')return json(route,{},503);
      if(ttsMode==='delay')await new Promise(r=>ttsRelease=r);
      const characters=[...request.text];return json(route,{audio_base64:Buffer.from('synthetic audio').toString('base64'),alignment:{characters,character_start_times_seconds:characters.map((_,i)=>i*.025),character_end_times_seconds:characters.map((_,i)=>(i+1)*.025)}});
    }
    if(url.hostname!=='127.0.0.1')return route.abort();
    if(path==='/auth/session')return json(route,authenticated?{authenticated:true,accountId:'synthetic-owner',parlorAllowed:allowed,user:{email:'fixture@example.test'}}:{authenticated:false});
    if(path==='/api/parlor/capabilities')return json(route,{mode:'byok'});
    if(path==='/api/me/decks')return json(route,[deck]);
    if(path==='/api/decks/parlor-fixture')return json(route,deck);
    if(path.startsWith('/api/decks/parlor-fixture/artwork/assets/'))return json(route,{},404);
    if(/^\/api\/decks\/parlor-fixture\/cards\/[^/]+\/artwork\/image$/.test(path))return route.fulfill({contentType:'image/webp',body:artFixtures[artIndex]});
    if(path.startsWith('/api/decks/parlor-fixture/artwork'))return json(route,{enabled:true,deckRevision:1,packId:'saved-artwork',packs:[{id:'saved-artwork',label:'Saved artwork',cardCount:Object.keys(data.cards).length,complete:true}],cards:Object.values(data.cards).map(card=>({slug:card.slug,name:card.name,artwork:{id:`synthetic-art-${artIndex}-${card.slug}`,deckId:deck.id,cardSlug:card.slug,packId:'saved-artwork',mediaType:'image/webp',width:artSizes[artIndex][0],height:artSizes[artIndex][1],byteLength:artFixtures[artIndex].length,integrity:'synthetic',deckRevision:1}}))});
    if(path.startsWith('/api/'))return json(route,{},404);
    return route.continue();
  });
  page=await context.newPage();await page.clock.install();
  for(const size of artSizes){const encoded=await page.evaluate(([w,h])=>{const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const c=canvas.getContext('2d');c.fillStyle='#30283d';c.fillRect(0,0,w,h);c.strokeStyle='#e9c98a';c.lineWidth=12;c.strokeRect(6,6,w-12,h-12);c.fillStyle='#f3c282';c.font='60px serif';c.fillText(`${w} x ${h}`,50,100);c.fillRect(0,h-50,w,50);return canvas.toDataURL('image/webp').split(',')[1];},size);artFixtures.push(Buffer.from(encoded,'base64'));}
  await page.goto('http://127.0.0.1:4187/parlor');await page.getByText('Parlor access is restricted.',{exact:true}).waitFor();assert.equal(await page.locator('input[type=password]').count(),0);
  authenticated=true;allowed=false;await page.reload();await page.getByText('Parlor access is restricted.',{exact:true}).waitFor();assert.equal(await button('Parlor').count(),0);
  allowed=true;await page.reload();
  await page.getByLabel('Anthropic API key',{exact:true}).fill('synthetic-browser-key');await page.getByLabel('Anthropic model ID',{exact:true}).fill('synthetic-model');
  await page.getByLabel('ElevenLabs API key',{exact:true}).fill('synthetic-voice-key');await page.getByLabel('ElevenLabs voice ID',{exact:true}).fill('synthetic-selected-voice');await page.getByLabel('Remember keys on this device (plaintext)').check();
  await page.reload();assert.equal(await page.getByLabel('ElevenLabs voice ID',{exact:true}).inputValue(),'synthetic-selected-voice');assert.equal(await page.locator('textarea').count(),0);await capture('setup');
  const before=await audioCount();await button('Start the show').click();await idle();assert.equal(await audioCount(),before);assert.equal(calls,0);
  // Early release, lost focus and pointer cancellation return to blank without voice or microphone.
  for(const cancel of ['release','blur','pointer']){
    if(cancel==='pointer')await button('Summon the spirit').dispatchEvent('pointerdown',{pointerId:9,pointerType:'touch',button:0,isPrimary:true});else await page.keyboard.down('a');
    await page.locator('.parlor-summoning').waitFor();await radio('tuning');assert.equal(await page.locator('.parlor-slot').count(),3);assert.equal(await page.locator('.radio-needle').evaluate(el=>getComputedStyle(el).animationName),'none');assert.equal(await page.locator('.parlor-radio').evaluate(el=>el.style.getPropertyValue('--contact')),'0');
    if(cancel==='pointer')await button('Summon the spirit').dispatchEvent('pointercancel',{pointerId:9});else if(cancel==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    if(cancel!=='pointer')await page.keyboard.up('a');await idle();await page.clock.fastForward(7100);assert.equal(await audioCount(),before);assert.equal(await page.evaluate(()=>window.__micRequests),0);
  }
  await page.emulateMedia({reducedMotion:'no-preference'});await page.keyboard.down('a');await radio('tuning');
  const progress=()=>page.locator('.parlor-radio').evaluate(el=>Number(el.style.getPropertyValue('--contact')));
  assert.ok(await progress()<.15);await page.clock.fastForward(3300);const halfway=await progress();assert.ok(halfway>.4&&halfway<.65);await capture('radio-summon-halfway');
  await page.clock.fastForward(2900);assert.ok(await progress()>.85);assert.equal(await audioCount(),before);await capture('radio-summon-near-contact');await page.keyboard.up('a');await idle();
  await page.keyboard.down('a');await radio('tuning');assert.ok(await progress()<.15,'new summon starts at zero');await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);await page.clock.fastForward(1000);await page.waitForFunction(()=>document.querySelector('.parlor-radio').style.getPropertyValue('--contact')==='0');await capture('radio-reduced-tuning');await page.keyboard.up('a');await idle();
  const cue=await audioCount();await page.keyboard.down('a');await page.clock.fastForward(7000);await waitAudio(cue);await page.evaluate(()=>window.__oldCue=window.__audio.onended);await page.keyboard.up('a');await resetEncounter();await page.evaluate(()=>window.__oldCue?.());await idle();assert.equal(await audioCount(),cue+1,'reset cancels introduction after a late release cue');
  // Release-cue failure can be retried by a deliberate tap without enabling a microphone.
  ttsMode='error';await page.keyboard.down('a');await page.clock.fastForward(7000);await page.getByRole('alert').filter({hasText:'Audio is unavailable'}).waitFor();await radio('stopped');await capture('radio-error');await page.keyboard.up('a');ttsMode='ok';const retryCue=await audioCount();await tap();await page.clock.fastForward(500);await waitAudio(retryCue);await finishAudio();await waitAudio(retryCue+1);await finishAudio();await button('Begin an open reading').waitFor();assert.equal(await page.evaluate(()=>window.__micRequests),0);await resetEncounter();
  await capture('idle-contact');await summon(false);assert.equal(await page.locator('.parlor-card').count(),0);
  await page.evaluate(()=>{window.__audio.currentTime=.5;window.__audio.ontimeupdate();});assert.ok((await caption().innerText()).length>0);assert.ok(!(await caption().innerText()).includes('speak your question'));assert.ok(!(await caption().innerText()).includes('['));
  await page.waitForTimeout(150);assert.ok(!(await caption().innerText()).includes('speak your question'));await page.keyboard.down('b');await finishAudio();await page.clock.fastForward(500);assert.equal(await page.evaluate(()=>window.__micRequests),0,'a hold started during introduction cannot turn into recording');await page.keyboard.up('b');
  const first=await audioCount();mode='delay';await talk('A synthetic spoken query');await radio('searching');await pending(()=>release);assert.equal(await caption().innerText(),'');
  await page.emulateMedia({reducedMotion:'no-preference'});assert.equal(await page.locator('.radio-needle').evaluate(el=>getComputedStyle(el).animationName),'radio-search');await capture('radio-inference-search');assert.equal(await progress(),0,'no invented inference percent');
  for(const viewport of [{width:1280,height:720},{width:390,height:844}]){await page.setViewportSize(viewport);await capture(`radio-search-${viewport.width}`);}await page.setViewportSize({width:1280,height:960});
  ttsMode='delay';release();release=null;mode='ok';await pending(()=>ttsRelease);await page.getByText('Finding the voice',{exact:true}).waitFor();await radio('searching');assert.equal(await page.locator('.is-revealed').count(),0);assert.equal(await caption().innerText(),'');await capture('radio-voice-search');
  await page.emulateMedia({reducedMotion:'reduce'});assert.deepEqual(await page.locator('.radio-needle,.radio-wave,.parlor-radio-halo').evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).animationName)),['none','none','none']);await capture('radio-reduced-search');ttsRelease();ttsRelease=null;ttsMode='ok';await waitAudio(first);await radio('speaking');assert.equal(await page.locator('.is-revealed').count(),1);assert.equal(await caption().innerText(),'');assert.equal(await button('Next card').count(),0);await capture('radio-speaking');
  await page.evaluate(()=>window.__audio.onwaiting());await radio('searching');assert.equal(await caption().innerText(),'');await page.evaluate(()=>window.__audio.onplaying());await radio('speaking');
  await finishAudio();await button('Next card').waitFor();await page.waitForTimeout(250);assert.equal(await page.locator('.is-revealed').count(),1);await artwork();await capture('first-card-desktop');
  for(const text of ['Tell me more about this card','How does that connect to my question?']){const count=await audioCount();await talk(text,true);await waitAudio(count);assert.equal(await page.locator('.is-revealed').count(),1);assert.equal(await caption().innerText(),'');await finishAudio();await button('Next card').waitFor();}
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.__mimeType='audio/mp4');
  const mobile=await audioCount();await talk('A touch-controlled mobile discussion','touch');await waitAudio(mobile);await finishAudio();await button('Next card').waitFor();assert.match(scribeRequests.at(-1),/recording.m4a/);await artwork();await capture('discussion-mobile');
  await page.evaluate(()=>window.__mimeType='audio/webm;codecs=opus');await page.setViewportSize({width:1280,height:960});
  for(let revealed=2;revealed<=3;revealed++){const count=await audioCount();await button('Next card').click();await waitAudio(count);assert.equal(await page.locator('.is-revealed').count(),revealed);await finishAudio();}
  await button('Hear the closing').waitFor();const closing=await audioCount();await button('Hear the closing').click();await waitAudio(closing);await finishAudio();assert.equal(await button('Next card').count(),0);
  // Permission denial, pending permission, blur and cancelled gestures never upload.
  let previousCalls=calls,previousScribe=scribeRequests.length;await page.evaluate(()=>window.__micMode='denied');await button('Hold to talk').focus();await page.keyboard.down('Space');await page.getByRole('alert').filter({hasText:'Microphone access was denied'}).waitFor();await page.keyboard.up('Space');assert.equal(calls,previousCalls);
  const starts=await page.evaluate(()=>window.__micStarts);await page.evaluate(()=>window.__micMode='pending');await button('Hold to talk').focus();await page.keyboard.down('Space');await page.waitForFunction(()=>!!window.__grant);await page.keyboard.up('Space');await page.evaluate(()=>window.__grant());assert.equal(await page.evaluate(()=>window.__micStarts),starts);assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);
  await page.evaluate(()=>window.__micMode='ok');await button('Hold to talk').focus();await page.keyboard.down('Space');await page.getByText('Recording while held. Release to transcribe.',{exact:true}).waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('Space');assert.equal(calls,previousCalls);assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);
  for(const event of ['pointercancel','lostpointercapture']){await button('Hold to talk').hover();await page.mouse.down();await page.getByText('Recording while held. Release to transcribe.',{exact:true}).waitFor();await button('Hold to talk').dispatchEvent(event,{pointerId:1,pointerType:'mouse'});await page.mouse.up();assert.equal(calls,previousCalls);assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);}
  await button('Hold to talk').focus();await page.keyboard.down('Space');await page.getByText('Recording while held. Release to transcribe.',{exact:true}).waitFor();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});await page.keyboard.up('Space');assert.equal(calls,previousCalls);assert.equal(scribeRequests.length,previousScribe);assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);
  await page.evaluate(()=>window.__micMode='empty');await talk('This clip is empty','enter');await page.getByRole('alert').filter({hasText:'No audio was captured'}).waitFor();assert.equal(scribeRequests.length,previousScribe);
  await page.evaluate(()=>window.__micMode='ok');scribeMode='silent';await talk('No speech',true);await page.getByRole('alert').filter({hasText:'No speech was heard'}).waitFor();assert.equal(calls,previousCalls);
  scribeMode='error';await talk('A transcription error',true);await page.getByRole('alert').filter({hasText:'Scribe could not transcribe'}).waitFor();assert.equal(calls,previousCalls);
  scribeMode='delay';await talk('A cancelled transcription',true);await button('Cancel transcription').waitFor();await page.waitForFunction(()=>document.querySelector('.parlor-status').textContent.includes('Transcribing'));await radio('searching');await capture('radio-transcription');assert.ok(scribeRelease);await button('Cancel transcription').click();scribeRelease();scribeRelease=null;scribeMode='ok';await radio('waiting');await page.waitForTimeout(150);assert.equal(calls,previousCalls);
  // Global table controls need no button focus. Five taps never leak an advance or recording.
  await page.getByLabel('Interactive reading',{exact:true}).focus();const requestsBefore=await page.evaluate(()=>window.__micRequests);const callsBefore=calls;
  await resetEncounter();assert.equal(calls,callsBefore);assert.equal(await page.evaluate(()=>window.__micRequests),requestsBefore);assert.equal(await page.locator('.parlor-show textarea,.parlor-show input').count(),0);await summon();
  const openAudio=await audioCount();await tap();await waitAudio(openAudio);assert.equal(await page.locator('.is-revealed').count(),1);assert.equal(await page.evaluate(()=>window.__micRequests),requestsBefore);
  // A busy tap cannot execute later just because speech completed inside its timeout.
  await tap();await finishAudio();await page.waitForTimeout(600);assert.equal(await page.locator('.is-revealed').count(),1);
  const heldStarts=await page.evaluate(()=>window.__micStarts);await page.evaluate(()=>window.__utterance='Overlapping keyboard discussion');
  await page.keyboard.down('a');await page.keyboard.down('b');await page.keyboard.down('a');await page.getByText('Recording while held. Release to transcribe.',{exact:true}).waitFor();await page.waitForTimeout(300);await page.keyboard.up('a');assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),true,'second key keeps intentional gesture held');await page.keyboard.up('b');await page.waitForFunction(()=>document.querySelector('.parlor-user-transcript').textContent==='Overlapping keyboard discussion');assert.equal(await page.evaluate(()=>window.__micStarts),heldStarts+1);await page.waitForFunction(()=>document.querySelector('.parlor-status').textContent==='Listen…');await finishAudio();
  const nextAudio=await audioCount();await tap('c');await waitAudio(nextAudio);assert.equal(await page.locator('.is-revealed').count(),2);
  // Reset during audio clears cards/history; captured callbacks cannot revive that reading.
  await page.evaluate(()=>window.__oldCallbacks=[window.__audio.onended,window.__audio.ontimeupdate]);await resetEncounter();await page.evaluate(()=>window.__oldCallbacks.forEach(fn=>fn?.()));await page.waitForTimeout(600);assert.equal(await page.locator('.parlor-card').count(),0);
  ttsMode='delay';const cancelledVoice=await audioCount();await page.keyboard.down('a');await page.clock.fastForward(7000);await pending(()=>ttsRelease);await radio('searching');await page.keyboard.up('a');await resetEncounter();ttsRelease();ttsRelease=null;ttsMode='ok';await page.waitForTimeout(150);await idle();assert.equal(await audioCount(),cancelledVoice,'late TTS response cannot revive the apparatus or player');
  await summon();scribeMode='delay';const resetCalls=calls;await talk('Old guest transcription',true);await button('Cancel transcription').waitFor();await page.getByLabel('Interactive reading',{exact:true}).focus();await resetEncounter();scribeRelease();scribeRelease=null;scribeMode='ok';await page.waitForTimeout(200);assert.equal(calls,resetCalls);assert.equal(await page.locator('.parlor-card').count(),0);
  await summon();mode='delay';await talk('Old guest reading',true);await page.waitForFunction(()=>document.querySelector('.parlor-status').textContent.includes('gathering'));await resetEncounter();release();release=null;mode='ok';await page.waitForTimeout(200);assert.equal(await page.locator('.parlor-card').count(),0);
  // Genuine decoded WebP fixtures at all four observed source sizes, desktop/projector and phone.
  await escape();for(artIndex=0;artIndex<artSizes.length;artIndex++){
    await page.reload();assert.equal(await page.getByLabel('ElevenLabs voice ID',{exact:true}).inputValue(),'synthetic-selected-voice');
    const setupMic=await page.evaluate(()=>window.__micRequests);await page.getByLabel('ElevenLabs voice ID',{exact:true}).focus();for(let i=0;i<5;i++)await page.keyboard.press('ArrowLeft');await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>window.__micRequests),setupMic);assert.equal(await page.locator('.parlor-show').count(),0);
    await begin();const sizeAudio=await audioCount();await tap();await waitAudio(sizeAudio);await finishAudio();
    for(const viewport of [{width:1280,height:720},{width:390,height:844}]){await page.setViewportSize(viewport);await artwork();await capture(`artwork-${artSizes[artIndex].join('x')}-${viewport.width}`);}
    await page.setViewportSize({width:1280,height:960});await escape();
  }artIndex=0;await begin();const resumed=await audioCount();await talk('A new guest',true);await waitAudio(resumed);await finishAudio();
  // Cancellation fences late LLM and late speech, preserves no guest data on return.
  mode='delay';const count=await audioCount();await talk('A delayed discussion',true);await page.waitForFunction(()=>document.querySelector('.parlor-status').textContent.includes('reflecting'));assert.ok(release);await escape();release();mode='ok';await page.waitForTimeout(150);assert.equal(await audioCount(),count);
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('synthetic spoken query')),false);
  await begin();const n=await audioCount();await talk('Pause this reading',true);await waitAudio(n);await button('Pause reading').click();await button('Retry this step').waitFor();assert.ok(await page.evaluate(()=>window.__audioCleared>0));await button('Read without audio').click();await button('Next card').waitFor();assert.equal(await page.locator('.is-revealed').count(),1);
  await button('Hold to talk').focus();await page.keyboard.down('Space');await page.getByText('Recording while held. Release to transcribe.',{exact:true}).waitFor();await escape();await page.keyboard.up('Space');assert.equal(await page.locator('.parlor-show').count(),0);
  await begin();await button('Hold to talk').focus();await page.keyboard.down('Space');await page.getByText('Recording while held. Release to transcribe.',{exact:true}).waitFor();authenticated=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('Parlor access is restricted.',{exact:true}).waitFor();assert.equal(await page.locator('.parlor-show').count(),0);
  assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);await page.keyboard.up('Space');assert.ok(speechRequests.length>=8);assert.ok(scribeRequests.length>=8);console.log('PASS: global tap/hold/five-tap reset, overlapping keys and repeat, no tap microphone access, late transcription/narration/reading fences, saved choices retained, setup exclusion, four artwork proportions on desktop/mobile, v3 selected voice and aligned captions, per-card discussion, explicit advance, held-only Scribe v2, touch/MP4, denial/empty/error/cancellation, Escape/logout cleanup. Synthetic providers and microphone only.');
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:resolve(evidence,'failure.png'),fullPage:true});throw error;}
finally{release?.();scribeRelease?.();ttsRelease?.();await context?.close();await browser?.close();await new Promise(r=>server?.httpServer?server.httpServer.close(r):r());console.log('Cleanup: browser, context and local preview closed.');}
