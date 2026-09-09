import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBrowserSession } from "@/auth/session";
import { validateAuthoringArtifact } from "@/authoring/api";
import type { DeckAuthoringValidation } from "@/decks/authoring";
import { unregisterDeck } from "@/decks";
import {
  deleteMyDeck,
  importMyDeck,
  importRequestFromJson,
  listMyDecks,
  setMyDeckVisibility,
  type CatalogDeckSummary,
} from "@/catalog/api";
import { navigate } from "./router";

type Visibility = CatalogDeckSummary["visibility"];

export function MyDecks() {
  const { session, refresh: refreshSession, signIn } = useBrowserSession();

  if (session.status === "loading") return <CenteredStatus title="Checking your account…" body="Loading your Generative Arcana session." />;
  if (session.status === "unavailable") return <CenteredStatus title="Accounts aren’t configured yet" body={session.message} />;
  if (session.status === "error") {
    return <CenteredStatus title="Couldn’t check your account" body={session.message} action={<button style={secondaryButton} onClick={() => void refreshSession()}>Try again</button>} />;
  }
  if (session.status === "anonymous") {
    return (
      <CenteredStatus
        title="Your deck library lives here"
        body="Sign in to upload decks, keep stable shareable identities, and manage private, unlisted, or public publication."
        action={<button style={primaryButton} onClick={() => signIn("/#/my-decks")}>Sign in →</button>}
      />
    );
  }

  return <AuthenticatedLibrary user={session.user} />;
}

