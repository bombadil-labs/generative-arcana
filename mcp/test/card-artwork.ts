import assert from "node:assert/strict";
import sharp from "sharp";
import { createServer } from "node:http";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { CardArtworkService, InMemoryArtworkRepository, InMemoryArtworkStorage, normalizeArtwork, ArtworkError, type ArtworkMetadata } from "../src/cardArtwork";
import { artworkStorageConfiguration } from "../src/artworkStorage";
import { createWebArtworkHandler } from "../src/webArtworkApi";
import { InMemoryUserDeckCatalogRepository } from "../src/userDeckCatalog";
import { InMemoryArcanaHostStore } from "../src/hostStore";
import { createArcanaMcpServer } from "../src/server";
import { neutralManifest, toolResult } from "./protocol-fixtures";

const png = await sharp({ create: { width: 32, height: 48, channels: 3, background: "#5e3487" } }).png().toBuffer();
const catalog = new InMemoryUserDeckCatalogRepository();
const deck = await catalog.createImported("alice", neutralManifest());
const other = await catalog.createImported("bob", neutralManifest("other"));
const records = new InMemoryArtworkRepository(catalog);
const storage = new InMemoryArtworkStorage();
const service = new CardArtworkService(catalog, records, storage);
const input = { ownerId: "alice", deckId: deck.id, cardSlug: "major-0", expectedDeckRevision: 1, expectedArtworkId: null, mediaType: "image/png", bytes: png };
const status = (expected: number) => (error: unknown) => error instanceof ArtworkError && error.status === expected;
await assert.rejects(service.upload({ ...input, ownerId: "bob" }), status(404));
await assert.rejects(service.upload({ ...input, deckId: other.id }), status(404));
await assert.rejects(service.upload({ ...input, cardSlug: "missing" }), status(404));
assert.equal(storage.objects.size, 0);
await assert.rejects(normalizeArtwork(png, "image/jpeg"), status(415));
await assert.rejects(normalizeArtwork(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "image/svg+xml"), status(415));
await assert.rejects(normalizeArtwork(Buffer.from("not an image"), "image/png"), status(415));
await assert.rejects(normalizeArtwork(Buffer.alloc(3_000_001), "image/png"), status(413));
const huge = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: "white" } }).png().toBuffer();
await assert.rejects(normalizeArtwork(huge, "image/png"), status(415));
for (const format of ["jpeg", "webp"] as const) {
  const bytes = await sharp(png)[format]().toBuffer();
  assert.equal((await normalizeArtwork(bytes, `image/${format}`)).width, 32);
}
// Animation control is rejected before raster decoding, including formats a decoder might flatten.
const apng = Buffer.concat([png.subarray(0, 8), Buffer.from([0,0,0,0,97,99,84,76,0,0,0,0]), png.subarray(8)]);
await assert.rejects(normalizeArtwork(apng, "image/png"), status(415));
const animatedWebp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([12,0,0,0]), Buffer.from("WEBPANIM"), Buffer.alloc(4)]);
await assert.rejects(normalizeArtwork(animatedWebp, "image/webp"), status(415));
const withExif = await sharp(png).withExif({ IFD0: { Copyright: "SHOULD_NOT_SURVIVE" } }).jpeg().toBuffer();
assert.equal((await sharp((await normalizeArtwork(withExif, "image/jpeg")).bytes).metadata()).exif, undefined);
const first = await service.upload(input);
assert.equal(first.deckId, deck.id); assert.equal(first.cardSlug, "major-0");
assert.equal(first.mediaType, "image/webp"); assert.equal(first.visualPack.cards?.["major-0"].asset, "image");
assert.ok(!JSON.stringify(first).includes("objectKey") && !JSON.stringify(first).includes("alice"));
assert.equal((await catalog.get(deck.id))?.revision, 1, "artwork does not alter card meaning or deck revision");
await assert.rejects(service.image(null, deck.id, "major-0"), status(404));
assert.deepEqual((await service.image("alice", deck.id, "major-0")).metadata, first);
await assert.rejects(service.upload(input), status(409));
const concurrent = await Promise.allSettled([service.upload({ ...input, expectedArtworkId: first.id }), service.upload({ ...input, expectedArtworkId: first.id })]);
assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1, "CAS protects independent uploads");
assert.equal(storage.objects.size, 1, "old/rejected objects cleaned up");
let current = await service.metadata("alice", deck.id, "major-0");
await assert.rejects(service.image("alice", deck.id, "major-0", first.id), status(404));
await catalog.setVisibility("alice", deck.id, "unlisted");
assert.ok((await service.image(null, deck.id, "major-0")).bytes.length);
await assert.rejects(service.upload({ ...input, expectedArtworkId: current.id }), status(409));
await catalog.setVisibility("alice", deck.id, "private");
await assert.rejects(service.image(null, deck.id, "major-0"), status(404));
const paused = new CardArtworkService(catalog, records, storage, async () => false);
await assert.rejects(paused.upload({ ...input, expectedDeckRevision: 3, expectedArtworkId: current.id }), status(429));
// Revoke during object retrieval: no bytes may escape the late permission check.
const revoking = new CardArtworkService(catalog, records, { ...storage, put: storage.put.bind(storage), delete: storage.delete.bind(storage), get: async key => { const bytes = await storage.get(key); await catalog.setVisibility("alice", deck.id, "private"); return bytes; } });
await catalog.setVisibility("alice", deck.id, "public");
await assert.rejects(revoking.image(null, deck.id, "major-0"), status(404));
// Integrity and opaque provider failures are checked instead of serving corrupted bytes.
const corrupt = new CardArtworkService(catalog, records, { put: storage.put.bind(storage), delete: storage.delete.bind(storage), get: async () => Buffer.from("bad") });
await assert.rejects(corrupt.image("alice", deck.id, "major-0"), status(503));
assert.equal(artworkStorageConfiguration({}), undefined);
assert.throws(() => artworkStorageConfiguration({ ARCANA_ARTWORK_ENABLED: "true" }), /DATABASE_HOST/);
assert.throws(() => artworkStorageConfiguration({ ARCANA_ARTWORK_ENABLED: "true", ARCANA_ARTWORK_DATABASE_HOST: "preview.example", DATABASE_URL: "postgres://user@production.example/db" }), /does not match/);

