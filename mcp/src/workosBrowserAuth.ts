import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WorkOS } from "@workos-inc/node";
import type { BrowserSessionAuthenticator, BrowserSessionUser } from "./browserSession.js";

const DEFAULT_COOKIE_NAME = "arcana-session";
const DEFAULT_RETURN_TO = "/#/my-decks";
const STATE_TTL_MS = 10 * 60 * 1000;

export interface WorkOSBrowserAuthConfiguration {
  apiKey: string;
  clientId: string;
  cookiePassword: string;
  redirectUri: string;
  issuer: string;
  cookieName?: string;
  secureCookies?: boolean;
}

export interface WorkOSBrowserUser {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profilePictureUrl?: string | null;
}

interface WorkOSAuthResult {
  authenticated: boolean;
  user?: WorkOSBrowserUser;
  reason?: string;
}

interface WorkOSRefreshResult extends WorkOSAuthResult {
  sealedSession?: string;
  retryable?: boolean;
}

interface WorkOSLoadedSession {
  authenticate(): Promise<WorkOSAuthResult>;
  refresh(): Promise<WorkOSRefreshResult>;
  getLogOutUrl(): Promise<string>;
}

export interface WorkOSBrowserClient {
  getAuthorizationUrl(input: { state: string }): string;
  authenticateWithCode(input: { code: string }): Promise<{ user: WorkOSBrowserUser; sealedSession: string }>;
  loadSealedSession(input: { sessionData: string }): Promise<WorkOSLoadedSession>;
}

export function isArcanaBrowserAuthPath(pathname: string): boolean {
  return pathname === "/auth/login"
    || pathname === "/auth/callback"
    || pathname === "/auth/session"
    || pathname === "/auth/logout";
}

export class WorkOSBrowserAuthAdapter implements BrowserSessionAuthenticator {
  readonly cookieName: string;
  private readonly secureCookies: boolean;
  private readonly identityIssuer: string;

  constructor(
    readonly config: WorkOSBrowserAuthConfiguration,
    private readonly client: WorkOSBrowserClient = createWorkOSBrowserClient(config),
  ) {
    requireSecret(config.apiKey, "WORKOS_API_KEY");
    requireSecret(config.clientId, "WORKOS_CLIENT_ID");
    if (requireSecret(config.cookiePassword, "WORKOS_COOKIE_PASSWORD").length < 32) {
      throw new Error("WORKOS_COOKIE_PASSWORD must be at least 32 characters.");
    }
    requireHttpsUrl(config.redirectUri, "WORKOS_REDIRECT_URI");
    this.identityIssuer = requireHttpsUrl(config.issuer, "WorkOS identity issuer");
    this.cookieName = requireCookieName(config.cookieName?.trim() || DEFAULT_COOKIE_NAME);
    this.secureCookies = config.secureCookies ?? new URL(config.redirectUri).protocol === "https:";
  }

  authorizationUrl(returnTo?: string): string {
    return this.client.getAuthorizationUrl({ state: this.signState(safeReturnTo(returnTo)) });
  }

  async completeLogin(code: string, state: string, res: ServerResponse): Promise<string> {
    if (!code.trim()) throw new Error("Authentication callback is missing code.");
    const returnTo = this.verifyState(state);
    const result = await this.client.authenticateWithCode({ code: code.trim() });
    this.setSessionCookie(res, result.sealedSession);
    return returnTo;
  }

  async authenticate(req: IncomingMessage, res: ServerResponse): Promise<BrowserSessionUser | null> {
    const sealed = cookieValue(req, this.cookieName);
    if (!sealed) return null;

    const session = await this.client.loadSealedSession({ sessionData: sealed });
    const initial = await session.authenticate();
    if (initial.authenticated && initial.user) return this.browserUser(initial.user);

    const refreshed = await session.refresh();
    if (refreshed.authenticated && refreshed.user && refreshed.sealedSession) {
      this.setSessionCookie(res, refreshed.sealedSession);
      return this.browserUser(refreshed.user);
    }

    // Preserve the sealed cookie on transient provider/network failures so a later request can retry.
    if (!refreshed.retryable) this.clearSessionCookie(res);
    return null;
  }

  async logoutUrl(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
    const sealed = cookieValue(req, this.cookieName);
    this.clearSessionCookie(res);
    if (!sealed) return null;
    const session = await this.client.loadSealedSession({ sessionData: sealed });
    return await session.getLogOutUrl();
  }

  private browserUser(user: WorkOSBrowserUser): BrowserSessionUser {
    if (typeof user.id !== "string" || !user.id.trim()) throw new Error("AuthKit session user is missing a stable id.");
    const displayName = [user.firstName, user.lastName].filter((part): part is string => typeof part === "string" && !!part.trim()).join(" ");
    return {
      identity: { issuer: this.identityIssuer, subject: user.id.trim() },
      ...(typeof user.email === "string" && user.email.trim() ? { email: user.email.trim() } : {}),
      ...(displayName ? { displayName } : {}),
      ...(typeof user.profilePictureUrl === "string" && user.profilePictureUrl.trim() ? { avatarUrl: user.profilePictureUrl.trim() } : {}),
    };
  }

  private setSessionCookie(res: ServerResponse, value: string): void {
    if (typeof value !== "string" || !value) throw new Error("AuthKit did not return a sealed session.");
    res.setHeader("set-cookie", serializeCookie(this.cookieName, value, this.secureCookies));
  }

  private clearSessionCookie(res: ServerResponse): void {
    res.setHeader("set-cookie", serializeCookie(this.cookieName, "", this.secureCookies, 0));
  }

