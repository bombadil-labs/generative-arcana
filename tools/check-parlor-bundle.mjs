import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
const root=new URL('../app/dist/',import.meta.url);
async function inspect(directory){for(const item of await readdir(directory,{withFileTypes:true})){const path=new URL(item.name+(item.isDirectory()?'/':''),directory);if(item.isDirectory())await inspect(path);else if(/\.(js|html|css|map)$/.test(item.name)){const body=await readFile(path,'utf8');for(const value of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','ELEVENLABS_API_KEY','PARLOR_MODELS_JSON','arcana_parlor_usage','reserved_microusd','synthetic-server-anthropic','synthetic-server-openai','synthetic-server-voice','parlor-build-secret-canary'])assert.ok(!body.includes(value),`Server-only parlor symbol or secret canary in browser artifact: ${item.name}`);}}}
await inspect(root);console.log('Browser artifacts contain no server credential/configuration symbols or synthetic secret canaries.');
