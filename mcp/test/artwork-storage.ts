import assert from "node:assert/strict";
import { S3PrivateArtworkStorage, artworkStorageConfiguration } from "../src/artworkStorage";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
const env = { ARCANA_ARTWORK_ENABLED: "true", DATABASE_URL: "postgres://fixture@db.preview.invalid/arcana", ARCANA_ARTWORK_DATABASE_HOST: "db.preview.invalid", ARCANA_ARTWORK_S3_ENDPOINT: "https://storage.preview.invalid", ARCANA_ARTWORK_S3_REGION: "us-east-1", ARCANA_ARTWORK_S3_BUCKET: "private-fixture", ARCANA_ARTWORK_S3_ACCESS_KEY_ID: "test-only-id", ARCANA_ARTWORK_S3_SECRET_ACCESS_KEY: "test-only-secret" };
const configuration = artworkStorageConfiguration(env)!;
assert.equal(configuration.bucket, "private-fixture");
assert.equal(artworkStorageConfiguration({ ...env, ARCANA_ARTWORK_ENABLED: "false" }), undefined);
for (const endpoint of ["http://storage.invalid", "https://name:password@storage.invalid", "https://storage.invalid/path", "https://storage.invalid/?query=1"]) assert.throws(() => artworkStorageConfiguration({ ...env, ARCANA_ARTWORK_S3_ENDPOINT: endpoint }));
const direct = "ep-summer-sunset-b74erymn.c-13.us-east-1.aws.neon.tech";
const pooled = "ep-summer-sunset-b74erymn-pooler.c-13.us-east-1.aws.neon.tech";
assert.ok(artworkStorageConfiguration({ ...env, ARCANA_ARTWORK_DATABASE_HOST: direct, DATABASE_URL: `postgres://fixture@${pooled}/db` }));
assert.ok(artworkStorageConfiguration({ ...env, ARCANA_ARTWORK_DATABASE_HOST: pooled, DATABASE_URL: `postgres://fixture@${direct}/db` }));
for (const host of ["ep-other-pooler.c-13.us-east-1.aws.neon.tech", "ep-summer-sunset-b74erymn-pooler.c-14.us-east-1.aws.neon.tech", "ep-summer-sunset-b74erymn-pooler.c-13.us-east-2.aws.neon.tech", "ep-summer-sunset-b74erymn-pooler.c-13.us-east-1.aws.neon.tech.evil.invalid"]) {
  assert.throws(() => artworkStorageConfiguration({ ...env, ARCANA_ARTWORK_DATABASE_HOST: direct, DATABASE_URL: `postgres://fixture@${host}/db` }), /does not match/);
}
assert.throws(() => artworkStorageConfiguration({ ...env, ARCANA_ARTWORK_DATABASE_HOST: "db.preview.invalid", DATABASE_URL: "postgres://fixture@db-pooler.preview.invalid/db" }), /does not match/, "pooler equivalence is restricted to verified Neon AWS host shape");
const storage = new S3PrivateArtworkStorage(configuration);
// Replace only the SDK transport inside this test; no endpoint is contacted and no credentials leave the process.
let sent: unknown; let signal: AbortSignal | undefined;
const transport = (send: (command: unknown, options: {abortSignal?: AbortSignal}) => Promise<unknown>) => { (storage as unknown as { client: unknown }).client = { send }; };
transport(async (command, options) => { sent = command; signal = options.abortSignal; return {}; });
await storage.put("card-artwork/test.webp", Buffer.from("test"));
assert.ok(sent instanceof PutObjectCommand); assert.equal(sent.input.IfNoneMatch, "*"); assert.equal(sent.input.CacheControl, "private, no-store"); assert.ok(signal);
await storage.delete("card-artwork/test.webp"); assert.ok(sent instanceof DeleteObjectCommand); assert.ok(signal);
let canceled = false;
transport(async () => ({ ContentLength: 3, Body: { transformToWebStream: () => new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1,2,3])); controller.close(); }, cancel() { canceled = true; } }) } }));
assert.deepEqual(await storage.get("key"), Buffer.from([1,2,3]));
transport(async () => ({ ContentLength: 2_000_001, Body: { transformToWebStream: () => new ReadableStream({ cancel() { canceled = true; } }) } }));
await assert.rejects(storage.get("key"), /exceeds limit/); assert.equal(canceled, true);
transport(async () => ({ ContentLength: 1, Body: { transformToWebStream: () => new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2_000_001)); } }) } }));
await assert.rejects(storage.get("key"), /exceeds limit/, "lying ContentLength cannot bypass streaming byte limit");
// A body that never produces a chunk must be canceled by the total deadline, not only SDK header timers.
transport(async () => ({ ContentLength: 1, Body: { transformToWebStream: () => new ReadableStream({ cancel() { canceled = true; } }) } }));
canceled = false; const start = Date.now();
await assert.rejects(storage.get("key"), /timed out/);
assert.equal(canceled, true); assert.ok(Date.now() - start < 20_000);
console.log("Private S3 configuration, bounded streaming and complete-download deadline tests passed (mock transport, no provider access).");
