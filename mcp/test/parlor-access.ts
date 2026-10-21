import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBetterAuthHarness } from "./better-auth-fixtures";
import { createArcanaBetterAuth } from "../src/betterAuth";
import { createParlorAccessGuard, isParlorOwner, isPrivateParlorPath, parlorPathname, PARLOR_OWNER } from "../src/parlorAccess";
import { createParlorHandler } from "../src/parlorApi";
import { parlorConfig } from "../src/parlorConfig";
import { serveArcanaWebApp } from "../src/webAppStatic";

const h = await createBetterAuthHarness();
const origin = new URL(PARLOR_OWNER.issuer).origin;
const auth = createArcanaBetterAuth({
  baseURL: origin, resource: `${origin}/mcp`, secret: "test-only-not-a-production-secret-0123456789",
}, { database: { dialect: h.pg.dialect, type: "postgres", transaction: true }, sendEmail: async () => {} });
const dir = await mkdtemp(join(tmpdir(), "parlor-access-"));
let authFails = false, providerCalls = 0;
const guard = createParlorAccessGuard({ authenticate: async (req, res) => {
  if (authFails) throw new Error("Synthetic database failure");
  return auth.browserAuthenticator.authenticate(req, res);
} });
const api = createParlorHandler({ config: parlorConfig({ PARLOR_MODE: "byok" }), authorize: guard,
  fetch: async () => { providerCalls++; throw new Error("No provider calls allowed"); } });
