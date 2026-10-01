#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ARCHIVED_DIRECTORIES = ["byrne", "deep-time", "evolution", "finalfantasy", "ultima", "ultima-octave", "ulysses"];
const ARCHIVED_ENTRYPOINTS = ["bundled.ts", "composeBundledDeckData.ts"];
const LEGACY_IDENTITIES = ["final-fantasy-tarot", "deep-time", "ultima-tarot", "ultima-octave", "byrne-journey-tarot", "ulysses-tarot", "evolution-and-consciousness"];

/** Reject copied archives, source directories, and emitted legacy art/data in a public artifact. */
export function auditPublicDistribution({ root = repositoryRoot, distDir = join(root, "app/dist"), runtime = false } = {}) {
  if (runtime) {
    for (const path of ["decks", ...ARCHIVED_DIRECTORIES.map((name) => `app/src/decks/${name}`), ...ARCHIVED_ENTRYPOINTS.map((name) => `app/src/decks/${name}`)]) {
      assert.equal(existsSync(join(root, path)), false, `Runtime must exclude historical sources: ${path}`);
    }
    for (const path of walk(root, true)) {
      assert.doesNotMatch(path, /\.zip$/i, `Runtime must exclude source archives: ${path}`);
    }
  }
  if (runtime && !existsSync(distDir)) return;
  assert.ok(existsSync(join(distDir, "index.html")), `Build output missing: ${distDir}`);

  const legacyDigests = new Map();
  for (const source of [join(root, "decks"), ...ARCHIVED_DIRECTORIES.map((name) => join(root, "app/src/decks", name))]) {
    for (const file of walk(source)) {
      legacyDigests.set(digest(readFileSync(file)), relative(root, file));
    }
  }
  for (const file of walk(distDir)) {
    const path = relative(distDir, file).replace(/\\/g, "/");
    assert.doesNotMatch(path, /(?:^|\/)(?:decks|src)\//, `Source tree leaked into build: ${path}`);
    assert.doesNotMatch(path, /\.zip$/i, `Archive leaked into build: ${path}`);
    const content = readFileSync(file);
    const legacySource = legacyDigests.get(digest(content));
    assert.equal(legacySource, undefined, `Legacy source/art leaked into build: ${path} matches ${legacySource}`);
    if (/\.(?:js|css|html|json|map)$/i.test(path)) {
      const text = content.toString("utf8");
      for (const id of LEGACY_IDENTITIES) assert.ok(!text.includes(id), `Legacy identity ${id} leaked into ${path}`);
    }
  }
}

function* walk(path, skipDependencies = false) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  assert.ok(!stat.isSymbolicLink(), `Public artifact must not contain source symlinks: ${path}`);
  if (stat.isFile()) { yield path; return; }
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(path)) {
    if (skipDependencies && ["node_modules", ".git", ".test-build"].includes(entry)) continue;
    yield* walk(join(path, entry), skipDependencies);
  }
}
function digest(content) { return createHash("sha256").update(content).digest("hex"); }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const runtimeIndex = process.argv.indexOf("--runtime");
  if (runtimeIndex !== -1) {
    assert.ok(process.argv[runtimeIndex + 1], "--runtime requires a root path");
    auditPublicDistribution({ root: resolve(process.argv[runtimeIndex + 1]), runtime: true });
  } else {
    auditPublicDistribution();
  }
  console.log("Public distribution excludes archived deck sources, artwork, data, and ZIPs.");
}
