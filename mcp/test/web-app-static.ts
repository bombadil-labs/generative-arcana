import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isArcanaMachinePath, serveArcanaWebApp } from "../src/webAppStatic";

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "arcana-web-static-"));
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "index.html"), "<!doctype html><title>Arcana</title>");
  await writeFile(join(dir, "assets", "app.js"), "console.log('arcana')");

  const server = createServer((req, res) => {
    if (!serveArcanaWebApp(req, res, dir)) {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    let response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(await response.text(), /Arcana/);

    for (const path of ["/parlor", "/parlor/"]) {
      const parlor = await fetch(`${base}${path}`);
      assert.equal(parlor.status, 200);
      assert.match(parlor.headers.get("content-type") ?? "", /^text\/html/);
      assert.match(await parlor.text(), /Arcana/);
    }

    response = await fetch(`${base}/assets/app.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /immutable/);
    assert.match(response.headers.get("content-type") ?? "", /^text\/javascript/);

    response = await fetch(`${base}/some/future/route`);
    assert.equal(response.status, 200, "unknown application routes should fall back to index.html");
    assert.match(await response.text(), /Arcana/);

    for (const path of ["//api/missing", "///.well-known/missing", "/api", "/api/unknown", "/auth/missing", "/mcp/unknown", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server", "/readyz/extra", "/%61pi/unknown", "/%2ewell-known/unknown"]) {
      response = await fetch(`${base}${path}`);
      assert.equal(response.status, 404, `${path} must not fall back to HTML`);
    }
    assert.equal(isArcanaMachinePath("//api//unknown"), true);
    assert.equal(isArcanaMachinePath("/apiary"), false, "namespace boundaries should preserve ordinary app routes");
    assert.equal(isArcanaMachinePath("/author"), false);

    response = await fetch(`${base}/`, { method: "HEAD" });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");

    response = await fetch(`${base}/`, { method: "POST" });
    assert.equal(response.status, 404, "static app handler must not consume mutations");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
