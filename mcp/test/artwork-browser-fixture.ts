/** Loopback-only manual UI fixture. Never imported by any shipped runtime. No real account/data. */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import { CardArtworkService, InMemoryArtworkRepository, InMemoryArtworkStorage } from "../src/cardArtwork";
import { InMemoryUserDeckCatalogRepository } from "../src/userDeckCatalog";
import { InMemoryArcanaHostStore } from "../src/hostStore";
import { createArcanaWebCatalogRequestHandler } from "../src/webCatalogApi";
import { createWebArtworkHandler, isArtworkPath } from "../src/webArtworkApi";
import { serveArcanaWebApp } from "../src/webAppStatic";
import { neutralManifest } from "./protocol-fixtures";

const catalog = new InMemoryUserDeckCatalogRepository();
const deck = await catalog.createImported("fixture-owner", neutralManifest());
const service = new CardArtworkService(catalog, new InMemoryArtworkRepository(catalog), new InMemoryArtworkStorage());
const png = await sharp(Buffer.from('<svg width="480" height="720" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="720" fill="#1d2231"/><circle cx="240" cy="325" r="142" stroke="#d5bb7c" stroke-width="7" fill="none"/><path d="M240 125L330 380H150Z" stroke="#927dbe" stroke-width="5" fill="none"/><circle cx="240" cy="325" r="14" fill="#d5bb7c"/></svg>')).png().toBuffer();
await writeFile("/tmp/arcana-artwork-fixture.png", png);
let signedIn = true;
const options = { catalog, hosts: new InMemoryArcanaHostStore(), artwork: service,
  browserPrincipalResolver: { async resolve() { return signedIn ? { id: "fixture-owner" } : null; } },
};
const web = createArcanaWebCatalogRequestHandler(options);
const artwork = createWebArtworkHandler(options);
const dist = fileURLToPath(new URL("../../app/dist/", import.meta.url));
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/auth/session") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(signedIn ? { authenticated: true, accountId: "fixture-account", user: { displayName: "Local Artwork Fixture", email: "fixture@example.invalid" } } : { authenticated: false })); return; }
  if (url.pathname === "/api/auth/sign-out" && req.method === "POST") { signedIn = false; res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); return; }
  if (isArtworkPath(url.pathname)) { void artwork(req, res); return; }
  if (url.pathname.startsWith("/api/decks/") || url.pathname.startsWith("/api/me/decks")) { void web(req, res); return; }
  if (!serveArcanaWebApp(req, res, dist)) { res.writeHead(404); res.end(); }
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address(); if (!address || typeof address === "string") throw new Error("fixture listener missing");
  console.log(JSON.stringify({ fixture: `http://127.0.0.1:${address.port}/#/deck/${deck.id}/artwork`, deck: deck.id, image: "/tmp/arcana-artwork-fixture.png" }));
});
process.once("SIGTERM", () => server.close());
