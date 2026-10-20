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
const speechRequests=[];
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
const button=name=>page.getByRole('button',{name,exact:true});
const caption=()=>page.getByLabel('Narrator transcript',{exact:true});
async function finishAudio(){await page.evaluate(()=>{const a=window.__audio;a.currentTime=900;a.ontimeupdate?.();a.onended?.();});}
async function waitAudio(previous){await page.waitForFunction(n=>window.__audioCount>n,previous);}
async function audioCount(){return page.evaluate(()=>window.__audioCount);}
async function begin(){const n=await audioCount();await button('Start the show').click();await waitAudio(n);assert.equal(await page.locator('.parlor-card').count(),0);assert.equal(await caption().innerText(),'');await finishAudio();await button('Hold to talk').waitFor({state:'visible'});}
async function talk(text,keyboard=false){
  const target=button('Hold to talk');await page.evaluate(text=>window.__utterance=text,text);
  if(keyboard){await target.focus();await page.keyboard.down('Space');}else{await target.hover();await page.mouse.down();}
  await page.getByText('Listening on this device… release to send.',{exact:true}).waitFor();
  await page.evaluate(()=>window.__mic.onresult({results:[{isFinal:false,0:{transcript:window.__utterance}}]}));
  assert.equal(await page.getByLabel('Your words',{exact:true}).innerText(),text);
  if(keyboard)await page.keyboard.up('Space');else{await page.mouse.move(2,2);await page.mouse.up();}
}
async function escape(){await page.keyboard.press('Escape');await button('Start the show').waitFor();assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Start the show');assert.equal(await page.locator('.parlor-card').count(),0);}
async function capture(name){await page.evaluate(()=>window.scrollTo(0,0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:resolve(evidence,name+'.png'),fullPage:true});}
try{
  await mkdir(evidence,{recursive:true});server=await preview({root,preview:{host:'127.0.0.1',port:4187,strictPort:true}});
  browser=await chromium.launch({headless:true,...(process.env.PARLOR_BROWSER?{executablePath:process.env.PARLOR_BROWSER}:{channel:'msedge'})});
  context=await browser.newContext({viewport:{width:1280,height:960},reducedMotion:'reduce'});context.setDefaultTimeout(12000);
  await context.addInitScript(()=>{
    window.__audioCount=0;window.__audioPaused=0;window.__audioCleared=0;window.__micAborted=0;window.__micStarts=0;window.__micMode='ok';window.__availability='available';window.__utterance='';
    window.Audio=class{
      currentTime=0;
      constructor(){window.__audio=this;window.__audioCount++;}
      play(){queueMicrotask(()=>this.onplaying?.());return Promise.resolve();}
      pause(){window.__audioPaused++;}
      removeAttribute(){window.__audioCleared++;}load(){}
    };
    window.SpeechRecognition=class{
      processLocally=false;
      static async available(options){if(!options.processLocally)throw Error('Remote recognition forbidden');return window.__availability;}
      static async install(options){if(!options.processLocally)throw Error('Remote install forbidden');window.__availability='available';return true;}
      constructor(){window.__mic=this;}
      start(){if(!this.processLocally)throw Error('Remote recognition forbidden');window.__micStarts++;if(window.__micMode==='denied')queueMicrotask(()=>this.onerror?.({error:'not-allowed'}));else if(window.__micMode!=='pending')queueMicrotask(()=>this.onstart?.());}
      stop(){queueMicrotask(()=>{this.onresult?.({results:[{isFinal:true,0:{transcript:window.__utterance}}]});this.onend?.();});}
      abort(){window.__micAborted++;}
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
  await page.setViewportSize({width:390,height:844});await capture('discussion-mobile');await page.setViewportSize({width:1280,height:960});
  for(let revealed=2;revealed<=3;revealed++){const count=await audioCount();await button('Next card').click();await waitAudio(count);assert.equal(await page.locator('.is-revealed').count(),revealed);await finishAudio();}
  await button('Hear the closing').waitFor();const closing=await audioCount();await button('Hear the closing').click();await waitAudio(closing);await finishAudio();assert.equal(await button('Next card').count(),0);
  // Permission denial and early release cannot submit or leave background recording.
  let previousCalls=calls;await page.evaluate(()=>window.__micMode='denied');await button('Hold to talk').focus();await page.keyboard.down('Space');await page.getByRole('alert').filter({hasText:'Microphone access was denied'}).waitFor();await page.keyboard.up('Space');assert.equal(calls,previousCalls);
  await page.evaluate(()=>window.__micMode='pending');await button('Hold to talk').focus();await page.keyboard.down('Space');await page.waitForFunction(()=>window.__mic.onstart!==null);await page.evaluate(()=>window.__lateStart=window.__mic.onstart);await page.keyboard.up('Space');await page.evaluate(()=>window.__lateStart());assert.equal(calls,previousCalls);assert.equal(await page.getByText('Listening on this device… release to send.',{exact:true}).count(),0);
  await page.evaluate(()=>window.__micMode='ok');await button('Hold to talk').focus();await page.keyboard.down('Space');await page.getByText('Listening on this device… release to send.',{exact:true}).waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('Space');assert.equal(calls,previousCalls);assert.ok(await page.evaluate(()=>window.__micAborted>0));
  for(const event of ['pointercancel','lostpointercapture']){await button('Hold to talk').hover();await page.mouse.down();await page.getByText('Listening on this device… release to send.',{exact:true}).waitFor();await button('Hold to talk').dispatchEvent(event,{pointerId:1,pointerType:'mouse'});await page.mouse.up();assert.equal(calls,previousCalls);assert.equal(await page.getByText('Listening on this device… release to send.',{exact:true}).count(),0);}
  await button('Hold to talk').focus();await page.keyboard.down('Space');await page.getByText('Listening on this device… release to send.',{exact:true}).waitFor();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});await page.keyboard.up('Space');assert.equal(calls,previousCalls);assert.equal(await page.getByText('Listening on this device… release to send.',{exact:true}).count(),0);
  await page.evaluate(()=>window.__availability='downloadable');await button('Hold to talk').focus();await page.keyboard.down('Space');await page.keyboard.up('Space');await button('Download local speech language pack').waitFor();await button('Download local speech language pack').click();assert.equal(calls,previousCalls);
  // Cancellation fences late LLM and late speech, preserves no guest data on return.
  mode='delay';const count=await audioCount();await talk('A delayed discussion',true);await page.waitForFunction(()=>document.querySelector('.parlor-status').textContent.includes('reflecting'));assert.ok(release);await escape();release();mode='ok';await page.waitForTimeout(150);assert.equal(await audioCount(),count);
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('synthetic spoken query')),false);
  await begin();const n=await audioCount();await talk('Pause this reading',true);await waitAudio(n);await button('Pause reading').click();await button('Retry this step').waitFor();assert.ok(await page.evaluate(()=>window.__audioCleared>0));await button('Read without audio').click();await button('Next card').waitFor();assert.equal(await page.locator('.is-revealed').count(),1);
  await button('Hold to talk').focus();await page.keyboard.down('Space');await page.getByText('Listening on this device… release to send.',{exact:true}).waitFor();await escape();await page.keyboard.up('Space');assert.equal(await page.locator('.parlor-show').count(),0);
  await begin();authenticated=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('Parlor access is restricted.',{exact:true}).waitFor();assert.equal(await page.locator('.parlor-show').count(),0);
  assert.ok(speechRequests.length>=8);console.log('PASS: v3 selected voice, greeting before query, real-timestamp caption reveal, pointer release outside, keyboard hold/release, repeated per-card discussion, explicit advance/closing, denial, early release, blur, language download, Escape/logout fences, audio cleanup and desktop/mobile layout. Synthetic providers and microphone only.');
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:resolve(evidence,'failure.png'),fullPage:true});throw error;}
finally{release?.();await context?.close();await browser?.close();await new Promise(r=>server?.httpServer?server.httpServer.close(r):r());console.log('Cleanup: browser, context and local preview closed.');}
