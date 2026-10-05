import assert from "node:assert/strict";
import sharp from "sharp";
import { createServer } from "node:http";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { CardArtworkService, InMemoryArtworkRepository, InMemoryArtworkStorage, ArtworkError, type PackArtworkMetadata } from "../src/cardArtwork";
import { createWebArtworkHandler, isArtworkPath } from "../src/webArtworkApi";
import { InMemoryUserDeckCatalogRepository } from "../src/userDeckCatalog";
import { InMemoryArcanaHostStore } from "../src/hostStore";
import { createArcanaMcpServer } from "../src/server";
import { neutralManifest, toolResult } from "./protocol-fixtures";
import { validateVisualPackForDeck } from "../../app/src/visuals/manifest";

const png = await sharp({ create: { width: 64, height: 96, channels: 3, background: "#345678" } }).png().toBuffer();
const catalog = new InMemoryUserDeckCatalogRepository();
const deck = await catalog.createImported("alice", neutralManifest());
const repository = new InMemoryArtworkRepository(catalog);
const storage = new InMemoryArtworkStorage();
const service = new CardArtworkService(catalog, repository, storage);
const fails = (status: number) => (error: unknown) => error instanceof ArtworkError && error.status === status;
const input = { ownerId: "alice", deckId: deck.id, slot: "cover" as const, expectedDeckRevision: 1, expectedArtworkId: null, mediaType: "image/png", bytes: png };
await service.createPack({ ownerId: "alice", deckId: deck.id, packId: "ink", label: "Ink", expectedDeckRevision: 1 });
await assert.rejects(service.uploadPackAsset({ ...input, ownerId: "bob" }), fails(404));
await assert.rejects(service.uploadPackAsset({ ...input, expectedDeckRevision: 2 }), fails(409));
await assert.rejects(service.uploadPackAsset({ ...input, packId: "missing" }), fails(404));
await assert.rejects(service.uploadPackAsset({ ...input, slot: "major-0" as "cover" }), fails(400));
await assert.rejects(service.uploadPackAsset({ ...input, mediaType: "image/svg+xml", bytes: Buffer.from("<svg/>") }), fails(415));
await assert.rejects(service.uploadPackAsset({ ...input, bytes: Buffer.alloc(3_000_001) }), fails(413));
assert.equal(storage.objects.size, 0);
const originalManifest = JSON.stringify((await catalog.get(deck.id))!.manifest);
const cover = await service.uploadPackAsset(input);
const back = await service.uploadPackAsset({ ...input, slot: "cardBack" });
const namedCover = await service.uploadPackAsset({ ...input, packId: "ink" });
assert.equal(cover.width / cover.height, 2 / 3, "aspect ratio preserved");
assert.equal("cardSlug" in cover, false);
assert.equal("cards" in cover.visualPack, false);
assert.deepEqual(cover.visualPack.cover, { asset: "image" });
assert.deepEqual(back.visualPack.cardBack, { asset: "image" });
assert.equal(validateVisualPackForDeck(cover.visualPack, deck.manifest).ok, true);
assert.equal(validateVisualPackForDeck(back.visualPack, deck.manifest).ok, true);
assert.ok(!JSON.stringify(cover).includes("objectKey"));
assert.equal((await catalog.get(deck.id))!.revision, 1);
assert.equal(JSON.stringify((await catalog.get(deck.id))!.manifest), originalManifest);
const summary = (await service.listPacks("alice", deck.id)).find(pack => pack.id === "saved-artwork")!;
assert.equal(summary.cardCount, 0); assert.equal(summary.complete, false);
assert.equal(summary.hasCover, true); assert.equal(summary.hasCardBack, true);
let cards = await service.ownedCards("alice", deck.id);
assert.equal(cards.cover?.id, cover.id); assert.equal(cards.cardBack?.id, back.id);
assert.equal(cards.cards.length, Object.keys(deck.manifest.data.cards).length);
assert.ok(cards.cards.every(card => !card.artwork), "pack assets are never front images");
const named = await service.readableCards("alice", deck.id, "ink");
assert.equal(named.cover?.id, namedCover.id); assert.equal(named.cardBack, null, "never borrow another pack's back");
await assert.rejects(service.packAssetMetadata("alice", deck.id, "cardBack", "ink"), fails(404));
for (const cardSlug of Object.keys(deck.manifest.data.cards)) await service.upload({ ...input, cardSlug });
const complete = (await service.listPacks("alice", deck.id)).find(pack => pack.id === "saved-artwork")!;
assert.equal(complete.cardCount, Object.keys(deck.manifest.data.cards).length); assert.equal(complete.complete, true);
const replacements = await Promise.allSettled([service.uploadPackAsset({ ...input, expectedArtworkId: cover.id }), service.uploadPackAsset({ ...input, expectedArtworkId: cover.id })]);
assert.equal(replacements.filter(result => result.status === "fulfilled").length, 1);
assert.equal(storage.objects.size, Object.keys(deck.manifest.data.cards).length + 3, "old and rejected objects cleaned up, other slots retained");
await assert.rejects(service.packAssetImage("alice", deck.id, "cover", cover.id), fails(404));
assert.equal((await service.packAssetMetadata("alice", deck.id, "cardBack")).id, back.id);
assert.equal((await service.packAssetMetadata("alice", deck.id, "cover", "ink")).id, namedCover.id);
await assert.rejects(service.packAssetImage(null, deck.id, "cover"), fails(404));
await catalog.setVisibility("alice", deck.id, "unlisted");
assert.ok((await service.packAssetImage(null, deck.id, "cover")).bytes.length);
await assert.rejects(service.uploadPackAsset({ ...input, slot: "cardBack", expectedArtworkId: back.id }), fails(409));
const revoking = new CardArtworkService(catalog, repository, { put: storage.put.bind(storage), delete: storage.delete.bind(storage), get: async key => { const bytes = await storage.get(key); await catalog.setVisibility("alice", deck.id, "private"); return bytes; } });
await assert.rejects(revoking.packAssetImage(null, deck.id, "cover"), fails(404));
const corrupt = new CardArtworkService(catalog, repository, { put: storage.put.bind(storage), delete: storage.delete.bind(storage), get: async () => Buffer.from("bad") });
await assert.rejects(corrupt.packAssetImage("alice", deck.id, "cardBack"), fails(503));
let loads = 0;
const native = { ...input, bytes: undefined, loadBytes: async () => { loads++; return png; } };
await assert.rejects(service.uploadPackAsset({ ...native, ownerId: "bob" }), fails(404));
assert.equal(loads, 0, "owner checks precede native downloads");
const currentCover = await service.packAssetMetadata("alice", deck.id, "cover");
const noQuota = new CardArtworkService(catalog, repository, storage, async () => false);
await assert.rejects(noQuota.uploadPackAsset({ ...native, expectedDeckRevision: currentCover.deckRevision, expectedArtworkId: currentCover.id }), fails(429));
assert.equal(loads, 0, "shared rate gate precedes native downloads");

