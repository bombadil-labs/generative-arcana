// Real-browser regression: jsdom cannot detect intrinsic grid sizing/cropping.
// Requires playwright-core (or PLAYWRIGHT_MODULE pointing to an external install).
// Run with CHROMIUM_PATH pointing to an existing Chromium/Edge executable.
const { buildSync } = require("esbuild");
const { readFileSync, writeFileSync, mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const assert = require("node:assert/strict");
assert.ok(process.env.CHROMIUM_PATH, "Set CHROMIUM_PATH to an existing Chromium browser");
const root = resolve(__dirname, "..");
const output = mkdtempSync(join(tmpdir(), "arcana-pack-layout-"));
const script = buildSync({ stdin: { contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {PackAssetImage} from './src/artwork/PackAssetImage';
window.addEventListener('error', () => document.body.dataset.result = 'error');
async function run() {
  const cases = [[1200,800,'cover'],[600,1000,'cardBack'],[2000,200,'cover'],[200,2000,'cardBack']];
  const blobs = [];
  for (const [width,height] of cases) {
    const c = document.createElement('canvas'); c.width=width; c.height=height;
    const x=c.getContext('2d'); x.fillStyle='#e9d9b5'; x.fillRect(0,0,width,height);
    x.strokeStyle='#ba2939'; x.lineWidth=Math.min(width,height)/12; x.strokeRect(0,0,width,height);
    x.fillStyle='#264b42'; x.font=Math.min(width,height)/8+'px sans-serif'; x.fillText(width+' × '+height,width/8,height/2);
    blobs.push(await new Promise(r=>c.toBlob(r,'image/webp')));
  }
  window.fetch=async path=>new Response(blobs[Number(String(path).match(/decks\\/(\\d+)/)[1])],{headers:{'content-type':'image/webp'}});
  const assets=cases.map(([width,height,slot],i)=>({id:'asset-'+i,deckId:String(i),slot,width,height,byteLength:blobs[i].size,mediaType:'image/webp',deckRevision:1}));
  createRoot(document.getElementById('root')).render(<>{[438,280].map(size=><section key={size} style={{width:size}}>{assets.map((asset,i)=><article key={i}><h2>{size}px / {asset.width}×{asset.height} {asset.slot}</h2><div className="pack-asset-preview"><PackAssetImage asset={asset} scope="layout-test" alt={asset.slot} fallback="Loading"/></div></article>)}</section>)}</>);
  const check=()=>{
    const images=[...document.querySelectorAll('img')];
    if(images.length!==8 || images.some(i=>i.style.opacity!=='1')) return setTimeout(check,50);
    const measurements=images.map(i=>{const p=i.closest('.pack-asset-preview');const r=i.getBoundingClientRect();return {width:r.width,height:r.height,boxWidth:p.clientWidth,boxHeight:p.clientHeight,fit:getComputedStyle(i).objectFit};});
    document.body.dataset.result=measurements.every(m=>Math.abs(m.width-m.boxWidth)<1 && Math.abs(m.height-m.boxHeight)<1 && m.fit==='contain')?'pass':'fail';
    document.getElementById('results').textContent=JSON.stringify(measurements);
  }; check();
} run().catch(e=>{document.body.dataset.result='error';document.getElementById('results').textContent=String(e)});
`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, define: { "process.env.NODE_ENV": '"production"' } }).outputFiles[0].text;
const html = join(output, "layout.html");
writeFileSync(html, `<!doctype html><html><head><style>:root{--line:#b8aa91;--paper-2:#f1e9d9;--r-2:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere}*{box-sizing:border-box}body{font:14px sans-serif;background:#faf7ef}#root{display:flex;gap:24px}h2{font-size:14px}article{margin-bottom:12px}${readFileSync(join(root,"src/app/artwork.css"),"utf8")}</style></head><body><div id="root"></div><pre id="results"></pre><script>${script}</script></body></html>`);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 820, height: 1200 } });
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(pathToFileURL(html).href);
    await page.waitForFunction(() => document.body.dataset.result, { timeout: 15000 });
    await page.screenshot({ path: join(output,"layout.png"), fullPage: true });
    const result = await page.locator("body").getAttribute("data-result");
    const measurements = await page.locator("#results").textContent();
    writeFileSync(join(output,"measurements.json"), measurements);
    console.log(`Browser layout evidence: ${output}`);
    assert.deepEqual(errors, []);
    assert.equal(result, "pass", measurements);
    console.log("PASS: eight portrait/landscape/extreme-ratio previews at desktop/mobile widths fit their content boxes.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

