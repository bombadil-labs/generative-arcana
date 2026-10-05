import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const base = process.env.MIGRATION_BASE_SHA;
if (!base || !/^[0-9a-f]{40}$/.test(base) || /^0+$/.test(base)) throw new Error('Exact migration comparison base SHA required');
const git = (...args) => execFileSync('git',args,{encoding:'utf8'});
const files = git('ls-tree','-r','--name-only',base,'mcp/migrations').trim().split('\n');
for (const file of files.filter(f => /\/\d+.*\.sql$/.test(f))) {
  assert.equal(await readFile(file,'utf8'),git('show',`${base}:${file}`), `Deployed SQL is immutable: ${file}`);
}
if (files.includes('mcp/migrations/catalog.json')) {
  const old = JSON.parse(git('show',`${base}:mcp/migrations/catalog.json`));
  const current = JSON.parse(await readFile('mcp/migrations/catalog.json','utf8'));
  assert.deepEqual(current.slice(0,old.length),old,'Historical catalog entries are immutable');
}
console.log('Historical migration bytes and catalog entries preserved.');