// Recheck ownership/revision under the attachment lock after a slow object write.
const racedDeck = await catalog.createImported("alice", neutralManifest("pack-race"));
const racedStorage = new InMemoryArtworkStorage();
const raced = new CardArtworkService(catalog, repository, { put: async (key, bytes) => { await racedStorage.put(key, bytes); await catalog.deleteOwned("alice", racedDeck.id); }, get: racedStorage.get.bind(racedStorage), delete: racedStorage.delete.bind(racedStorage) });
await assert.rejects(raced.uploadPackAsset({ ...input, deckId: racedDeck.id }), fails(404));
assert.equal(racedStorage.objects.size,0,"definitely rejected write cleans up its new object");
const uncertainDeck = await catalog.createImported("alice", neutralManifest("pack-uncertain"));
const uncertainStorage = new InMemoryArtworkStorage();
const uncertainRepository = new Proxy(repository, { get(target, key) { if (key === "attachPackAsset") return async () => { throw new Error("commit outcome unknown"); }; const value = Reflect.get(target,key); return typeof value === "function" ? value.bind(target) : value; } });
const uncertain = new CardArtworkService(catalog, uncertainRepository, uncertainStorage);
await assert.rejects(uncertain.uploadPackAsset({ ...input, deckId: uncertainDeck.id }), /commit outcome unknown/);
assert.equal(uncertainStorage.objects.size,1,"unknown outcomes retain potentially committed objects");

