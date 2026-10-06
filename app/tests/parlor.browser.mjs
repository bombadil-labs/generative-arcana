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
let authenticated=false,accountId='host-a',calls=0,mode='ok',release;
const evidence=resolve(root,'../..','parlor-verification');
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
async function captureLayout(name) {
  const inspect=()=>page.evaluate(()=>{
    const header=document.querySelector('header'), parlor=document.querySelector('.parlor');
    const rect=header.getBoundingClientRect();
    return {headers:document.querySelectorAll('header').length,top:rect.top,bottom:rect.bottom,scrollY,
      parlorTop:parlor.getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  const before=await inspect();
  assert.equal(before.headers,1,'exactly one app header');
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
    if(url.hostname==='api.elevenlabs.io')return json(route,{message:'Synthetic audio failure'},503);
    if(url.hostname!=='127.0.0.1')return route.abort();
    if(path==='/auth/session')return json(route,authenticated?{authenticated:true,accountId,user:{email:'synthetic@example.test'}}:{authenticated:false});
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
    await page.getByRole('button',{name:'Open the parlor',exact:true}).click();
    await page.getByRole('button',{name:'Take a seat',exact:true}).click();
    await page.getByLabel('What would you like to explore?').fill('A synthetic party question');
    await page.getByRole('button',{name:'Bring this question',exact:true}).click();
    await page.getByRole('button',{name:'Confirm & deal three cards',exact:true}).dblclick();
  };
  await guest();await page.getByRole('button',{name:'Reveal card 1',exact:true}).waitFor();assert.equal(calls,1);assert.equal(await page.locator('.parlor-card').count(),3);assert.equal(await page.locator('.is-revealed').count(),0);
  await captureLayout('face-down-desktop');
  await page.getByRole('button',{name:'Reveal card 1',exact:true}).click();await page.getByRole('button',{name:'Continue with captions',exact:true}).waitFor();
  await page.getByRole('button',{name:'Continue with captions',exact:true}).click();await page.getByRole('button',{name:'Reveal card 2',exact:true}).waitFor();
  await page.getByRole('button',{name:'Mute',exact:true}).click();
  await page.getByRole('button',{name:'Reveal card 2',exact:true}).dblclick();await page.getByRole('button',{name:'Reveal card 3',exact:true}).waitFor();assert.equal(await page.locator('.is-revealed').count(),2);
  await page.getByRole('button',{name:'Reveal card 3',exact:true}).click();await page.getByRole('button',{name:'Hear the synthesis',exact:true}).waitFor();
  await captureLayout('revealed-desktop');
  await page.setViewportSize({width:390,height:844});await captureLayout('revealed-mobile');
  await page.setViewportSize({width:1280,height:960});
  await page.getByRole('button',{name:'Hear the synthesis',exact:true}).click();await page.getByLabel('Ask a follow-up (captions)').waitFor();
  await page.getByLabel('Ask a follow-up (captions)').fill('What could I reflect on?');await page.getByRole('button',{name:'Ask the reader',exact:true}).click();
  await page.getByText('Follow the meaning that resonates, and keep your own judgment.',{exact:false}).first().waitFor();
  assert.equal(new URL(page.url()).pathname,'/parlor');assert.equal(new URL(page.url()).hash,'');
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('synthetic party question')),false);
  await page.getByRole('button',{name:'Next guest',exact:true}).click();assert.equal(await page.locator('.parlor-card').count(),0);
  await page.getByRole('button',{name:'Host settings · end reading',exact:true}).click();
  mode='error';await guest();await page.getByRole('button',{name:'Retry / resume',exact:true}).waitFor();const before=calls;mode='ok';await page.getByRole('button',{name:'Retry / resume',exact:true}).dblclick();await page.getByRole('button',{name:'Reveal card 1',exact:true}).waitFor();assert.equal(calls,before+1);
  await page.getByRole('button',{name:'Host settings · end reading',exact:true}).click();mode='delay';await guest();
  await page.getByRole('button',{name:'Pause / interrupt',exact:true}).click();await page.getByRole('button',{name:'Next guest',exact:true}).click();release?.();mode='ok';
  await page.getByRole('button',{name:'Take a seat',exact:true}).waitFor();assert.equal(await page.locator('.parlor-card').count(),0);
  await page.getByRole('button',{name:'Host settings · end reading',exact:true}).click();
  await page.getByRole('button',{name:'Clear keys from this device',exact:true}).click();assert.equal(await key.inputValue(),'');
  await page.getByRole('button',{name:'My Decks',exact:true}).click();await page.waitForURL('**/#/my-decks');
  await page.goBack();await page.waitForURL('**/parlor');await page.getByRole('button',{name:'Open the parlor',exact:true}).waitFor();
  assert.equal(await page.locator('.parlor-card').count(),0);assert.equal(await key.inputValue(),'');
  await captureLayout('returned-desktop');
  await page.setViewportSize({width:390,height:844});await captureLayout('settings-mobile');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  authenticated=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('button',{name:'Sign in to enter',exact:true}).waitFor();
  await captureLayout('logged-out-mobile');
  console.log('PASS: production /parlor and /parlor/, login return, masked restoration, chosen set, confirmation, single draw request, captions/audio failure, repeated clicks, synthesis, follow-up, reset, retry, interruption, Back navigation, desktop/mobile single header at viewport top, content below header, no overflow, logout. Mock providers only.');
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
