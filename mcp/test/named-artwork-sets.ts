import assert from "node:assert/strict";
import sharp from "sharp";
import { createServer } from "node:http";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { CardArtworkService, InMemoryArtworkRepository, InMemoryArtworkStorage, ArtworkError, type ArtworkMetadata, type ArtworkPackSummary } from "../src/cardArtwork";
import { InMemoryUserDeckCatalogRepository } from "../src/userDeckCatalog";
import { InMemoryArcanaHostStore } from "../src/hostStore";
import { createArcanaMcpServer } from "../src/server";
import { createWebArtworkHandler } from "../src/webArtworkApi";
import { neutralManifest, toolResult, textContent } from "./protocol-fixtures";

const catalog = new InMemoryUserDeckCatalogRepository();
const manifest = neutralManifest("named-artwork");
const deck = await catalog.createImported("alice", manifest);
const records = new InMemoryArtworkRepository(catalog);
const storage = new InMemoryArtworkStorage();
const service = new CardArtworkService(catalog, records, storage);
const png = async (background: string) => sharp({ create: { width: 16, height: 24, channels: 3, background } }).png().toBuffer();
const red = await png("red"); const blue = await png("blue");
const createInput = { ownerId: "alice", deckId: deck.id, expectedDeckRevision: 1 };
const uploadInput = { ...createInput, cardSlug: "major-0", expectedArtworkId: null, mediaType: "image/png", bytes: red };
const status = (expected: number) => (error: unknown) => error instanceof ArtworkError && error.status === expected;
await assert.rejects(service.createPack({ ...createInput, ownerId: "bob", packId: "claude", label: "Claude" }), status(404));
await assert.rejects(service.createPack({ ...createInput, expectedDeckRevision: 2, packId: "claude", label: "Claude" }), status(409));
await assert.rejects(service.createPack({ ...createInput, packId: "saved-artwork", label: "Reserved" }), status(400));
await assert.rejects(service.createPack({ ...createInput, packId: "../escape", label: "Bad" }), status(400));
const claudePack = await service.createPack({ ...createInput, packId: "claude", label: "Claude" });
assert.deepEqual(await service.createPack({ ...createInput, packId: "claude", label: "Claude" }), claudePack, "create retry is idempotent");
await assert.rejects(service.createPack({ ...createInput, packId: "claude", label: "Changed" }), status(409));
await service.createPack({ ...createInput, packId: "gpt", label: "GPT" });
let downloads = 0;
const limited = new CardArtworkService(catalog,records,storage,async () => false);
const {bytes: _bytes,...lazyInput} = uploadInput;
await assert.rejects(limited.upload({...lazyInput,packId:"claude",loadBytes:async () => { downloads++; return red; }}),status(429));
assert.equal(downloads,0,"rate rejection happens before native image retrieval");
await assert.rejects(service.upload({...lazyInput,ownerId:"bob",packId:"claude",loadBytes:async () => { downloads++; return red; }}),status(404));
assert.equal(downloads,0,"owner rejection happens before native image retrieval");
const legacy = await service.upload(uploadInput);
const claude = await service.upload({ ...uploadInput, packId: "claude" });
const gpt = await service.upload({ ...uploadInput, packId: "gpt", bytes: blue });
assert.equal(storage.objects.size, 3, "same card in separate sets retains all three images");
assert.equal((await service.metadata("alice", deck.id, "major-0")).id, legacy.id);
assert.equal((await service.metadata("alice", deck.id, "major-0", "claude")).id, claude.id);
assert.notEqual(claude.integrity, gpt.integrity);
await assert.rejects(service.upload({ ...uploadInput, packId: "gpt", expectedArtworkId: claude.id }), status(409));
await assert.rejects(service.upload({ ...uploadInput, packId: "unknown" }), status(404));
await assert.rejects(service.metadata("alice", deck.id, "major-6", "gpt"), status(404));
await assert.rejects(service.listPacks("bob", deck.id), status(404));
const changed = await Promise.all([
  service.upload({ ...uploadInput, packId: "claude", expectedArtworkId: claude.id, bytes: blue }),
  service.upload({ ...uploadInput, packId: "gpt", expectedArtworkId: gpt.id, bytes: red }),
]);
assert.equal(storage.objects.size, 3, "replacement deletes only that set's previous image");
assert.equal((await service.metadata("alice", deck.id, "major-0")).id, legacy.id);
assert.equal((await service.metadata("alice", deck.id, "major-0", "claude")).id, changed[0].id);
assert.equal((await service.metadata("alice", deck.id, "major-0", "gpt")).id, changed[1].id);
const listing = await service.readableCards("alice", deck.id, "gpt");
assert.equal(listing.packId, "gpt"); assert.equal(listing.cards.find(card => card.slug === "major-6")?.artwork, null);
assert.deepEqual(listing.packs.map(pack => [pack.id, pack.cardCount]), [["saved-artwork",1],["claude",1],["gpt",1]]);
assert.deepEqual((await catalog.get(deck.id))?.manifest, manifest, "set creation/uploads never change semantic content");
assert.equal((await catalog.get(deck.id))?.revision, 1);

