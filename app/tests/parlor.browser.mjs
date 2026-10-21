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
const speechRequests=[],scribeRequests=[];let scribeMode='ok',scribeRelease;
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
const button=name=>page.getByRole('button',{name,exact:true});
const caption=()=>page.getByLabel('Narrator transcript',{exact:true});
async function finishAudio(){await page.evaluate(()=>{const a=window.__audio;a.currentTime=900;a.ontimeupdate?.();a.onended?.();});}
async function waitAudio(previous){await page.waitForFunction(n=>window.__audioCount>n,previous);}
async function audioCount(){return page.evaluate(()=>window.__audioCount);}
async function begin(){const n=await audioCount();await button('Start the show').click();await waitAudio(n);assert.equal(await page.locator('.parlor-card').count(),0);assert.equal(await caption().innerText(),'');await finishAudio();await button('Hold to talk').waitFor({state:'visible'});}
async function talk(text,control=false){
  const target=button('Hold to talk');await page.evaluate(text=>window.__utterance=text,text);
  const previousWords=await page.getByLabel('Your words',{exact:true}).innerText();
  if(control==='touch')await target.dispatchEvent('pointerdown',{pointerId:9,pointerType:'touch',button:0,isPrimary:true});
  else if(control){await target.focus();await page.keyboard.down(control==='enter'?'Enter':'Space');}else{await target.hover();await page.mouse.down();}
  await page.getByText('Recording while held. Release to transcribe.',{exact:true}).waitFor();
  const before=scribeRequests.length;await page.waitForTimeout(300);assert.equal(scribeRequests.length,before,'no upload while held');
  assert.equal(await page.getByLabel('Your words',{exact:true}).innerText(),previousWords,'batch transcript is not simulated while recording');
  if(control==='touch')await target.dispatchEvent('pointerup',{pointerId:9,pointerType:'touch',button:0,isPrimary:true});
  else if(control)await page.keyboard.up(control==='enter'?'Enter':'Space');else{await page.mouse.move(2,2);await page.mouse.up();}
  assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false,'release stops all tracks');
  if(scribeMode==='ok' && await page.evaluate(()=>window.__micMode!=='empty'))await page.waitForFunction(text=>document.querySelector('.parlor-user-transcript').textContent===text,text);
}
async function escape(){await page.keyboard.press('Escape');await button('Start the show').waitFor();assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Start the show');assert.equal(await page.locator('.parlor-card').count(),0);}
async function capture(name){await page.evaluate(()=>window.scrollTo(0,0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:resolve(evidence,name+'.png'),fullPage:true});}
try{
  await mkdir(evidence,{recursive:true});server=await preview({root,preview:{host:'127.0.0.1',port:4187,strictPort:true}});
  browser=await chromium.launch({headless:true,...(process.env.PARLOR_BROWSER?{executablePath:process.env.PARLOR_BROWSER}:{channel:'msedge'})});
  context=await browser.newContext({viewport:{width:1280,height:960},reducedMotion:'reduce',hasTouch:true});context.setDefaultTimeout(12000);
  await context.addInitScript(()=>{
    window.__audioCount=0;window.__audioPaused=0;window.__audioCleared=0;window.__micStarts=0;window.__micMode='ok';window.__utterance='';window.__tracks=[];window.__mimeType='audio/webm;codecs=opus';
    window.Audio=class{
      currentTime=0;
      constructor(){window.__audio=this;window.__audioCount++;}
      play(){queueMicrotask(()=>this.onplaying?.());return Promise.resolve();}
      pause(){window.__audioPaused++;}
      removeAttribute(){window.__audioCleared++;}load(){}
    };
    window.SpeechRecognition=class{constructor(){throw Error('No browser speech fallback allowed');}};
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async options=>{
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
      const text=identities?JSON.stringify({cards:identities.map(card=>({slug:card.slug,text:`${card.name} invites you to reflect on this position. Its authored meaning opens a possibility.`})),synthesis:'The cards invite reflection and a choice that remains yours.'}):'Stay with the meaning that resonates. What possibility does it open for you?';
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
      const characters=[...request.text];return json(route,{audio_base64:Buffer.from('synthetic audio').toString('base64'),alignment:{characters,character_start_times_seconds:characters.map((_,i)=>i*.025),character_end_times_seconds:characters.map((_,i)=>(i+1)*.025)}});
    }
    if(url.hostname!=='127.0.0.1')return route.abort();
    if(path==='/auth/session')return json(route,authenticated?{authenticated:true,accountId:'synthetic-owner',parlorAllowed:allowed,user:{email:'fixture@example.test'}}:{authenticated:false});
    if(path==='/api/parlor/capabilities')return json(route,{mode:'byok'});
    if(path==='/api/me/decks')return json(route,[deck]);
    if(path==='/api/decks/parlor-fixture')return json(route,deck);
    if(path.startsWith('/api/decks/parlor-fixture/artwork/assets/'))return json(route,{},404);
    if(path.startsWith('/api/decks/parlor-fixture/artwork'))return json(route,{enabled:true,deckRevision:1,packId:'saved-artwork',packs:[{id:'saved-artwork',label:'Saved artwork',cardCount:0,complete:false}],cards:[]});
    if(path.startsWith('/api/'))return json(route,{},404);
    return route.continue();
  });
  page=await context.newPage();await page.goto('http://127.0.0.1:4187/parlor');await page.getByText('Parlor access is restricted.',{exact:true}).waitFor();assert.equal(await page.locator('input[type=password]').count(),0);
  authenticated=true;allowed=false;await page.reload();await page.getByText('Parlor access is restricted.',{exact:true}).waitFor();assert.equal(await button('Parlor').count(),0);
  allowed=true;await page.reload();
  await page.getByLabel('Anthropic API key',{exact:true}).fill('synthetic-browser-key');await page.getByLabel('Anthropic model ID',{exact:true}).fill('synthetic-model');
  await page.getByLabel('ElevenLabs API key',{exact:true}).fill('synthetic-voice-key');await page.getByLabel('ElevenLabs voice ID',{exact:true}).fill('synthetic-selected-voice');await page.getByLabel('Remember keys on this device (plaintext)').check();
  await page.reload();assert.equal(await page.getByLabel('ElevenLabs voice ID',{exact:true}).inputValue(),'synthetic-selected-voice');assert.equal(await page.locator('textarea').count(),0);await capture('setup');
  const before=await audioCount();await button('Start the show').click();await waitAudio(before);assert.equal(calls,0);assert.equal(await caption().innerText(),'');assert.equal(await page.locator('.parlor-card').count(),0);
  await page.evaluate(()=>{window.__audio.currentTime=.2;window.__audio.ontimeupdate();});assert.ok((await caption().innerText()).length>0);assert.ok(!(await caption().innerText()).includes('Release it'));
  await page.waitForTimeout(150);assert.ok(!(await caption().innerText()).includes('Release it'));await finishAudio();
  const first=await audioCount();await talk('A synthetic spoken query');await waitAudio(first);assert.equal(await page.locator('.is-revealed').count(),1);assert.equal(await caption().innerText(),'');assert.equal(await button('Next card').count(),0);
  await finishAudio();await button('Next card').waitFor();await page.waitForTimeout(250);assert.equal(await page.locator('.is-revealed').count(),1);await capture('first-card-desktop');
  for(const text of ['Tell me more about this card','How does that connect to my question?']){const count=await audioCount();await talk(text,true);await waitAudio(count);assert.equal(await page.locator('.is-revealed').count(),1);assert.equal(await caption().innerText(),'');await finishAudio();await button('Next card').waitFor();}
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.__mimeType='audio/mp4');
  const mobile=await audioCount();await talk('A touch-controlled mobile discussion','touch');await waitAudio(mobile);await finishAudio();await button('Next card').waitFor();assert.match(scribeRequests.at(-1),/recording.m4a/);await capture('discussion-mobile');
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
  scribeMode='delay';await talk('A cancelled transcription',true);await button('Cancel transcription').waitFor();await page.waitForFunction(()=>document.querySelector('.parlor-status').textContent.includes('Transcribing'));assert.ok(scribeRelease);await button('Cancel transcription').click();scribeRelease();scribeRelease=null;scribeMode='ok';await page.waitForTimeout(150);assert.equal(calls,previousCalls);
  // Cancellation fences late LLM and late speech, preserves no guest data on return.
  mode='delay';const count=await audioCount();await talk('A delayed discussion',true);await page.waitForFunction(()=>document.querySelector('.parlor-status').textContent.includes('reflecting'));assert.ok(release);await escape();release();mode='ok';await page.waitForTimeout(150);assert.equal(await audioCount(),count);
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('synthetic spoken query')),false);
  await begin();const n=await audioCount();await talk('Pause this reading',true);await waitAudio(n);await button('Pause reading').click();await button('Retry this step').waitFor();assert.ok(await page.evaluate(()=>window.__audioCleared>0));await button('Read without audio').click();await button('Next card').waitFor();assert.equal(await page.locator('.is-revealed').count(),1);
  await button('Hold to talk').focus();await page.keyboard.down('Space');await page.getByText('Recording while held. Release to transcribe.',{exact:true}).waitFor();await escape();await page.keyboard.up('Space');assert.equal(await page.locator('.parlor-show').count(),0);
  await begin();await button('Hold to talk').focus();await page.keyboard.down('Space');await page.getByText('Recording while held. Release to transcribe.',{exact:true}).waitFor();authenticated=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('Parlor access is restricted.',{exact:true}).waitFor();assert.equal(await page.locator('.parlor-show').count(),0);
  assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);await page.keyboard.up('Space');assert.ok(speechRequests.length>=8);assert.ok(scribeRequests.length>=8);console.log('PASS: v3 selected voice, greeting before query, real-timestamp caption reveal, pointer release outside, keyboard hold/release, repeated per-card discussion, explicit advance/closing, Scribe v2 batch with held-only clips, touch/MP4 and Enter controls, denial, pending permission release, blur, empty clips, silence, provider errors, cancelled transcription, Escape/logout fences, audio cleanup and desktop/mobile layout. Synthetic providers and microphone only.');
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:resolve(evidence,'failure.png'),fullPage:true});throw error;}
finally{release?.();scribeRelease?.();await context?.close();await browser?.close();await new Promise(r=>server?.httpServer?server.httpServer.close(r):r());console.log('Cleanup: browser, context and local preview closed.');}