  private signState(returnTo: string): string {
    const payload = Buffer.from(JSON.stringify({
      returnTo,
      expiresAt: Date.now() + STATE_TTL_MS,
      nonce: randomBytes(16).toString("base64url"),
    }), "utf8").toString("base64url");
    const signature = this.stateSignature(payload);
    return `${payload}.${signature}`;
  }

  private verifyState(state: string): string {
    const [payload, signature, extra] = state.split(".");
    if (!payload || !signature || extra) throw new Error("Authentication state is invalid.");
    const expected = Buffer.from(this.stateSignature(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("Authentication state is invalid.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      throw new Error("Authentication state is invalid.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Authentication state is invalid.");
    const record = parsed as Record<string, unknown>;
    if (typeof record.expiresAt !== "number" || record.expiresAt < Date.now()) throw new Error("Authentication state has expired.");
    if (typeof record.returnTo !== "string") throw new Error("Authentication state is invalid.");
    return safeReturnTo(record.returnTo);
  }

  private stateSignature(payload: string): string {
    return createHmac("sha256", this.config.cookiePassword).update(payload).digest("base64url");
  }
}

export function createWorkOSBrowserAuthRequestHandler(adapter: WorkOSBrowserAuthAdapter) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    try {
      if (req.method === "GET" && url.pathname === "/auth/login") {
        res.writeHead(302, { location: adapter.authorizationUrl(url.searchParams.get("returnTo") ?? undefined), "cache-control": "no-store" });
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/auth/callback") {
        const providerError = url.searchParams.get("error");
        if (providerError) {
          json(res, 400, { error: "authentication_failed", message: url.searchParams.get("error_description") ?? providerError });
          return;
        }
        const code = url.searchParams.get("code") ?? "";
        const state = url.searchParams.get("state") ?? "";
        const returnTo = await adapter.completeLogin(code, state, res);
        res.writeHead(303, { location: returnTo, "cache-control": "no-store" });
        res.end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/auth/session") {
        const session = await adapter.authenticate(req, res);
        json(res, 200, session
          ? {
              authenticated: true,
              user: {
                ...(session.displayName ? { displayName: session.displayName } : {}),
                ...(session.email ? { email: session.email } : {}),
                ...(session.avatarUrl ? { avatarUrl: session.avatarUrl } : {}),
              },
            }
          : { authenticated: false });
        return;
      }

      if (req.method === "POST" && url.pathname === "/auth/logout") {
        const logoutUrl = await adapter.logoutUrl(req, res);
        res.writeHead(303, { location: logoutUrl ?? "/#/", "cache-control": "no-store" });
        res.end();
        return;
      }

      res.writeHead(405, { "content-type": "application/json", allow: allowedMethods(url.pathname), "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "method_not_allowed" }));
    } catch (error) {
      json(res, 400, {
        error: "browser_auth_failed",
        message: error instanceof Error ? error.message : "Browser authentication failed.",
      });
    }
  };
}

export function createWorkOSBrowserClient(config: WorkOSBrowserAuthConfiguration): WorkOSBrowserClient {
  const sdk = new WorkOS(config.apiKey, { clientId: config.clientId });
  return {
    getAuthorizationUrl({ state }) {
      return sdk.userManagement.getAuthorizationUrl({
        provider: "authkit",
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        state,
      });
    },
    async authenticateWithCode({ code }) {
      const result = await sdk.userManagement.authenticateWithCode({
        clientId: config.clientId,
        code,
        session: {
          sealSession: true,
          cookiePassword: config.cookiePassword,
        },
      });
      if (!result.sealedSession) throw new Error("AuthKit did not return a sealed session.");
      return { user: result.user as WorkOSBrowserUser, sealedSession: result.sealedSession };
    },
    async loadSealedSession({ sessionData }) {
      const session = await sdk.userManagement.loadSealedSession({
        sessionData,
        cookiePassword: config.cookiePassword,
      });
      return {
        async authenticate() {
          return await session.authenticate() as WorkOSAuthResult;
        },
        async refresh() {
          return await session.refresh() as WorkOSRefreshResult;
        },
        async getLogOutUrl() {
          return await session.getLogOutUrl();
        },
      };
    },
  };
}

function cookieValue(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); }
    catch { return null; }
  }
  return null;
}

function serializeCookie(name: string, value: string, secure: boolean, maxAge?: number): string {
  const pieces = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
    ...(maxAge === undefined ? [] : [`Max-Age=${maxAge}`]),
  ];
  return pieces.join("; ");
}

function safeReturnTo(value: string | undefined): string {
  if (!value) return DEFAULT_RETURN_TO;
  const base = new URL("https://arcana.invalid/");
  const parsed = new URL(value, base);
  if (parsed.origin !== base.origin || !value.startsWith("/")) throw new Error("returnTo must be a same-origin relative path.");
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function allowedMethods(pathname: string): string {
  return pathname === "/auth/logout" ? "POST" : "GET";
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function requireCookieName(value: string): string {
  if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(value)) throw new Error("Browser session cookie name contains invalid characters.");
  return value;
}

function requireSecret(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty.`);
  return value.trim();
}

function requireHttpsUrl(value: string, label: string): string {
  const url = new URL(requireSecret(value, label));
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error(`${label} must use HTTPS (or HTTP on loopback).`);
  }
  if (url.username || url.password || url.hash) throw new Error(`${label} must not contain credentials or a fragment.`);
  return url.href;
}
