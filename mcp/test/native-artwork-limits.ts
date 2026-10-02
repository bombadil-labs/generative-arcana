import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, type ClientRequest, type IncomingMessage, type RequestOptions } from "node:http";
import type { request } from "node:https";
import { Readable } from "node:stream";
import sharp from "sharp";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  ArtworkError, CardArtworkService, InMemoryArtworkRepository, InMemoryArtworkStorage,
  MAX_ARTWORK_INPUT_BYTES, MAX_NATIVE_ARTWORK_INPUT_BYTES, MAX_ARTWORK_OUTPUT_BYTES, normalizeArtwork,
} from "../src/cardArtwork";
import { MAX_MCP_ARTWORK_BYTES } from "../src/artworkTools";
import { InMemoryArcanaHostStore } from "../src/hostStore";
import { MAX_MANIFEST_UPLOAD_BYTES, ManifestUploadError } from "../src/manifestUploads";
import { fetchNativeFile, type NativeFileTransport } from "../src/nativeManifestFile";
import { createArcanaMcpServer } from "../src/server";
import { InMemoryUserDeckCatalogRepository } from "../src/userDeckCatalog";
import { createWebArtworkHandler } from "../src/webArtworkApi";
import { neutralManifest, textContent, toolResult } from "./protocol-fixtures";

assert.equal(MAX_NATIVE_ARTWORK_INPUT_BYTES, 5_000_000);
assert.equal(MAX_ARTWORK_INPUT_BYTES, 3_000_000);
assert.equal(MAX_MCP_ARTWORK_BYTES, 1_000_000);
assert.equal(MAX_ARTWORK_OUTPUT_BYTES, 2_000_000);
assert.equal(MAX_MANIFEST_UPLOAD_BYTES, 2_000_000);

const colors = [[210, 40, 35], [30, 180, 60], [30, 70, 210], [210, 180, 30]];
/** A real RGB raster: four colored quadrants with deterministic per-channel grain. */
async function raster(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 0x12345678;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = colors[Number(x >= width / 2) + 2 * Number(y >= height / 2)];
      for (let channel = 0; channel < 3; channel++) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        pixels[(y * width + x) * 3 + channel] = color[channel] + ((seed >>> 0) % 15) - 7;
      }
    }
  }
  // Low compression makes the fixture large through real pixel data: no padding,
  // synthetic metadata, corrupt chunks, appended data, or mocked image decoder.
  const bytes = await sharp(pixels, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  const decoded = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, width); assert.equal(decoded.info.height, height);
  assert.deepEqual(decoded.data, pixels, "the entire PNG decodes back to its actual source pixels");
  assert.equal(bytes.toString("ascii", bytes.length - 8, bytes.length - 4), "IEND", "no trailing fake bytes");
  return { bytes, width, height };
}

const nativeFile = {
  file_id: "file-synthetic-artwork",
  download_url: "https://files.oaiusercontent.com/synthetic-artwork.png?fixture=private",
  mime_type: "image/png",
};
const nativeOptions = { maxBytes: MAX_NATIVE_ARTWORK_INPUT_BYTES, mediaTypes: ["image/png"] };
function transportFor(bytes: Buffer, announced = true, mediaType = "image/png") {
  let requests = 0; let lookups = 0; let destroyed = false;
  const transport: NativeFileTransport = {
    lookup: async hostname => { lookups++; assert.equal(hostname, "files.oaiusercontent.com"); return [{ address: "8.8.8.8" }]; },
    signal: () => new AbortController().signal,
    request: ((url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      requests++;
      assert.equal(url.protocol, "https:"); assert.equal(url.hostname, "files.oaiusercontent.com");
      assert.equal(options.agent, false);
      assert.equal((options.headers as Record<string, string>).authorization, undefined);
      const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      let response: IncomingMessage | undefined;
      req.destroy = () => { destroyed = true; response?.destroy(); };
      req.end = () => queueMicrotask(() => {
        const chunks: Buffer[] = [];
        for (let offset = 0; offset < bytes.length; offset += 64 * 1024) chunks.push(bytes.subarray(offset, offset + 64 * 1024));
        response = Readable.from(chunks) as IncomingMessage;
        response.statusCode = 200;
        response.headers = { "content-type": mediaType, ...(announced ? { "content-length": String(bytes.length) } : {}) };
        callback(response);
      });
      return req as unknown as ClientRequest;
    }) as typeof request,
  };
  return { transport, stats: () => ({ requests, lookups, destroyed }) };
}
const artworkStatus = (status: number, code?: string) => (error: unknown) =>
  error instanceof ArtworkError && error.status === status && (code === undefined || error.code === code);