// Recheck ownership/revision after slow storage writes, and preserve ambiguous commit outcomes.
const raceDeck = await catalog.createImported("alice", neutralManifest("race"));
const raceStorage = new InMemoryArtworkStorage();
const raced = new CardArtworkService(catalog, records, { put: async (key, bytes) => { await raceStorage.put(key, bytes); await catalog.deleteOwned("alice", raceDeck.id); }, get: raceStorage.get.bind(raceStorage), delete: raceStorage.delete.bind(raceStorage) });
await assert.rejects(raced.upload({ ...input, deckId: raceDeck.id }), status(404));
assert.equal(raceStorage.objects.size, 0);
const uncertainDeck = await catalog.createImported("alice", neutralManifest("uncertain"));
const uncertainStorage = new InMemoryArtworkStorage();
const uncertain = new CardArtworkService(catalog, { getPackAsset: records.getPackAsset.bind(records), listPackAssets: records.listPackAssets.bind(records), attachPackAsset: records.attachPackAsset.bind(records), get: records.get.bind(records), list: records.list.bind(records), listPacks: records.listPacks.bind(records), createPack: records.createPack.bind(records), attach: async () => { throw new Error("Connection lost during commit"); } }, uncertainStorage);
await assert.rejects(uncertain.upload({ ...input, deckId: uncertainDeck.id }), /Connection lost/);
assert.equal(uncertainStorage.objects.size, 1, "ambiguous outcomes must never delete potentially committed artwork");

