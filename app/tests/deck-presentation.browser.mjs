// Run against `npm run dev`: npm run test:layout
// Uses an installed Chromium channel, or ARCANA_BROWSER_EXECUTABLE for a test binary.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const origin = process.env.ARCANA_TEST_ORIGIN || "http://127.0.0.1:5173";
const out = new URL("../test-results/deck-presentation/", import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch(process.env.ARCANA_BROWSER_EXECUTABLE
  ? { executablePath: process.env.ARCANA_BROWSER_EXECUTABLE }
  : { channel: process.env.ARCANA_BROWSER_CHANNEL || "msedge" });
const context = await browser.newContext({ reducedMotion: "reduce" });
const page = await context.newPage();
const failures = [], requests = [], evidence = [];
page.on("pageerror", error => failures.push(error.message));
const fixture = JSON.parse(await readFile(new URL("fixtures/minimal-artwork-manifest.json", import.meta.url), "utf8"));
fixture.data.name = "The Observatory of Small Wonders";
fixture.tagline = "A quiet atlas of light, pattern, and possibility.";
for (const n of [1, 2]) fixture.data.cards[`major-${n}`] = { ...structuredClone(fixture.data.cards["major-0"]), slug: `major-${n}`, number: String(n), name: `Study ${n}` };
const deckId = "presentation-fixture";
await page.addInitScript(id => localStorage.setItem(`arcana:artwork-set:${id}`, "saved-artwork"), deckId);
const summary = { id: deckId, slug: fixture.data.slug, name: fixture.data.name, tagline: fixture.tagline, visibility: "public", revision: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
// Neutral test artwork at the recommended dimensions. No production data or uploads.
const rasters = await page.evaluate(() => {
  const result = {};
  for (const [slot, w, h, color] of [["cover",1536,1024,"#344b49"],["cardBack",1024,1536,"#765c37"],["front",1024,1536,"#c7b895"]]) {
    const canvas = document.createElement("canvas"); canvas.width=w; canvas.height=h;
    const ctx=canvas.getContext("2d"); ctx.fillStyle=color; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle="#f4e8c8"; ctx.lineWidth=6; ctx.strokeRect(w*.06,h*.06,w*.88,h*.88);
    ctx.beginPath(); ctx.arc(w/2,h/2,w*.24,0,Math.PI*2); ctx.stroke();
    ctx.font=`${w*.065}px Georgia`; ctx.textAlign="center"; ctx.fillStyle="#f4e8c8";
    ctx.fillText(slot === "cover" ? "THE OBSERVATORY" : slot === "front" ? "A STUDY OF LIGHT" : "✦",w/2,h*.82);
    result[slot]=canvas.toDataURL("image/webp").split(",")[1];
  } return result;
});
const bytes = Object.fromEntries(Object.entries(rasters).map(([key,value])=>[key,Buffer.from(value,"base64")]));
let mode = "full", holdImages = false, holdInk = false, signedIn = false;
let pendingImages = [], pendingInk = [];
const packs = ["saved-artwork", "ink", "empty"].map(id=>({id,label:id,cardCount:id==="empty"?0:2,complete:false,hasCover:id!=="empty",hasCardBack:id!=="empty"}));
function asset(packId, slot) {
  return { id: `${packId}-${slot}`, deckId, packId, slot, mediaType:"image/webp", width:slot==="cover"?1536:1024, height:slot==="cover"?1024:1536, byteLength:bytes[slot==="front"?"front":slot].length, integrity:"sha256-test", deckRevision:1 };
}
await page.route("**/*", async route => {
  const url = new URL(route.request().url());
  if(url.origin!==origin) return route.abort();
  if(!url.pathname.startsWith("/api/") && url.pathname!=="/auth/session") return route.continue();
  requests.push({path:url.pathname,method:route.request().method()});
  assert.equal(route.request().method(),"GET","preview must never mutate anything");
  const json=body=>route.fulfill({json:body});
  if(url.pathname==="/auth/session") return json(signedIn ? {authenticated:true,accountId:"fixture",user:{email:"fixture@example.invalid"}} : {authenticated:false});
  if(url.pathname==="/api/me/decks") return json([summary]);
  if(url.pathname==="/api/decks/public") return json([summary]);
  if(url.pathname===`/api/decks/${deckId}`) return json({...summary,manifest:fixture});
  const packId=url.searchParams.get("packId")||"saved-artwork";
  if(url.pathname.endsWith("/image")) {
    const slot=url.pathname.includes("/assets/cover/")?"cover":url.pathname.includes("/assets/cardBack/")?"cardBack":"front";
    const respond=()=>route.fulfill({contentType:"image/webp",body:mode==="corrupt"?Buffer.alloc(bytes[slot].length):bytes[slot]}).catch(()=>{});
    if(mode==="failed") return route.fulfill({status:404});
    if(holdImages) { pendingImages.push(respond); return; }
    return respond();
  }
  if(url.pathname.endsWith("/artwork")) {
    if(mode==="denied") return route.fulfill({status:403,json:{message:"Not available"}});
    const empty=packId==="empty"||mode==="none";
    const data={enabled:true,deckRevision:1,packId,packs,cover:empty||mode==="missing"?null:asset(packId,"cover"),cardBack:empty||mode==="missing"?null:asset(packId,"cardBack"),cards:Object.values(fixture.data.cards).map(card=>({slug:card.slug,name:card.name,artwork:empty||card.slug==="major-0"?null:{...asset(packId,"front"),cardSlug:card.slug}}))};
    if(mode==="revision") { data.deckRevision=2; data.cover=null; data.cardBack=null; }
    if(holdInk&&packId==="ink") {pendingInk.push(()=>json(data).catch(()=>{}));return;}
    return json(data);
  }
  throw new Error(`Unexpected API: ${url.pathname}`);
});
const rect = selector => page.locator(selector).first().boundingBox();
async function loaded() { await page.waitForFunction(()=>[...document.images].every(img=>img.complete)); }
async function until(predicate) {
  const deadline=Date.now()+5000;
  while(!predicate()) { assert.ok(Date.now()<deadline,"expected request did not arrive"); await new Promise(resolve=>setTimeout(resolve,10)); }
}
async function heroLoaded() {
  await page.waitForFunction(()=>document.querySelector(".deck-artwork-front img")?.style.opacity==="1" &&
    [...document.querySelectorAll(".deck-artwork-cover img,.deck-artwork-back img")].length===3 &&
    [...document.querySelectorAll(".deck-artwork-stage img")].every(img=>img.complete&&img.naturalWidth>0));
}
async function bounds() {
  const stage=await rect(".deck-artwork-stage"), title=await rect("h1");
  assert.ok(title.y>=stage.y+stage.height,"title stays below stage");
  for(const card of await page.locator(".deck-artwork-card").all()) {
    const b=await card.boundingBox();
    assert.ok(b.x>=stage.x-1&&b.x+b.width<=stage.x+stage.width+1&&b.y>=stage.y-1&&b.y+b.height<=stage.y+stage.height+1,"transformed card stays in reserved stage");
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"no horizontal overflow");
}
let visit=0;
async function home() {
  await page.goto(`${origin}/?visit=${++visit}#/deck/${deckId}`);
  await page.locator("#home-artwork-set").waitFor();
  await page.waitForFunction(()=>!document.querySelector('[role="status"]')?.textContent.includes("Loading artwork"));
}
try {
  for(const width of [320,375,768,1440]) {
    await page.setViewportSize({width,height:1000});
    holdImages=true;
    await page.goto(`${origin}/?width=${width}#/community`);
    const tile=page.locator(".community-deck"); await tile.waitFor();
    await until(()=>pendingImages.length>0);
    const before=await tile.locator(":scope > div").nth(1).boundingBox();
    holdImages=false; await Promise.all(pendingImages.splice(0).map(fn=>fn())); await loaded();
    const after=await tile.locator(":scope > div").nth(1).boundingBox();
    assert.equal(after.y,before.y,"tile title must not shift when cover loads");
    const media=await tile.locator(":scope > div").first().boundingBox();
    assert.ok(Math.abs(media.width/media.height-1.5)<.02,"cover reserves 3:2");
    assert.ok(after.y>=media.y+media.height-1,"title below media");
    await tile.focus(); await page.keyboard.press("Enter"); await page.locator("#home-artwork-set").waitFor(); await heroLoaded();
    await bounds();
    const slug=await page.locator("[data-sample-slug]").getAttribute("data-sample-slug");
    assert.notEqual(slug,"major-0","sample must have saved artwork");
    await page.locator("#home-artwork-set").selectOption("ink"); await loaded();
    await page.waitForFunction(slug=>document.querySelector("[data-sample-slug]")?.getAttribute("data-sample-slug")===slug,slug);
    await heroLoaded();
    await bounds();
    await page.screenshot({path:new URL(`detail-${width}.png`,out).pathname.replace(/^\/(\w:)/,"$1"),fullPage:true});
    await page.goBack(); await tile.waitFor();
    await page.screenshot({path:new URL(`community-${width}.png`,out).pathname.replace(/^\/(\w:)/,"$1"),fullPage:true});
    evidence.push({width,tileTitleStable:true,heroBounds:true,keyboardNavigation:true,back:true});
  }
  await home();
  const before=await rect("h1");
  holdInk=true; await page.locator("#home-artwork-set").selectOption("saved-artwork"); await loaded();
  await page.locator("#home-artwork-set").selectOption("ink");
  await until(()=>pendingInk.length>0);
  mode="none";
  await page.locator("#home-artwork-set").selectOption("saved-artwork");
  await Promise.all(pendingInk.splice(0).map(fn=>fn())); holdInk=false;
  await page.waitForFunction(()=>!document.querySelector(".deck-artwork-stage img"));
  assert.equal(await page.locator("[data-sample-slug]").count(),0,"late set must not replace empty set");
  assert.equal((await rect("h1")).y,before.y,"empty set keeps reserved geometry");
  for(const scenario of ["missing","failed","corrupt","none","revision","denied"]) {
    mode=scenario;
    await page.evaluate(()=>localStorage.clear());
    await home(); await loaded(); await bounds();
    if(scenario!=="missing") assert.equal(await page.locator(".deck-artwork-stage img").count(),0,"failed/missing images use fallback");
    await page.screenshot({path:new URL(`${scenario}.png`,out).pathname.replace(/^\/(\w:)/,"$1"),fullPage:true});
  }
  mode="full"; await home(); await loaded();
  await heroLoaded();
  const stable=await page.locator("[data-sample-slug]").getAttribute("data-sample-slug");
  await page.getByRole("tab",{name:/Ranks/}).click();
  assert.equal(await page.locator("[data-sample-slug]").getAttribute("data-sample-slug"),stable);
  // Leaving while bytes are in flight must not resurrect an old stage.
  holdImages=true;
  await page.locator("#home-artwork-set").selectOption("ink");
  await until(()=>pendingImages.length>0);
  await page.getByRole("button",{name:"Generative Arcana — home"}).click();
  await page.locator(".deck-artwork-stage").waitFor({state:"detached"});
  holdImages=false; await Promise.all(pendingImages.splice(0).map(fn=>fn()));
  assert.equal(await page.locator(".deck-artwork-stage").count(),0);
  await home(); await heroLoaded();
  // Desktop at 200% zoom has the same layout viewport as 720 CSS pixels.
  await page.setViewportSize({width:720,height:500});
  await page.locator("h1").evaluate(el=>el.textContent="A Very Long Deck Title ".repeat(8));
  await bounds();
  assert.equal(await page.locator(".deck-artwork-stage").evaluate(el=>getComputedStyle(el).pointerEvents),"none");
  assert.equal(await page.locator(".deck-artwork-stage").locator("button,a,input,select,[tabindex]").count(),0);
  await page.emulateMedia({reducedMotion:"no-preference"});
  assert.equal(await page.locator(".deck-artwork-stage").evaluate(el=>el.getAnimations({subtree:true}).length),0,"still life does not animate");
  signedIn=true;
  await page.goto(`${origin}/?library=1#/my-decks`);
  const libraryImage=page.locator('img[alt="The Observatory of Small Wonders cover"]');
  await libraryImage.waitFor(); await loaded();
  const libraryBounds=await libraryImage.boundingBox(), frame=await libraryImage.locator("..").boundingBox();
  assert.ok(libraryBounds.y+libraryBounds.height<=frame.y+frame.height+1,"My Decks image stays in its frame");
  assert.ok(libraryBounds.x+libraryBounds.width<=frame.x+frame.width+1);
  assert.deepEqual(failures,[]);
  assert.ok(requests.every(r=>!r.path.includes("reading")&&!r.path.includes("draw")));
  await writeFile(new URL("results.json",out),JSON.stringify({evidence,scenarios:["pack changes","stale responses","navigation during image load","revision mismatch","access denied","missing slots","404","decode failure","no art","long titles","200% equivalent viewport","reduced motion"],pageErrors:failures,mutations:requests.filter(r=>r.method!=="GET")},null,2));
  console.log("Deck presentation browser regressions passed (320/375/768/1440px + fallback/navigation/race checks).");
} catch (error) {
  console.error(JSON.stringify({recentRequests:requests.slice(-10),failures,text:await page.locator("body").innerText()},null,2));
  throw error;
} finally { await browser.close(); }
