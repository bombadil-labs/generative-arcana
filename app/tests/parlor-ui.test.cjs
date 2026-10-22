const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const React = require('react');
const { JSDOM } = require('jsdom');
const { rawDeck } = require('./fixtures.cjs');
const dom = new JSDOM('<div id="root"></div>', { url:'http://localhost/parlor' });
const original = { window:global.window, document:global.document, fetch:global.fetch, navigator:Object.getOwnPropertyDescriptor(global,'navigator'), PopStateEvent:global.PopStateEvent };
global.window=dom.window; global.document=dom.window.document; global.PopStateEvent=dom.window.PopStateEvent;
Object.defineProperty(global,'navigator',{configurable:true,value:dom.window.navigator}); global.IS_REACT_ACT_ENVIRONMENT=true;
const { createRoot } = require('react-dom/client');
const { act } = React;
let vite,root,App,Provider,useSession,sessionControl,router,settingsApi;
let authenticated,accountId,providerCalls,lateResolve,delayed,accessMode,hostedDenied,hostedBodies,parlorAllowed,deckCalls;
const data=rawDeck();
const deck={id:'parlor-deck',slug:data.slug,name:data.name,tagline:'Fixture deck',revision:1,visibility:'private',createdAt:'',updatedAt:'',manifest:{data,tagline:'Fixture deck'}};
const flush=()=>act(async()=>{await new Promise(r=>setTimeout(r,0));});
const realSetTimeout=global.setTimeout;
async function settle(){for(let i=0;i<8;i++)await flush();}
const json=(body,status=200)=>Response.json(body,{status});
function Capture({children}) { sessionControl=useSession(); return children; }
function button(text){return [...document.querySelectorAll('button')].find(el=>el.textContent===text);}
async function click(text){const target=button(text);assert.ok(target,`button exists: ${text}`);await act(async()=>target.click());await settle();}
async function input(label,value){const field=[...document.querySelectorAll('label')].find(el=>el.childNodes[0].textContent===label)?.querySelector('input,textarea,select');assert.ok(field,`input exists: ${label}`);await act(async()=>{const proto=field.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(field,value);field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});await flush();}
async function guest(){await click('Start the show');assert.equal(document.querySelectorAll('textarea').length,0);assert.ok(!button('Type instead'));assert.equal(document.querySelector('.parlor-idle').textContent,'Press and hold the button to make contact with the beyond');await act(async()=>window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'a',code:'KeyA',bubbles:true})));await act(async()=>{await new Promise(r=>realSetTimeout(r,20));});await settle();await act(async()=>window.dispatchEvent(new dom.window.KeyboardEvent('keyup',{key:'a',code:'KeyA',bubbles:true})));await settle();await click('Begin an open reading');}
async function escape(){await act(async()=>window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await settle();}


before(async()=>{
  const {createServer}=await import('vite');
  vite=await createServer({root:resolve(__dirname,'..'),server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]}});
  ({App}=await vite.ssrLoadModule('/src/app/App.tsx'));
  ({BrowserSessionProvider:Provider,useBrowserSession:useSession}=await vite.ssrLoadModule('/src/auth/session.tsx'));
  router=await vite.ssrLoadModule('/src/app/router.ts'); settingsApi=await vite.ssrLoadModule('/src/parlor/settings.ts');
});
beforeEach(async()=>{
  // Only accelerate the summon threshold in this DOM fixture. Pure gesture tests
  // and the real-browser test independently verify the actual seven seconds.
  global.setTimeout=(callback,ms,...args)=>realSetTimeout(callback,ms===7000?5:ms,...args);
  authenticated=true;parlorAllowed=true;deckCalls=0;accountId='test-account';providerCalls=0;delayed=false;lateResolve=undefined;
  accessMode='byok';hostedDenied=false;hostedBodies=[];
  window.history.replaceState(null,'','/parlor');window.localStorage.clear();
  settingsApi.saveSettings(window.localStorage,accountId,{...settingsApi.defaultSettings(),anthropicKey:'synthetic-ui-key',anthropicModel:'synthetic-model'},true);
  global.fetch=async(path,init={})=>{
    if(path==='/api/parlor/capabilities')return hostedDenied?json({},403):json({mode:accessMode,models:[{provider:'anthropic',id:'server-model'}],voices:[]});
    if(path==='/api/parlor/narrate'){
      hostedBodies.push(JSON.parse(init.body));if(hostedDenied)return json({},403);
      const token=JSON.parse(Buffer.from(hostedBodies.at(-1).token,'base64url').toString());
      const response=json({cards:token.c.map(([slug])=>({slug,text:'Hosted synthetic narration.'})),synthesis:'Hosted synthetic synthesis.'});
      if(delayed)return new Promise(resolve=>{lateResolve=()=>resolve(response);});return response;
    }
    if(path==='/auth/session')return json(authenticated?{authenticated:true,accountId,parlorAllowed,user:{email:'host@example.test'}}:{authenticated:false});
    if(path==='/api/auth/sign-out'){authenticated=false;return json({success:true});}
    if(path==='/api/me/decks'){deckCalls++;return json([deck]);}
    if(path==='/api/decks/parlor-deck')return json(deck);
    if(path.startsWith('/api/decks/parlor-deck/artwork/assets/'))return json({},404);
    if(path.startsWith('/api/decks/parlor-deck/artwork'))return json({enabled:true,deckRevision:1,packId:'saved-artwork',packs:[{id:'saved-artwork',label:'Chosen set',cardCount:0,complete:false}],cards:[]});
    if(path==='https://api.anthropic.com/v1/messages'){
      providerCalls++; const body=JSON.parse(init.body);const identities=JSON.parse(body.messages[0].content.split('CARD IDENTITIES IN ORDER\n')[1]);
      const response=json({content:[{type:'text',text:JSON.stringify({cards:identities.map(card=>({slug:card.slug,text:'Mock interpretation for this card.'})),synthesis:'Mock synthesis.'})}]});
      if(delayed)return new Promise(resolve=>{lateResolve=()=>resolve(response);});
      return response;
    }
    throw new Error('Unexpected mock request');
  };
  root=createRoot(document.getElementById('root'));
});
async function mount(){
  await act(async()=>root.render(React.createElement(Provider,null,React.createElement(Capture,null,React.createElement(App)))));await settle();
  // The private module is intentionally loaded only after server permission arrives.
  for(let i=0;i<150&&/Loading your private table|Checking parlor access/.test(document.body.textContent);i++)
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
  await settle();
}
afterEach(async()=>{await act(async()=>root.unmount());document.getElementById('root').replaceChildren();global.setTimeout=realSetTimeout;});
after(async()=>{await vite?.close();dom.window.close();global.window=original.window;global.document=original.document;global.fetch=original.fetch;global.PopStateEvent=original.PopStateEvent;if(original.navigator)Object.defineProperty(global,'navigator',original.navigator);else delete global.navigator;delete global.IS_REACT_ACT_ENVIRONMENT;});

