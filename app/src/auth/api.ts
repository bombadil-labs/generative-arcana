/** Small, same-origin Better Auth client. Cookies remain HttpOnly; secrets stay in memory. */
export class AccountRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "AccountRequestError";
  }
}

export async function accountRequest<T = Record<string, unknown>>(
  path: string,
  options: { body?: Record<string, unknown>; signal?: AbortSignal; method?: "GET" | "POST" } = {},
): Promise<T> {
  // Callers cannot turn this authenticated client into a cross-origin request.
  if (!/^\/(?:api\/auth|auth)(?:\/[a-z0-9-]+)+(?:\?[^#\\]*)?$/i.test(path)) {
    throw new Error("Invalid account endpoint.");
  }
  const response = await fetch(path, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  if (!isJson) {
    throw new AccountRequestError(response.status === 404 || response.status === 503 || response.ok
      ? "Accounts are not available on this deployment. You can still load your own deck JSON from the home page."
      : `The account service could not complete this request (${response.status}). Try again.`, response.status);
  }
  const body = await response.json() as Record<string, unknown> | null;
  if (!response.ok) {
    const code = typeof body?.code === "string" ? body.code : undefined;
    const message = typeof body?.message === "string" ? body.message : undefined;
    throw new AccountRequestError(response.status === 429
      ? "Too many attempts. Wait a little before trying again."
      : message || `The account request failed (${response.status}). Try again.`, response.status, code);
  }
  return body as T;
}

/** Only app fragments are valid ordinary return destinations. OAuth is a separate server flow. */
export function safeAccountReturnTo(value: string | null | undefined): string {
  if (!value || /[\u0000-\u0020\u007f\\]/.test(value)) return "/#/my-decks";
  if (!/^\/#\/(?:$|my-decks(?:\?|$)|community(?:\?|$)|deck\/[^?#]+(?:\?|$)|account\/connections(?:\?|$))/.test(value)) return "/#/my-decks";
  try {
    const url = new URL(value, "https://arcana.invalid");
    if (url.origin !== "https://arcana.invalid" || url.pathname !== "/" || url.search || /[\u0000-\u0020\u007f\\]/.test(decodeURIComponent(value))) return "/#/my-decks";
  } catch { return "/#/my-decks"; }
  return value;
}

export type AccountPage = "login" | "signup" | "verify-email" | "forgot-password" | "reset-password" | "consent" | "connections";
export interface AccountRoute { page: AccountPage; params: URLSearchParams }

export function parseAccountRoute(route: string, search = ""): AccountRoute | null {
  const divider = route.indexOf("?");
  const path = divider < 0 ? route : route.slice(0, divider);
  const query = divider < 0 ? "" : route.slice(divider + 1);
  const page = path.match(/^\/account\/(login|signup|verify-email|forgot-password|reset-password|consent|connections)\/?$/)?.[1] as AccountPage | undefined;
  if (!page) return null;
  const params = new URLSearchParams(query);
  // Better Auth appends recovery tokens/errors before the fragment in callback URLs.
  const outer = new URLSearchParams(search);
  for (const name of ["token", "error"]) {
    if (!params.has(name) && outer.has(name)) params.set(name, outer.get(name)!);
  }
  return { page, params };
}

export function accountHref(page: AccountPage, params = new URLSearchParams()): string {
  const query = params.toString();
  return `/#/account/${page}${query ? `?${query}` : ""}`;
}

export function accountError(error: unknown): string {
  if (error instanceof AccountRequestError) return error.message;
  return "Couldn’t reach the account service. Check your connection and try again.";
}

export interface OAuthContext {
  client: { clientId: string; name: string; uri?: string };
  scopes: string[];
  resource?: string;
  redirectUri: string;
  oauthQuery: string;
}

/** Only a verified OAuth flow can redirect to its registered external callback. */
export function validatedOAuthRedirect(value: string, context: OAuthContext, origin: string): string {
  const url = new URL(value, origin);
  const callback = new URL(context.redirectUri);
  const fail = () => { throw new AccountRequestError("The authorization destination changed or is unsafe. Restart the connection from your client.", 400); };
  if (url.username || url.password || /[\u0000-\u0020\u007f\\]/.test(value)) return fail();
  const sameOrigin = url.origin === origin && ["https:", "http:"].includes(url.protocol);
  if (sameOrigin && ["/auth/consent", "/auth/login", "/api/auth/oauth2/authorize"].includes(url.pathname)) return url.href;
  // Match the provider's RFC 8252 native-client URI classes. A private-use URI has
  // a reverse-domain scheme, no authority, and exactly one leading path slash.
  const nativeScheme = /^[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
  const isNative = nativeScheme.test(url.protocol.slice(0, -1)) && !url.host
    && url.href.slice(url.protocol.length).startsWith("/") && !url.href.slice(url.protocol.length).startsWith("//");
  const allowedScheme = url.protocol === "https:" || (url.protocol === "http:"
    && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) || isNative;
  if (!allowedScheme || url.hash || url.protocol !== callback.protocol || url.host !== callback.host || url.pathname !== callback.pathname) return fail();
  // Registration can include fixed query parameters; the response must retain all
  // of them exactly. OAuth code/state/error parameters may be added by the server.
  for (const key of new Set(callback.searchParams.keys())) {
    if (JSON.stringify(callback.searchParams.getAll(key)) !== JSON.stringify(url.searchParams.getAll(key))) return fail();
  }
  return url.href;
}