const transportStatus = (status: number) => (error: unknown) => error instanceof ManifestUploadError && error.status === status;

const catalog = new InMemoryUserDeckCatalogRepository();
const deck = await catalog.createImported("alice", neutralManifest("native-artwork-limits"));
const foreignDeck = await catalog.createImported("bob", neutralManifest("foreign-native-artwork"));
const records = new InMemoryArtworkRepository(catalog);
const storage = new InMemoryArtworkStorage();
let quotaCalls = 0;
const service = new CardArtworkService(catalog, records, storage, async ownerId => {
  assert.equal(ownerId, "alice"); quotaCalls++; return true;
});
const base = { ownerId: "alice", deckId: deck.id, cardSlug: "lines-4", expectedDeckRevision: 1, expectedArtworkId: null as string | null, mediaType: "image/png" };
const unchangedDeck = await catalog.get(deck.id);

// Both ends of the newly admitted 3–5 MB range, including chunked retrieval and resizing.
const nativeRasters = [await raster(1024, 1024), await raster(1600, 1024), await raster(4352, 256)];
const slots = ["major-0", "major-6", "lines-1"];
for (const [index, source] of nativeRasters.entries()) {
  assert.ok(source.bytes.length > MAX_ARTWORK_INPUT_BYTES && source.bytes.length < MAX_NATIVE_ARTWORK_INPUT_BYTES);
  const fixture = transportFor(source.bytes, index !== 1);
  const metadata = await service.upload({ ...base, cardSlug: slots[index], loadBytes: () => {
    assert.equal(quotaCalls, index + 1, "quota is checked before native retrieval");
    return fetchNativeFile(nativeFile, nativeOptions, fixture.transport);
  } });
  assert.deepEqual(fixture.stats(), { requests: 1, lookups: 1, destroyed: false });
  assert.equal(metadata.mediaType, "image/webp");
  assert.ok(metadata.byteLength > 0 && metadata.byteLength <= MAX_ARTWORK_OUTPUT_BYTES);
  const expectedWidth = Math.min(source.width, 4096);
  const expectedHeight = Math.round(source.height * expectedWidth / source.width);
  assert.equal(metadata.width, expectedWidth); assert.equal(metadata.height, expectedHeight);
  assert.equal(metadata.visualPack.cards?.[slots[index]].asset, "image");
  assert.ok(!JSON.stringify(metadata).includes("objectKey"));
  assert.ok(!JSON.stringify(metadata).includes(nativeFile.download_url));
  const record = await records.get(deck.id, slots[index]); assert.ok(record);
  const stored = storage.objects.get(record.objectKey); assert.ok(stored);
  assert.equal(stored.byteLength, metadata.byteLength);
  assert.ok(!Buffer.from(stored).equals(source.bytes), "store normalized bytes, never the original native PNG");
  const decoded = await sharp(stored).raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, expectedWidth); assert.equal(decoded.info.height, expectedHeight);
  assert.equal((await sharp(stored).metadata()).format, "webp");
  for (const [quadrant, expected] of colors.entries()) {
    const x = Math.floor(expectedWidth * (quadrant % 2 === 0 ? 0.25 : 0.75));
    const y = Math.floor(expectedHeight * (quadrant < 2 ? 0.25 : 0.75));
    const offset = (y * expectedWidth + x) * decoded.info.channels;
    for (let channel = 0; channel < 3; channel++) {
      assert.ok(Math.abs(decoded.data[offset + channel] - expected[channel]) < 25, "normalized pixels preserve the source quadrant colors");
    }
  }
  assert.deepEqual((await service.image("alice", deck.id, slots[index])).bytes, stored);
  await assert.rejects(service.image(null, deck.id, slots[index]), artworkStatus(404));
  await assert.rejects(service.image("bob", deck.id, slots[index]), artworkStatus(404));
}
assert.deepEqual(await catalog.get(deck.id), unchangedDeck, "native artwork leaves meanings, manifest, revision and visibility unchanged");