test('anonymous /parlor is gated before settings and no provider request is made',async()=>{
  authenticated=false;await mount();assert.match(document.body.textContent,/Parlor access is restricted/);assert.ok(!button('Parlor'));assert.equal(document.querySelectorAll('input[type=password]').length,0);assert.equal(providerCalls,0);assert.equal(deckCalls,0);
});

test('other accounts and hash URLs cannot load settings or decks; missing permission fails closed',async()=>{
  parlorAllowed=undefined;window.history.replaceState(null,'','/#/parlor');await mount();
  assert.match(document.body.textContent,/Parlor access is restricted/);assert.ok(!button('Parlor'));
  assert.equal(document.querySelectorAll('input[type=password]').length,0);assert.equal(deckCalls,0);assert.equal(providerCalls,0);
});
test('restored and pasted keys always remain password fields; clearing keys removes persisted values',async()=>{
  await mount();assert.equal(document.querySelectorAll('input[type=password]').length,3);assert.ok(!document.body.textContent.includes('synthetic-ui-key'));
  await input('OpenAI API key','synthetic-pasted-key');
  for(const field of document.querySelectorAll('input[type=password]'))assert.equal(field.type,'password');
  assert.ok(!document.body.textContent.includes('synthetic-pasted-key'));assert.ok(!button('Show key'));
  await click('Clear keys from this device');for(const field of document.querySelectorAll('input[type=password]'))assert.equal(field.value,'');
  assert.equal([...Array(window.localStorage.length)].map((_,i)=>window.localStorage.key(i)).filter(k=>k.startsWith('arcana:parlor:credentials')).length,0);
});
test('confirm then reset and navigation clear guest state; no questions in URL/storage',async()=>{
  await mount();await guest();assert.equal(document.querySelectorAll('.parlor-card').length,3);assert.equal(providerCalls,1);assert.ok(button('Hold to talk'));assert.ok(button('Next card'));assert.equal(document.querySelectorAll('.is-revealed').length,1);
  assert.equal(window.location.pathname,'/parlor');assert.equal(window.location.hash,'');assert.ok(!JSON.stringify(window.localStorage).includes('Private guest'));
  await escape();assert.ok(button('Start the show'));assert.ok(!document.body.textContent.includes('Private guest'));assert.equal(document.querySelectorAll('.parlor-card').length,0);
  await act(async()=>router.navigate('/my-decks'));await settle();assert.equal(window.location.pathname,'/');assert.equal(window.location.hash,'#/my-decks');
  // Real entry uses a document navigation so the server rechecks authorization.
  await act(async()=>{window.history.pushState(null,'','/parlor');window.dispatchEvent(new dom.window.PopStateEvent('popstate'));});await settle();assert.equal(window.location.pathname,'/parlor');assert.ok(button('Start the show'));
});
test('account change with same email interrupts and fences pending response',async()=>{
  await mount();delayed=true;await guest();assert.equal(providerCalls,1);assert.ok(lateResolve);
  accountId='different-account';await act(async()=>sessionControl.refresh());await settle();lateResolve();await settle();
  assert.ok(!document.body.textContent.includes('Private guest'));assert.equal(document.querySelectorAll('.parlor-card').length,0);assert.equal(document.querySelector('input[type=password]').value,'');
});
test('logout interrupts pending generation and the late response cannot reopen the table',async()=>{
  await mount();delayed=true;await guest();await act(async()=>sessionControl.signOut());await settle();lateResolve();await settle();assert.match(document.body.textContent,/Parlor access is restricted/);assert.equal(document.querySelectorAll('.parlor-card').length,0);
});
test('navigation away during generation fences the response; browser Back opens a fresh host screen',async()=>{
  await mount();delayed=true;await guest();assert.ok(lateResolve);
  await act(async()=>router.navigate('/my-decks'));await settle();lateResolve();await settle();
  await act(async()=>window.history.back());await settle();
  assert.equal(window.location.pathname,'/parlor');assert.ok(button('Start the show'));
  assert.equal(document.querySelectorAll('.parlor-card').length,0);assert.ok(!document.body.textContent.includes('Private guest'));
});
test('literal trailing slash and pagehide return to setup with a cleared guest experience',async()=>{
  window.history.replaceState(null,'','/parlor/');await mount();await guest();await act(async()=>window.dispatchEvent(new dom.window.Event('pagehide')));await settle();assert.ok(button('Start the show'));assert.equal(document.querySelectorAll('.parlor-card').length,0);
});