const oauth = { requestOfflineAccess: true, resourceMetadataUrl: "https://arcana.test/.well-known/oauth-protected-resource/mcp", readScopes: ["decks:read"], writeScopes: ["decks:write"] };
const principal = { id: "alice", scopes: ["decks:read", "decks:write"] };
const handler = createWebArtworkHandler({ catalog, hosts: new InMemoryArcanaHostStore(), artwork: service, oauth,
  principalResolver: { async resolve(req: { headers: Headers }) { if (req.headers.get("authorization") === "Bearer alice") return principal; if (req.headers.get("authorization") === "Bearer read") return { id: "alice", scopes: ["decks:read"] }; return null; } },
});
const http = createServer((req, res) => void handler(req, res));
await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
const address = http.address(); if (!address || typeof address === "string") throw new Error("no listener");
const base = `http://127.0.0.1:${address.port}`, path = `/api/me/decks/${deck.id}/artwork/assets/cardBack?packId=ink`;
assert.equal(isArtworkPath(path.split("?")[0]), true);
assert.equal(isArtworkPath(`/api/decks/${deck.id}/artwork/assets/cardBack/image`), true);
assert.equal(isArtworkPath(`/api/decks/${deck.id}/artwork/assets/not-a-slot`), false);
try {
  assert.equal((await fetch(base + path, { method: "PUT", body: png })).status, 401);
  assert.equal((await fetch(base + path, { method: "PUT", headers: { authorization: "Bearer read" }, body: png })).status, 403);
  assert.equal((await fetch(base + path, { method: "PUT", headers: { authorization: "Bearer alice" }, body: png })).status, 400);
  const headers = { authorization: "Bearer alice", "content-type": "image/png", "x-arcana-deck-revision": String(currentCover.deckRevision), "x-arcana-artwork-version": "none" };
  const saved = await fetch(base + path, { method: "PUT", headers, body: png }); assert.equal(saved.status, 201);
  const metadata = await saved.json() as PackArtworkMetadata;
  assert.equal(metadata.slot, "cardBack"); assert.equal(metadata.packId, "ink");
  assert.equal((await fetch(base + path, { method: "PUT", headers, body: png })).status, 409);
  assert.equal((await fetch(base + metadata.imageUrl)).status, 404);
  const image = await fetch(base + metadata.imageUrl, { headers: { authorization: "Bearer alice" } });
  assert.equal(image.status, 200); assert.equal(image.headers.get("cache-control"), "private, no-store");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff"); assert.equal(image.headers.get("content-type"), "image/webp");
  assert.equal((await image.arrayBuffer()).byteLength, metadata.byteLength);
} finally { await new Promise<void>(resolve => http.close(() => resolve())); }

async function connect(who: typeof principal | null) {
  const server = createArcanaMcpServer({ catalog, artwork: service, principal: who, oauth: { ...oauth, principal: who } });
  const client = new Client({ name: "pack-artwork-test", version: "1" }); const [left, right] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(left), client.connect(right)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
const anonymous = await connect(null);
try {
  const write = (await anonymous.client.listTools()).tools.find(tool => tool.name === "set_visual_pack_asset")!;
  assert.equal(write.annotations?.destructiveHint, true); assert.deepEqual(write._meta?.["openai/fileParams"], ["file"]);
  assert.deepEqual(write._meta?.securitySchemes, [{ type: "oauth2", scopes: ["decks:read", "decks:write", "offline_access"] }]);
  const denied = await anonymous.client.callTool({ name: "set_visual_pack_asset", arguments: { ...input, ownerId: undefined, bytes: undefined, base64: png.toString("base64") } });
  assert.equal(denied.isError, true); assert.ok(denied._meta?.["mcp/www_authenticate"]);
} finally { await anonymous.close(); }
const authed = await connect(principal);
try {
  const summaries = toolResult<Array<{ id: string; hasCover?: boolean; hasCardBack?: boolean; cardCount: number }>>(await authed.client.callTool({ name: "list_visual_packs", arguments: { deckId: deck.id } }));
  assert.equal(summaries.find(pack => pack.id === "ink")?.hasCover, true);
  assert.equal(summaries.find(pack => pack.id === "ink")?.hasCardBack, true);
  assert.equal(summaries.find(pack => pack.id === "ink")?.cardCount, 0);
  const current = await service.packAssetMetadata("alice", deck.id, "cover");
  const args = { deckId: deck.id, slot: "cover", expectedDeckRevision: current.deckRevision, expectedArtworkId: current.id, mediaType: "image/png", base64: png.toString("base64") };
  const saved = toolResult<PackArtworkMetadata>(await authed.client.callTool({ name: "set_visual_pack_asset", arguments: args }));
  const read = await authed.client.callTool({ name: "get_visual_pack_asset", arguments: { deckId: deck.id, slot: "cover", includeImage: false } });
  assert.equal(toolResult<PackArtworkMetadata>(read).id, saved.id); assert.ok(read.content.every(part => part.type !== "image"));
  const image = await authed.client.callTool({ name: "get_visual_pack_asset", arguments: { deckId: deck.id, slot: "cardBack" } });
  assert.ok(image.content.some(part => part.type === "image"));
  assert.equal((await authed.client.callTool({ name: "set_visual_pack_asset", arguments: { ...args, expectedArtworkId: saved.id, base64: "data:image/png;base64," + args.base64 } })).isError, true);
  assert.equal((await authed.client.callTool({ name: "set_visual_pack_asset", arguments: { ...args, expectedArtworkId: saved.id, file: { file_id: "test", download_url: "https://example.com/image.png" } } })).isError, true);
  assert.equal((await authed.client.callTool({ name: "set_visual_pack_asset", arguments: { ...args, expectedArtworkId: saved.id, base64: undefined, file: { file_id: "test", download_url: "https://example.com/image.png" } } })).isError, true);
} finally { await authed.close(); }
await catalog.deleteOwned("alice", deck.id);
await assert.rejects(service.packAssetImage("alice", deck.id, "cover"), fails(404));
console.log("Pack covers/backs: independent slots and front coverage, image safety, owner/revision CAS, visibility rechecks, HTTP/MCP authorization and transport passed.");
