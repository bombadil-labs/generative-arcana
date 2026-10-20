// GitHub Pages cannot enforce session authorization. Do not publish private Parlor assets there.
import { readdir, unlink } from 'node:fs/promises';
const assets = new URL('../app/dist/assets/', import.meta.url);
for (const name of await readdir(assets)) {
  if (/^parlor-[^/]+\.(?:js|css|map)$/.test(name)) await unlink(new URL(name, assets));
}
console.log('Private Parlor assets excluded from the static GitHub Pages artifact.');
