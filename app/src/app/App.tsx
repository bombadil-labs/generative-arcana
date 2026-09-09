import { useEffect, type CSSProperties } from "react";
import { useHashRoute, navigate } from "./router";
import { Landing } from "./Landing";
import { Community } from "./Community";
import { DeckHome } from "./DeckHome";
import { CardBrowser } from "./CardBrowser";
import { Reading } from "./Reading";
import { RemoteDeckBoundary } from "./RemoteDeckBoundary";

/**
 * App shell + hash router. Deck routes use the canonical runtime/resource id. If an id is not
 * registered locally, RemoteDeckBoundary may resolve a visible shared deck from the catalog before
 * handing it to the same About/Browse/Reading surfaces used by bundled and locally imported decks.
 */
type Tab = "about" | "browse" | "read";

export function App() {
  const route = useHashRoute();

  let content: React.ReactNode;
  let m: RegExpMatchArray | null;
  let deckId: string | null = null;
  let tab: Tab | null = null;
  if (route.match(/^\/community\/?$/)) content = <Community />;
  else if ((m = route.match(/^\/deck\/([^/]+)\/browse\/?$/))) { deckId = m[1]; tab = "browse"; content = <RemoteDeckBoundary deckId={deckId}><CardBrowser deckId={deckId} /></RemoteDeckBoundary>; }
  else if ((m = route.match(/^\/deck\/([^/]+)\/read\/?$/))) { deckId = m[1]; tab = "read"; content = <RemoteDeckBoundary deckId={deckId}><Reading deckId={deckId} /></RemoteDeckBoundary>; }
  else if ((m = route.match(/^\/deck\/([^/]+)\/r\/(.+)$/))) { deckId = m[1]; tab = "read"; content = <RemoteDeckBoundary deckId={deckId}><Reading deckId={deckId} token={m[2]} /></RemoteDeckBoundary>; }
  else if ((m = route.match(/^\/deck\/([^/]+)\/?$/))) { deckId = m[1]; tab = "about"; content = <RemoteDeckBoundary deckId={deckId}><DeckHome deckId={deckId} /></RemoteDeckBoundary>; }
  else content = <Landing />;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", deckId ?? "core");
  }, [deckId]);

  const tabs: { key: Tab; label: string; path: string }[] = deckId ? [
    { key: "about", label: "About", path: `/deck/${deckId}` },
    { key: "browse", label: "Browse cards", path: `/deck/${deckId}/browse` },
    { key: "read", label: "Reading", path: `/deck/${deckId}/read` },
  ] : [];

  return (
    <div style={{ minHeight: "100vh" }}>
      <header style={header}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => navigate("/")} style={brand} aria-label="Generative Arcana — home">
            <BrandMark />
            <span style={{ font: "400 19px/1 var(--font-display)", letterSpacing: "0.01em" }}>Generative Arcana</span>
          </button>
          {!deckId && <button onClick={() => navigate("/community")} style={libraryLink} aria-current={route.match(/^\/community\/?$/) ? "page" : undefined}>Community</button>}
        </div>
        {tabs.length > 0 && (
          <nav aria-label="Deck sections" style={{ display: "flex", gap: 4 }}>
            {tabs.map((t) => {
              const on = t.key === tab;
              return <button key={t.key} onClick={() => navigate(t.path)} aria-current={on ? "page" : undefined} style={tabPill(on)}>{t.label}</button>;
            })}
          </nav>
        )}
      </header>
      <main>{content}</main>
    </div>
  );
}

function BrandMark() {
  return <span aria-hidden style={{ display: "inline-flex", color: "var(--accent)" }}><svg width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="12" cy="12" r="3.2" fill="currentColor" /></svg></span>;
}

const header: CSSProperties = { position: "sticky", top: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px clamp(16px, 4vw, 28px)", borderBottom: "1px solid var(--line)", background: "color-mix(in srgb, var(--paper) 82%, transparent)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", flexWrap: "wrap" };
const brand: CSSProperties = { all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 9, color: "var(--ink)" };
const libraryLink: CSSProperties = { all: "unset", cursor: "pointer", padding: "7px 10px", borderRadius: 999, font: "600 12px/1 var(--font-body)", color: "var(--ink-2)" };
function tabPill(on: boolean): CSSProperties { return { all: "unset", cursor: "pointer", padding: "7px 13px", borderRadius: 999, font: "600 13px/1 var(--font-body)", color: on ? "var(--accent)" : "var(--ink-2)", background: on ? "var(--accent-wash)" : "transparent" }; }
