import type { IncomingMessage, ServerResponse } from "node:http";
import { MAX_MANIFEST_UPLOAD_BYTES, ManifestUploadError, type ManifestUploadRepository } from "./manifestUploads";
export function isManifestUploadPath(path: string) { return /^\/api\/manifest-uploads\/[0-9a-f-]{36}$/.test(path); }
export function createManifestUploadHandler(uploads: ManifestUploadRepository) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("cache-control", "no-store");
    const json = (status: number, value: unknown) => { if (!res.destroyed) { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); } };
    if (req.method !== "PUT") { res.setHeader("allow", "PUT"); return json(405, { error: "method_not_allowed" }); }
    const auth = req.headers.authorization;
    if (!auth?.match(/^Bearer [A-Za-z0-9_-]{43}$/)) return json(401, { error: "invalid_upload_ticket" });
    if (req.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return json(415, { error: "json_required" });
    if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") return json(415, { error: "content_encoding_not_supported" });
    const contentLength = Number(req.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > MAX_MANIFEST_UPLOAD_BYTES) return json(413, { error: "request_too_large" });
    const chunks: Buffer[] = []; let size = 0;
    const timeout = setTimeout(() => req.destroy(), 15_000);
    try {
      for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > MAX_MANIFEST_UPLOAD_BYTES) { json(413, { error: "request_too_large" }); req.destroy(); return; } chunks.push(bytes); }
      const uploadId = new URL(req.url!, "http://arcana.invalid").pathname.split("/").at(-1)!;
      return json(200, await uploads.finalize(uploadId, auth.slice(7), Buffer.concat(chunks)));
    } catch (error) { return json(error instanceof ManifestUploadError ? error.status : 503, { error: error instanceof ManifestUploadError ? error.message : "upload_failed" }); }
    finally { clearTimeout(timeout); }
  };
}
