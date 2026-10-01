import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { serveArcanaWebApp } from "../src/webAppStatic";

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "arcana-retired-assets-"));
  // Deliberately include stale files: source/archive routes must stay blocked even if copied.
  const retired = [
    "/decks/finalfantasy/deck.json",
    "/app/src/decks/finalfantasy/pixel/major-0.png",
    "/src/decks/evolution/pixel/major-0.png",
    "/src/decks/deep-time/scenes/coreSample.ts",
    "/src/decks/bundled.ts",
    "/generative-arcana-v2.0.zip",
  ];
  for (const path of ["/index.html", "/assets/custom-card.svg", "/assets/app.js", ...retired]) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), path === "/index.html" ? "<title>Arcana</title>" : "custom asset");
  }
  const server = createServer((req, res) => {
    if (!serveArcanaWebApp(req, res, dir)) res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const path of [...retired, "/%64ecks/finalfantasy/deck.json", "//src//decks//ultima//cards/major-0.ts", "/assets/major-0-oldhash.png", "/assets/retired", "/missing.json"]) {
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(`${base}${path}`, { method });
        assert.equal(response.status, 404, `${method} ${path} must not deliver legacy content or SPA HTML`);
      }
    }
    for (const path of ["/", "/new-route", "/assets/custom-card.svg", "/assets/app.js"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, `Generic/custom route ${path} remains available`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
