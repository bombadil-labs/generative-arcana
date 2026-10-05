import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BrowserSessionState } from "../auth/session";
import { ArtworkApiError, DEFAULT_ARTWORK_PACK_ID, getOwnedArtwork, uploadPackArtworkAsset, validateArtworkFile, type OwnedArtworkCatalog, type PackArtworkAsset, type PackArtworkSlot } from "../artwork/api";
import { PackAssetImage } from "../artwork/PackAssetImage";

interface Props {
  deckId: string;
  packId: string;
  session: BrowserSessionState;
  catalog: OwnedArtworkCatalog;
  disabled?: boolean;
  onSaved(asset: PackArtworkAsset): void;
  onRefresh(catalog: OwnedArtworkCatalog): void;
}
/** Optional set-level files, separate from card fronts and reading behavior. */
export function PackAssetEditor(props: Props) {
  return <section className="pack-assets" aria-label="Artwork set cover and card back">
    <h2>Cover and card back</h2>
    <p className="artwork-hint">Optional images for this artwork set. These do not count toward illustrated cards or set completeness.</p>
    <div className="pack-assets-grid">
      <AssetSlotEditor {...props} slot="cover" />
      <AssetSlotEditor {...props} slot="cardBack" />
    </div>
  </section>;
}
function AssetSlotEditor({ deckId, packId, session, catalog, disabled, slot, onSaved, onRefresh }: Props & { slot: PackArtworkSlot }) {
  const label = slot === "cover" ? "Cover" : "Card back";
  const scope = useMemo(() => ({ deckId, packId, session, slot }), [deckId, packId, session, slot]);
  const [state, setState] = useState<{ scope: typeof scope; file: File | null; busy: boolean; error: string | null; notice: string | null; needsRefresh?: boolean }>({ scope, file: null, busy: false, error: null, notice: null });
  const current = state.scope === scope ? state : { scope, file: null, busy: false, error: null, notice: null };
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const activeScope = useRef(scope);
  const asset = catalog[slot];
  useLayoutEffect(() => {
    activeScope.current = scope;
    request.current?.abort(); request.current = null;
    if (input.current) input.current.value = "";
    setState({ scope, file: null, busy: false, error: null, notice: null });
    return () => { request.current?.abort(); request.current = null; };
  }, [scope]);
  function clearFile() { if (input.current) input.current.value = ""; }
  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!current.file || current.busy || current.needsRefresh || disabled || request.current || activeScope.current !== scope) return;
    const invalid = validateArtworkFile(current.file);
    if (invalid) { setState({ ...current, error: invalid }); return; }
    const controller = new AbortController(); request.current = controller;
    const stillCurrent = () => !controller.signal.aborted && activeScope.current === scope && request.current === controller;
    setState({ ...current, busy: true, error: null, notice: null });
    try {
      const result = await uploadPackArtworkAsset(deckId, slot, current.file, catalog.deckRevision, asset?.id ?? null, controller.signal, packId === DEFAULT_ARTWORK_PACK_ID ? undefined : packId);
      if (!stillCurrent()) return;
      onSaved(result); clearFile();
      setState({ scope, file: null, busy: false, error: null, notice: `${label} saved in this artwork set.` });
    } catch (cause: unknown) {
      if (!stillCurrent()) return;
      if (cause instanceof ArtworkApiError && cause.status === 409) {
        clearFile();
        setState({ scope, file: null, busy: true, error: `This deck or ${label.toLowerCase()} changed. Loading the latest version…`, notice: null });
        try {
          const latest = await getOwnedArtwork(deckId, controller.signal, packId === DEFAULT_ARTWORK_PACK_ID ? undefined : packId);
          if (!stillCurrent()) return;
          onRefresh(latest);
          setState({ scope, file: null, busy: false, error: `The latest version is loaded. Review the ${label.toLowerCase()}, choose your image again, then upload.`, notice: null });
        } catch (refreshError: unknown) {
          if (stillCurrent()) setState({ scope, file: null, busy: false, error: `Could not refresh artwork. Reload the latest assets before uploading. ${friendlyError(refreshError)}`, notice: null, needsRefresh: true });
        }
      } else setState({ ...current, busy: false, error: friendlyError(cause), notice: null });
    } finally { if (stillCurrent()) request.current = null; }
  }
  async function reloadLatest() {
    if (current.busy || request.current || activeScope.current !== scope) return;
    const controller = new AbortController(); request.current = controller;
    const stillCurrent = () => !controller.signal.aborted && activeScope.current === scope && request.current === controller;
    clearFile(); setState({ ...current, file: null, busy: true, notice: null });
    try {
      const latest = await getOwnedArtwork(deckId, controller.signal, packId === DEFAULT_ARTWORK_PACK_ID ? undefined : packId);
      if (!stillCurrent()) return;
      onRefresh(latest);
      setState({ scope, file: null, busy: false, error: null, notice: "The latest version is loaded. Choose your image again, then upload." });
    } catch (cause: unknown) {
      if (stillCurrent()) setState({ scope, file: null, busy: false, error: friendlyError(cause), notice: null, needsRefresh: true });
    } finally { if (stillCurrent()) request.current = null; }
  }
  return <form id={`artwork-${slot}-form`} className="pack-asset-form" onSubmit={upload} aria-busy={current.busy}>
    <h3>{label}</h3>
    <p className="artwork-hint">{slot === "cover" ? "Shown on the deck’s home page and library tiles for the selected set." : "Stored with this set for future use. Card backs are not shown during readings yet. Use 180° rotational symmetry if reversals should stay hidden."}</p>
    <div className="pack-asset-preview"><PackAssetImage asset={asset} scope={session} alt={`${label} preview`} fallback={<span className="artwork-hint">{asset ? `${label} preview unavailable` : `No ${label.toLowerCase()} yet`}</span>} /></div>
    <label htmlFor={`artwork-${slot}-file`}>{asset ? `Replace ${label.toLowerCase()}` : `Image for ${label.toLowerCase()}`}</label>
    <input ref={input} id={`artwork-${slot}-file`} type="file" accept="image/png,image/jpeg,image/webp" disabled={current.busy || current.needsRefresh || disabled} aria-describedby={`artwork-${slot}-limits`} onChange={(event) => {
      const file = event.target.files?.[0] ?? null;
      const error = file ? validateArtworkFile(file) : null;
      if (error) event.target.value = "";
      setState({ scope, file: error ? null : file, busy: false, error, notice: null });
    }} />
    <p id={`artwork-${slot}-limits`} className="artwork-hint">PNG, JPEG, or WebP · up to 3 MB and 16 megapixels · no SVG or animation. Saved as WebP with the original aspect ratio.</p>
    {current.file && <p className="artwork-hint">Ready: {current.file.name}</p>}
    <div className="artwork-create-actions">
      <button type="submit" disabled={current.busy || current.needsRefresh || disabled || !current.file}>{current.busy ? "Uploading…" : asset ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}</button>
      {current.file && <button type="button" disabled={current.busy} onClick={() => { clearFile(); setState({ scope, file: null, busy: false, error: null, notice: null }); }}>Clear selection</button>}
    </div>
    {current.needsRefresh && <button type="button" disabled={current.busy} onClick={() => void reloadLatest()}>{current.busy ? "Reloading…" : "Reload latest assets"}</button>}
    {current.error && <p className="artwork-error" role="alert">{current.error}</p>}
    {current.notice && <p className="artwork-success" role="status">{current.notice}</p>}
  </form>;
}
function friendlyError(error: unknown): string {
  if (error instanceof ArtworkApiError && (error.status === 401 || error.status === 403 || error.status === 404)) return "This deck or artwork set is unavailable, or you do not have permission to change it.";
  return error instanceof Error ? error.message : "Unable to save artwork. Check your connection and try again.";
}
