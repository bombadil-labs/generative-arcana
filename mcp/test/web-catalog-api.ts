import assert from "node:assert/strict";
import { createServer } from "node:http";
import deepTime from "../../decks/deep-time/deck.json";
import type { DeckDataFile } from "../../app/src/decks/types";
import type { ArcanaHostState, ArcanaHostStateRepository } from "../src/hostState";
import { PersistentArcanaHostStore } from "../src/hostStore";
import { StaticBearerPrincipalResolver } from "../src/alphaAuth";
import { InMemoryUserDeckCatalogRepository } from "../src/userDeckCatalog";
import { createArcanaWebCatalogRequestHandler } from "../src/webCatalogApi";

async function main(): Promise<void> {
  const catalog = new InMemoryUserDeckCatalogRepository();
  const hosts = new PersistentArcanaHostStore(new MemoryHostStateRepository(), undefined, catalog);
  const handler = createArcanaWebCatalogRequestHandler({
    catalog,
    hosts,
    principalResolver: new StaticBearerPrincipalResolver("secret", "usr_test"),
    browserPrincipalResolver: {
      async resolve(req) {
        return req.headers.cookie?.includes("arcana-session=test-browser") ? { id: "usr_test" } : null;
      },
    },
  });
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    let response = await fetch(`${base}/api/decks/public`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);

    response = await fetch(`${base}/api/me/decks`);
    assert.equal(response.status, 401);

    const data = structuredClone(deepTime) as unknown as DeckDataFile;
    data.slug = "web-import";
    data.name = "Web Import";
    response = await fetch(`${base}/api/me/decks`, {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ manifest: { data, tagline: "Imported through the web API" } }),
    });
    assert.equal(response.status, 201);
    const created = await response.json() as { id: string; slug: string; visibility: string; ownerId?: string };
    assert.ok(created.id);
    assert.notEqual(created.id, created.slug);
    assert.equal(created.slug, "web-import");
    assert.equal(created.visibility, "private");
    assert.equal(created.ownerId, undefined, "transport output must not expose opaque owner principal ids");

    response = await fetch(`${base}/api/me/decks`, { headers: { authorization: "Bearer secret" } });
    assert.equal(response.status, 200);
    const mine = await response.json() as Array<{ id: string }>;
    assert.equal(mine.some((deck) => deck.id === created.id), true);

    response = await fetch(`${base}/api/me/decks`, { headers: { cookie: "arcana-session=test-browser" } });
    assert.equal(response.status, 200, "browser session resolver reaches the same owned catalog without exposing a bearer token");
    const browserMine = await response.json() as Array<{ id: string }>;
    assert.equal(browserMine.some((deck) => deck.id === created.id), true);

    response = await fetch(`${base}/api/me/decks`, {
      headers: { authorization: "Bearer wrong", cookie: "arcana-session=test-browser" },
    });
    assert.notEqual(response.status, 200, "an invalid bearer credential must not downgrade to a valid browser cookie");

    response = await fetch(`${base}/api/decks/${created.id}`);
    assert.equal(response.status, 404, "private deck existence must remain hidden from anonymous callers");

    response = await fetch(`${base}/api/me/decks/${created.id}`, {
      method: "PATCH",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ visibility: "public" }),
    });
    assert.equal(response.status, 200);

    response = await fetch(`${base}/api/decks/public`);
    assert.equal(response.status, 200);
    const publicDecks = await response.json() as Array<{ id: string }>;
    assert.equal(publicDecks.some((deck) => deck.id === created.id), true);

    response = await fetch(`${base}/api/decks/${created.id}`);
    assert.equal(response.status, 200);
    const shared = await response.json() as { id: string; manifest: { data: { slug: string } }; ownerId?: string };
    assert.equal(shared.id, created.id);
    assert.equal(shared.manifest.data.slug, "web-import");
    assert.equal(shared.ownerId, undefined);

    response = await fetch(`${base}/api/me/decks/${created.id}`, {
      method: "DELETE",
      headers: { authorization: "Bearer secret" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: created.id, deleted: true });

    response = await fetch(`${base}/api/decks/${created.id}`);
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

class MemoryHostStateRepository implements ArcanaHostStateRepository {
  private readonly values = new Map<string, unknown>();
  async load(scopeId: string): Promise<unknown | null> { return this.values.has(scopeId) ? structuredClone(this.values.get(scopeId)) : null; }
  async save(scopeId: string, state: ArcanaHostState): Promise<void> { this.values.set(scopeId, structuredClone(state)); }
  async delete(scopeId: string): Promise<boolean> { return this.values.delete(scopeId); }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
