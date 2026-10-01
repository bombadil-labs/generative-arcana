import { useEffect, useRef, useState } from "react";
import { useBrowserSession, type BrowserSessionState } from "../auth/session";
import { getOwnedArtwork, uploadCardArtwork, validateArtworkFile, ArtworkApiError, type OwnedArtworkCatalog } from "../artwork/api";
import { useArtworkStore } from "../artwork/context";
import { getDeck } from "../decks/registry";
import { CardArt } from "../components/CardArt";
import { navigate } from "./router";
import "./artwork.css";

type CatalogState = { deckId: string; session: BrowserSessionState; data: OwnedArtworkCatalog | null; error: string | null };
/** Ownership is established by the owner-only API. Every mutation has a revision + asset precondition. */
export function ArtworkEditor({ deckId }: { deckId: string }) {
  const { session, signIn } = useBrowserSession();
  if (session.status === "loading") return <section className="artwork-editor"><p role="status">Checking your account…</p></section>;
  if (session.status !== "authenticated") return <section className="artwork-editor"><h1>Card artwork</h1><p>Sign in to upload artwork for a deck you own.</p><button onClick={() => signIn(`/#/deck/${encodeURIComponent(deckId)}/artwork`)}>Sign in</button></section>;
  return <OwnedArtworkEditor deckId={deckId} session={session} />;
}
function OwnedArtworkEditor({ deckId, session }: { deckId: string; session: BrowserSessionState }) {
  const deck = getDeck(deckId);
  const canonicalId = deck?.id ?? deckId;
  const artworkStore = useArtworkStore();
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [reload, setReload] = useState(0);
  const [slug, setSlug] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const current = catalog?.deckId === canonicalId && catalog.session === session ? catalog : null;

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    mutation.current?.abort(); mutation.current = null;
    setCatalog(null); setFile(null); setBusy(false); setMessage(null); setError(null);
    if (fileInput.current) fileInput.current.value = "";
    void getOwnedArtwork(canonicalId, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setCatalog({ deckId: canonicalId, session, data, error: null });
      setSlug((previous) => data.cards.some((card) => card.slug === previous) ? previous : data.cards[0]?.slug ?? "");
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setCatalog({ deckId: canonicalId, session, data: null, error: friendlyError(cause) });
    });
    return () => { controller.abort(); mutation.current?.abort(); };
  }, [canonicalId, session, reload]);

  const selected = current?.data?.cards.find((card) => card.slug === slug);
  const preview = deck?.cards.find((card) => card.slug === slug);
  const resetFile = () => { setFile(null); if (fileInput.current) fileInput.current.value = ""; };
  const changeCard = (next: string) => { setSlug(next); resetFile(); setError(null); setMessage(null); };

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    // The ref prevents two synchronous submits before React commits the disabled state.
    if (!file || !current?.data || !selected || mutation.current || request.current?.signal.aborted) return;
    const invalid = validateArtworkFile(file);
    if (invalid) { setError(invalid); return; }
    const controller = new AbortController(); mutation.current = controller;
    const scope = request.current;
    const stillCurrent = () => !controller.signal.aborted && !scope?.signal.aborted && mutation.current === controller;
    setBusy(true); setError(null); setMessage(null);
    try {
      const artwork = await uploadCardArtwork(canonicalId, selected.slug, file, current.data.deckRevision, selected.artwork?.id ?? null, controller.signal);
      if (!stillCurrent()) return;
      setCatalog({ ...current, data: { ...current.data, deckRevision: artwork.deckRevision, cards: current.data.cards.map((card) => card.slug === selected.slug ? { ...card, artwork } : card) } });
      resetFile();
      setMessage(`Artwork saved for ${selected.name}. It will appear in the card browser and readings.`);
      void artworkStore?.load(selected.slug, true);
    } catch (cause: unknown) {
      if (!stillCurrent()) return;
      if (cause instanceof ArtworkApiError && cause.status === 409) {
        // Refresh preconditions, but never silently retry a write over somebody else's changes.
        setCatalog(null); resetFile();
        setError("This deck or card artwork changed. Loading the latest version before you try again.");
        artworkStore?.fail(selected.slug);
        try {
          const data = await getOwnedArtwork(canonicalId, controller.signal);
          if (!stillCurrent()) return;
          setCatalog({ deckId: canonicalId, session, data, error: null });
          setSlug((previous) => data.cards.some((card) => card.slug === previous) ? previous : data.cards[0]?.slug ?? "");
          setError("The latest version is loaded. Review the card, choose your image again, then upload.");
          void artworkStore?.load(selected.slug, true);
        } catch (refreshError: unknown) {
          if (stillCurrent()) setCatalog({ deckId: canonicalId, session, data: null, error: friendlyError(refreshError) });
        }
      } else setError(friendlyError(cause));
    } finally {
      if (stillCurrent()) { mutation.current = null; setBusy(false); }
    }
  }

  return <section className="artwork-editor">
    <p className="artwork-kicker">Your deck · visual artwork</p>
    <h1>{deck?.name ? `${deck.name}: artwork` : "Card artwork"}</h1>
    <p className="artwork-intro">Add one illustration at a time. Your card names, meanings, axes, and reading links stay separate from the image. Saved artwork follows this deck’s sharing settings.</p>
    <button className="artwork-back" type="button" onClick={() => navigate(`/deck/${canonicalId}/browse`)}>← Browse cards</button>
    {!current && <p role="status">Loading the latest cards and artwork…</p>}
    {current?.error && <div role="alert"><p>{current.error}</p><button type="button" onClick={() => setReload((value) => value + 1)}>Try again</button></div>}
    {current && error && <p className="artwork-error" role="alert">{error}</p>}
    {current && message && <p className="artwork-success" role="status">{message}</p>}
    {current?.data && <div className="artwork-layout">
      <form onSubmit={upload} aria-busy={busy}>
        <label htmlFor="artwork-card">Card</label>
        <select id="artwork-card" value={slug} onChange={(event) => changeCard(event.target.value)} disabled={busy}>
          {current.data.cards.map((card) => <option key={card.slug} value={card.slug}>{card.name}{card.artwork ? " · artwork added" : ""}</option>)}
        </select>
        <p className="artwork-hint">{selected?.artwork ? "This card has artwork. Uploading replaces its current image." : "This card currently uses its semantic card face."}</p>
        <label htmlFor="artwork-file">Image for {selected?.name ?? "this card"}</label>
        <input ref={fileInput} id="artwork-file" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="artwork-limits" disabled={busy || !selected} onChange={(event) => {
          const next = event.target.files?.[0] ?? null;
          setMessage(null); setFile(null);
          const invalid = next ? validateArtworkFile(next) : null;
          setError(invalid);
          if (invalid) event.target.value = "";
          else setFile(next);
        }} />
        <p id="artwork-limits" className="artwork-hint">PNG, JPEG, or WebP. Maximum 3 MB and 16 megapixels. No SVG or animation. Images are validated and re-encoded as WebP before saving.</p>
        {file && <p className="artwork-hint">Ready: {file.name}</p>}
        <button className="artwork-submit" type="submit" disabled={busy || !file || !selected}>{busy ? "Uploading…" : selected?.artwork ? "Replace artwork" : "Upload artwork"}</button>
      </form>
      {preview && (!artworkStore || current.data.deckRevision === artworkStore.deckRevision) && <figure className="artwork-preview"><div><CardArt card={preview} deckId={canonicalId} deck={deck?.data} mode="poster" /></div><figcaption>Current card · {preview.name}</figcaption></figure>}
    </div>}
  </section>;
}
function friendlyError(error: unknown): string {
  if (error instanceof ArtworkApiError && (error.status === 401 || error.status === 403 || error.status === 404)) return "This deck is unavailable or you do not have permission to change its artwork.";
  return error instanceof Error ? error.message : "Unable to load artwork. Check your connection and try again.";
}