const server = createServer((req, res) => { void (async () => {
  const path = parlorPathname(req.url ?? "/");
  const restricted = isPrivateParlorPath(path);
  if (restricted && !await guard(req, res)) return;
  if (path.startsWith("/api/parlor")) { await api(req, res); return; }
  if (!serveArcanaWebApp(req, res, dir, restricted)) res.writeHead(404).end();
})(); });
try {
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "index.html"), "<title>Arcana private table</title>");
  await writeFile(join(dir, "assets/parlor-fixture.js"), "private Parlor code");
  await writeFile(join(dir, "assets/parlor-fixture.css"), "private Parlor styles");
  await writeFile(join(dir, "assets/app.js"), "ordinary public app");
  // Only this isolated PGlite fixture is mutated. These IDs are not session credentials.
  const account = await h.signupVerify("owner-fixture@example.test");
  await h.pg.client.query('UPDATE arcana_auth_user SET email=$1 WHERE id=$2', ["retired-fixture@example.test", account.user.id]);
  await h.pg.client.query('INSERT INTO arcana_auth_user (id,name,email,"emailVerified","createdAt","updatedAt") SELECT $1,name,$2,"emailVerified","createdAt","updatedAt" FROM arcana_auth_user WHERE id=$3',
    [PARLOR_OWNER.subject, account.user.email, account.user.id]);
  await h.pg.client.query('UPDATE arcana_auth_account SET "userId"=$1,"accountId"=$1 WHERE "userId"=$2', [PARLOR_OWNER.subject, account.user.id]);
  const other = await h.signupVerify("other-fixture@example.test", "Mykola Bilokonsky");
  const login = async (email: string) => {
    const response = await auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
      method: "POST", headers: { origin, "content-type": "application/json", "x-arcana-client-ip": "198.51.100.10" },
      body: JSON.stringify({ email, password: "correct horse battery staple 123" }),
    }));
    assert.equal(response.status, 200, await response.clone().text());
    return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  };
  const ownerCookie = await login(account.user.email);
  const otherCookie = await login(other.user.email);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const get = (path: string, cookie = "", method = "GET") => new Promise<{ status: number; body: string; headers: import("node:http").IncomingHttpHeaders }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: address.port, path, method,
      headers: { cookie, "x-parlor-owner": PARLOR_OWNER.subject, origin } }, res => {
      let body = ""; res.setEncoding("utf8"); res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    }); req.on("error", reject); req.end();
  });
  const paths = ["/parlor", "/parlor/", "/%70arlor", "//parlor", "/parlor//",
    "/PARLOR", "/assets/parlor-fixture.js", "/assets/parlor-fixture.css", "/assets/%70arlor-fixture.js",
    "/other%2f..%2fassets%2fparlor-fixture.js", "/other%5c..%5cassets%5cparlor-fixture.js",
    "/api/parlor", "/api/parlor/capabilities", "/api/parlor/narrate", "/api/parlor/converse", "/api/parlor/speech",
    "/api/parlor/future-endpoint", "/%61pi/parlor/capabilities", "//api//parlor/capabilities"];
  for (const cookie of ["", "arcana-auth.session_token=forged", otherCookie]) {
    for (const path of paths) for (const method of ["GET", "HEAD", "POST"]) {
      const result = await get(path, cookie, method);
      assert.equal(result.status, cookie === otherCookie ? 403 : 401, `${method} ${path}`);
      assert.equal(result.headers["cache-control"], "private, no-store");
      assert.ok(!result.body.includes("private table") && !result.body.includes("private Parlor"));
    }
  }
  for (const path of ["/parlor", "/parlor/", "/%70arlor", "//parlor", "/assets/parlor-fixture.js", "/assets/parlor-fixture.css"]) {
    for (const method of ["GET", "HEAD"]) {
      const result = await get(path, ownerCookie, method);
      assert.equal(result.status, 200, `${method} owner ${path}`);
      assert.equal(result.headers["cache-control"], "private, no-store");
      assert.equal(result.headers.vary, "Cookie");
      if (method === "HEAD") assert.equal(result.body, "");
    }
  }
  const capabilities = await get("/api/parlor/capabilities", ownerCookie);
  assert.equal(capabilities.status, 200);
  assert.equal(JSON.parse(capabilities.body).mode, "byok");
  for (const path of ["narrate", "converse", "speech"]) assert.equal((await get(`/api/parlor/${path}`, ownerCookie, "POST")).status, 503);
  for (const cookie of ["", otherCookie, ownerCookie]) {
    assert.equal((await get("/", cookie)).status, 200);
    assert.equal((await get("/assets/app.js", cookie)).status, 200);
  }
  const session = async (cookie: string) => (await auth.handler(new Request(`${origin}/auth/session`, { headers: { cookie } }))).json();
  assert.equal((await session(ownerCookie)).parlorAllowed, true);
  assert.equal((await session(otherCookie)).parlorAllowed, false);
  assert.equal(isParlorOwner({ ...PARLOR_OWNER, issuer: "https://staging.invalid/api/auth" }), false);
  assert.equal(isParlorOwner({ ...PARLOR_OWNER, subject: other.user.id }), false);
  authFails = true;
  assert.equal((await get("/parlor", ownerCookie)).status, 503);
  assert.equal((await get("/api/parlor/capabilities", ownerCookie)).status, 503);
  authFails = false;
  await h.pg.client.query('UPDATE arcana_auth_user SET "emailVerified"=false WHERE id=$1', [PARLOR_OWNER.subject]);
  assert.equal((await get("/parlor", ownerCookie)).status, 401, "unverified owner is denied");
  await h.pg.client.query('UPDATE arcana_auth_user SET "emailVerified"=true WHERE id=$1', [PARLOR_OWNER.subject]);
  await h.pg.client.query('DELETE FROM arcana_auth_session WHERE "userId"=$1', [PARLOR_OWNER.subject]);
  assert.equal((await get("/parlor", ownerCookie)).status, 401, "revoked owner session is denied");
  assert.equal(providerCalls, 0);
  console.log("Parlor: real signed sessions allow only the verified owner; anonymous, forged, other, unverified, revoked and failed auth denied; normalized pages, private assets and every API protected; ordinary app preserved; zero provider calls.");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await auth.close(); await h.close(); await rm(dir, { recursive: true, force: true });
}