const oauth = { requestOfflineAccess: true, resourceMetadataUrl: "https://arcana.test/.well-known/oauth-protected-resource/mcp", readScopes: ["decks:read"], writeScopes: ["decks:write"] };
const principal = { id: "alice", scopes: ["decks:read", "decks:write"] };
const handler = createWebArtworkHandler({ catalog, hosts: new InMemoryArcanaHostStore(), artwork: service, oauth,
  principalResolver: { async resolve(req: { headers: Headers }) { return req.headers.get("authorization") === "Bearer alice" ? principal : req.headers.get("authorization") === "Bearer read" ? { id: "alice", scopes: ["decks:read"] } : null; } },
});
const http = createServer((req,res) => void handler(req,res));
await new Promise<void>(resolve => http.listen(0,"127.0.0.1",resolve));
const address = http.address(); if (!address || typeof address === "string") throw new Error("No listener");
const base = `http://127.0.0.1:${address.port}`;
const headers = { authorization: "Bearer alice", "content-type": "application/json" };
const setPath = `${base}/api/me/decks/${deck.id}/artwork/sets`;
try {
  const body = JSON.stringify({ id: "website", label: "Website", expectedDeckRevision: 1 });
  assert.equal((await fetch(setPath,{method:"POST",headers:{...headers,authorization:"Bearer read"},body})).status,403);
  assert.equal((await fetch(setPath,{method:"POST",headers,body})).status,201);
  let response = await fetch(`${base}/api/me/decks/${deck.id}/cards/major-0/artwork?packId=website`, { method: "PUT", body: blue, headers: { authorization: "Bearer alice", "content-type": "image/png", "x-arcana-deck-revision": "1", "x-arcana-artwork-version": "none" } });
  assert.equal(response.status,201); const web = await response.json() as ArtworkMetadata;
  assert.equal(web.packId,"website"); assert.ok(web.imageUrl.includes("packId=website"));
  response = await fetch(base+web.imageUrl,{headers}); assert.equal(response.status,200);
  response = await fetch(`${base}/api/decks/${deck.id}/cards/major-0/artwork?packId=missing`,{headers}); assert.equal(response.status,404);
  response = await fetch(`${base}/api/decks/${deck.id}/artwork?packId=website`,{headers}); assert.equal(response.status,200); assert.equal((await response.json() as {packId:string}).packId,"website");
  response = await fetch(`${base}/api/decks/${deck.id}/artwork?packId=website`); assert.equal(response.status,404);
} finally { await new Promise<void>(resolve => http.close(() => resolve())); }

