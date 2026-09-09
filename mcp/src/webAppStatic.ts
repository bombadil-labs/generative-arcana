import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

/** Serve the built Vite application without coupling the app or domain to the HTTP transport. */
export function serveArcanaWebApp(
  req: IncomingMessage,
  res: ServerResponse,
  distDir: string,
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  const root = resolve(distDir);
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return false; }
  if (pathname.includes("\0")) return false;

  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const requested = resolve(root, relative);
  const withinRoot = requested === root || requested.startsWith(`${root}${sep}`);
  if (!withinRoot) return false;

  const file = regularFile(requested) ? requested : resolve(root, "index.html");
  if (!regularFile(file)) return false;

  const headers: Record<string, string> = {
    "content-type": contentType(file),
    "x-content-type-options": "nosniff",
    "cache-control": file.includes(`${sep}assets${sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  };
  const size = statSync(file).size;
  headers["content-length"] = String(size);
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(file).pipe(res);
  return true;
}

function regularFile(path: string): boolean {
  try { return existsSync(path) && statSync(path).isFile(); }
  catch { return false; }
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}
