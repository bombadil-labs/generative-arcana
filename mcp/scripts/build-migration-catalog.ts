import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { directory, digest, schema, type Entry } from './domain-migrations';
const previous: Entry[] = JSON.parse(await readFile(new URL('catalog.json', directory), 'utf8'));
const db = new PGlite();
const entries: Entry[] = [];
try {
  for (const file of (await readdir(directory)).filter(f => /^\d+.*\.sql$/.test(f)).sort()) {
    const sql = await readFile(new URL(file, directory), 'utf8');
    await db.exec(sql);
    const entry = {version:entries.length+1,file,sha256:digest(sql),schema:await schema(db)};
    if (previous[entries.length]) assert.deepEqual(entry,previous[entries.length], 'Historical catalog entry changed; restore it, do not regenerate deployed history');
    entries.push(entry);
  }
  assert.ok(entries.length >= previous.length, 'Historical migration removed');
  if (process.argv.includes('--check')) assert.deepEqual(entries,previous,'Unregistered migration: append and review the catalog');
  else await writeFile(new URL('catalog.json', directory), JSON.stringify(entries, null, 2) + '\n');
} finally { await db.close(); }
