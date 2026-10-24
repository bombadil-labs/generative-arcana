// Synthetic native-fetch regression; no app account, provider or microphone.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import ts from 'typescript';
const source = await readFile(new URL('../src/parlor/runtimeTranscript.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext(); const requests = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).pathname !== '/api/parlor/transcript') return route.fulfill({ contentType: 'text/html', body: '<title>Synthetic transcript fixture</title>' });
    const body = route.request().postDataJSON(); requests.push(body);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body.start ? { token: 'synthetic-receipt' } : { accepted: body.events.length }) });
  });
  const page = await context.newPage(); await page.goto('http://localhost/');
  await page.evaluate(code => { const exports = {}; new Function('exports', code)(exports); window.sink = new exports.RuntimeTranscript(); window.sink.event({ kind: 'user_input', text: 'Synthetic native fetch input' }); }, compiled);
  await page.waitForTimeout(1000);
  assert.equal(requests.length, 2, 'native browser fetch submits registration and a text event');
  assert.equal(requests[1].events[0].text, 'Synthetic native fetch input');
  await page.evaluate(() => window.sink.dispose());
  console.log('PASS: native browser fetch registers and writes synthetic transcript events.');
} finally { await browser.close(); }
