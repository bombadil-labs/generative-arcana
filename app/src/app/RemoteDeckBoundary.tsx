import { useEffect, useState } from "react";
import { getDeck } from "@/decks";
import type { DeckModule } from "@/decks/types";
import { useBrowserSession, type BrowserSessionState } from "@/auth/session";
import { catalogDeckRuntime } from "@/catalog/runtime";
import { navigate } from "./router";

type Resolution = {
  deckId: string;
  routeKey: string;
  session: BrowserSessionState;
} & ({ status: "ready"; deck: DeckModule } | { status: "missing" | "error"; message: string });

/** Catalog snapshots are revalidated on every route/session boundary. Only bundled decks and
 * browser-local imports bypass the catalog. Never render a previous route/session's resolution. */
export function RemoteDeckBoundary({ deckId, routeKey, children }: { deckId: string; routeKey: string; children: React.ReactNode }) {
  const { session } = useBrowserSession();
  const [resolution, setResolution] = useState<Resolution | null>(null);

  useEffect(() => {
    if (catalogDeckRuntime.localDeck(deckId) || session.status === "loading") return;
    const controller = new AbortController();
    void catalogDeckRuntime.resolve(deckId, controller.signal).then((deck) => {
      if (!controller.signal.aborted) setResolution({ deckId, routeKey, session, status: "ready", deck });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const status = typeof error === "object" && error && "status" in error ? (error as { status?: unknown }).status : undefined;
      setResolution({
        deckId, routeKey, session,
        status: status === 404 || status === 403 || status === 401 ? "missing" : "error",
        message: error instanceof Error ? error.message : "Unable to load this deck.",
      });
    });
    return () => controller.abort();
  }, [deckId, routeKey, session]);

  if (catalogDeckRuntime.localDeck(deckId)) return <>{children}</>;
  const current = resolution?.deckId === deckId && resolution.routeKey === routeKey && resolution.session === session ? resolution : null;
  if (!current || session.status === "loading") return <DeckStatus title="Opening deck…" body="Checking the latest deck and your access in the Generative Arcana catalog." />;
  if (current.status === "ready" && getDeck(deckId) === current.deck) return <>{children}</>;
  if (current.status === "missing") return <DeckStatus title="Deck unavailable" body="This deck does not exist or is not visible to you." />;
  return <DeckStatus title="Couldn’t open deck" body={current.status === "error" ? current.message : "The catalog could not be reached."} />;
}

function DeckStatus({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "clamp(32px,8vw,96px) clamp(16px,4vw,28px)" }}>
      <div style={{ font: "400 12px/1.4 var(--font-mono)", letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--ink-3)" }}>Community library</div>
      <h1 style={{ font: "400 clamp(32px,5vw,56px)/1.05 var(--font-display)", margin: "var(--s-3) 0", color: "var(--ink)" }}>{title}</h1>
      <p style={{ font: "400 16px/1.6 var(--font-body)", color: "var(--ink-2)", maxWidth: "58ch" }}>{body}</p>
      <button onClick={() => navigate("/community")} style={backButton}>← Community decks</button>
    </div>
  );
}

const backButton: React.CSSProperties = {
  all: "unset", cursor: "pointer", marginTop: "var(--s-4)", padding: "10px 14px", borderRadius: "var(--r-2)",
  border: "1px solid var(--line-2)", font: "600 13px/1 var(--font-body)", color: "var(--ink)",
};