function AuthenticatedLibrary({ user }: { user: { displayName?: string; email?: string; avatarUrl?: string } }) {
  const [decks, setDecks] = useState<CatalogDeckSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyDeck, setBusyDeck] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<DeckAuthoringValidation | null>(null);
  const [validatedText, setValidatedText] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDecks = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await listMyDecks(signal);
      setDecks(next);
      setError(null);
    } catch (reason) {
      if (signal?.aborted) return;
      setError(reason instanceof Error ? reason.message : "Unable to load your decks.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadDecks(controller.signal);
    return () => controller.abort();
  }, [loadDecks]);

  const accountLabel = user.displayName || user.email || "Signed in";

  async function handleFile(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      setSourceText(text);
      setSourceName(file.name);
      clearPreflight();
      setImportError(null);
      setImportNotice(null);
      void preflight(text);
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : "Unable to read that file.");
    }
  }

  function clearPreflight() {
    setValidation(null);
    setValidatedText(null);
  }

  async function preflight(text = sourceText): Promise<DeckAuthoringValidation | null> {
    if (!text.trim()) return null;
    setValidating(true);
    setImportError(null);
    setImportNotice(null);
    try {
      let parsed: unknown;
      try { parsed = JSON.parse(text); }
      catch { throw new Error("That file or pasted text is not valid JSON."); }
      const result = await validateAuthoringArtifact(parsed);
      setValidation(result);
      setValidatedText(text);
      return result;
    } catch (reason) {
      clearPreflight();
      setImportError(reason instanceof Error ? reason.message : "Deck validation failed.");
      return null;
    } finally {
      setValidating(false);
    }
  }

  async function submitImport() {
    if (!sourceText.trim()) return;
    setImporting(true);
    setImportError(null);
    setImportNotice(null);
    try {
      let parsed: unknown;
      try { parsed = JSON.parse(sourceText); }
      catch { throw new Error("That file or pasted text is not valid JSON."); }

      const currentValidation = validatedText === sourceText ? validation : null;
      const checked = currentValidation ?? await preflight(sourceText);
      if (!checked?.valid) return;

      const created = await importMyDeck(importRequestFromJson(parsed, replaceExisting));
      setSourceText("");
      setSourceName(null);
      setReplaceExisting(false);
      clearPreflight();
      if (fileRef.current) fileRef.current.value = "";
      setImportNotice(`${created.name} is now in your library (${created.visibility}).`);
      await loadDecks();
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : "Deck import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function changeVisibility(deck: CatalogDeckSummary, visibility: Visibility) {
    if (visibility === deck.visibility) return;
    setBusyDeck(deck.id);
    setError(null);
    try {
      const updated = await setMyDeckVisibility(deck.id, visibility);
      setDecks((current) => current?.map((item) => item.id === deck.id ? updated : item) ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update deck visibility.");
    } finally {
      setBusyDeck(null);
    }
  }

  async function remove(deck: CatalogDeckSummary) {
    if (!window.confirm(`Permanently delete “${deck.name}”? This cannot be undone.`)) return;
    setBusyDeck(deck.id);
    setError(null);
    try {
      await deleteMyDeck(deck.id);
      unregisterDeck(deck.id);
      setDecks((current) => current?.filter((item) => item.id !== deck.id) ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete this deck.");
    } finally {
      setBusyDeck(null);
    }
  }

  async function copyLink(deck: CatalogDeckSummary) {
    const link = deckLink(deck.id);
    try {
      await navigator.clipboard.writeText(link);
      setImportNotice(`Copied a link to ${deck.name}.`);
    } catch {
      window.prompt("Copy this deck link:", link);
    }
  }

  const currentValidation = validatedText === sourceText ? validation : null;
  const canImport = !!currentValidation?.valid && !validating && !importing;

  return (
    <div style={page}>
      <header style={hero}>
        <div>
          <div style={kicker}>My Decks</div>
          <h1 style={headline}>Your symbolic library</h1>
          <p style={lede}>Upload a canonical Generative Arcana manifest, control how it is shared, and open it anywhere by its stable resource identity.</p>
        </div>
        <div style={accountCard}>
          {user.avatarUrl && <img alt="" src={user.avatarUrl} style={avatar} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ font: "600 13px/1.35 var(--font-body)", color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis" }}>{accountLabel}</div>
            {user.displayName && user.email && <div style={{ font: "400 11px/1.4 var(--font-mono)", color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div>}
          </div>
          <form method="POST" action="/auth/logout" style={{ marginLeft: "auto" }}>
            <button type="submit" style={quietButton}>Sign out</button>
          </form>
        </div>
      </header>

      <section style={section}>
        <div style={sectionHeadingRow}>
          <div>
            <div style={sectionKicker}>Import</div>
            <h2 style={sectionTitle}>Add a deck</h2>
          </div>
          <button style={secondaryButton} onClick={() => fileRef.current?.click()}>Choose JSON file</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => void handleFile(event.currentTarget.files?.[0])} />
        </div>
        <p style={sectionCopy}>Canonical manifests are imported as-is. Raw deck JSON is still accepted for compatibility. New decks always begin private.</p>
        {sourceName && <div style={fileBadge}>{sourceName}</div>}
        <textarea
          value={sourceText}
          onChange={(event) => { setSourceText(event.target.value); setSourceName(null); clearPreflight(); setImportError(null); setImportNotice(null); }}
          placeholder="Paste a canonical manifest or raw deck JSON…"
          spellCheck={false}
          style={textarea}
        />
        <div style={importActions}>
          <label style={checkboxLabel}>
            <input type="checkbox" checked={replaceExisting} onChange={(event) => setReplaceExisting(event.target.checked)} />
            Replace my existing deck with the same authored slug
          </label>
          <div style={buttonGroup}>
            <button disabled={!sourceText.trim() || validating || importing} onClick={() => void preflight()} style={secondaryButtonDisabled(!sourceText.trim() || validating || importing)}>
              {validating ? "Validating…" : currentValidation ? "Validate again" : "Validate deck"}
            </button>
            <button disabled={!canImport} onClick={() => void submitImport()} style={primaryButtonDisabled(!canImport)}>
              {importing ? "Importing…" : "Import deck"}
            </button>
          </div>
        </div>
        {replaceExisting && <p style={hint}>Replacement preserves the existing stable resource ID and publication state; it creates a new revision rather than a new identity.</p>}
        {!currentValidation && sourceText.trim() && !validating && !importError && <p style={hint}>Validate this exact JSON before import. Validation is stateless and does not change your library.</p>}
        {currentValidation && <ValidationResult result={currentValidation} />}
        {importError && <Notice kind="error">{importError}</Notice>}
        {importNotice && <Notice kind="ok">{importNotice}</Notice>}
      </section>

      <section style={section}>
        <div style={sectionHeadingRow}>
          <div>
            <div style={sectionKicker}>Library</div>
            <h2 style={sectionTitle}>Owned decks</h2>
          </div>
          {decks && <div style={count}>{decks.length} {decks.length === 1 ? "deck" : "decks"}</div>}
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        {decks === null && !error && <div style={empty}>Loading your library…</div>}
        {decks?.length === 0 && <div style={empty}>You haven’t imported a deck yet. Add one above and it will appear here immediately.</div>}
        {decks && decks.length > 0 && <div style={deckList}>{decks.map((deck) => (
          <DeckRow
            key={deck.id}
            deck={deck}
            busy={busyDeck === deck.id}
            onVisibility={(visibility) => void changeVisibility(deck, visibility)}
            onDelete={() => void remove(deck)}
            onCopy={() => void copyLink(deck)}
          />
        ))}</div>}
      </section>
    </div>
  );
}

function ValidationResult({ result }: { result: DeckAuthoringValidation }) {
  if (!result.valid) return <Notice kind="error">{result.error}</Notice>;
  const { summary } = result;
  return (
    <div role="status" style={validationCard}>
      <div style={validationHeader}>
        <span style={result.canonical ? canonicalBadge : compatibilityBadge}>
          {result.canonical ? "Canonical manifest" : "Compatibility input"}
        </span>
        <span style={validationName}>{summary.name}</span>
      </div>
      <div style={validationStats}>
        <span>slug {summary.slug}</span>
        <span>{summary.cardCount} cards</span>
        <span>{summary.suitCount} suits</span>
        <span>{summary.rankCount} ranks</span>
        <span>{summary.stationCount} stations</span>
        <span>{summary.spreadCount} native spreads</span>
      </div>
      {result.warning && <p style={validationWarning}>{result.warning}</p>}
    </div>
  );
}

function DeckRow({
  deck,
  busy,
  onVisibility,
  onDelete,
  onCopy,
}: {
  deck: CatalogDeckSummary;
  busy: boolean;
  onVisibility(visibility: Visibility): void;
  onDelete(): void;
  onCopy(): void;
}) {
  const updated = useMemo(() => formatDate(deck.updatedAt), [deck.updatedAt]);
  return (
    <article style={deckRow}>
      <button onClick={() => navigate(`/deck/${deck.id}`)} style={deckIdentity}>
        <div style={deckGlyph} aria-hidden>✦</div>
        <div style={{ minWidth: 0 }}>
          <div style={deckName}>{deck.name}</div>
          <div style={tagline}>{deck.tagline}</div>
          <div style={metadata}>rev {deck.revision} · updated {updated} · slug {deck.slug}</div>
        </div>
      </button>
      <div style={deckControls}>
        <label style={visibilityLabel}>
          <span>Visibility</span>
          <select disabled={busy} value={deck.visibility} onChange={(event) => onVisibility(event.target.value as Visibility)} style={select}>
            <option value="private">Private</option>
            <option value="unlisted">Unlisted</option>
            <option value="public">Public</option>
          </select>
        </label>
        {deck.visibility !== "private" && <button disabled={busy} onClick={onCopy} style={quietButton}>Copy link</button>}
        <button disabled={busy} onClick={onDelete} style={dangerButton}>Delete</button>
      </div>
      <div style={visibilityHelp}>{visibilityDescription(deck.visibility)}</div>
    </article>
  );
}

function CenteredStatus({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return <div style={centered}><div style={kicker}>My Decks</div><h1 style={statusTitle}>{title}</h1><p style={statusBody}>{body}</p>{action && <div style={{ marginTop: "var(--s-4)" }}>{action}</div>}</div>;
}

function Notice({ kind, children }: { kind: "error" | "ok"; children: React.ReactNode }) {
  return <div role={kind === "error" ? "alert" : "status"} style={{ ...notice, borderColor: kind === "error" ? "var(--error)" : "var(--line-2)" }}>{children}</div>;
}

function visibilityDescription(visibility: Visibility): string {
  if (visibility === "private") return "Only you can resolve this deck.";
  if (visibility === "unlisted") return "Anyone with its stable link can use it, but it does not appear in Community.";
  return "Discoverable in Community and usable by anyone through its stable resource ID.";
}

function deckLink(id: string): string {
  return `${window.location.origin}${window.location.pathname}#/deck/${encodeURIComponent(id)}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const page: React.CSSProperties = { maxWidth: 1120, margin: "0 auto", padding: "clamp(28px,5vw,64px) clamp(16px,4vw,28px) 72px" };
const hero: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: "var(--s-5)", alignItems: "end", marginBottom: "var(--s-6)" };
const kicker: React.CSSProperties = { font: "400 12px/1.4 var(--font-mono)", letterSpacing: "0.13em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: "var(--s-3)" };
const headline: React.CSSProperties = { font: "400 clamp(38px,6vw,72px)/1.04 var(--font-display)", color: "var(--ink)", margin: 0 };
const lede: React.CSSProperties = { maxWidth: "64ch", margin: "var(--s-3) 0 0", font: "400 16px/1.65 var(--font-body)", color: "var(--ink-2)" };
const accountCard: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, minWidth: 0, padding: "12px 14px", border: "1px solid var(--line)", borderRadius: "var(--r-2)", background: "var(--card)" };
const avatar: React.CSSProperties = { width: 32, height: 32, borderRadius: "50%", objectFit: "cover" };
const section: React.CSSProperties = { marginTop: "var(--s-5)", padding: "clamp(18px,3vw,28px)", border: "1px solid var(--line)", borderRadius: "var(--r-3)", background: "var(--card)", boxShadow: "var(--e-1)" };
const sectionHeadingRow: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" };
const sectionKicker: React.CSSProperties = { ...kicker, marginBottom: 6 };
const sectionTitle: React.CSSProperties = { font: "400 29px/1.1 var(--font-display)", color: "var(--ink)", margin: 0 };
const sectionCopy: React.CSSProperties = { font: "400 14px/1.6 var(--font-body)", color: "var(--ink-2)", maxWidth: "70ch" };
const textarea: React.CSSProperties = { width: "100%", minHeight: 180, boxSizing: "border-box", resize: "vertical", padding: 14, border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", background: "var(--paper-2)", color: "var(--ink)", font: "400 12px/1.5 var(--font-mono)" };
const fileBadge: React.CSSProperties = { display: "inline-block", marginBottom: 10, padding: "6px 9px", borderRadius: 999, background: "var(--accent-wash)", color: "var(--accent)", font: "600 11px/1 var(--font-mono)" };
const importActions: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginTop: 12 };
const buttonGroup: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" };
const validationCard: React.CSSProperties = { marginTop: 12, padding: 14, border: "1px solid var(--line-2)", borderRadius: "var(--r-2)", background: "var(--paper-2)" };
const validationHeader: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" };
const validationName: React.CSSProperties = { font: "600 14px/1.35 var(--font-body)", color: "var(--ink)" };
const validationStats: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: "6px 12px", marginTop: 10, font: "400 10.5px/1.4 var(--font-mono)", color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.04em" };
const canonicalBadge: React.CSSProperties = { display: "inline-block", padding: "5px 8px", borderRadius: 999, background: "var(--accent-wash)", color: "var(--accent)", font: "600 10px/1 var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.05em" };
const compatibilityBadge: React.CSSProperties = { ...canonicalBadge, background: "var(--paper)", color: "var(--ink-2)", border: "1px solid var(--line-2)" };
const validationWarning: React.CSSProperties = { margin: "10px 0 0", font: "400 12px/1.5 var(--font-body)", color: "var(--ink-2)" };
const checkboxLabel: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, font: "400 13px/1.4 var(--font-body)", color: "var(--ink-2)" };
const hint: React.CSSProperties = { margin: "10px 0 0", font: "400 12px/1.55 var(--font-body)", color: "var(--ink-3)" };
const deckList: React.CSSProperties = { display: "grid", gap: 12, marginTop: 16 };
const deckRow: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: "10px 18px", padding: 14, border: "1px solid var(--line)", borderRadius: "var(--r-2)", background: "var(--paper)" };
const deckIdentity: React.CSSProperties = { all: "unset", cursor: "pointer", display: "grid", gridTemplateColumns: "40px minmax(0,1fr)", gap: 12, alignItems: "center", minWidth: 0 };
const deckGlyph: React.CSSProperties = { width: 40, height: 52, display: "grid", placeItems: "center", borderRadius: 6, background: "var(--accent-wash)", color: "var(--accent)", font: "400 24px/1 var(--font-display)" };
const deckName: React.CSSProperties = { font: "400 19px/1.2 var(--font-display)", color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const tagline: React.CSSProperties = { marginTop: 3, font: "400 13px/1.4 var(--font-body)", color: "var(--ink-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const metadata: React.CSSProperties = { marginTop: 7, font: "400 10.5px/1.4 var(--font-mono)", color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.05em" };
const deckControls: React.CSSProperties = { display: "flex", alignItems: "end", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" };
const visibilityLabel: React.CSSProperties = { display: "grid", gap: 4, font: "600 10px/1 var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--ink-3)" };
const select: React.CSSProperties = { minWidth: 112, padding: "8px 28px 8px 9px", border: "1px solid var(--line-2)", borderRadius: 8, background: "var(--card)", color: "var(--ink)", font: "600 12px/1 var(--font-body)" };
const visibilityHelp: React.CSSProperties = { gridColumn: "1 / -1", paddingTop: 8, borderTop: "1px solid var(--line)", font: "400 11.5px/1.45 var(--font-body)", color: "var(--ink-3)" };
const count: React.CSSProperties = { font: "400 11px/1 var(--font-mono)", color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" };
const empty: React.CSSProperties = { marginTop: 16, padding: 18, border: "1px dashed var(--line-2)", borderRadius: "var(--r-2)", font: "400 14px/1.6 var(--font-body)", color: "var(--ink-2)" };
const notice: React.CSSProperties = { marginTop: 12, padding: "10px 12px", border: "1px solid var(--line-2)", borderRadius: 8, font: "400 13px/1.5 var(--font-body)", color: "var(--ink-2)" };
const centered: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: "clamp(48px,10vw,120px) clamp(16px,4vw,28px)" };
const statusTitle: React.CSSProperties = { font: "400 clamp(34px,5vw,58px)/1.05 var(--font-display)", color: "var(--ink)", margin: 0 };
const statusBody: React.CSSProperties = { maxWidth: "58ch", margin: "var(--s-3) 0 0", font: "400 16px/1.65 var(--font-body)", color: "var(--ink-2)" };
const primaryButton: React.CSSProperties = { all: "unset", cursor: "pointer", display: "inline-block", padding: "11px 16px", borderRadius: "var(--r-2)", background: "var(--accent)", color: "var(--accent-ink)", font: "600 13px/1 var(--font-body)" };
const secondaryButton: React.CSSProperties = { ...primaryButton, background: "transparent", color: "var(--ink)", border: "1px solid var(--line-2)" };
const quietButton: React.CSSProperties = { all: "unset", cursor: "pointer", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", color: "var(--ink-2)", font: "600 11px/1 var(--font-body)" };
const dangerButton: React.CSSProperties = { ...quietButton, color: "var(--error)" };
function primaryButtonDisabled(disabled: boolean): React.CSSProperties { return { ...primaryButton, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1 }; }
function secondaryButtonDisabled(disabled: boolean): React.CSSProperties { return { ...secondaryButton, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1 }; }
