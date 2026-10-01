import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { accountHref, accountRequest, safeAccountReturnTo } from "./api";

export interface BrowserAccount {
  displayName?: string;
  email?: string;
  emailVerified?: boolean;
  avatarUrl?: string;
}

export type BrowserSessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: BrowserAccount; mcpUrl?: string }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

interface BrowserSessionContextValue {
  session: BrowserSessionState;
  refresh(): Promise<void>;
  signIn(returnTo?: string): void;
  signOut(): Promise<void>;
}

const BrowserSessionContext = createContext<BrowserSessionContextValue | null>(null);

export function BrowserSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<BrowserSessionState>({ status: "loading" });
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const response = await fetch("/auth/session", {
        method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { accept: "application/json" },
      });
      if (id !== requestId.current) return;
      if (response.status === 404 || response.status === 503 || !response.headers.get("content-type")?.includes("application/json")) {
        setSession({ status: "unavailable", message: "Accounts are not available on this deployment. You can still load your own deck JSON from the home page." });
        return;
      }
      const body = await response.json() as { authenticated?: unknown; user?: BrowserAccount; mcpUrl?: unknown; message?: unknown };
      if (id !== requestId.current) return;
      if (!response.ok) {
        setSession({ status: "error", message: typeof body.message === "string" ? body.message : `Session request failed (${response.status}).` });
        return;
      }
      setSession(body.authenticated === true
        ? { status: "authenticated", user: body.user ?? {}, mcpUrl: validatedMcpUrl(body.mcpUrl) }
        : { status: "anonymous" });
    } catch {
      if (id === requestId.current) setSession({ status: "error", message: "Unable to check your account. Check your connection and try again." });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      ++requestId.current;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const signOut = useCallback(async () => {
    await accountRequest("/api/auth/sign-out", { body: {} });
    // A session read started before logout must not resurrect the old UI session.
    ++requestId.current;
    setSession({ status: "anonymous" });
  }, []);

  const value = useMemo<BrowserSessionContextValue>(() => ({
    session, refresh, signOut,
    signIn(returnTo = "/#/my-decks") {
      window.location.assign(accountHref("login", new URLSearchParams({ returnTo: safeAccountReturnTo(returnTo) })));
    },
  }), [refresh, session, signOut]);

  return <BrowserSessionContext.Provider value={value}>{children}</BrowserSessionContext.Provider>;
}

export function useBrowserSession(): BrowserSessionContextValue {
  const value = useContext(BrowserSessionContext);
  if (!value) throw new Error("useBrowserSession must be used inside BrowserSessionProvider.");
  return value;
}

/** The server supplies its canonical OAuth resource, which may differ from a browser alias. */
export function validatedMcpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f\\]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && local))
      || url.username || url.password || url.pathname !== "/mcp" || url.search || url.hash) return undefined;
    return url.href;
  } catch { return undefined; }
}
