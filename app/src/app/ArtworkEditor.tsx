import { useEffect, useRef, useState } from "react";
import { useBrowserSession, type BrowserSessionState } from "../auth/session";
import { getOwnedArtwork, uploadCardArtwork, createArtworkSet, validateArtworkFile, ArtworkApiError, DEFAULT_ARTWORK_PACK_ID, type ArtworkPack, type OwnedArtworkCatalog } from "../artwork/api";
import { useArtworkStore, useArtworkSelection, getArtworkPackId, setArtworkPackId, CatalogArtworkProvider } from "../artwork/context";
import { resolveArtworkPack } from "../artwork/selection";
import { getDeck } from "../decks/registry";
import { CardArt } from "../components/CardArt";
import { navigate } from "./router";
import "./artwork.css";
import { PackAssetEditor } from "./PackAssetEditor";

type CatalogState = { deckId: string; packId: string; session: BrowserSessionState; data: OwnedArtworkCatalog | null; error: string | null };
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
  const selection = useArtworkSelection();
  const [localSelection, setLocalSelection] = useState(() => ({ deckId: canonicalId, packId: getArtworkPackId(canonicalId) || DEFAULT_ARTWORK_PACK_ID }));
  const localResolution = useRef<string | null>(null);
  const packId = selection?.packId ?? (localSelection.deckId === canonicalId ? localSelection.packId : getArtworkPackId(canonicalId) || DEFAULT_ARTWORK_PACK_ID);
  const hasSelection = !!selection;
  const selectionPending = !!selection && !selection.resolved;
  const selectionError = selectionPending ? selection?.error : null;
  const [knownPacks, setKnownPacks] = useState<{ deckId: string; session: BrowserSessionState; packs: ArtworkPack[] } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [setName, setSetName] = useState("");
  const [setId, setSetId] = useState("");
  const [setDescription, setSetDescription] = useState("");
  const [creating, setCreating] = useState(false);
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
  const current = catalog?.deckId === canonicalId && catalog.packId === packId && catalog.session === session ? catalog : null;

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    mutation.current?.abort(); mutation.current = null;
    setCatalog(null); setFile(null); setBusy(false); setCreating(false); setMessage(null); setError(null);
    if (fileInput.current) fileInput.current.value = "";
    if (selectionPending) {
      if (selectionError) setCatalog({ deckId: canonicalId, packId, session, data: null, error: selectionError ?? "Unable to load artwork sets." });
      return () => controller.abort();
    }
    if (!packId) return () => controller.abort();
    const read = () => getOwnedArtwork(canonicalId, controller.signal, packId === DEFAULT_ARTWORK_PACK_ID ? undefined : packId);
    void read().catch((cause: unknown) => {
      if (!hasSelection && localResolution.current !== canonicalId && cause instanceof ArtworkApiError && (cause.status === 400 || cause.status === 404) && packId !== DEFAULT_ARTWORK_PACK_ID) return getOwnedArtwork(canonicalId, controller.signal);
      throw cause;
    }).then((data) => {
      if (controller.signal.aborted) return;
      setKnownPacks({ deckId: canonicalId, session, packs: data.packs });
      if (!hasSelection && localResolution.current !== canonicalId) {
        localResolution.current = canonicalId;
        const resolved = resolveArtworkPack(data.packs, getArtworkPackId(canonicalId));
        if (resolved !== packId) { setLocalSelection({ deckId: canonicalId, packId: resolved }); return; }
      }
      setCatalog({ deckId: canonicalId, packId, session, data, error: null });
      setSlug((previous) => data.cards.some((card) => card.slug === previous) ? previous : data.cards[0]?.slug ?? "");
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setCatalog({ deckId: canonicalId, packId, session, data: null, error: friendlyError(cause) });
    });
    return () => { controller.abort(); mutation.current?.abort(); };
  }, [canonicalId, session, reload, packId, hasSelection, selectionPending, selectionError]);

  const rememberedPacks = knownPacks?.deckId === canonicalId && knownPacks.session === session ? knownPacks.packs : [];
  const packs = current?.data?.packs ?? (rememberedPacks.length ? rememberedPacks : selection?.packs ?? []);
  const activePack = packs.find((pack) => pack.id === packId);
  const changePack = (id: string) => {
    // Cancel immediately, even if a network response arrives before the next effect cleanup.
    request.current?.abort(); mutation.current?.abort(); mutation.current = null;
    setArtworkPackId(canonicalId, id);
    localResolution.current = canonicalId;
    if (selection) selection.selectPack(id);
    else setLocalSelection({ deckId: canonicalId, packId: id });
    setShowCreate(false); setCreating(false); setBusy(false);
    if (id === packId) { artworkStore?.clear(); setReload((value) => value + 1); }
  };
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
    const stillCurrent = () => !controller.signal.aborted && !scope?.signal.aborted && mutation.current === controller && (!artworkStore || artworkStore.packId === packId);
    setBusy(true); setError(null); setMessage(null);
    try {
      const artwork = await uploadCardArtwork(canonicalId, selected.slug, file, current.data.deckRevision, selected.artwork?.id ?? null, controller.signal, packId === DEFAULT_ARTWORK_PACK_ID ? undefined : packId);
      if (!stillCurrent()) return;
      // Another optional slot may have finished while this front uploaded. Merge into the
      // latest catalog so its metadata/flags are never replaced by this request's snapshot.
      setCatalog((previous) => {
        if (!previous?.data || previous.deckId !== canonicalId || previous.packId !== packId || previous.session !== session) return previous;
        const cards = previous.data.cards.map((card) => card.slug === selected.slug ? { ...card, artwork } : card);
        const cardCount = cards.filter((card) => card.artwork).length;
        const packs = previous.data.packs.map((pack) => pack.id === packId ? { ...pack, cardCount, complete: cardCount === cards.length } : pack);
        return { ...previous, data: { ...previous.data, deckRevision: artwork.deckRevision, cards, packs } };
      });
      setKnownPacks((previous) => {
        if (!previous || previous.deckId !== canonicalId || previous.session !== session) return previous;
        const cardCount = current.data!.cards.filter((card) => card.slug === selected.slug || card.artwork).length;
        return { ...previous, packs: previous.packs.map((pack) => pack.id === packId ? { ...pack, cardCount, complete: cardCount === current.data!.cards.length } : pack) };
      });
      resetFile();
      setMessage(`Artwork saved for ${selected.name}. It is saved in ${activePack?.label ?? packId} for the card browser and readings.`);
      void artworkStore?.load(selected.slug, true);
    } catch (cause: unknown) {
      if (!stillCurrent()) return;
      if (cause instanceof ArtworkApiError && cause.status === 409) {
        // Refresh preconditions, but never silently retry a write over somebody else's changes.
        setCatalog(null); resetFile();
        setError("This deck or card artwork changed. Loading the latest version before you try again.");
        artworkStore?.fail(selected.slug);
        try {
          const data = await getOwnedArtwork(canonicalId, controller.signal, packId === DEFAULT_ARTWORK_PACK_ID ? undefined : packId);
          if (!stillCurrent()) return;
          setCatalog({ deckId: canonicalId, packId, session, data, error: null });
          setSlug((previous) => data.cards.some((card) => card.slug === previous) ? previous : data.cards[0]?.slug ?? "");
          setError("The latest version is loaded. Review the card, choose your image again, then upload.");
          void artworkStore?.load(selected.slug, true);
        } catch (refreshError: unknown) {
          if (stillCurrent()) setCatalog({ deckId: canonicalId, packId, session, data: null, error: friendlyError(refreshError) });
        }
      } else setError(friendlyError(cause));
    } finally {
      if (stillCurrent()) { mutation.current = null; setBusy(false); }
    }
  }

  async function createSet(event: React.FormEvent) {
    event.preventDefault();
    if (!current?.data || mutation.current || request.current?.signal.aborted) return;
    const controller = new AbortController(); mutation.current = controller;
    const scope = request.current;
    const stillCurrent = () => !controller.signal.aborted && !scope?.signal.aborted && mutation.current === controller && (!artworkStore || artworkStore.packId === packId);
    setCreating(true); setError(null); setMessage(null);
    try {
      const pack = await createArtworkSet(canonicalId, { id: setId, label: setName, description: setDescription, expectedDeckRevision: current.data.deckRevision }, controller.signal);
      if (!stillCurrent()) return;
      artworkStore?.addPack(pack);
      setKnownPacks({ deckId: canonicalId, session, packs: [...packs.filter((item) => item.id !== pack.id), pack] });
      setSetName(""); setSetId(""); setSetDescription("");
      changePack(pack.id);
    } catch (cause: unknown) {
      if (!stillCurrent()) return;
      setError(friendlyError(cause));
      if (cause instanceof ArtworkApiError && cause.status === 409) {
        try {
          const data = await getOwnedArtwork(canonicalId, controller.signal, packId === DEFAULT_ARTWORK_PACK_ID ? undefined : packId);
          if (stillCurrent()) { setCatalog({ deckId: canonicalId, packId, session, data, error: null }); setKnownPacks({ deckId: canonicalId, session, packs: data.packs }); }
        } catch { /* retain the explicit create error, and never retry a write automatically */ }
      }
    } finally {
      if (stillCurrent()) { mutation.current = null; setCreating(false); }
    }
  }

  return <section className="artwork-editor">
    <p className="artwork-kicker">Your deck · visual artwork</p>
    <h1>{deck?.name ? `${deck.name}: artwork` : "Card artwork"}</h1>
    <p className="artwork-intro">Add one illustration at a time. Your card names, meanings, axes, and reading links stay separate from the image. Create named artwork sets to give the same deck different visual treatments. Each set follows this deck’s sharing settings.</p>
    <button className="artwork-back" type="button" onClick={() => navigate(`/deck/${canonicalId}/browse`)}>← Browse cards</button>
    <div className="artwork-set-controls">
      <div>
        <label htmlFor="artwork-set">Artwork set</label>
        <select id="artwork-set" value={packId} onChange={(event) => changePack(event.target.value)}>
          {!packId && <option value="" disabled>Choose an artwork set…</option>}
          {packId && !packs.some((pack) => pack.id === packId) && <option value={packId}>{packId === DEFAULT_ARTWORK_PACK_ID ? "Saved artwork" : packId}</option>}
          {packs.map((pack) => <option key={pack.id} value={pack.id}>{pack.label} · {pack.cardCount} illustrated{pack.complete ? " · complete" : ""}</option>)}
        </select>
        {activePack?.description && <p className="artwork-hint">{activePack.description}</p>}
      </div>
      <button type="button" disabled={!current?.data || busy || creating} aria-expanded={showCreate} onClick={() => { setShowCreate((value) => !value); setError(null); }}>New artwork set</button>
    </div>
    {showCreate && <form className="artwork-create-set" onSubmit={createSet} aria-busy={creating}>
      <h2>Create an artwork set</h2>
      <p className="artwork-hint">Starts empty. Upload each card into this set; your other sets stay available.</p>
      <label htmlFor="artwork-set-name">Set name</label>
      <input id="artwork-set-name" value={setName} maxLength={80} required disabled={creating} placeholder="Watercolor" onChange={(event) => {
        const next = event.target.value;
        if (!setId || setId === makeSetId(setName)) setSetId(makeSetId(next));
        setSetName(next);
      }} />
      <label htmlFor="artwork-set-id">Set ID</label>
      <input id="artwork-set-id" value={setId} maxLength={80} required pattern={"[a-z0-9]+([._\\-][a-z0-9]+)*"} disabled={creating} aria-describedby="artwork-set-id-hint" onChange={(event) => setSetId(event.target.value)} />
      <p id="artwork-set-id-hint" className="artwork-hint">A unique, stable ID using lowercase letters, numbers, hyphens, periods, or underscores.</p>
      <label htmlFor="artwork-set-description">Description (optional)</label>
      <input id="artwork-set-description" value={setDescription} maxLength={500} disabled={creating} onChange={(event) => setSetDescription(event.target.value)} />
      <div className="artwork-create-actions">
        <button type="submit" disabled={creating || busy || !current?.data || !setName.trim() || !setId.trim()}>{creating ? "Creating…" : "Create set"}</button>
        <button type="button" disabled={creating} onClick={() => setShowCreate(false)}>Cancel</button>
      </div>
    </form>}
    {!current && <p role="status">{packId ? "Loading the latest cards and artwork…" : "Choose an artwork set to edit."}</p>}
    {current?.error && <div role="alert"><p>{current.error}</p><button type="button" onClick={() => { selection?.refresh(); setReload((value) => value + 1); }}>Try again</button></div>}
    {current && error && <p className="artwork-error" role="alert">{error}</p>}
    {current && message && <p className="artwork-success" role="status">{message}</p>}
    {current?.data && <div className="artwork-layout">
      <form id="artwork-upload-form" onSubmit={upload} aria-busy={busy}>
        <label htmlFor="artwork-card">Card</label>
        <select id="artwork-card" value={slug} onChange={(event) => changeCard(event.target.value)} disabled={busy || creating}>
          {current.data.cards.map((card) => <option key={card.slug} value={card.slug}>{card.name}{card.artwork ? " · artwork added" : ""}</option>)}
        </select>
        <p className="artwork-hint">{selected?.artwork ? "This card has artwork in this set. Uploading replaces only this set’s image." : "This set has no image for this card. It uses its semantic card face."}</p>
        <label htmlFor="artwork-file">Image for {selected?.name ?? "this card"}</label>
        <input ref={fileInput} id="artwork-file" type="file" accept="image/png,image/jpeg,image/webp" aria-describedby="artwork-limits" disabled={busy || creating || !selected} onChange={(event) => {
          const next = event.target.files?.[0] ?? null;
          setMessage(null); setFile(null);
          const invalid = next ? validateArtworkFile(next) : null;
          setError(invalid);
          if (invalid) event.target.value = "";
          else setFile(next);
        }} />
        <p id="artwork-limits" className="artwork-hint">PNG, JPEG, or WebP. Maximum 3 MB and 16 megapixels. No SVG or animation. Images are validated and re-encoded as WebP before saving.</p>
        {file && <p className="artwork-hint">Ready: {file.name}</p>}
        <button className="artwork-submit" type="submit" disabled={busy || creating || !file || !selected}>{busy ? "Uploading…" : selected?.artwork ? "Replace artwork" : "Upload artwork"}</button>
      </form>
      {preview && (!artworkStore || current.data.deckRevision === artworkStore.deckRevision) && <figure className="artwork-preview"><div>{artworkStore ? <CardArt card={preview} deckId={canonicalId} deck={deck?.data} mode="poster" /> : <CatalogArtworkProvider key={packId} deckId={canonicalId} deckRevision={current.data.deckRevision} selectedPackId={packId}><CardArt card={preview} deckId={canonicalId} deck={deck?.data} mode="poster" /></CatalogArtworkProvider>}</div><figcaption>{activePack?.label ?? packId} · {preview.name}</figcaption></figure>}
    </div>}
    {current?.data && <PackAssetEditor key={`${canonicalId}:${packId}`} deckId={canonicalId} packId={packId} session={session} catalog={current.data} disabled={busy || creating} onSaved={(asset) => {
      const updatePacks = (items: ArtworkPack[]) => items.map((pack) => pack.id === packId ? { ...pack, [asset.slot === "cover" ? "hasCover" : "hasCardBack"]: true } : pack);
      setCatalog((previous) => previous?.deckId === canonicalId && previous.packId === packId && previous.session === session && previous.data ? { ...previous, data: { ...previous.data, [asset.slot]: asset, packs: updatePacks(previous.data.packs) } } : previous);
      setKnownPacks((previous) => previous?.deckId === canonicalId && previous.session === session ? { ...previous, packs: updatePacks(previous.packs) } : previous);
      void artworkStore?.loadCatalog(true).catch(() => {});
    }} onRefresh={(data) => {
      setCatalog({ deckId: canonicalId, packId, session, data, error: null });
      setKnownPacks({ deckId: canonicalId, session, packs: data.packs });
      void artworkStore?.loadCatalog(true).catch(() => {});
    }} />}
  </section>;
}
function friendlyError(error: unknown): string {
  if (error instanceof ArtworkApiError && (error.status === 401 || error.status === 403 || error.status === 404)) return "This deck or artwork set is unavailable, or you do not have permission to change its artwork.";
  return error instanceof Error ? error.message : "Unable to load artwork. Check your connection and try again.";
}

function makeSetId(label: string): string { return label.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, ""); }
