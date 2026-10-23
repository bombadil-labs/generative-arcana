import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
const root=new URL('../app/dist/',import.meta.url);
async function inspect(directory){for(const item of await readdir(directory,{withFileTypes:true})){const path=new URL(item.name+(item.isDirectory()?'/':''),directory);if(item.isDirectory())await inspect(path);else if(/\.(js|html|css|map)$/.test(item.name)){const body=await readFile(path,'utf8');for(const value of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','ELEVENLABS_API_KEY','PARLOR_MODELS_JSON','PARLOR_OWNER_KEYS_ENABLED','PARLOR_OWNER_ANTHROPIC_MODEL','arcana_parlor_usage','reserved_microusd','synthetic-server-anthropic','synthetic-server-openai','synthetic-server-voice','synthetic-owner-anthropic-secret','synthetic-owner-eleven-secret','parlor-build-secret-canary'])assert.ok(!body.includes(value),`Server-only parlor symbol or secret canary in browser artifact: ${item.name}`);}}}
await inspect(root);console.log('Browser artifacts contain no server credential/configuration symbols or synthetic secret canaries.');
const files=await readdir(new URL('assets/',root));
assert.ok(files.some(name=>/^parlor-.*\.js$/.test(name)),'Parlor must have a separate private JavaScript chunk');
const html=await readFile(new URL('index.html',root),'utf8');
assert.ok(!/<(?:script|link)[^>]*(?:src|href)="[^"]*assets\/parlor-/.test(html),'Public HTML must not preload Parlor assets');
for(const name of files.filter(name=>/\.(?:js|css)$/.test(name)&&!name.startsWith('parlor-'))) {
  const content=await readFile(new URL(`assets/${name}`,root),'utf8');
  for(const privateMarker of ['anthropic-dangerous-direct-browser-access','parlor-ritual','arcana:parlor:credentials','scribe_v2','eleven_v3'])
    assert.ok(!content.includes(privateMarker),`Private Parlor implementation leaked into ${name}`);
  assert.ok(!/\b(?:import|export)[^;]*\bfrom\s*["'][^"']*\/parlor-/.test(content),`Public bundle statically imports private Parlor code: ${name}`);
}
console.log('Parlor implementation is isolated from public entry assets and is never preloaded.');
