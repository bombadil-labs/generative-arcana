import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build, createServer, preview } from "vite";
import { auditPublicDistribution, ARCHIVED_DIRECTORIES } from "../../tools/check-public-distribution.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(appRoot, "..");
const configFile = join(appRoot, "vite.config.ts");
const retiredPaths = [
  "/decks/finalfantasy/deck.json", "/src/decks/finalfantasy/pixel/major-0.png",
  "/app/src/decks/evolution/pixel/major-0.png", "/src/decks/deep-time/scenes/coreSample.ts",
  "/src/decks/bundled.ts", "/src/decks/composeBundledDeckData.ts", "/generative-arcana-v2.0.zip",
  "/%64ecks/ultima/deck.json", "/src/decks/%75lysses/cards/major-0.ts",
  `/@fs/${repositoryRoot}/decks/finalfantasy/deck.json`,
  `/@fs/${repositoryRoot}/app/src/decks/finalfantasy/pixel/major-0.png`,
  `/@fs/${repositoryRoot}/generative-arcana-v2.0.zip`,
];

async function assertRetiredRoutes(server, extra = []) {
  const base = server.resolvedUrls.local[0].replace(/\/$/, "");
  for (const path of [...retiredPaths, ...extra]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await fetch(`${base}${path}`, { method });
      assert.equal(response.status, 404, `${method} ${path} must not expose retired content or fallback HTML`);
    }
  }
  return base;
}

test("development source and raw filesystem routes do not expose archived decks", async () => {
  const server = await createServer({ configFile, root: appRoot, logLevel: "silent", server: { host: "127.0.0.1", port: 0 } });
  try {
    await server.listen();
    const base = await assertRetiredRoutes(server);
    assert.equal((await fetch(`${base}/src/decks/cardMeta.ts`)).status, 200, "Generic shared metadata remains loadable");
  } finally { await server.close(); }
});

test("preview blocks copied source/archive files and old hashed asset URLs", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "arcana-preview-policy-"));
  const dist = join(fixture, "dist");
  for (const path of ["index.html", "assets/custom.svg", "decks/finalfantasy/deck.json", "generative-arcana-v2.0.zip"]) {
    await mkdir(dirname(join(dist, path)), { recursive: true });
    await writeFile(join(dist, path), path === "index.html" ? "<title>Arcana</title>" : "custom bytes");
  }
  const server = await preview({ configFile, root: fixture, logLevel: "silent", build: { outDir: "dist" }, preview: { host: "127.0.0.1", port: 0 } });
  try {
    const base = await assertRetiredRoutes(server, ["/assets/major-0-retiredhash.png", "/missing.json", "/assets/missing"]);
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/assets/custom.svg`)).status, 200, "Custom art remains available");
    assert.equal((await fetch(`${base}/future/route`)).status, 200, "Application fallback remains available");
  } finally {
    await server.close();
    await rm(fixture, { recursive: true, force: true });
  }
});

test("build refuses archived corpus imports while preserving the historical files", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "arcana-build-policy-"));
  try {
    await writeFile(join(fixture, "index.html"), '<script type="module" src="/entry.js"></script>');
    const archivedData = join(repositoryRoot, "decks/finalfantasy/deck.json");
    await writeFile(join(fixture, "entry.js"), `import data from ${JSON.stringify(archivedData)}; document.body.textContent = data.name;`);
    await assert.rejects(build({ configFile, root: fixture, logLevel: "silent", build: { outDir: "dist" } }), /Archived deck sources cannot enter the public build/);
    assert.ok((await readFile(archivedData)).byteLength > 0, "The historical source remains intact");
    await writeFile(join(fixture, "entry.js"), 'document.body.textContent = "Custom decks welcome";');
    await build({ configFile, root: fixture, logLevel: "silent", build: { outDir: "dist" } });
    auditPublicDistribution({ root: repositoryRoot, distDir: join(fixture, "dist") });
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("distribution audit rejects copied legacy image bytes and ZIP files", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "arcana-dist-audit-"));
  try {
    await writeFile(join(fixture, "index.html"), "<title>Arcana</title>");
    const image = await readFile(join(appRoot, "src/decks/finalfantasy/pixel/major-0.png"));
    await writeFile(join(fixture, "renamed-art.png"), image);
    assert.throws(() => auditPublicDistribution({ root: repositoryRoot, distDir: fixture }), /Legacy source\/art leaked/);
    await rm(join(fixture, "renamed-art.png"));
    await writeFile(join(fixture, "generative-arcana-v2.0.zip"), "archival bytes");
    assert.throws(() => auditPublicDistribution({ root: repositoryRoot, distDir: fixture }), /Archive leaked/);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

test("both production Docker contexts exclude historical files before any COPY", async () => {
  for (const path of [".dockerignore", "mcp/Dockerfile.dockerignore"]) {
    const patterns = new Set((await readFile(join(repositoryRoot, path), "utf8")).split(/\r?\n/));
    for (const excluded of ["decks", ...ARCHIVED_DIRECTORIES.map((name) => `app/src/decks/${name}`), "app/src/decks/bundled.ts", "app/src/decks/composeBundledDeckData.ts", "**/*.zip"]) {
      assert.ok(patterns.has(excluded), `${path} must exclude ${excluded}`);
    }
  }
  for (const path of ["Dockerfile.vercel", "mcp/Dockerfile"]) {
    const dockerfile = await readFile(join(repositoryRoot, path), "utf8");
    assert.doesNotMatch(dockerfile, /COPY decks /);
    assert.match(dockerfile, /check-public-distribution\.mjs --runtime \/srv/);
  }
});
