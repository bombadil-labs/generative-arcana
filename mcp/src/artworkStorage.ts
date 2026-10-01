import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { MAX_ARTWORK_OUTPUT_BYTES, type PrivateArtworkStorage } from "./cardArtwork";

export interface ArtworkStorageConfiguration { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }
/** Explicit opt-in; never pick up unrelated AWS credentials or fall back to another provider. */
export function artworkStorageConfiguration(env: NodeJS.ProcessEnv = process.env): ArtworkStorageConfiguration | undefined {
  if (env.ARCANA_ARTWORK_ENABLED !== "true") return undefined;
  const required = (name: string) => { const value = env[name]?.trim(); if (!value) throw new Error(`Artwork requires ${name}.`); return value; };
  const expectedDatabaseHost = required("ARCANA_ARTWORK_DATABASE_HOST");
  if (!env.DATABASE_URL || normalizeNeonDatabaseHost(new URL(env.DATABASE_URL).hostname) !== normalizeNeonDatabaseHost(expectedDatabaseHost)) throw new Error("Artwork database host does not match the explicitly configured branch.");
  const endpoint = required("ARCANA_ARTWORK_S3_ENDPOINT");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Artwork storage endpoint must be an HTTPS origin.");
  const bucket = required("ARCANA_ARTWORK_S3_BUCKET");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error("Invalid artwork bucket name.");
  return { endpoint, bucket, region: required("ARCANA_ARTWORK_S3_REGION"), accessKeyId: required("ARCANA_ARTWORK_S3_ACCESS_KEY_ID"), secretAccessKey: required("ARCANA_ARTWORK_S3_SECRET_ACCESS_KEY") };
}
/** Neon exposes direct and pooled names for one endpoint. No other host equivalence is accepted. */
function normalizeNeonDatabaseHost(host: string): string {
  return /^ep-[a-z0-9-]+-pooler\.c-\d+\.[a-z0-9-]+\.aws\.neon\.tech$/.test(host)
    ? host.replace(/-pooler(?=\.)/, "") : host;
}
export class S3PrivateArtworkStorage implements PrivateArtworkStorage {
  private readonly client: S3Client;
  constructor(private readonly config: ArtworkStorageConfiguration) {
    this.client = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, requestHandler: { requestTimeout: 15_000, throwOnRequestTimeout: true, connectionTimeout: 5_000, socketTimeout: 15_000 }, maxAttempts: 2 });
  }
  async put(key: string, bytes: Uint8Array) {
    await this.client.send(new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: bytes, ContentType: "image/webp", CacheControl: "private, no-store", IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(15_000) });
  }
  async get(key: string) {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    // SDK header deadlines do not cover slow response bodies. Bound the complete download.
    const timeout = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => undefined); }, 15_000);
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { abortSignal: controller.signal });
      if (!result.Body) throw new Error("Artwork object missing");
      reader = result.Body.transformToWebStream().getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      if (!result.ContentLength || result.ContentLength > MAX_ARTWORK_OUTPUT_BYTES) throw new Error("Artwork object exceeds limit");
      while (true) {
        const chunk = await reader.read();
        if (controller.signal.aborted) throw new Error("Artwork download timed out");
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_ARTWORK_OUTPUT_BYTES) throw new Error("Artwork object exceeds limit");
        chunks.push(chunk.value);
      }
      return Buffer.concat(chunks);
    } finally { clearTimeout(timeout); await reader?.cancel().catch(() => undefined); reader?.releaseLock(); }
  }
  async delete(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }), { abortSignal: AbortSignal.timeout(15_000) }); }
}