const overNative = await raster(1536, 1152);
assert.ok(overNative.bytes.length > MAX_NATIVE_ARTWORK_INPUT_BYTES);
for (const announced of [true, false]) {
  const fixture = transportFor(overNative.bytes, announced);
  await assert.rejects(service.upload({ ...base, loadBytes: () => fetchNativeFile(nativeFile, nativeOptions, fixture.transport) }), transportStatus(413));
  assert.deepEqual(fixture.stats(), { requests: 1, lookups: 1, destroyed: true }, "announced and chunked native limits both stop retrieval");
}
// The trusted loader's own result remains bounded even if a caller omits fetchNativeFile.
await assert.rejects(service.upload({ ...base, loadBytes: async () => overNative.bytes }), artworkStatus(413, "artwork_size"));
const invalidLimit = transportFor(nativeRasters[0].bytes);
await assert.rejects(fetchNativeFile(nativeFile, { ...nativeOptions, maxBytes: MAX_NATIVE_ARTWORK_INPUT_BYTES + 1 }, invalidLimit.transport), transportStatus(400));
assert.deepEqual(invalidLimit.stats(), { requests: 0, lookups: 0, destroyed: false });
// A larger absolute native ceiling does not relax the manifest caller's separate budget.
for (const announced of [true, false]) {
  const fixture = transportFor(nativeRasters[0].bytes, announced, "application/octet-stream");
  await assert.rejects(fetchNativeFile({ ...nativeFile, mime_type: "application/octet-stream" }, {
    maxBytes: MAX_MANIFEST_UPLOAD_BYTES, mediaTypes: ["application/octet-stream"],
  }, fixture.transport), transportStatus(413));
  assert.deepEqual(fixture.stats(), { requests: 1, lookups: 1, destroyed: true });
}

// Neither direct service callers nor the public normalizer inherit the native ceiling.
for (const { bytes } of nativeRasters) {
  await assert.rejects(normalizeArtwork(bytes, "image/png"), artworkStatus(413, "artwork_size"));
  await assert.rejects(service.upload({ ...base, bytes }), artworkStatus(413, "artwork_size"));
}
await assert.rejects(service.upload({ ...base, loadBytes: async () => Buffer.from("not a PNG") }), artworkStatus(415, "artwork_format"));
await assert.rejects(service.upload({ ...base, mediaType: "image/jpeg", loadBytes: async () => nativeRasters[0].bytes }), artworkStatus(415, "artwork_format"));
assert.equal(storage.objects.size, 3, "all rejected inputs leave existing private artwork untouched");
assert.equal(await records.get(deck.id, base.cardSlug), null);

// Authorization, slot CAS and quota rejection precede ANY native loading.
let blockedLoads = 0; let blockedQuotaCalls = 0;
const blockedTransport = transportFor(nativeRasters[0].bytes);
const blockedLoad = () => { blockedLoads++; return fetchNativeFile(nativeFile, nativeOptions, blockedTransport.transport); };
const blocked = new CardArtworkService(catalog, records, storage, async () => { blockedQuotaCalls++; return false; });
const gateCases = [
  { label: "non-owner", change: { ownerId: "bob" }, status: 404 },
  { label: "foreign deck", change: { deckId: foreignDeck.id }, status: 404 },
  { label: "missing card", change: { cardSlug: "missing" }, status: 404 },
  { label: "missing set", change: { packId: "missing" }, status: 404 },
  { label: "stale deck revision", change: { expectedDeckRevision: 2 }, status: 409 },
  { label: "stale empty slot", change: { expectedArtworkId: "00000000-0000-4000-8000-000000000000" }, status: 409 },
  { label: "occupied slot", change: { cardSlug: "major-0" }, status: 409 },
];
for (const test of gateCases) await assert.rejects(blocked.upload({ ...base, ...test.change, loadBytes: blockedLoad }), artworkStatus(test.status), test.label);
assert.equal(blockedQuotaCalls, 0, "authorization and CAS precede quota consumption");
await assert.rejects(blocked.upload({ ...base, loadBytes: blockedLoad }), artworkStatus(429, "artwork_rate_limit"));
assert.equal(blockedQuotaCalls, 1); assert.equal(blockedLoads, 0);
assert.deepEqual(blockedTransport.stats(), { requests: 0, lookups: 0, destroyed: false });