const server = createArcanaMcpServer({ catalog, artwork: service, principal, oauth: { ...oauth, principal } });
const client = new Client({name:"named-artwork-tests",version:"1"});
const [left,right] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(left),client.connect(right)]);
try {
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.find(tool => tool.name === "set_card_artwork")?._meta?.["openai/fileParams"],["file"]);
  assert.deepEqual(tools.tools.find(tool => tool.name === "create_visual_pack")?._meta?.securitySchemes,[{type:"oauth2",scopes:["decks:read","decks:write","offline_access"]}]);
  const empty = toolResult<ArtworkPackSummary>(await client.callTool({name:"create_visual_pack",arguments:{deckId:deck.id,packId:"empty",label:"Empty",expectedDeckRevision:1}}));
  assert.equal(empty.cardCount,0);
  const packs = toolResult<ArtworkPackSummary[]>(await client.callTool({name:"list_visual_packs",arguments:{deckId:deck.id}}));
  assert.ok(packs.some(pack => pack.id === "empty" && pack.cardCount === 0),"empty named sets remain discoverable");
  const metadataOnly = await client.callTool({name:"get_card_artwork",arguments:{deckId:deck.id,cardSlug:"major-0",packId:"claude",includeImage:false}});
  assert.equal(toolResult<ArtworkMetadata>(metadataOnly).id,changed[0].id); assert.ok(!metadataOnly.content.some(part => part.type === "image"));
  const missing = await client.callTool({name:"get_card_art",arguments:{deckId:deck.id,cardSlug:"major-0",packId:"empty"}});
  assert.equal(missing.isError,true); assert.match(textContent(missing),/no artwork/);
  const rejectedNative = await client.callTool({name:"set_card_artwork",arguments:{deckId:deck.id,cardSlug:"major-6",packId:"gpt",mediaType:"image/png",expectedDeckRevision:1,expectedArtworkId:null,file:{file_id:"test",download_url:"https://example.com/not-a-native-file.png",mime_type:"image/png"}}});
  assert.equal(rejectedNative.isError,true); assert.match(textContent(rejectedNative),/approved ChatGPT/);
  const bothInputs = await client.callTool({name:"set_card_artwork",arguments:{deckId:deck.id,cardSlug:"major-6",packId:"gpt",mediaType:"image/png",expectedDeckRevision:1,expectedArtworkId:null,base64:red.toString("base64"),file:{file_id:"test",download_url:"https://example.com/image.png"}}});
  assert.equal(bothInputs.isError,true);
  for (const cardSlug of Object.keys(manifest.data.cards).filter(slug => slug !== "major-0")) await service.upload({...uploadInput,cardSlug,packId:"claude"});
  const cast = toolResult<{token:string}>(await client.callTool({name:"cast_reading",arguments:{deckId:deck.id,spread:"single"}}));
  const failedRender = await client.callTool({name:"render_reading",arguments:{token:cast.token,packId:"empty"}});
  assert.equal(failedRender.isError,true); assert.match(textContent(failedRender),/missing art/);
  const render = await client.callTool({name:"render_reading",arguments:{token:cast.token,packId:"claude"}});
  assert.equal(render.isError,undefined,textContent(render));
  const rendered = (render.structuredContent as {result:{layout:{packId:string};placements:{packId:string}[]}}).result;
  assert.equal(rendered.layout.packId,"claude"); assert.ok(rendered.placements.every(card => card.packId === "claude"));
  assert.ok(render.content.some(part => part.type === "image"));
} finally { await client.close(); await server.close(); }
await catalog.setVisibility("alice",deck.id,"public");
assert.equal((await service.listPacks(null,deck.id)).length,5);
await catalog.setVisibility("alice",deck.id,"private");
await assert.rejects(service.image(null,deck.id,"major-0",undefined,"claude"),status(404));
await catalog.deleteOwned("alice",deck.id);
await assert.rejects(service.listPacks("alice",deck.id),status(404));
const limitDeck = await catalog.createImported("alice",neutralManifest("pack-limit"));
for (let i=0;i<32;i++) await service.createPack({ownerId:"alice",deckId:limitDeck.id,expectedDeckRevision:1,packId:`set-${i}`,label:`Set ${i}`});
await assert.rejects(service.createPack({ownerId:"alice",deckId:limitDeck.id,expectedDeckRevision:1,packId:"one-too-many",label:"Limit"}),status(400));
console.log("Named artwork sets: owner/revision CAS, independent assets, HTTP/MCP selection, native-file rejection and strict rendering passed.");
