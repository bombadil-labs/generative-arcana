import assert from "node:assert/strict";
import { createServer } from "node:http";
import deepTime from "../../decks/deep-time/deck.json";
import type { DeckDataFile } from "../../app/src/decks/types";
import { ExternalIdentityBrowserPrincipalResolver } from "../src/browserSession";
import type { ArcanaHostState, ArcanaHostStateRepository } from "../src/hostState";
import { PersistentArcanaHostStore } from "../src/hostStore";
import {
  InMemoryExternalIdentityRepository,
  OAuthPrincipalResolver,
  type BearerIdentityVerifier,
} from "../src/oauthIdentity";
import { InMemoryUserDeckCatalogRepository } from "../src/userDeckCatalog";
import { createArcanaWebCatalogRequestHandler, isArcanaWebCatalogPath } from "../src/webCatalogApi";
import {
  createWorkOSBrowserAuthRequestHandler,
  isArcanaBrowserAuthPath,
  WorkOSBrowserAuthAdapter,
  type WorkOSBrowserClient,
} from "../src/workosBrowserAuth";

const ISSUER = "https://identity.example.test/";
const MCP_TOKEN = "host-token";

async function main(): Promise<void> {
  const user = {
    id: "user_cross_host",
    email: "cross-host@example.test",
    firstName: "Cross",
    lastName: "Host",
    profilePictureUrl: null,
  };
  const workosClient: WorkOSBrowserClient = {
    getAuthorizationUrl({ state }) {
      const url = new URL("https://login.example.test/authorize");
      url.searchParams.set("state", state);
      return url.href;
    },
    async authenticateWithCode({ code }) {
      assert.equal(code, "browser-code");
      return { user, sealedSession: "browser-session" };
    },
    async loadSealedSession({ sessionData }) {
      return {
        async authenticate() {
          return sessionData === "browser-session"
            ? { authenticated: true, user }
            : { authenticated: false, reason: "invalid_jwt" };
        },
        async refresh() {
          return { authenticated: false, reason: "invalid_grant", retryable: false };
        },
        async getLogoutUrl() {
          return "https://login.example.test/logout";
        },
      };
    },
  };
  const browserAuth = new WorkOSBrowserAuthAdapter({
    apiKey: "sk_test_cross_host",
    clientId: "client_cross_host",
    cookiePassword: "0123456789abcdef0123456789abcdef",
    redirectUri: "http://127.0.0.1/auth/callback",
    issuer: ISSUER,
    secureCookies: false,
  }, workosClient);

  const identities = new InMemoryExternalIdentityRepository();
  const browserPrincipalResolver = new ExternalIdentityBrowserPrincipalResolver(browserAuth, identities);
  const bearerVerifier: BearerIdentityVerifier = {
    async verify(token) {
      assert.equal(token, MCP_TOKEN);
      return {
        issuer: ISSUER,
        subject: user.id,
        scopes: ["decks:read", "decks:write"],
      };
    },
  };
  const bearerPrincipalResolver = new OAuthPrincipalResolver(bearerVerifier, identities, ["decks:read"]);

  const catalog = new InMemoryUserDeckCatalogRepository();
  const hosts = new PersistentArcanaHostStore(new MemoryHostStateRepository(), undefined, catalog);
  const authHandler = createWorkOSBrowserAuthRequestHandler(browserAuth);
  const catalogHandler = createArcanaWebCatalogRequestHandler({
    catalog,
    hosts,
    principalResolver: bearerPrincipalResolver,
    browserPrincipalResolver,
    oauth: {
      resourceMetadataUrl: "https://arcana.example.test/.well-known/oauth-protected-resource/mcp",
      readScopes: ["decks:read"],
      writeScopes: ["decks:write"],
    },
  });

  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).pathname;
    if (isArcanaBrowserAuthPath(pathname)) {
      void authHandler(req, res);
      return;
    }
    if (isArcanaWebCatalogPath(pathname)) {
      void catalogHandler(req, res);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("cross-host test server did not bind");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const browserCookie = await signInBrowser(base);

    let response = await fetch(`${base}/api/me/decks`, { headers: { cookie: browserCookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);

    response = await fetch(`${base}/api/me/decks`, { headers: bearerHeaders() });
    assert.equal(response.status, 200, "the MCP bearer resolves the same account before any deck exists");
    assert.deepEqual(await response.json(), []);

    const data = structuredClone(deepTime) as unknown as DeckDataFile;
    data.slug = "cross-host-deck";
    data.name = "Cross Host Deck";
    response = await fetch(`${base}/api/me/decks`, {
      method: "POST",
      headers: { cookie: browserCookie, "content-type": "application/json" },
      body: JSON.stringify({ data, tagline: "Created in the browser" }),
    });
    assert.equal(response.status, 201);
    const created = await response.json() as DeckSummary;
    assert.ok(created.id);
    assert.notEqual(created.id, created.slug);
    assert.equal(created.visibility, "private");
    assert.equal(created.revision, 1);
    assert.equal((created as DeckSummary & { ownerId?: string }).ownerId, undefined);

    response = await fetch(`${base}/api/me/decks`, { headers: bearerHeaders() });
    assert.equal(response.status, 200);
    const seenFromBearer = await response.json() as DeckSummary[];
    assert.deepEqual(seenFromBearer.map((deck) => deck.id), [created.id], "browser and MCP auth must converge on one opaque owner principal");

    response = await fetch(`${base}/api/decks/${created.id}`);
    assert.equal(response.status, 404, "an anonymous caller cannot infer a private deck");
    response = await fetch(`${base}/api/decks/${created.id}`, { headers: { cookie: browserCookie } });
    assert.equal(response.status, 200, "the browser owner can resolve the private deck through its stable resource id");

    response = await patchVisibility(base, created.id, "unlisted", { cookie: browserCookie });
    const unlisted = await response.json() as DeckSummary;
    assert.equal(response.status, 200);
    assert.equal(unlisted.id, created.id);
    assert.equal(unlisted.visibility, "unlisted");
    assert.equal(unlisted.revision, 2);

    response = await fetch(`${base}/api/decks/${created.id}`);
    assert.equal(response.status, 200, "unlisted becomes anonymous read-through by stable id");
    response = await fetch(`${base}/api/decks/public`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [], "unlisted is resolvable but never discoverable");

    response = await patchVisibility(base, created.id, "public", bearerHeaders());
    const published = await response.json() as DeckSummary;
    assert.equal(response.status, 200, "the MCP-authenticated peer can publish the browser-created deck");
    assert.equal(published.id, created.id);
    assert.equal(published.visibility, "public");
    assert.equal(published.revision, 3);
    assert.ok(published.publishedAt);

    response = await fetch(`${base}/api/decks/public`);
    const publicDecks = await response.json() as DeckSummary[];
    assert.equal(publicDecks.some((deck) => deck.id === created.id), true);

    response = await fetch(`${base}/api/me/decks`, {
      method: "POST",
      headers: { cookie: browserCookie, "content-type": "application/json" },
      body: JSON.stringify({ data, tagline: "Revised in the browser", replaceExisting: true }),
    });
    assert.equal(response.status, 201);
    const replaced = await response.json() as DeckSummary;
    assert.equal(replaced.id, created.id, "explicit same-slug replacement preserves canonical resource identity");
    assert.equal(replaced.visibility, "public", "replacement preserves publication state");
    assert.equal(replaced.publishedAt, published.publishedAt, "replacement preserves publication timestamp");
    assert.equal(replaced.revision, 4);

    response = await fetch(`${base}/api/decks/${created.id}`);
    assert.equal(response.status, 200);
    const shared = await response.json() as { id: string; manifest: { tagline: string } };
    assert.equal(shared.id, created.id);
    assert.equal(shared.manifest.tagline, "Revised in the browser");

    response = await fetch(`${base}/api/me/decks/${created.id}`, {
      method: "DELETE",
      headers: bearerHeaders(),
    });
    assert.equal(response.status, 200, "the MCP-authenticated peer can delete the same owned resource");
    assert.deepEqual(await response.json(), { id: created.id, deleted: true });

    response = await fetch(`${base}/api/me/decks`, { headers: { cookie: browserCookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
    response = await fetch(`${base}/api/decks/${created.id}`);
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function signInBrowser(base: string): Promise<string> {
  let response = await fetch(`${base}/auth/login?returnTo=${encodeURIComponent("/#/my-decks")}`, { redirect: "manual" });
  assert.equal(response.status, 302);
  const authorization = new URL(response.headers.get("location")!);
  const state = authorization.searchParams.get("state");
  const authStateCookie = cookiePair(response.headers.get("set-cookie") ?? "", "arcana-session-auth-state");
  assert.ok(state && authStateCookie);

  response = await fetch(`${base}/auth/callback?code=browser-code&state=${encodeURIComponent(state!)}`, {
    headers: { cookie: authStateCookie! },
    redirect: "manual",
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/#/my-decks");
  const sessionCookie = cookiePair(response.headers.get("set-cookie") ?? "", "arcana-session");
  assert.ok(sessionCookie);

  response = await fetch(`${base}/auth/session`, { headers: { cookie: sessionCookie! } });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { authenticated?: boolean }).authenticated, true);
  return sessionCookie!;
}

function bearerHeaders(): Record<string, string> {
  return { authorization: `Bearer ${MCP_TOKEN}` };
}

function patchVisibility(
  base: string,
  deckId: string,
  visibility: "private" | "unlisted" | "public",
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(`${base}/api/me/decks/${deckId}`, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ visibility }),
  });
}

function cookiePair(setCookie: string, name: string): string | null {
  const match = new RegExp(`(?:^|,\\s*)${name}=([^;]*)`).exec(setCookie);
  return match ? `${name}=${match[1]}` : null;
}

interface DeckSummary {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  visibility: "private" | "unlisted" | "public";
  revision: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

class MemoryHostStateRepository implements ArcanaHostStateRepository {
  private readonly values = new Map<string, unknown>();

  async load(scopeId: string): Promise<unknown | null> {
    return this.values.has(scopeId) ? structuredClone(this.values.get(scopeId)) : null;
  }

  async save(scopeId: string, state: ArcanaHostState): Promise<void> {
    this.values.set(scopeId, structuredClone(state));
  }

  async delete(scopeId: string): Promise<boolean> {
    return this.values.delete(scopeId);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