const oauth = { requestOfflineAccess: true, resourceMetadataUrl: "https://arcana.test/.well-known/oauth-protected-resource/mcp", readScopes: ["decks:read"], writeScopes: ["decks:write"] };
const principal = { id: "alice", scopes: ["decks:read", "decks:write"] };
const handlerOptions = { catalog, hosts: new InMemoryArcanaHostStore(), artwork: service, oauth,
  principalResolver: { async resolve(req: { headers: Headers }) { const token = req.headers.get("authorization"); if (token === "Bearer alice") return principal; if (token === "Bearer read") return { id: "alice", scopes: ["decks:read"] }; if (token === "Bearer bob") return { id: "bob", scopes: ["decks:read", "decks:write"] }; return null; } },
};
const handler = createWebArtworkHandler(handlerOptions);
const http = createServer((req, res) => void handler(req, res));
await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
const address = http.address(); if (!address || typeof address === "string") throw new Error("no listener");
const base = `http://127.0.0.1:${address.port}`;
const ownPath = `/api/me/decks/${deck.id}/cards/major-0/artwork`;
try {
  assert.equal((await fetch(base + `/api/me/decks/${deck.id}/artwork`)).status, 401);
  assert.equal((await fetch(base + `/api/decks/${deck.id}/artwork`)).status, 404);
  assert.equal((await fetch(base + `/api/decks/${deck.id}/artwork`, { headers: { authorization: "Bearer bob" } })).status, 404);
  let response = await fetch(base + `/api/me/decks/${deck.id}/artwork`, { headers: { authorization: "Bearer alice" } });
  assert.equal(response.status, 200); const listing = await response.json() as { deckRevision: number };
  response = await fetch(base + ownPath, { method: "PUT", headers: { authorization: "Bearer read" }, body: png }); assert.equal(response.status, 403);
  response = await fetch(base + ownPath, { method: "PUT", headers: { authorization: "Bearer alice" }, body: png }); assert.equal(response.status, 400);
  const headers = { authorization: "Bearer alice", "content-type": "image/png", "x-arcana-deck-revision": String(listing.deckRevision), "x-arcana-artwork-version": current.id };
  response = await fetch(base + ownPath, { method: "PUT", headers, body: png }); assert.equal(response.status, 201);
  current = await response.json() as ArtworkMetadata;
  response = await fetch(base + ownPath, { method: "PUT", headers, body: png }); assert.equal(response.status, 409);
  response = await fetch(base + current.imageUrl, { headers: { authorization: "Bearer alice" } }); assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp"); assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.ok((await response.arrayBuffer()).byteLength);
} finally { await new Promise<void>(resolve => http.close(() => resolve())); }

async function connect(who: typeof principal | null) {
  const server = createArcanaMcpServer({ catalog, artwork: service, principal: who, oauth: { ...oauth, principal: who } });
  const client = new Client({ name: "artwork-test", version: "1" }); const [left, right] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(left), client.connect(right)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
const anonymous = await connect(null);
try {
  const tools = await anonymous.client.listTools(); const write = tools.tools.find(tool => tool.name === "set_card_artwork"); assert.ok(write);
  assert.equal(write.annotations?.destructiveHint, true);
  assert.deepEqual(write._meta?.securitySchemes, [{ type: "oauth2", scopes: ["decks:read", "decks:write", "offline_access"] }]);
  const denied = await anonymous.client.callTool({ name: "set_card_artwork", arguments: { deckId: deck.id, cardSlug: "major-0", expectedDeckRevision: 5, expectedArtworkId: current.id, mediaType: "image/png", base64: png.toString("base64") } });
  assert.equal(denied.isError, true); assert.ok(denied._meta?.["mcp/www_authenticate"]);
} finally { await anonymous.close(); }
const authed = await connect(principal);
try {
  const args = { deckId: deck.id, cardSlug: "major-0", expectedDeckRevision: (await catalog.get(deck.id))!.revision, expectedArtworkId: current.id, mediaType: "image/png", base64: png.toString("base64") };
  assert.equal((await authed.client.callTool({ name: "set_card_artwork", arguments: { ...args, base64: "data:image/png;base64," + args.base64 } })).isError, true);
  const saved = toolResult<ArtworkMetadata>(await authed.client.callTool({ name: "set_card_artwork", arguments: args }));
  const result = await authed.client.callTool({ name: "get_card_artwork", arguments: { deckId: deck.id, cardSlug: "major-0" } });
  assert.equal(result.isError, undefined); assert.ok(result.content.some(part => part.type === "image" && part.mimeType === "image/webp"));
  assert.equal(toolResult<ArtworkMetadata>(result).id, saved.id);
  const legacy = await authed.client.callTool({ name: "get_card_art", arguments: { deckId: deck.id, cardSlug: "major-0" } });
  assert.equal(legacy.isError, undefined); assert.ok(legacy.content.some(part => part.type === "image"));
  const packs = toolResult<Array<{id:string; cardCount:number}>>(await authed.client.callTool({ name: "list_visual_packs", arguments: { deckId: deck.id } }));
  assert.equal(packs.find(pack => pack.id === "saved-artwork")?.cardCount, 1);
} finally { await authed.close(); }
await catalog.deleteOwned("alice", deck.id);
await assert.rejects(service.image("alice", deck.id, "major-0"), status(404));
console.log("Card artwork validation, ownership, races, HTTP and MCP tests passed.");
