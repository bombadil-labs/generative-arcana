// One browser, one context, one server. All provider/account traffic is synthetic.
// Run after building: PLAYWRIGHT_MODULE=<existing playwright-core entry> node tests/parlor.browser.mjs
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preview } from 'vite';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright-core');
const data=JSON.parse(await readFile(resolve(root,'../decks/deep-time/deck.json'),'utf8'));
const deck={id:'parlor-fixture',slug:data.slug,name:data.name,tagline:'Synthetic browser fixture',revision:1,visibility:'private',createdAt:'',updatedAt:'',manifest:{data,tagline:'Synthetic fixture'}};
let server,browser,context,page;
let authenticated=false,accountId='host-a',calls=0,mode='ok',release,audioMode='error',deploymentMode='byok',hostedDenied=false;
const evidence=resolve(root,'../..','parlor-verification');
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
async function captureLayout(name) {
  const inspect=()=>page.evaluate(()=>{
    const header=document.querySelector('header'), parlor=document.querySelector('.parlor');
    const rect=header.getBoundingClientRect();
    return {headers:document.querySelectorAll('header').length,show:!!document.querySelector('.parlor-show'),headerVisible:rect.height>0,top:rect.top,bottom:rect.bottom,scrollY,
      parlorTop:parlor.getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  const before=await inspect();
  assert.equal(before.headers,1,'exactly one app header');
  assert.equal(before.headerVisible,!before.show,'navigation disappears only during the show');
  assert.equal(before.top,0,'sticky header remains at viewport top after interaction');
  assert.equal(before.overflow,false,'no horizontal overflow');
  console.log(name,'before capture',JSON.stringify(before));
  await page.evaluate(()=>window.scrollTo(0,160));
  assert.equal((await inspect()).top,0,'header stays at viewport top when scrolled');
  // Full-page capture retains a sticky header at the current scroll offset.
  // Return to the document top before capturing the layout for review.
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const top=await inspect();
  assert.equal(top.scrollY,0);
  assert.equal(top.parlorTop,top.bottom,'parlor starts directly below the app header');
  await page.screenshot({path:resolve(evidence,name+'.png'),fullPage:true});
  await page.screenshot({path:resolve(evidence,name+'-viewport.png')});
}
try {
  server=await preview({root,preview:{host:'127.0.0.1',port:4187,strictPort:true}});
  browser=await chromium.launch({headless:true,...(process.env.PARLOR_BROWSER ? {executablePath:process.env.PARLOR_BROWSER} : {channel:'msedge'})});
  context=await browser.newContext({viewport:{width:1280,height:960},reducedMotion:'reduce'});
  context.setDefaultTimeout(12000);
  await context.addInitScript(()=>{
    window.__showAudio={playing:0,paused:0,cleared:0};
    window.Audio=class {
      play(){window.__showAudio.playing++;queueMicrotask(()=>this.onplaying?.());return Promise.resolve();}
      pause(){window.__showAudio.paused++;}
      removeAttribute(name){if(name==='src')window.__showAudio.cleared++;}
      load(){}
    };
  });
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    if(url.hostname==='api.anthropic.com'||url.hostname==='api.openai.com') {
      calls++;
      if(mode==='error') return json(route,{message:'Synthetic provider error'},429);
      const request=route.request().postDataJSON();
      const prompt=request.messages.at(-1).content;
      const identities=prompt.includes('CARD IDENTITIES IN ORDER\n')?JSON.parse(prompt.split('CARD IDENTITIES IN ORDER\n')[1]):null;
      const text=identities?JSON.stringify({cards:identities.map(card=>({slug:card.slug,text:`${card.name} invites you to reflect on this position. Let its authored meaning open a possibility.`})),synthesis:'The three cards invite reflection, curiosity, and a choice that remains yours.'}):'Follow the meaning that resonates, and keep your own judgment.';
      if(mode==='delay') await new Promise(resolve=>{release=resolve;});
      return json(route,url.hostname==='api.anthropic.com'?{content:[{type:'text',text}]}:{choices:[{message:{content:text}}]});
    }
    if(url.hostname==='api.elevenlabs.io')return audioMode==='hold'?route.fulfill({status:200,contentType:'audio/mpeg',body:'synthetic mocked audio'}):json(route,{message:'Synthetic audio failure'},503);
    if(url.hostname!=='127.0.0.1')return route.abort();
    if(path==='/auth/session')return json(route,authenticated?{authenticated:true,accountId,user:{email:'synthetic@example.test'}}:{authenticated:false});
    if(path==='/api/parlor/capabilities')return hostedDenied?json(route,{},403):json(route,{mode:deploymentMode,models:[{provider:'anthropic',id:'server-approved-model'}],voices:[]});
    if(path==='/api/parlor/narrate'){
      if(hostedDenied)return json(route,{},403);
      const request=route.request().postDataJSON();assert.ok(!JSON.stringify(request).includes('synthetic-browser-key'));
      const token=JSON.parse(Buffer.from(request.token,'base64url').toString());
      return json(route,{cards:token.c.map(([slug])=>({slug,text:'A hosted reflection on the authored meaning of this card.'})),synthesis:'A synthetic hosted synthesis.'});
    }
    if(path==='/api/me/decks')return json(route,[deck]);
    if(path==='/api/decks/parlor-fixture')return json(route,deck);
    if(path.startsWith('/api/decks/parlor-fixture/artwork/assets/'))return json(route,{},404);
    if(path.startsWith('/api/decks/parlor-fixture/artwork')) {
      const packId=url.searchParams.get('packId')||'saved-artwork';
      return json(route,{enabled:true,deckRevision:1,packId,packs:[{id:'saved-artwork',label:'Saved artwork',cardCount:0,complete:false},{id:'party',label:'Party artwork',cardCount:0,complete:false}],cards:[]});
    }
    if(path.startsWith('/api/'))return json(route,{},404);
    return route.continue();
  });
  page=await context.newPage();
  await page.goto('http://127.0.0.1:4187/parlor/');
  await page.getByRole('button',{name:'Sign in to enter',exact:true}).waitFor();
  assert.equal(await page.locator('input[type=password]').count(),0);
  await page.getByRole('button',{name:'Sign in to enter',exact:true}).click();
  await page.waitForURL('**/#/account/login?returnTo=%2Fparlor');
  authenticated=true;await page.goto('http://127.0.0.1:4187/parlor');
  const key=page.getByLabel('Anthropic API key',{exact:true});
  await key.fill('synthetic-browser-key');await page.getByLabel('Anthropic model ID',{exact:true}).fill('synthetic-model');
  await page.getByLabel('ElevenLabs API key',{exact:true}).fill('synthetic-voice-key');await page.getByLabel('ElevenLabs voice ID',{exact:true}).fill('synthetic-voice');
  assert.equal(await key.getAttribute('type'),'password');
  assert.equal(await page.locator('body').innerText().then(text=>text.includes('synthetic-browser-key')),false);
  await page.getByLabel('Remember keys on this device (plaintext)').check();
  await page.reload();assert.equal(await key.getAttribute('type'),'password');assert.equal((await key.inputValue()).length,21);
  await page.getByLabel('Artwork set',{exact:true}).selectOption('party');
  await mkdir(evidence,{recursive:true});await captureLayout('settings-desktop');
  const guest=async()=>{
    await page.getByLabel('What would you like to explore?').fill('A synthetic party question');
    await page.getByRole('button',{name:'Start the show',exact:true}).click();
    await page.locator('.parlor-show').waitFor();
  };
  const escaped=async()=>{
    await page.keyboard.press('Escape');await page.getByRole('button',{name:'Start the show',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Start the show');
    assert.equal(await page.locator('.parlor-card').count(),0);
    assert.equal(await page.locator('header').first().isVisible(),true);
    assert.equal(await page.getByLabel('What would you like to explore?').inputValue(),'');
  };
  const onlyCards=async()=>{
    assert.equal(await page.locator('.parlor-show button,.parlor-show textarea,.parlor-show input,.parlor-show summary,.parlor-show figcaption,.parlor-show a,.parlor-show [tabindex="0"]').count(),0);
    assert.equal(await page.locator('header').first().isVisible(),false);
    assert.equal(await page.locator('.parlor-show').innerText().then(text=>/Show controls|Exit show|synthetic party question|invites you to reflect|Three cards/.test(text)),false);
    const boxes=await page.locator('.parlor-card').evaluateAll(cards=>cards.map(card=>{const r=card.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,w:innerWidth,h:innerHeight};}));
    assert.equal(boxes.length,3);for(const r of boxes)assert.ok(r.top>=0&&r.bottom<=r.h&&r.left>=0&&r.right<=r.w);
  };
  // Silent automatic reveals, then a stable cards-only end state.
  await page.getByLabel('ElevenLabs API key',{exact:true}).fill('');
  mode='delay';release=undefined;await guest();await page.waitForFunction(()=>document.querySelectorAll('.parlor-card').length===3);
  await onlyCards();await captureLayout('face-down-desktop');assert.ok(release);release();mode='ok';
  await page.waitForFunction(()=>document.querySelectorAll('.is-revealed').length===3);
  await onlyCards();await captureLayout('revealed-desktop');
  await page.keyboard.press('Tab');assert.equal(await page.locator('.parlor-show button:focus').count(),0);
  await page.setViewportSize({width:390,height:844});await onlyCards();await captureLayout('revealed-mobile');
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('synthetic party question')),false);
  await escaped();
  // Pending narration is fenced after Escape and after logout.
  mode='delay';release=undefined;await guest();await page.waitForTimeout(150);assert.ok(release);await escaped();release();mode='ok';await page.waitForTimeout(100);
  assert.equal(await page.locator('.parlor-card').count(),0);
  mode='error';await guest();await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'Start the show',exact:true}).waitFor();mode='ok';
  assert.equal(await page.locator('.parlor-show').count(),0);
  // Audio begins on its own; Escape aborts playback and clears the object URL.
  await page.getByLabel('ElevenLabs API key',{exact:true}).fill('synthetic-voice-key');audioMode='hold';
  await guest();await page.waitForFunction(()=>window.__showAudio.playing>0);await onlyCards();await escaped();
  assert.ok(await page.evaluate(()=>window.__showAudio.paused>0&&window.__showAudio.cleared>0));
  await page.getByLabel('ElevenLabs API key',{exact:true}).fill('');
  // Browser Back is the touch-only escape route; re-entry starts in setup.
  await page.getByRole('button',{name:'My Decks',exact:true}).click();await page.waitForURL('**/#/my-decks');
  await page.getByRole('button',{name:'Parlor',exact:true}).click();await page.waitForURL('**/parlor');
  await key.fill('synthetic-browser-key');await page.getByLabel('Anthropic model ID',{exact:true}).fill('synthetic-model');await page.getByLabel('ElevenLabs API key',{exact:true}).fill('');
  await guest();await page.goBack();await page.waitForURL('**/#/my-decks');assert.equal(await page.locator('header').first().isVisible(),true);
  await page.goForward();await page.getByRole('button',{name:'Start the show',exact:true}).waitFor();
  await key.fill('synthetic-browser-key');await page.getByLabel('Anthropic model ID',{exact:true}).fill('synthetic-model');await page.getByLabel('ElevenLabs API key',{exact:true}).fill('');
  mode='delay';release=undefined;await guest();await page.waitForTimeout(150);
  authenticated=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('button',{name:'Sign in to enter',exact:true}).waitFor();release?.();mode='ok';
  assert.equal(await page.locator('.parlor-card').count(),0);
  authenticated=true;deploymentMode='hosted';await page.setViewportSize({width:1280,height:960});await page.goto('http://127.0.0.1:4187/parlor');
  await page.getByLabel('Hosted model',{exact:true}).waitFor();assert.equal(await page.locator('input[type=password]').count(),0);
  await captureLayout('hosted-settings-desktop');const directCalls=calls;
  await guest();await page.waitForFunction(()=>document.querySelectorAll('.is-revealed').length===3);
  await onlyCards();await captureLayout('hosted-reading-desktop');
  await page.setViewportSize({width:390,height:844});await onlyCards();await captureLayout('hosted-reading-mobile');assert.equal(calls,directCalls);
  await escaped();hostedDenied=true;await guest();await page.getByRole('alert').waitFor();assert.equal(calls,directCalls);
  assert.equal(await page.locator('.parlor-show').count(),0);
  await page.reload();await page.getByText('This account does not have hosted parlor access.',{exact:true}).waitFor();
  assert.equal(await page.locator('input[type=password]').count(),0);
  console.log('PASS: cards-only desktop/mobile, automatic reveals, setup question, error return, Escape focus restoration, repeated entry/exit, pending response fences, audio cleanup, Back navigation, auth/logout and hosted denial. Mock providers only.');
} catch (error) {
  await mkdir(evidence,{recursive:true});
  if(page&&!page.isClosed())await page.screenshot({path:resolve(evidence,'failure.png'),fullPage:true});
  throw error;
} finally {
  release?.();
  await context?.close();
  await browser?.close();
  await new Promise(resolve=>server?.httpServer ? server.httpServer.close(resolve) : resolve());
  console.log('Cleanup: task-owned context, browser and preview server closed.');
}
