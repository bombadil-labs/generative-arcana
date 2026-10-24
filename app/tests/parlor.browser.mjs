// One browser/context/server. Every account/provider request and microphone is synthetic.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {preview} from 'vite';
import ts from 'typescript';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const silentExports={};new Function('exports',ts.transpileModule(await readFile(resolve(root,'src/parlor/silentReading.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(silentExports);
const ownerMode=process.env.PARLOR_OWNER_BROWSER==='1';
const transcriptMode=process.env.PARLOR_TRANSCRIPT_BROWSER==='1';
const transcriptRequests=[];let transcriptStarts=0;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright-core');
const data=JSON.parse(await readFile(resolve(root,'../decks/deep-time/deck.json'),'utf8'));
const deck={id:'parlor-fixture',slug:data.slug,name:data.name,tagline:'Synthetic browser fixture',revision:1,visibility:'private',createdAt:'',updatedAt:'',manifest:{data,tagline:'Synthetic fixture'}};
const evidence=resolve(root,'../..','parlor-conversation-verification');
let server,browser,context,page,authenticated=false,allowed=true,calls=0,mode='ok',release;
const speechRequests=[],scribeRequests=[],scribeTypes=[],languageRequests=[];let scribeMode='ok',scribeRelease,ttsMode='ok',ttsRelease;
const artSizes=[[945,1663],[958,1642],[971,1619],[1024,1536]];let artIndex=0,longNarration=false;const artFixtures=[],artRequests=[];
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
const button=name=>page.getByRole('button',{name,exact:true});
const stage=()=>page.getByLabel('Interactive reading',{exact:true});
const phase=state=>page.locator('.parlor-ritual[data-phase="'+state+'"]');
const cue=()=>page.getByLabel('Table instructions',{exact:true});
async function advance(){await tap();await page.clock.fastForward(500);}
const caption=()=>page.getByLabel('Narrator transcript',{exact:true});
async function finishAudio(){await page.evaluate(()=>{const a=window.__audio;a.currentTime=900;a.ontimeupdate?.();a.onended?.();});}
async function finishSilent(){
  const pages=[];await page.locator('.parlor-caption.is-silent').waitFor();await page.waitForFunction(()=>document.querySelector('.parlor-caption').textContent.trim());await page.waitForTimeout(50);
  for(let i=0;i<100;i++){
    if(!['calling','speaking'].includes(await stage().getAttribute('data-phase')))break;
    const shown=await caption().textContent();assert.ok(shown.trim());pages.push(shown.trim());
    const bounds=await caption().evaluate(el=>{
      const box=el.getBoundingClientRect(),node=el.firstElementChild.firstChild,range=document.createRange();
      // pre-wrap may hang invisible trailing spaces beyond a line. Measure the
      // actual words, including every rectangle of a wrapped unbroken word.
      const words=[...node.textContent.matchAll(/\S+/gu)].flatMap(match=>{range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);return [...range.getClientRects()].map(r=>r.toJSON());});
      return {fits:words.every(r=>r.top>=box.top-1&&r.bottom<=box.bottom+1&&r.left>=box.left-1&&r.right<=box.right+1)&&getComputedStyle(el).maskImage==='none',box:box.toJSON(),words,font:getComputedStyle(el).font};
    });
    assert.equal(bounds.fits,true,'every silent page is fully visible, including its first and last lines: '+JSON.stringify(bounds));
    await page.clock.fastForward(silentExports.silentPageMs(shown)+500);await page.waitForTimeout(10);
  }
  assert.ok(!['calling','speaking'].includes(await stage().getAttribute('data-phase')),'silent presentation eventually finishes');
  assert.equal(await page.locator('[data-silent-measure]').count(),0,'finished presentation removes measurement resources');return pages;
}
async function waitAudio(previous){await page.waitForFunction(n=>window.__audioCount>n,previous);}
async function audioCount(){return page.evaluate(()=>window.__audioCount);}
async function radioLevel(){return page.evaluate(()=>window.__radioLevel());}
async function radio(mode){await page.locator(`.parlor-radio[data-mode="${mode}"]`).waitFor();}
async function pending(get){const end=Date.now()+5000;while(!get()&&Date.now()<end)await new Promise(r=>setTimeout(r,20));assert.ok(get(),'fixture request arrived');}
const idleText='Press and hold the button to make contact with the beyond';
async function idle(){await page.locator('.parlor-idle').waitFor();assert.equal((await page.locator('.parlor-show').innerText()).trim(),idleText+'\n\nThree button presses to learn about the deck, five to reset the reading');assert.equal(await page.locator('.parlor-card,.parlor-slot,.parlor-caption,.parlor-radio').count(),0);}
async function summon(finish=true){
  await idle();const n=await audioCount(),mic=await page.evaluate(()=>window.__micRequests);await pressA();await page.locator('.parlor-summoning').waitFor();assert.equal(await page.locator('.parlor-slot').count(),3);
  await page.clock.fastForward(7000);await waitAudio(n);assert.match(speechRequests.at(-1).text,/signal holds/);assert.doesNotMatch(speechRequests.at(-1).text,/button|release|press|tap|click|reset|advance/i);assert.equal(await page.evaluate(()=>window.__micRequests),mic);await cue().getByText('Keep holding.',{exact:true}).waitFor();await finishAudio();await page.getByText('Release the button.',{exact:true}).waitFor();assert.equal(await audioCount(),n+1);
  await page.keyboard.up('a');await waitAudio(n+1);assert.match(speechRequests.at(-1).text,/I am the spirit of the ether/);assert.doesNotMatch(speechRequests.at(-1).text,/button|press|hold|release|tap|click|reset|advance|cards|deck|spread/i);assert.equal(await page.evaluate(()=>window.__micRequests),mic);assert.equal(await caption().innerText(),'');
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
async function pressA(){await page.keyboard.down('a');if(await page.locator('.parlor-idle').count())await page.clock.fastForward(300);}
async function tap(key='a'){await page.keyboard.press(key);}
async function openGuide(){for(let i=0;i<3;i++)await tap();await page.clock.fastForward(500);await page.getByRole('dialog').waitFor();await page.waitForFunction(()=>document.querySelector('.parlor-introduction-text')?.textContent.trim());}
async function closeGuide(){await tap();await page.clock.fastForward(500);await page.getByRole('dialog').waitFor({state:'detached'});}
async function guideFits(){
  const result=await page.locator('.parlor-introduction-text').evaluate(el=>{
    const box=el.getBoundingClientRect(),node=el.firstChild,range=document.createRange();
    const words=[...node.textContent.matchAll(/\S+/gu)].flatMap(match=>{range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);return [...range.getClientRects()].map(r=>r.toJSON());});
    const dialog=el.closest('[role=dialog]').getBoundingClientRect(),cue=document.querySelector('.parlor-introduction-cue').getBoundingClientRect(),footer=document.querySelector('.parlor-shortcut-note').getBoundingClientRect();
    return {fits:words.every(r=>r.top>=box.top-1&&r.bottom<=box.bottom+1&&r.left>=box.left-1&&r.right<=box.right+1),box:box.toJSON(),dialog:dialog.toJSON(),cue:cue.toJSON(),footer:footer.toJSON(),height:innerHeight,font:parseFloat(getComputedStyle(el).fontSize),scroll:document.documentElement.scrollHeight};
  });
  assert.ok(result.fits,'all introduction words are visible: '+JSON.stringify(result));assert.ok(result.font>=19);assert.ok(result.dialog.y>=0&&result.dialog.bottom<=result.footer.y);assert.ok(result.cue.bottom<=result.dialog.bottom&&result.cue.top>=result.box.bottom);assert.ok(result.footer.bottom<=result.height);assert.ok(result.scroll<=result.height+1);return result;
}
async function frameLabels(){
  // Compare settled geometry; the prior footprint remains reserved while its
  // transform is in flight so returning captions cannot cover a settling card.
  await page.waitForFunction(()=>{const focused=document.querySelector('figure.is-focused'),stage=document.querySelector('.parlor-spread-stage');return focused?Math.abs(new DOMMatrix(getComputedStyle(focused).transform).a-1.6)<.00001:!stage.classList.contains('reserves-focus');});
  assert.deepEqual(await page.locator('.parlor-slot-labels span').allTextContents(),['Past','Present','Future']);
  const geometry=await page.locator('.parlor-slot-labels').evaluate(el=>{
    const rect=n=>n.getBoundingClientRect().toJSON(),table=document.querySelector('.parlor-table');
    return {row:rect(el),labels:[...el.children].map(n=>({box:rect(n),text:n.textContent,font:parseFloat(getComputedStyle(n).fontSize),scroll:n.scrollWidth})),table:rect(table),stage:rect(table.closest('.parlor-card-area')),caption:rect(document.querySelector('.parlor-caption')),focus:document.querySelector('figure.is-focused')&&rect(document.querySelector('figure.is-focused')),width:innerWidth,height:innerHeight};
  });
  assert.ok(Math.abs(geometry.table.y+geometry.table.height/2-(geometry.stage.y+geometry.stage.height/2))<1,'small spread is vertically centered behind the focused artwork');
  const edge=Math.max(geometry.table.bottom,geometry.focus?.bottom??0),gap=geometry.row.y-edge;
  assert.ok(gap>=5&&gap<=7,'labels follow the actual occupied artwork edge by 6px, not a tall viewport band: '+JSON.stringify({gap,geometry}));
  assert.ok(geometry.row.bottom<=geometry.caption.y+1,'labels cannot overlap spoken captions');
  if(geometry.focus)assert.ok(geometry.row.y>=geometry.focus.bottom-1,'labels never overlap the enlarged card');
  for(const {box,font,scroll} of geometry.labels){assert.ok(font>=16);assert.ok(box.x>=0&&box.right<=geometry.width+1&&box.y>=0&&box.bottom<=geometry.height+1);assert.ok(scroll<=box.width+1,'frame names stay readable without horizontal overflow');}
}
async function focused(index){
  const figures=page.locator('.parlor-table figure'),active=page.locator('.parlor-table figure.is-focused');
  await frameLabels();
  assert.equal(await page.locator('[role=dialog],[aria-modal=true]').count(),0,'card focus adds no modal or keyboard trap');
  if(index===null){assert.equal(await active.count(),0);assert.equal(await page.locator('.parlor-spread-stage.has-focus').count(),0);return;}
  assert.equal(await active.count(),1);assert.equal(await figures.evaluateAll(nodes=>nodes.findIndex(n=>n.classList.contains('is-focused'))),index);
  assert.equal(await active.locator('.is-revealed').count(),1,'only an actually revealed card may be foregrounded');
  await page.waitForFunction(()=>{const el=document.querySelector('figure.is-focused');return el&&el.getBoundingClientRect().height/el.offsetHeight>1.59&&getComputedStyle(el.closest('.parlor-spread-stage'),'::before').opacity==='1';});
  const info=await active.evaluate(el=>{
    const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
    return {card:rect(el),stage:rect(el.closest('.parlor-card-area')),cue:rect(document.querySelector('.parlor-cue')),user:rect(document.querySelector('.parlor-user-transcript')),caption:rect(document.querySelector('.parlor-caption')),dim:getComputedStyle(el.closest('.parlor-spread-stage'),'::before').opacity,transition:getComputedStyle(el).transitionDuration,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches};
  });
  assert.ok(info.card.x>=info.stage.x-1 && info.card.right<=info.stage.right+1 && info.card.y>=info.stage.y-1 && info.card.bottom<=info.stage.bottom+1,'enlarged artwork stays inside its reserved row');
  assert.ok(info.user.bottom<=info.card.y+1 && info.card.bottom<=info.caption.y+1,'focus cannot obscure either transcript');
  assert.ok(Math.abs(info.card.x+info.card.width/2-(info.stage.x+info.stage.width/2))<1,'every current card occupies the same centered focus position');
  assert.ok(Math.abs(info.card.y+info.card.height/2-(info.stage.y+info.stage.height/2))<1,'focused card retains its released vertical center');
  const baseline=await active.evaluate(el=>{
    const stage=el.closest('.parlor-spread-stage'),scene=stage.closest('.parlor-scene'),style=getComputedStyle(scene),rows=style.gridTemplateRows.split(' ').map(parseFloat),height=scene.clientHeight-rows[0]-rows[1]-parseFloat(getComputedStyle(document.querySelector('.parlor-caption')).fontSize)*1.5*(innerHeight<=600?2:innerWidth<=800?3:4)-3*parseFloat(style.rowGap),gap=Math.min(36,Math.max(12,innerWidth*.03));
    const tableWidth=Math.min(stage.clientWidth,800,1.2*height+2*gap),width=(tableWidth-2*gap)/3;
    return {width:1.6*width,height:1.6*width*1.5};
  });
  assert.ok(Math.abs(info.card.width-baseline.width)<1&&Math.abs(info.card.height-baseline.height)<1,'enlarged artwork keeps the exact released sizing formula despite the new label row');
  assert.equal(info.dim,'1');if(info.reduced)assert.ok(parseFloat(info.transition)<=.001,'reduced motion settles immediately (including the app-wide near-zero override)');
}
async function resetEncounter(){const saved=await page.evaluate(()=>JSON.stringify(localStorage));const n=await audioCount();for(let i=0;i<5;i++)await tap();await idle();assert.equal(await radioLevel(),0,'reset fades ambience to silence');assert.equal(await audioCount(),n,'reset is silent');assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);assert.equal(await page.evaluate(()=>JSON.stringify(localStorage)),saved,'reset preserves saved keys and choices');}
async function artwork(){
  await page.waitForFunction(()=>[...document.querySelectorAll('.parlor-artwork img')].every(img=>img.complete&&img.naturalWidth>0));
  const slots=await page.locator('.parlor-card').evaluateAll(nodes=>nodes.map(n=>[n.offsetWidth,n.offsetHeight]));
  for(const [w,h] of slots){assert.ok(Math.abs(w/h-2/3)<.01);assert.ok(Math.abs(w-slots[0][0])<1);assert.ok(Math.abs(h-slots[0][1])<1);}
  const images=await page.locator('.parlor-artwork img').evaluateAll(nodes=>nodes.map(img=>{const r=img.getBoundingClientRect(),card=img.closest('.parlor-card').getBoundingClientRect(),style=getComputedStyle(img);return {natural:[img.naturalWidth,img.naturalHeight],fit:style.objectFit,opacity:style.opacity,inset:Math.min(r.left-card.left,r.top-card.top,card.right-r.right,card.bottom-r.bottom),width:r.width,height:r.height};}));
  assert.ok(images.length);for(const img of images){assert.deepEqual(img.natural,artSizes[artIndex]);assert.equal(img.fit,'contain');assert.equal(img.opacity,'1');assert.ok(img.inset>=6,'full artwork stays inside rounded frame');const scale=Math.min(img.width/img.natural[0],img.height/img.natural[1]);assert.ok(img.natural[0]*scale<=img.width+.1&&img.natural[1]*scale<=img.height+.1);}
}
async function run(){
try{
  await mkdir(evidence,{recursive:true});server=await preview({root,preview:{host:'127.0.0.1',port:4187,strictPort:true}});
  browser=await chromium.launch({headless:true,...(process.env.PARLOR_BROWSER?{executablePath:process.env.PARLOR_BROWSER}:{channel:'msedge'})});
  context=await browser.newContext({viewport:{width:1280,height:960},reducedMotion:'reduce',hasTouch:true,deviceScaleFactor:Number(process.env.PARLOR_DPR||1)});context.setDefaultTimeout(12000);
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
      const request=route.request().postDataJSON(),prompt=ownerLanguage?'':request.messages.at(-1).content;languageRequests.push(request);
      const identities=ownerLanguage?(path.endsWith('narrate')?JSON.parse(Buffer.from(request.token,'base64url')).c.map(([slug])=>({slug,name:slug})):null):prompt.includes('CARD IDENTITIES IN ORDER\n')?JSON.parse(prompt.split('CARD IDENTITIES IN ORDER\n')[1]):null;
      if(!identities)assert.doesNotMatch(JSON.stringify(ownerLanguage?request.turns:request.messages),/\[(?:sighs|exhales|sarcastic|curious)\]/,'history has no delivery tags');
      const text=identities?JSON.stringify({cards:identities.map(card=>({slug:card.slug,text:`[sarcastic] A distant landscape takes shape in the mist. A path opens where you thought there was none.${longNarration?' Reflect on the choice before you, and consider what you might learn by making room for another possibility.'.repeat(14):''}`})),synthesis:'The visions leave a choice that remains yours.'}):'[curious] I know nothing of cards. I see only the landscape that reaches me through the ether.';
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
    if(path==='/api/parlor/transcript'){
      assert.equal(transcriptMode,true);assert.equal(route.request().method(),'POST');const body=route.request().postDataJSON();transcriptRequests.push(body);
      assert.ok(Buffer.byteLength(JSON.stringify(body))<=16384);assert.doesNotMatch(JSON.stringify(body),/synthetic-browser-key|synthetic-voice-key|raw_audio|authorization|xi-api-key/);
      return json(route,body.start?{token:'synthetic-receipt-'+(++transcriptStarts)}:{accepted:body.events.length});
    }
    if(path==='/api/parlor/capabilities')return json(route,{mode:'byok',transcriptLogging:transcriptMode,...(ownerMode?{ownerKeys:{anthropicModel:'claude-test-owner',elevenlabs:true}}:{})});
    if(path==='/api/me/decks')return json(route,[deck]);
    if(path==='/api/decks/parlor-fixture')return json(route,deck);
    if(path.startsWith('/api/decks/parlor-fixture/artwork/assets/'))return json(route,{},404);
    if(/^\/api\/decks\/parlor-fixture\/cards\/[^/]+\/artwork\/image$/.test(path)){artRequests.push(url);return route.fulfill({contentType:'image/webp',body:artFixtures[artIndex]});}
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
  if(process.env.PARLOR_DETAILS_ONLY!=='1'){
  const before=await audioCount();await button('Start the show').click();await idle();assert.equal(await audioCount(),before);assert.equal(calls,0);
  assert.equal(await page.evaluate(()=>window.__radioContexts.length),0,'no AudioContext before a deliberate summon gesture');
  for(const viewport of [{width:1920,height:1080},{width:1366,height:768},{width:1024,height:768},{width:768,height:1024},{width:390,height:640},{width:320,height:568}]){
    await page.setViewportSize(viewport);await page.waitForTimeout(40);
    for(const selector of ['.parlor-idle .parlor-cue-title','.parlor-shortcut-note']){
      const lines=await page.locator(selector).evaluate(el=>{const node=el.firstChild,range=document.createRange(),lines=[];for(const match of node.textContent.matchAll(/\S+/g)){range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);const box=range.getBoundingClientRect();let line=lines.find(l=>Math.abs(l.y-box.y)<2);if(!line){line={y:box.y,words:[]};lines.push(line);}line.words.push(match[0]);}return lines.map(l=>l.words);});
      assert.ok(lines.length<2||lines.at(-1).length>=2,'no lone final word: '+JSON.stringify({viewport,selector,lines}));
    }
    await capture('idle-balanced-'+viewport.width+'x'+viewport.height);
  }
  await page.setViewportSize({width:1280,height:960});
  await page.evaluate(()=>{window.__summonFlashes=0;new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1&&(n.matches?.('.parlor-radio')||n.querySelector?.('.parlor-radio')))window.__summonFlashes++;}).observe(document.body,{childList:true,subtree:true});});
  await openGuide();await closeGuide();await resetEncounter();await page.clock.fastForward(1000);await idle();
  assert.equal(await page.evaluate(()=>window.__summonFlashes),0,'triple and five taps do not flash summoning');
  assert.equal(await page.evaluate(()=>window.__radioContexts.length),0,'tap bursts never unlock ambience');assert.equal(await page.evaluate(()=>window.__micRequests),0);assert.equal(calls,0);assert.equal(await audioCount(),before);
  if(process.env.PARLOR_INITIAL_ONLY==='1'){
    await page.keyboard.down('a');await page.keyboard.up('a');await page.clock.fastForward(8000);await idle();assert.equal(await page.evaluate(()=>window.__radioContexts.length),0);
    await pressA();await radio('tuning');await page.clock.fastForward(6500);assert.equal(await audioCount(),before);await page.clock.fastForward(500);await waitAudio(before);await page.keyboard.up('a');await resetEncounter();await idle();
    console.log('PASS initial summon intent: silent tap bursts, three/five/close, 300ms threshold plus seven seconds, no late release effects, balanced idle/footer text at six viewport sizes. Synthetic providers/microphone only.');return;
  }
  // Touching/dragging the blank scene never starts a summon, recording or ambience.
  await stage().dispatchEvent('pointerdown',{pointerId:9,pointerType:'touch',button:0,isPrimary:true});await page.clock.fastForward(7100);await stage().dispatchEvent('pointermove',{pointerId:9,clientY:100});await stage().dispatchEvent('pointercancel',{pointerId:9});await idle();assert.equal(await audioCount(),before);assert.equal(await page.evaluate(()=>window.__micRequests),0);assert.equal(await page.evaluate(()=>window.__radioContexts.length),0);
  // Five taps never flash the introduction, including on the initial screen.
  await page.evaluate(()=>{window.__guideFlashes=0;new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1&&(n.matches?.('[role=dialog]')||n.querySelector?.('[role=dialog]')))window.__guideFlashes++;}).observe(document.body,{childList:true,subtree:true});});
  await resetEncounter();await page.clock.fastForward(1000);assert.equal(await page.evaluate(()=>window.__guideFlashes),0);
  for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:390,height:640},{width:844,height:390},{width:390,height:360}]){
    await page.setViewportSize(viewport);await openGuide();const pages=[];
    for(let i=0;i<30;i++){await guideFits();const text=await page.locator('.parlor-introduction-text').textContent();if(pages.length&&text===pages[0])break;pages.push(text);await page.clock.fastForward(silentExports.silentPageMs(text)+100);await page.waitForTimeout(10);}
    assert.ok(pages.join('').includes(data.name));assert.match(pages.join(''),/Major Arcana/);assert.match(pages.join(''),/Minor Arcana/);assert.match(pages.join(''),/Ranks/);
    await capture('deck-introduction-'+viewport.width+'x'+viewport.height);await closeGuide();await idle();assert.equal(calls,0);assert.equal(await audioCount(),before);assert.equal(await page.evaluate(()=>window.__micRequests),0);assert.equal(await page.locator('[data-silent-measure]').count(),0);
  }
  await page.setViewportSize({width:1280,height:960});await openGuide();await resetEncounter();assert.equal(await page.getByRole('dialog').count(),0);await page.clock.fastForward(200000);await idle();
  // Early physical-key release and lost focus return to blank without voice or microphone.
  for(const cancel of ['release','blur']){
    await pressA();
    await page.locator('.parlor-summoning').waitFor();await radio('tuning');assert.equal(await page.locator('.parlor-slot').count(),3);assert.equal(await page.locator('.radio-needle').evaluate(el=>getComputedStyle(el).animationName),'none');assert.equal(await page.locator('.parlor-radio').evaluate(el=>el.style.getPropertyValue('--contact')),'0');
    if(cancel==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    await page.keyboard.up('a');await idle();await page.clock.fastForward(7100);assert.equal(await audioCount(),before);assert.equal(await page.evaluate(()=>window.__micRequests),0);
  }
  await page.emulateMedia({reducedMotion:'no-preference'});await pressA();await radio('tuning');
  const progress=()=>page.locator('.parlor-radio').evaluate(el=>Number(el.style.getPropertyValue('--contact')));
  assert.ok(await progress()<.15);await page.clock.fastForward(3300);const halfway=await progress();assert.ok(halfway>.4&&halfway<.65);await capture('radio-summon-halfway');
  await page.clock.fastForward(2900);assert.ok(await progress()>.85);assert.equal(await audioCount(),before);await capture('radio-summon-near-contact');await page.keyboard.up('a');await idle();
  await pressA();await radio('tuning');assert.ok(await progress()<.15,'new summon starts at zero');await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);await page.clock.fastForward(1000);await page.waitForFunction(()=>document.querySelector('.parlor-radio').style.getPropertyValue('--contact')==='0');await capture('radio-reduced-tuning');await page.keyboard.up('a');await idle();
  const cueAudio=await audioCount();await pressA();await page.clock.fastForward(7000);await waitAudio(cueAudio);await page.evaluate(()=>window.__oldCue=window.__audio.onended);await page.keyboard.up('a');await resetEncounter();await page.evaluate(()=>window.__oldCue?.());await idle();assert.equal(await audioCount(),cueAudio+1,'reset cancels introduction after a late release cue');
  // Release-cue failure can be retried by a deliberate tap without enabling a microphone.
  ttsMode='error';await pressA();await page.clock.fastForward(7000);await page.locator(`.parlor-cue[role="alert"][aria-description*="${ownerMode?'account provider refused access':'Audio is unavailable'}"]`).waitFor();await radio('stopped');assert.equal(await caption().innerText(),'');await capture('radio-error');await page.keyboard.up('a');await page.clock.fastForward(700);assert.equal(calls,0,'failed summon release never starts narration');assert.equal(await page.locator('.parlor-card').count(),0);await phase('error').waitFor();ttsMode='ok';const retryCue=await audioCount();await tap();await page.clock.fastForward(500);await waitAudio(retryCue);await finishAudio();await waitAudio(retryCue+1);await finishAudio();await phase('question').waitFor();assert.equal(calls,0,'recovered intro still waits for a query or new tap');assert.equal(await page.evaluate(()=>window.__micRequests),0);await resetEncounter();
  await capture('idle-contact');await summon(false);assert.equal(await page.locator('.parlor-card').count(),0);
  await page.evaluate(()=>{window.__audio.currentTime=.5;window.__audio.ontimeupdate();});assert.ok((await caption().innerText()).length>0);assert.ok(!(await caption().innerText()).includes('speak your question'));assert.ok(!(await caption().innerText()).includes('['));
  await page.waitForTimeout(150);assert.ok(!(await caption().innerText()).includes('speak your question'));await page.keyboard.down('b');await finishAudio();await page.clock.fastForward(500);assert.equal(await page.evaluate(()=>window.__micRequests),0,'a hold started during introduction cannot turn into recording');await page.keyboard.up('b');
  const first=await audioCount();mode='delay';await talk('A synthetic spoken query');await radio('searching');await pending(()=>release);await ignoredBusy();assert.equal(await caption().innerText(),'');
  await page.emulateMedia({reducedMotion:'no-preference'});assert.equal(await page.locator('.radio-needle').evaluate(el=>getComputedStyle(el).animationName),'radio-search');await capture('radio-inference-search');assert.equal(await progress(),0,'no invented inference percent');
  await page.waitForFunction(()=>window.__radioLevel()>0);const searchingLevel=await radioLevel();assert.ok(searchingLevel>0&&searchingLevel<=1);
  for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:390,height:844}]){await page.setViewportSize(viewport);await capture(`radio-search-${viewport.width}`);}await page.setViewportSize({width:1280,height:960});
  ttsMode='delay';release();release=null;mode='ok';await pending(()=>ttsRelease);await ignoredBusy();await cue().getByText('Please wait a moment, dialing in the etheric connection',{exact:true}).waitFor();await radio('searching');assert.equal(await page.locator('.is-revealed').count(),0);assert.equal(await caption().innerText(),'');await capture('radio-voice-search');
  assert.equal(await page.locator('.parlor-cue-title').innerText(),'Please wait a moment, dialing in the etheric connection');
  await page.emulateMedia({reducedMotion:'reduce'});assert.deepEqual(await page.locator('.radio-needle,.radio-wave,.parlor-radio-halo').evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).animationName)),['none','none','none']);await capture('radio-reduced-search');ttsRelease();ttsRelease=null;ttsMode='ok';await waitAudio(first);await radio('speaking');assert.equal(await page.locator('.is-revealed').count(),1);assert.equal(await caption().innerText(),'');assert.equal(await page.locator('.parlor-show button').count(),0);await capture('radio-speaking');await ignoredBusy();
  await page.evaluate(()=>{window.__audio.currentTime=.5;window.__audio.ontimeupdate();window.__pausedAudio=window.__audio;});const guideCaption=await caption().textContent(),guideCalls=calls,guideAudio=await audioCount();
  await openGuide();assert.equal(await radioLevel(),0);await page.clock.fastForward(200000);await guideFits();assert.equal(await caption().textContent(),guideCaption);assert.equal(calls,guideCalls);assert.equal(await audioCount(),guideAudio);assert.equal(await stage().getAttribute('data-phase'),'speaking');
  await closeGuide();await radio('speaking');assert.equal(await page.evaluate(()=>window.__audio===window.__pausedAudio&&window.__audio.currentTime===.5),true);assert.equal(await caption().textContent(),guideCaption);assert.equal(calls,guideCalls);assert.equal(await audioCount(),guideAudio);await page.evaluate(()=>{window.__audio.currentTime=0;window.__audio.ontimeupdate();});
  await page.evaluate(()=>window.__audio.onwaiting());await radio('searching');assert.equal(await caption().innerText(),'');await page.evaluate(()=>window.__audio.onplaying());await radio('speaking');
  assert.ok(await radioLevel()<searchingLevel/10,'actual voice playback strongly ducks the ambience');
  await finishAudio();await phase('ready').waitFor();await page.waitForTimeout(250);assert.equal(await page.locator('.is-revealed').count(),1);await artwork();await capture('first-card-desktop');
  await focused(0);
  for(const text of ['Tell me more about this card','How does that connect to my question?']){const count=await audioCount();await talk(text,true);await waitAudio(count);await focused(0);assert.equal(await page.locator('.is-revealed').count(),1);assert.equal(await caption().innerText(),'');await finishAudio();await phase('ready').waitFor();await focused(0);}
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.__mimeType='audio/mp4');
  const mobile=await audioCount();await talk('A keyboard-controlled mobile discussion','enter');await waitAudio(mobile);await finishAudio();await phase('ready').waitFor();if(ownerMode)assert.equal(scribeTypes.at(-1),'audio/mp4');else assert.match(scribeRequests.at(-1),/recording.m4a/);await artwork();await capture('discussion-mobile');
  await page.evaluate(()=>window.__mimeType='audio/webm;codecs=opus');await page.setViewportSize({width:1280,height:960});
  for(let revealed=2;revealed<=3;revealed++){
    if(revealed===2)await page.emulateMedia({reducedMotion:'no-preference'});
    const count=await audioCount();ttsMode='delay';await advance();await pending(()=>ttsRelease);await focused(null);
    await page.waitForFunction(()=>[...document.querySelectorAll('.parlor-table figure')].every(el=>el.getBoundingClientRect().height/el.offsetHeight<1.01));
    assert.equal(await page.locator('.is-revealed').count(),revealed-1,'settling the old card cannot reveal the next card while audio loads');
    assert.equal(await caption().textContent(),'');await capture(`card-${revealed}-preparing`);ttsRelease();ttsRelease=null;ttsMode='ok';
    await waitAudio(count);assert.equal(await page.locator('.is-revealed').count(),revealed);await focused(revealed-1);await finishAudio();await focused(revealed-1);await page.emulateMedia({reducedMotion:'reduce'});
  }
  await phase('ready').waitFor();assert.match(await cue().innerText(),/hear the closing/);await capture('third-card-closing-cue');const closing=await audioCount();await advance();await waitAudio(closing);await focused(null);await finishAudio();await phase('complete').waitFor();assert.match(await cue().innerText(),/ask about the reading.*five times/s);await capture('complete-followup-cue');assert.equal(await page.locator('.parlor-show button').count(),0);
  await focused(null);const finalDiscussion=await audioCount();await talk('How do all three cards fit together?');await waitAudio(finalDiscussion);await focused(null);await finishAudio();await phase('complete').waitFor();await focused(null);
  // Permission denial, pending permission, blur and cancelled gestures never upload.
  let previousCalls=calls,previousScribe=scribeRequests.length;await page.evaluate(()=>window.__micMode='denied');await stage().focus();await page.keyboard.down('Space');await page.locator('.parlor-cue[role="alert"][aria-description*="Microphone access was denied"]').waitFor();await page.keyboard.up('Space');assert.equal(calls,previousCalls);
  const starts=await page.evaluate(()=>window.__micStarts);await page.evaluate(()=>window.__micMode='pending');await stage().focus();await page.keyboard.down('Space');await page.waitForFunction(()=>!!window.__grant);await page.keyboard.up('Space');await page.evaluate(()=>window.__grant());assert.equal(await page.evaluate(()=>window.__micStarts),starts);assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);
  await page.evaluate(()=>window.__micMode='ok');await stage().focus();await page.keyboard.down('Space');await cue().getByText('Speak now.',{exact:true}).waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('Space');assert.equal(calls,previousCalls);assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);
  await stage().focus();await page.keyboard.down('Space');await cue().getByText('Speak now.',{exact:true}).waitFor();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});await page.keyboard.up('Space');assert.equal(calls,previousCalls);assert.equal(scribeRequests.length,previousScribe);assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);
  await page.evaluate(()=>window.__micMode='empty');await talk('This clip is empty','enter');await page.locator('.parlor-cue[role="alert"][aria-description*="No audio was captured"]').waitFor();assert.equal(scribeRequests.length,previousScribe);
  await page.evaluate(()=>window.__micMode='ok');scribeMode='silent';await talk('No speech',true);await page.locator('.parlor-cue[role="alert"][aria-description*="No speech was heard"]').waitFor();assert.equal(calls,previousCalls);
  scribeMode='error';await talk('A transcription error',true);await page.locator('.parlor-cue[role="alert"][aria-description*="Scribe could not transcribe"]').waitFor();assert.equal(calls,previousCalls);
  scribeMode='delay';await talk('A cancelled transcription',true);await cue().getByText('Please wait a moment, dialing in the etheric connection',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('.parlor-cue-title').textContent.includes('etheric connection'));await radio('searching');await capture('radio-transcription');await ignoredBusy();assert.ok(scribeRelease);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));scribeRelease();scribeRelease=null;scribeMode='ok';await radio('waiting');await page.waitForTimeout(150);assert.equal(calls,previousCalls);
  // Global table controls need no button focus. Five taps never leak an advance or recording.
  await page.getByLabel('Interactive reading',{exact:true}).focus();const requestsBefore=await page.evaluate(()=>window.__micRequests);const callsBefore=calls;
  await resetEncounter();assert.equal(calls,callsBefore);assert.equal(await page.evaluate(()=>window.__micRequests),requestsBefore);assert.equal(await page.locator('.parlor-show textarea,.parlor-show input').count(),0);await summon();
  const openAudio=await audioCount();await tap();await waitAudio(openAudio);assert.equal(await page.locator('.is-revealed').count(),1);assert.equal(await page.evaluate(()=>window.__micRequests),requestsBefore);
  // A busy tap cannot execute later just because speech completed inside its timeout.
  await tap();await finishAudio();await page.waitForTimeout(600);assert.equal(await page.locator('.is-revealed').count(),1);
  const heldStarts=await page.evaluate(()=>window.__micStarts);await page.evaluate(()=>window.__utterance='Overlapping keyboard discussion');
  await pressA();await page.keyboard.down('b');await pressA();await cue().getByText('Speak now.',{exact:true}).waitFor();await page.waitForTimeout(300);await page.keyboard.up('a');assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),true,'second key keeps intentional gesture held');await page.keyboard.up('b');await page.waitForFunction(()=>document.querySelector('.parlor-user-transcript').textContent==='Overlapping keyboard discussion');assert.equal(await page.evaluate(()=>window.__micStarts),heldStarts+1);await cue().getByText('Listen.',{exact:true}).waitFor();await finishAudio();
  const nextAudio=await audioCount();await tap('c');await waitAudio(nextAudio);assert.equal(await page.locator('.is-revealed').count(),2);
  // Reset during audio clears cards/history; captured callbacks cannot revive that reading.
  await page.evaluate(()=>window.__oldCallbacks=[window.__audio.onended,window.__audio.ontimeupdate]);await resetEncounter();await page.evaluate(()=>window.__oldCallbacks.forEach(fn=>fn?.()));await page.waitForTimeout(600);assert.equal(await page.locator('.parlor-card').count(),0);
  ttsMode='delay';const cancelledVoice=await audioCount();await pressA();await page.clock.fastForward(7000);await pending(()=>ttsRelease);await radio('searching');await page.keyboard.up('a');await resetEncounter();ttsRelease();ttsRelease=null;ttsMode='ok';await page.waitForTimeout(150);await idle();assert.equal(await audioCount(),cancelledVoice,'late TTS response cannot revive the apparatus or player');
  await summon();scribeMode='delay';const resetCalls=calls;await talk('Old guest transcription',true);await cue().getByText('Please wait a moment, dialing in the etheric connection',{exact:true}).waitFor();await page.getByLabel('Interactive reading',{exact:true}).focus();await resetEncounter();scribeRelease();scribeRelease=null;scribeMode='ok';await page.waitForTimeout(200);assert.equal(calls,resetCalls);assert.equal(await page.locator('.parlor-card').count(),0);
  await summon();mode='delay';await talk('Old guest reading',true);await page.waitForFunction(()=>document.querySelector('.parlor-cue-title').textContent.includes('etheric connection'));await resetEncounter();release();release=null;mode='ok';await page.waitForTimeout(200);assert.equal(await page.locator('.parlor-card').count(),0);
  // Genuine decoded WebP fixtures at all four observed source sizes, desktop/projector and phone.
  await escape();for(artIndex=0;artIndex<artSizes.length;artIndex++){
    await page.reload();assert.equal(await page.getByLabel('ElevenLabs voice ID',{exact:true}).inputValue(),'synthetic-selected-voice');
    const setupMic=await page.evaluate(()=>window.__micRequests);await page.getByLabel('ElevenLabs voice ID',{exact:true}).focus();for(let i=0;i<5;i++)await page.keyboard.press('ArrowLeft');await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>window.__micRequests),setupMic);assert.equal(await page.locator('.parlor-show').count(),0);
    await begin();const sizeAudio=await audioCount();await tap();await waitAudio(sizeAudio);await finishAudio();
    for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:390,height:844}]){await page.setViewportSize(viewport);await artwork();await focused(0);await capture(`artwork-${artSizes[artIndex].join('x')}-${viewport.width}`);}
    await page.setViewportSize({width:1280,height:960});await escape();
  }artIndex=0;await begin();const resumed=await audioCount();await talk('A new guest',true);await waitAudio(resumed);await finishAudio();
  // Cancellation fences late LLM and late speech, preserves no guest data on return.
  mode='delay';const count=await audioCount();await talk('A delayed discussion',true);await page.waitForFunction(()=>document.querySelector('.parlor-cue-title').textContent.includes('etheric connection'));assert.ok(release);await escape();release();mode='ok';await page.waitForTimeout(150);assert.equal(await audioCount(),count);
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('synthetic spoken query')),false);
  // Long text rolls within fixed rows. Only timestamp-revealed words enter the
  // DOM, and old lines leave without moving the cards or requiring scrolling.
  longNarration=true;await page.setViewportSize({width:1920,height:1080});await begin();
  const longQuestion='How might I understand this?\n'+'A possibility worth considering. '.repeat(20)+'word'.repeat(80)+' The end of my question.';
  const longAudio=await audioCount();await talk(longQuestion);await waitAudio(longAudio);
  assert.equal(await caption().textContent(),'','no script appears before playback reaches its first timestamp');
  const anchor=await page.locator('.parlor-table').boundingBox();
  for(const time of [5,12,25]){
    await page.evaluate(time=>{window.__audio.currentTime=time;window.__audio.ontimeupdate?.();},time);
    const shown=await caption().textContent();assert.ok(shown.length>20 && shown.length<speechRequests.at(-1).text.length-20,'only a spoken prefix is available');
    assert.deepEqual(await page.locator('.parlor-table').boundingBox(),anchor,'growing captions cannot move the spread');
  }
  await finishAudio();await phase('ready').waitFor();const completedNarration=await caption().textContent();
  async function boundedTranscript(target,expectClipped=false){
    const info=await target.evaluate(el=>{
      const box=el.getBoundingClientRect(),lines=el.firstElementChild,node=lines.firstChild,style=getComputedStyle(el);
      const glyph=index=>{const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+1);const r=range.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
      return {top:box.top,bottom:box.bottom,left:box.left,right:box.right,first:glyph(0),last:glyph(node.length-1),scroll:el.scrollTop,overflow:style.overflowY,font:parseFloat(style.fontSize),animation:style.animationName};
    });
    assert.equal(info.overflow,'clip');assert.equal(info.scroll,0);assert.ok(info.font>=18);
    assert.ok(info.last.top>=info.top && info.last.bottom<=info.bottom+1 && info.last.left>=info.left-1 && info.last.right<=info.right+1,'latest line remains fully visible');
    if(expectClipped)assert.ok(info.first.bottom<info.top,'old lines have left the visible window');
    assert.equal(info.animation,'none','caption updates never simulate speech with animation');
  }
  for(const viewport of [{width:1920,height:1080},{width:2560,height:1440},{width:2560,height:720},{width:1024,height:768},{width:1280,height:600},{width:1280,height:720},{width:768,height:1024},{width:600,height:1200},{width:390,height:844},{width:390,height:640},{width:390,height:360},{width:844,height:390}]){
    await page.setViewportSize(viewport);await boundedTranscript(caption(),true);await boundedTranscript(page.getByLabel('Your words',{exact:true}),true);await focused(0);
    const layout=await page.evaluate(()=>{
      const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
      return {stage:rect('.parlor-ritual'),user:rect('.parlor-user-transcript'),cards:rect('.parlor-table'),caption:rect('.parlor-caption'),cue:rect('.parlor-cue'),width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight};
    });
    assert.ok(layout.scrollHeight<=viewport.height+1 && layout.scrollWidth<=viewport.width+1,'guest scene never needs page scrolling');
    assert.ok(Math.abs(layout.stage.x+layout.stage.width/2-viewport.width/2)<1 && Math.abs(layout.stage.y+layout.stage.height/2-(viewport.height-(viewport.width<=800?(viewport.height<=450?36:52):0))/2)<1,'composition remains centered');
    assert.ok(layout.user.bottom<=layout.cards.y+1 && layout.cards.bottom<=layout.caption.y+1,'cards and text occupy reserved nonoverlapping rows');
    assert.ok(layout.cue.y>=0 && layout.cue.bottom<=viewport.height && layout.caption.bottom<=viewport.height,'cue and latest narration stay onscreen');
    const capacity=await caption().evaluate(el=>({height:el.clientHeight,line:parseFloat(getComputedStyle(el).lineHeight),bottom:el.getBoundingClientRect().bottom,sceneBottom:el.closest('.parlor-scene').getBoundingClientRect().bottom}));
    assert.ok(Math.abs(capacity.bottom-capacity.sceneBottom)<1,'captions use the remaining scene height');
    assert.ok(capacity.height>=capacity.line*(viewport.height<=600?1:2),'caption keeps readable lines on short viewports');
    if(viewport.width===2560&&viewport.height===1440)assert.ok(capacity.height>300,'wide projector recovers the unused band for more than four caption lines');
    console.log('Measured projection layout',JSON.stringify({viewport,caption:capacity.height,lines:capacity.height/capacity.line}));
    await capture(`rolling-captions-${viewport.width}x${viewport.height}`);
  }
  await page.emulateMedia({reducedMotion:'no-preference'});await boundedTranscript(caption(),true);await focused(0);assert.ok(parseFloat(await page.locator('figure.is-focused').evaluate(el=>getComputedStyle(el).transitionDuration))>.1);await page.emulateMedia({reducedMotion:'reduce'});
  // Touch drags/cancellation still cannot become encounter input. There is no
  // scroll position for a guest to maintain or repair after a viewport resize.
  await page.setViewportSize({width:390,height:640});
  const scrollRequests={calls,scribe:scribeRequests.length,audio:await audioCount(),mic:await page.evaluate(()=>window.__micRequests)};
  const cdp=await context.newCDPSession(page);
  async function swipe(target){
    const box=await target.boundingBox();assert.ok(box);const x=Math.round(box.x+box.width/2),bottom=Math.min((await page.viewportSize()).height-30,box.y+box.height-8),top=Math.max(30,box.y+8);assert.ok(bottom-top>30,'swipe target is visible');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:bottom}]});
    for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:bottom-(bottom-top)*i/8}]});await page.waitForTimeout(25);}
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(300);
  }
  assert.equal(await caption().evaluate(el=>{for(let n=el;n;n=n.parentElement)if(getComputedStyle(n).touchAction==='none')return false;return true;}),true,'no guest ancestor blocks native touch panning');
  await swipe(caption());assert.equal(await caption().evaluate(el=>el.scrollTop),0);await swipe(page.locator('.parlor-table'));assert.equal(await page.evaluate(()=>window.scrollY),0);
  for(const end of ['pointerup','pointercancel']){await caption().dispatchEvent('pointerdown',{pointerId:17,pointerType:'touch',button:0,isPrimary:true});await page.clock.fastForward(600);await caption().dispatchEvent('pointermove',{pointerId:17,clientY:20});await caption().dispatchEvent(end,{pointerId:17,pointerType:'touch'});}
  await page.clock.fastForward(600);assert.deepEqual({calls,scribe:scribeRequests.length,audio:await audioCount(),mic:await page.evaluate(()=>window.__micRequests)},scrollRequests,'scroll, held drag and cancellation never request a microphone, provider or advance');assert.equal(await page.locator('.is-revealed').count(),1);
  await stage().focus();await talk('What did you mean by the beginning?');await waitAudio(scrollRequests.audio);
  const history=languageRequests.at(-1);assert.ok((ownerMode?history.turns:history.messages).some(turn=>turn.content===completedNarration),'full completed narration remains in follow-up context despite visual clipping');
  if(ownerMode)assert.equal(JSON.parse(Buffer.from(history.token,'base64url')).q,longQuestion);else assert.ok(history.system.includes(JSON.stringify(longQuestion)),'full user question remains in provider context');
  await finishAudio();const next=await audioCount();await advance();await waitAudio(next);await finishAudio();assert.equal(await page.locator('.is-revealed').count(),2,'deliberate physical input still advances after touch gestures');
  await cdp.detach();scribeMode='error';await talk('A recoverable microphone error');await cue().getByText('Your voice did not reach us.',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:360});const errorCue=await cue().boundingBox();assert.ok(errorCue.y>=0 && errorCue.y+errorCue.height<=360,'even the longest recovery cue stays within a short viewport');await focused(1);
  scribeMode='ok';await resetEncounter();await escape();longNarration=false;await page.setViewportSize({width:1280,height:960});
  await page.getByLabel('Show operator controls while testing',{exact:true}).check();
  longNarration=true;await begin();const n=await audioCount();await talk('Pause this reading',true);await waitAudio(n);await button('Pause reading').click();await button('Retry this step').waitFor();assert.ok(await page.evaluate(()=>window.__audioCleared>0));const silentAudio=await audioCount(),silentText=speechRequests.at(-1).text.replace(/\[[^\]]+\]\s*/g,'');await button('Read without audio').click();
  await cue().getByText('Read along.',{exact:true}).waitFor();await radio('waiting');await focused(0);await ignoredBusy();await ignoredBusy(true);assert.equal(await page.locator('.is-revealed').count(),1);
  await page.setViewportSize({width:390,height:640});await page.waitForTimeout(100);assert.ok(silentText.startsWith((await caption().textContent()).trim()),'resize restarts the unread first page rather than skipping its beginning');
  await page.screenshot({path:resolve(evidence,'silent-first-page.png'),fullPage:true});
  const silentPages=await finishSilent();assert.equal(await stage().getAttribute('data-phase'),'ready','silent delivery outcome: '+await cue().getAttribute('aria-description'));await phase('ready').waitFor();await focused(0);assert.ok(silentPages.length>5);assert.equal(silentPages.join(' ').replace(/\s+/g,' ').trim(),silentText.replace(/\s+/g,' ').trim(),'beginning, middle and ending of the full silent narration were visible');
  assert.equal(await page.locator('.is-revealed').count(),1,'finishing silent pages never auto-advances');assert.equal(await audioCount(),silentAudio,'explicit silent delivery never starts speech');longNarration=false;await page.setViewportSize({width:1280,height:960});
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
  // Explicit silent setup covers summon/greeting and a reset during paged delivery.
  await page.getByLabel('Read without audio',{exact:true}).check();const beforeSilent=await audioCount();await button('Start the show').click();await pressA();await page.clock.fastForward(7000);await finishSilent();await phase('awaiting-release').waitFor();await page.keyboard.up('a');await finishSilent();await phase('question').waitFor();assert.equal(await audioCount(),beforeSilent);
  await advance();await page.locator('.parlor-caption.is-silent').waitFor();await page.waitForFunction(()=>document.querySelector('.parlor-ritual').dataset.phase==='speaking');await resetEncounter();assert.equal(await page.locator('[data-silent-measure]').count(),0);await page.clock.fastForward(60000);await idle();assert.equal(await audioCount(),beforeSilent);await escape();await page.getByLabel('Read without audio',{exact:true}).uncheck();
  }
  // Optional static deck notes are separate from spoken captions and never page.
  const detailsToggle=page.getByLabel('Show card details beside the current card',{exact:true});assert.equal(await detailsToggle.isChecked(),false);
  await detailsToggle.check();await page.reload();assert.equal(await detailsToggle.isChecked(),true);
  await begin();assert.equal(await page.locator('.parlor-card-details').count(),0);let detailsAudio=await audioCount();await advance();await waitAudio(detailsAudio);await finishAudio();await phase('ready').waitFor();
  const details=page.getByLabel('Current card deck notes',{exact:true});await details.waitFor();
  const firstSlug=await details.getAttribute('data-card');assert.equal(await page.locator('.is-revealed').count(),1);const source=artRequests.findLast(url=>url.pathname.includes('/cards/'+firstSlug+'/'));assert.ok(source);assert.equal(source.searchParams.get('packId'),'saved-artwork');assert.equal(source.searchParams.get('version'),'synthetic-art-0-'+firstSlug);assert.deepEqual([...source.searchParams.keys()].sort(),['packId','version']);
  const sizes=[{width:1360,height:768},{width:1920,height:1080},{width:1024,height:768},{width:800,height:600},{width:1024,height:600},{width:800,height:480},{width:390,height:844},{width:390,height:640},{width:320,height:568},{width:844,height:390}];
  async function lightboxFits(viewport){
    await page.setViewportSize(viewport);await page.waitForTimeout(120);
    await page.waitForFunction(()=>document.querySelector('.parlor-lightbox-art img')?.naturalWidth>0);
    const g=await details.evaluate(el=>{
      const r=n=>n.getBoundingClientRect().toJSON(),panel=el.closest('.parlor-details-lightbox'),art=panel.querySelector('.parlor-lightbox-art'),img=art.querySelector('img'),cap=document.querySelector('.parlor-caption'),cue=document.querySelector('.parlor-cue'),note=document.querySelector('.parlor-shortcut-note');
      const words=[];const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;
      while(node=walker.nextNode()){const range=document.createRange();for(const m of node.textContent.matchAll(/\S+/gu)){range.setStart(node,m.index);range.setEnd(node,m.index+m[0].length);words.push(...[...range.getClientRects()].map(b=>b.toJSON()));}}
      const b=r(el),scale=Math.min(art.clientWidth/img.naturalWidth,art.clientHeight/img.naturalHeight);
      return {notes:b,art:r(art),panel:r(panel),caption:r(cap),cue:r(cue),footer:r(note),font:parseFloat(getComputedStyle(el).fontSize),height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth,scroll:el.scrollHeight,level:panel.dataset.detailLevel,wordsFit:words.every(w=>w.x>=b.x-1&&w.right<=b.right+1&&w.y>=b.y-1&&w.bottom<=b.bottom+1),natural:[img.naturalWidth,img.naturalHeight],rendered:[img.naturalWidth*scale,img.naturalHeight*scale],dpr:devicePixelRatio,fit:getComputedStyle(img).objectFit,transform:art.style.transform,text:el.textContent};
    });
    assert.ok(g.wordsFit&&g.scroll<=g.notes.height+1,'all summary words fit without scrolling or clipping: '+JSON.stringify(g));
    assert.ok(g.panel.bottom<=g.caption.y+1&&g.font>=18,'summary stays readable above independent captions: '+JSON.stringify(g));
    assert.ok(g.panel.x>=0&&g.panel.y>=0&&g.height<=viewport.height+1&&g.width<=viewport.width+1,'lightbox fits viewport: '+JSON.stringify(g));
    assert.ok(g.art.right<=g.notes.x+1||g.art.bottom<=g.notes.y+1,'art cannot overlap summary: '+JSON.stringify(g));
    assert.ok(g.caption.bottom<=g.footer.y+1||g.caption.right<=g.footer.x+1,'footer never obscures captions: '+JSON.stringify(g));
    assert.deepEqual(g.natural,[945,1663]);assert.equal(g.fit,'contain');
    assert.equal(await details.getAttribute('data-card'),firstSlug);assert.equal(await page.locator('.is-revealed').count(),1);
    const runs=await details.locator('[data-meaning]').evaluateAll(nodes=>nodes.map(n=>({kind:n.dataset.meaning,secondary:n.classList.contains('parlor-meaning-secondary'),text:n.textContent,color:getComputedStyle(n).color})));
    assert.equal(runs.length,2);const orientation=await details.getAttribute('data-orientation');
    for(const run of runs){assert.equal(run.secondary,orientation==='Reversed'?run.kind==='upright':run.kind==='reversed');assert.match(run.text,/drawn/);if(run.secondary)assert.equal(run.color,'rgb(185, 179, 187)');}
    if(viewport.width===1360)console.log('Primary projector lightbox',JSON.stringify(g));
    await capture(`lightbox-${viewport.width}x${viewport.height}`);return g;
  }
  for(const size of sizes)await lightboxFits(size);
  const stable=await details.textContent();await page.clock.fastForward(120000);assert.equal(await details.textContent(),stable,'single-screen summary never auto-pages');assert.equal(await page.locator('.is-revealed').count(),1);
  detailsAudio=await audioCount();ttsMode='delay';await advance();await pending(()=>ttsRelease);assert.equal(await details.count(),0);ttsRelease();ttsRelease=null;ttsMode='ok';await waitAudio(detailsAudio);await finishAudio();await phase('ready').waitFor();assert.notEqual(await details.getAttribute('data-card'),firstSlug);
  await resetEncounter();assert.equal(await details.count(),0);assert.equal(await page.locator('[data-silent-measure]').count(),0);await page.clock.fastForward(60000);await idle();await escape();assert.equal(await detailsToggle.isChecked(),true);
  // Long authored data is visibly excerpted, never rewritten, and stays intact for the reader.
  for(const card of Object.values(data.cards)){card.name+=' - '+ 'A long authored name '.repeat(10).trim();card.meaning={upright:'UPRIGHT_BEGIN '+ 'A patient possibility. '.repeat(12)+'UPRIGHT_END',inverted:'REVERSED_BEGIN '+ 'A different possibility. '.repeat(12)+'REVERSED_END'};}
  await page.reload();await begin();detailsAudio=await audioCount();await advance();await waitAudio(detailsAudio);await finishAudio();await phase('ready').waitFor();
  for(const viewport of sizes){await page.setViewportSize(viewport);await page.waitForTimeout(120);const info=await details.evaluate(el=>({text:el.textContent,overflow:el.scrollHeight>el.clientHeight+1,font:parseFloat(getComputedStyle(el).fontSize)}));assert.equal(info.overflow,false,JSON.stringify({viewport,info}));assert.ok(info.font>=18);assert.match(info.text,/UPRIGHT_BEGIN/);assert.match(info.text,/REVERSED_BEGIN/);assert.doesNotMatch(info.text,/UPRIGHT_END|REVERSED_END/);}
  if(!ownerMode)assert.match(JSON.stringify(languageRequests.at(-1)),/UPRIGHT_END/,'full authored BYOK provider context remains independent of excerpts');
  assert.ok(Object.values(data.cards).every(card=>card.meaning.upright.endsWith('UPRIGHT_END')),'presentation cannot mutate the server-loaded authored source');
  await resetEncounter();await escape();await detailsToggle.uncheck();await page.reload();assert.equal(await detailsToggle.isChecked(),false);await page.setViewportSize({width:1360,height:768});
  await begin();detailsAudio=await audioCount();await advance();await waitAudio(detailsAudio);await finishAudio();await phase('ready').waitFor();assert.equal(await page.locator('.parlor-details-lightbox').count(),0);await focused(0);await escape();
  if(process.env.PARLOR_DETAILS_ONLY==='1'){console.log('PASS focused lightbox: both labelled authored meaning excerpts, no summary paging, full saved artwork, ten viewports including 1360x768, long data, reset/advance and optional-off centered focus. Synthetic providers only.');return;}
  if(transcriptMode){
    await page.getByText(/Text questions, generated responses and presentation diagnostics are sent to temporary Vercel runtime logs/).waitFor();
    const events=transcriptRequests.flatMap(b=>b.events??[]);for(const kind of ['user_input','assistant_generated','presentation_progress','presentation_completed','presentation_interrupted','encounter_closed'])assert.ok(events.some(e=>e.kind===kind),'browser emits '+kind);
    assert.ok(transcriptStarts>2,'reset obtains fresh encounter receipts');assert.ok(events.some(e=>e.timing==='silent')&&events.some(e=>e.timing==='aligned'));
    assert.equal(await page.evaluate(()=>Object.entries(localStorage).some(([k,v])=>/transcript|eventId|presentation_progress/.test(k+' '+v))),false,'no transcript archive in browser storage');
  }
  await begin();await stage().focus();await page.keyboard.down('Space');await cue().getByText('Speak now.',{exact:true}).waitFor();authenticated=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByText('Parlor access is restricted.',{exact:true}).waitFor();assert.equal(await page.locator('.parlor-show').count(),0);
  const transcriptCount=transcriptRequests.length;await page.clock.fastForward(5000);await page.waitForTimeout(50);assert.equal(transcriptRequests.length,transcriptCount,'logout stops queued logging');
  await page.clock.fastForward(100);assert.equal(await page.evaluate(()=>window.__radioContexts.every(c=>c.state==='closed')),true,'logout closes ambience contexts');
  assert.equal(await page.evaluate(()=>window.__tracks.some(t=>!t.stopped)),false);await page.keyboard.up('Space');assert.ok(speechRequests.length>=8);assert.ok(scribeRequests.length>=8);console.log('PASS: global tap/hold/five-tap reset, overlapping keys and repeat, no tap microphone access, late transcription/narration/reading fences, saved choices retained, setup exclusion, four artwork proportions on desktop/mobile, v3 selected voice and aligned captions, per-card discussion, explicit advance, held-only Scribe v2, centered rolling captions and long questions across twelve viewport sizes, no read-ahead or page scrolling, full conversation retained, complete measured silent pages with reading time and reset-safe advance guards, touch drags without encounter input, explicit operator touch and cancellation, busy keyboard/pointer lock with five-tap reset and no replay, optional account-persisted single-screen lightbox across ten viewports and current-only metadata, MP4, denial/empty/error/cancellation, Escape/logout cleanup. Synthetic providers and microphone only.');
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:resolve(evidence,'failure.png'),fullPage:true});throw error;}
finally{release?.();scribeRelease?.();ttsRelease?.();await context?.close();await browser?.close();await new Promise(r=>server?.httpServer?server.httpServer.close(r):r());console.log('Cleanup: browser, context and local preview closed.');}

}
await run();
