import type { IncomingMessage, ServerResponse } from "node:http";
import type { BrowserSessionAuthenticator } from "./browserSession";
import type { ExternalIdentity } from "./oauthIdentity";
import { posix } from "node:path";

// Verified against the production auth user and external-identity mapping on 2026-10-20.
// This is an identity, not a credential. Never authorize by a client field, email or name.
export const PARLOR_OWNER = Object.freeze({
  issuer: "https://generative-arcana.vercel.app/api/auth",
  subject: "P5qiXvnvkTs3pCLQpnGBIZTBGaRZWbMg",
});

export function isParlorOwner(identity: ExternalIdentity | null | undefined): boolean {
  return identity?.issuer === PARLOR_OWNER.issuer && identity?.subject === PARLOR_OWNER.subject;
}

/** Normalize exactly as the static server does, including encoded/repeated separators. */
export function parlorPathname(url: string): string {
  try {
    return posix.normalize(decodeURIComponent(new URL(url.replace(/^\/+/, "/"), "http://localhost").pathname)
      .replace(/\\/g, "/").replace(/\/+/g, "/"));
  } catch { return ""; }
}

export function isPrivateParlorPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return path === "/parlor" || path.startsWith("/parlor/")
    || path === "/api/parlor" || path.startsWith("/api/parlor/")
    || /^\/assets\/parlor-[^/]+$/.test(path);
}

export function createParlorAccessGuard(authenticator?: BrowserSessionAuthenticator) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    // Never allow an authorized response to enter a shared cache.
    res.setHeader("cache-control", "private, no-store");
    res.setHeader("vary", "Cookie");
    let status = 503;
    let error = "parlor_auth_unavailable";
    if (authenticator) {
      try {
        const session = await authenticator.authenticate(req, res);
        if (session && isParlorOwner(session.identity)) return true;
        status = session ? 403 : 401;
        error = session ? "parlor_access_required" : "sign_in_required";
      } catch { /* Authentication failures never become permission. */ }
    }
    res.writeHead(status, { "content-type": "application/json", "x-content-type-options": "nosniff" });
    res.end(JSON.stringify({ error }));
    return false;
  };
}
