import { useEffect, useState } from "react";
import { getDeck, registerDeck } from "@/decks";
import { getSharedDeck } from "@/catalog/api";
import { navigate } from "./router";

/**
 * Resolve a visible catalog deck only when the ordinary runtime does not already know its id.
 * Once registered, every existing deck surface treats it exactly like any other validated deck.
 */
export function RemoteDeckBoundary({ deckId, children }: { deckId: string; children: React.ReactNode }) {
  const [state, setState] = useState<"ready" | "loading" | "missing" | "error">(() => getDeck(deckId) ? "ready" : "loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (getDeck(deckId)) { setState("ready"); return; }
    const controller = new AbortController();
    setState("loading");
    setMessage("");
    void getSharedDeck(deckId, controller.signal).then((remote) => {
      if (controller.signal.aborted) return;
      registerDeck({
        data: remote.manifest.data,
        tagline: remote.manifest.tagline,
        spreads: remote.manifest.spreads,
        custom: true,
        runtimeId: remote.id,
      }, { replaceExisting: true });
      setState("ready");
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const status = typeof error === "object" && error && "status" in error ? (error as { status?: unknown }).status : undefined;
      setMessage(error instanceof Error ? error.message : "Unable to load this deck.");
      setState(status === 404 ? "missing" : "error");
    });
    return () => controller.abort();
  }, [deckId]);

  if (state === "ready") return <>{children}</>;
  if (state === "loading") return <DeckStatus title="Opening deck…" body="Resolving this shared deck from the Generative Arcana catalog." />;
  if (state === "missing") return <DeckStatus title="Deck unavailable" body="This deck does not exist or is not visible to you." />;
  return <DeckStatus title="Couldn’t open deck" body={message || "The catalog could not be reached."} />;
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