test('Escape exits before reading and during generation, restores focus, and fences stale replies',async()=>{
  await mount();await guest();assert.equal(document.querySelector('header').style.display,'none');
  const escape=async()=>{await act(async()=>window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await settle();};
  await escape();assert.equal(document.activeElement,button('Start the show'));assert.notEqual(document.querySelector('header').style.display,'none');
  delayed=true;await guest();assert.ok(lateResolve);await escape();lateResolve();await settle();
  assert.equal(document.querySelectorAll('.parlor-card').length,0);assert.ok(!document.body.textContent.includes('Private guest'));
  assert.equal(document.activeElement,button('Start the show'));delayed=false;await guest();assert.equal(document.querySelectorAll('.parlor-card').length,3);await escape();
});

test('hosted mode has server model choices and no key fields, never restores or sends browser keys',async()=>{
  accessMode='hosted';await mount();assert.equal(document.querySelectorAll('input[type=password]').length,0);assert.ok(button('Start the show'));
  await guest();assert.equal(hostedBodies.length,1);assert.equal(providerCalls,0);
  assert.equal(hostedBodies[0].model,'server-model');assert.ok(!JSON.stringify(hostedBodies).includes('synthetic-ui-key'));
  assert.ok(!Object.keys(hostedBodies[0]).some(k=>/key/i.test(k)));assert.ok(!JSON.stringify(window.localStorage).includes('Private guest'));
});
test('denied or disabled hosted access does not offer browser-key fallback',async()=>{
  accessMode='hosted';hostedDenied=true;await mount();assert.ok(!button('Start the show'));assert.equal(document.querySelectorAll('input[type=password]').length,0);assert.equal(providerCalls,0);
});
test('revoked hosted request stays in hosted mode and logout fences a late hosted result',async()=>{
  accessMode='hosted';await mount();hostedDenied=true;await guest();assert.equal(providerCalls,0);assert.ok(button('Retry this step'));assert.ok(document.querySelector('[role=alert]'));assert.equal(document.querySelectorAll('input[type=password]').length,0);
  await escape();hostedDenied=false;delayed=true;await guest();assert.ok(lateResolve);await act(async()=>sessionControl.signOut());await settle();lateResolve();await settle();assert.match(document.body.textContent,/Parlor access is restricted/);assert.equal(document.querySelectorAll('.parlor-card').length,0);
});

test('reading waits after each card and keeps user text above narrated text',async()=>{
  await mount();await guest();
  await act(async()=>{await new Promise(r=>setTimeout(r,1100));});
  await act(async()=>{await new Promise(r=>setTimeout(r,1100));});
  await act(async()=>{await new Promise(r=>setTimeout(r,1100));});
  assert.equal(document.querySelectorAll('.is-revealed').length,1);await click('Next card');assert.equal(document.querySelectorAll('.is-revealed').length,2);await click('Next card');assert.equal(document.querySelectorAll('.is-revealed').length,3);await click('Hear the closing');
  const show=document.querySelector('.parlor-show');
  assert.ok(button('Hold to talk'));assert.ok(button('Leave the table'));assert.ok(!button('Next card'));
  assert.ok(show.textContent.includes('Mock synthesis'));assert.equal(show.querySelector('.parlor-user-transcript').textContent,'What have you brought to the table?');
  assert.ok(show.querySelector('.parlor-user-transcript').compareDocumentPosition(show.querySelector('.parlor-table')) & 4);
  assert.ok(show.querySelector('.parlor-table').compareDocumentPosition(show.querySelector('.parlor-caption')) & 4);
  await escape();assert.equal(document.activeElement,button('Start the show'));
});