// The concurrency gate also stays ahead of the native loader.
const busyDeck = await catalog.createImported("alice", neutralManifest("native-artwork-busy"));
const busyStorage = new InMemoryArtworkStorage();
const busy = new CardArtworkService(catalog, records, busyStorage);
const tiny = await raster(32, 48);
let release!: () => void;
const pending = new Promise<void>(resolve => { release = resolve; });
const started: Array<Promise<void>> = [];
const running = ["major-0", "major-6"].map(cardSlug => {
  let entered!: () => void;
  started.push(new Promise<void>(resolve => { entered = resolve; }));
  return busy.upload({ ...base, deckId: busyDeck.id, cardSlug, loadBytes: async () => { entered(); await pending; return tiny.bytes; } });
});
try {
  await Promise.all(started);
  await assert.rejects(busy.upload({ ...base, deckId: busyDeck.id, loadBytes: blockedLoad }), artworkStatus(429, "artwork_busy"));
  assert.equal(blockedLoads, 0);
} finally { release(); await Promise.all(running); }

const principal = { id: "alice", scopes: ["decks:read", "decks:write"] };
const oauth = { resourceMetadataUrl: "https://arcana.test/.well-known/oauth-protected-resource/mcp", readScopes: ["decks:read"], writeScopes: ["decks:write"] };
const webHandler = createWebArtworkHandler({ catalog, hosts: new InMemoryArcanaHostStore(), artwork: service, oauth,
  principalResolver: { async resolve(req: { headers: Headers }) { return req.headers.get("authorization") === "Bearer alice" ? principal : null; } },
});
const http = createServer((req, res) => void webHandler(req, res));
await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
const address = http.address(); assert.ok(address && typeof address !== "string");
try {
  const response = await fetch(`http://127.0.0.1:${address.port}/api/me/decks/${deck.id}/cards/${base.cardSlug}/artwork`, {
    method: "PUT", headers: { authorization: "Bearer alice", "content-type": "image/png", "x-arcana-deck-revision": "1", "x-arcana-artwork-version": "none" },
    body: nativeRasters[0].bytes,
  });
  assert.equal(response.status, 413, "the website retains its 3 MB request limit");
  assert.equal((await response.json() as { error: string }).error, "artwork_size");
} finally { await new Promise<void>(resolve => { http.close(() => resolve()); http.closeAllConnections(); }); }

// A raster between 1 MB and 3 MB is valid directly but remains forbidden inline.
const inlineOversize = await raster(768, 512);
assert.ok(inlineOversize.bytes.length > MAX_MCP_ARTWORK_BYTES && inlineOversize.bytes.length < MAX_ARTWORK_INPUT_BYTES);
assert.equal((await normalizeArtwork(inlineOversize.bytes, "image/png")).width, inlineOversize.width);
const server = createArcanaMcpServer({ catalog, artwork: service, principal, oauth: { ...oauth, principal } });
const client = new Client({ name: "native-artwork-limits-test", version: "1" });
const [left, right] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(left), client.connect(right)]);
try {
  const tool = (await client.listTools()).tools.find(tool => tool.name === "set_card_artwork"); assert.ok(tool);
  assert.deepEqual(tool._meta?.["openai/fileParams"], ["file"]);
  const properties = tool.inputSchema.properties as Record<string, { maxLength?: number }>;
  assert.equal(properties.base64.maxLength, 4 * Math.ceil(MAX_MCP_ARTWORK_BYTES / 3));
  const args = { deckId: deck.id, cardSlug: base.cardSlug, expectedDeckRevision: 1, expectedArtworkId: null, mediaType: "image/png" };
  const rejected = await client.callTool({ name: "set_card_artwork", arguments: { ...args, base64: inlineOversize.bytes.toString("base64") } });
  assert.equal(rejected.isError, true, textContent(rejected));
  assert.equal(await records.get(deck.id, base.cardSlug), null); assert.equal(storage.objects.size, 3);
  const accepted = toolResult<{ mediaType: string; width: number; height: number }>(await client.callTool({ name: "set_card_artwork", arguments: { ...args, base64: tiny.bytes.toString("base64") } }));
  assert.equal(accepted.mediaType, "image/webp"); assert.equal(accepted.width, tiny.width); assert.equal(accepted.height, tiny.height);
} finally { await client.close(); await server.close(); }

console.log(`Native artwork limits passed: real ${nativeRasters.map(source => source.bytes.length).join("/")} byte PNGs normalize to private WebP <=2 MB; native >5 MB, direct/HTTP >3 MB, inline >1 MB and manifest >2 MB refuse; ownership, CAS, quota and busy gates precede loading.`);
