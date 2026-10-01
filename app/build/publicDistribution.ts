import { statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import { isArchivedDeckModule, isArchivedPublicPath } from "../src/distributionPolicy";

/** Fail a build if a future UI change accidentally re-imports the archived corpus. */
export function publicDistribution(): Plugin {
  return {
    name: "arcana-public-distribution",
    enforce: "pre",
    load(id) {
      if (isArchivedDeckModule(id)) {
        this.error(`Archived deck sources cannot enter the public build: ${id}`);
      }
      return null;
    },
    configureServer(server) { server.middlewares.use(blockArchivedRequest); },
    configurePreviewServer(server) {
      server.middlewares.use(blockArchivedRequest);
      // Vite's SPA fallback otherwise returns index.html for retired image/data URLs.
      const root = resolve(server.config.root, server.config.build.outDir);
      server.middlewares.use((req, res, next) => {
        const pathname = decodedPath(req.url);
        const file = pathname && resolve(root, `.${pathname}`);
        const withinRoot = file && (file === root || file.startsWith(`${root}${sep}`));
        if (pathname && (extname(pathname) || pathname.startsWith("/assets/"))
          && (!withinRoot || !regularFile(file))) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }
        next();
      });
    },
  };
}

function regularFile(path: string): boolean {
  try { return statSync(path).isFile(); }
  catch { return false; }
}

function decodedPath(url: string | undefined): string | undefined {
  try { return decodeURIComponent(new URL(url?.replace(/^\/+/, "/") ?? "/", "http://localhost").pathname); }
  catch { return undefined; }
}

function blockArchivedRequest(
  req: { url?: string },
  res: { statusCode: number; end(body: string): void },
  next: () => void,
): void {
  const pathname = decodedPath(req.url);
  if (!pathname || pathname.includes("\0") || isArchivedPublicPath(pathname)) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  next();
}
