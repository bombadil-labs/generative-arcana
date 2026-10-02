import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { MAX_MANIFEST_UPLOAD_BYTES, ManifestUploadError } from "./manifestUploads";

export interface NativeManifestFile { download_url: string; file_id: string; mime_type?: string; file_name?: string }
export const manifestMediaType = (value?: string) => ["application/json", "text/json", "text/plain", "application/octet-stream"].includes((value ?? "application/octet-stream").split(";", 1)[0].trim().toLowerCase());
/** Only ChatGPT-controlled file delivery hosts, never arbitrary supplied web URLs. */
export function nativeFileUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ManifestUploadError(400, "Invalid native file URL."); }
  const host = url.hostname;
  const allowed = host === "files.oaiusercontent.com" || /^sdmntpr[a-z0-9-]*\.oaiusercontent\.com$/.test(host)
    || /^(?:oaisdmntpr|oaisdsorpr)[a-z0-9]*\.blob\.core\.windows\.net$/.test(host)
    || /^oaisdmntpr[a-z0-9]*\.s3\.[a-z0-9-]+\.amazonaws\.com$/.test(host);
  if (!allowed || url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password || url.hash) throw new ManifestUploadError(400, "Native files must use an approved ChatGPT file delivery host. Use an upload ticket for other hosts.");
  return url;
}
/** Conservative public IPv4 allowlist. DNS is resolved once and pinned in the HTTPS request. */
export function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b,c] = octets;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
export async function fetchNativeManifest(file: NativeManifestFile): Promise<Uint8Array> {
  return fetchNativeFile(file, { maxBytes: MAX_MANIFEST_UPLOAD_BYTES, mediaTypes: ["application/json", "text/json", "text/plain", "application/octet-stream"] });
}
export interface NativeFileTransport {
  lookup: (hostname: string) => Promise<Array<{ address: string }>>;
  request: typeof request;
  signal: () => AbortSignal;
}
const nativeFileTransport: NativeFileTransport = {
  lookup: hostname => lookup(hostname, { family: 4, all: true }),
  request,
  signal: () => AbortSignal.timeout(15_000),
};
/** Transport dependency injection is internal test support, never an MCP/server configuration input. */
export async function fetchNativeFile(file: NativeManifestFile, options: { maxBytes: number; mediaTypes: readonly string[] }, transport: NativeFileTransport = nativeFileTransport): Promise<Uint8Array> {
  const accepts = (value?: string) => options.mediaTypes.includes((value ?? "application/octet-stream").split(";", 1)[0].trim().toLowerCase());
  if (!file.file_id || (file.mime_type !== undefined && !accepts(file.mime_type))) throw new ManifestUploadError(400, "Native file has an unsupported content type.");
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > 3_000_000) throw new ManifestUploadError(400, "Invalid native file byte limit.");
  const url = nativeFileUrl(file.download_url);
  const signal = transport.signal();
  let addresses;
  try {
    addresses = await Promise.race([transport.lookup(url.hostname), new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true }))]);
  } catch { throw new ManifestUploadError(502, "Native file hostname could not be resolved safely."); }
  if (!addresses.length || addresses.some(value => !isPublicIpv4(value.address))) throw new ManifestUploadError(400, "Native file hostname is not a public destination.");
  const address = addresses[0]!.address;
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: "GET", signal, agent: false, family: 4,
      // Pin after DNS validation; retain original TLS servername and normal certificate verification.
      lookup: ((_hostname: string, options: { all?: boolean }, callback: Function) => options.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4)) as never,
      headers: { accept: options.mediaTypes.join(", ") },
    }, response => {
      if (response.statusCode !== 200 || !accepts(response.headers["content-type"])) {
        response.resume(); req.destroy(); reject(new ManifestUploadError(502, "Native file download failed or returned an unsupported content type. Redirects are not followed.")); return;
      }
      const length = Number(response.headers["content-length"]);
      if (Number.isFinite(length) && length > options.maxBytes) { req.destroy(); reject(new ManifestUploadError(413, "Native file exceeds its byte limit.")); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > options.maxBytes) { req.destroy(); reject(new ManifestUploadError(413, "Native file exceeds its byte limit.")); } else chunks.push(chunk); });
      response.on("end", () => { if (!size) reject(new ManifestUploadError(400, "Native file is empty.")); else resolve(Buffer.concat(chunks)); });
      response.on("error", () => reject(new ManifestUploadError(502, "Native file download failed.")));
    });
    req.on("error", () => reject(new ManifestUploadError(502, "Native file download failed or timed out.")));
    req.end();
  });
}
