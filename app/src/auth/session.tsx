import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export interface BrowserAccount {
  displayName?: string;
  email?: string;
  avatarUrl?: string;
}

export type BrowserSessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: BrowserAccount }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

interface BrowserSessionContextValue {
  session: BrowserSessionState;
  refresh(): Promise<void>;
  signIn(returnTo?: string): void;
}

const BrowserSessionContext = createContext<BrowserSessionContextValue | null>(null);

export function BrowserSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<BrowserSessionState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/auth/session", {
        method: "GET",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      if (response.status === 404 || response.status === 503) {
        setSession({ status: "unavailable", message: "Account sign-in is not configured on this deployment." });
        return;
      }
      const body = await response.json() as {
        authenticated?: unknown;
        user?: BrowserAccount;
        message?: unknown;
      };
      if (!response.ok) {
        setSession({ status: "error", message: typeof body.message === "string" ? body.message : `Session request failed (${response.status}).` });
        return;
      }
      if (body.authenticated === true) {
        setSession({ status: "authenticated", user: body.user ?? {} });
      } else {
        setSession({ status: "anonymous" });
      }
    } catch (error) {
      setSession({ status: "error", message: error instanceof Error ? error.message : "Unable to check account session." });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<BrowserSessionContextValue>(() => ({
    session,
    refresh,
    signIn(returnTo = "/#/my-decks") {
      window.location.assign(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
    },
  }), [refresh, session]);

  return <BrowserSessionContext.Provider value={value}>{children}</BrowserSessionContext.Provider>;
}

export function useBrowserSession(): BrowserSessionContextValue {
  const value = useContext(BrowserSessionContext);
  if (!value) throw new Error("useBrowserSession must be used inside BrowserSessionProvider.");
  return value;
}
