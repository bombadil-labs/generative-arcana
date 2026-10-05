import { getReadableArtwork, getArtworkImage, ArtworkApiError, DEFAULT_ARTWORK_PACK_ID, type ArtworkPack, type CardArtwork, type OwnedArtworkCatalog } from "./api";
import { resolveArtworkPack } from "./selection";

export type ArtworkState = { status: "idle" | "loading" | "missing" | "error" } | { status: "ready"; artwork: CardArtwork; url: string };
export const EMPTY_ARTWORK: ArtworkState = Object.freeze({ status: "idle" });
interface ArtworkTransport {
  catalog: typeof getReadableArtwork;
  image: typeof getArtworkImage;
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
}
const browserTransport: ArtworkTransport = {
  catalog: getReadableArtwork, image: getArtworkImage,
  createUrl: (blob) => URL.createObjectURL(blob), revokeUrl: (url) => URL.revokeObjectURL(url),
};
/** One disposable catalog route's selected artwork set. Nothing enters deck JSON or the trusted skin registry. */
export class ArtworkStore {
  private states = new Map<string, ArtworkState>();
  private requests = new Map<string, AbortController>();
  private listeners = new Set<() => void>();
  private catalogPromise: Promise<OwnedArtworkCatalog> | null = null;
  private catalogController: AbortController | null = null;
  private catalog: OwnedArtworkCatalog | null = null;
  private version = 0;
  private generation = 0;
  private selectionResolved = false;
  private preferredPackId: string | undefined;
  packId: string;
  packs: ArtworkPack[] = [{ id: DEFAULT_ARTWORK_PACK_ID, label: "Saved artwork", cardCount: 0, complete: false }];
  catalogStatus: "idle" | "loading" | "ready" | "error" = "idle";
  catalogError: string | null = null;
  constructor(readonly deckId: string, readonly deckRevision: number, private transport: ArtworkTransport = browserTransport, packId?: string) {
    this.preferredPackId = packId;
    this.packId = packId || DEFAULT_ARTWORK_PACK_ID;
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getVersion = (): number => this.version;
  get selectionReady(): boolean { return this.selectionResolved; }
  get(slug: string): ArtworkState { return this.states.get(slug) ?? EMPTY_ARTWORK; }
  has(slug: string): boolean { return this.get(slug).status === "ready"; }
  hasArtwork(slug: string): boolean { return !!this.catalog?.cards.find((card) => card.slug === slug)?.artwork; }
  private emit(): void { ++this.version; this.listeners.forEach((listener) => listener()); }
  private evict(slug: string): void {
    this.requests.get(slug)?.abort(); this.requests.delete(slug);
    const previous = this.states.get(slug);
    if (previous?.status === "ready") this.transport.revokeUrl(previous.url);
    this.states.delete(slug);
  }
  clear(): void {
    ++this.generation;
    this.catalogController?.abort(); this.catalogController = null; this.catalogPromise = null;
    this.catalog = null; this.catalogStatus = "idle"; this.catalogError = null;
    for (const slug of new Set([...this.states.keys(), ...this.requests.keys()])) this.evict(slug);
    this.emit();
  }
  selectPack(packId: string): void {
    if (!packId) return;
    const wasResolved = this.selectionResolved;
    // An explicit in-session selection may be empty so its owner can upload into it.
    this.preferredPackId = packId;
    this.selectionResolved = true;
    if (packId === this.packId && wasResolved) return;
    // Synchronous eviction means a render can never use the preceding set's decoded image.
    this.packId = packId;
    this.clear();
  }
  addPack(pack: ArtworkPack): void {
    this.packs = [...this.packs.filter((item) => item.id !== pack.id), pack];
    this.emit();
  }
  fail(slug: string): void { this.evict(slug); this.states.set(slug, { status: "error" }); this.emit(); }
  loadCatalog(refresh = false): Promise<OwnedArtworkCatalog> {
    if (refresh) { this.catalogController?.abort(); this.catalogPromise = null; this.catalog = null; }
    if (!this.catalogPromise) {
      const controller = new AbortController(); this.catalogController = controller;
      const generation = this.generation, packId = this.packId;
      const current = () => !controller.signal.aborted && this.catalogController === controller && this.generation === generation && this.packId === packId;
      this.catalogStatus = "loading"; this.catalogError = null;
      const read = async (id: string) => {
        const catalog = await this.transport.catalog(this.deckId, controller.signal, id === DEFAULT_ARTWORK_PACK_ID ? undefined : id);
        if ((catalog.packId ?? DEFAULT_ARTWORK_PACK_ID) !== id || catalog.deckRevision !== this.deckRevision) throw new Error("Artwork set or revision mismatch. Reopen the deck to refresh it.");
        return catalog;
      };
      this.catalogPromise = (async () => {
        let catalog: OwnedArtworkCatalog;
        try { catalog = await read(packId || DEFAULT_ARTWORK_PACK_ID); }
        catch (error) {
          const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
          // A removed/malformed remembered set must not trap the deck on a missing selection.
          // The fallback catalog still performs the same deck access check.
          if (!current() || this.selectionResolved || !packId || packId === DEFAULT_ARTWORK_PACK_ID || (status !== 404 && status !== 400)) throw error;
          catalog = await read(DEFAULT_ARTWORK_PACK_ID);
        }
        const packs = catalog.packs ?? [{ id: DEFAULT_ARTWORK_PACK_ID, label: "Saved artwork", cardCount: catalog.cards.filter((card) => card.artwork).length, complete: catalog.cards.every((card) => !!card.artwork) }];
        const selected = this.selectionResolved ? packId : resolveArtworkPack(packs, this.preferredPackId);
        if (current() && selected && selected !== (catalog.packId ?? DEFAULT_ARTWORK_PACK_ID)) catalog = await read(selected);
        if (!selected) catalog = { ...catalog, packId: "", cards: catalog.cards.map((card) => ({ ...card, artwork: null })) };
        if (current()) {
          this.packId = selected;
          this.selectionResolved = true;
          this.catalog = catalog;
          this.packs = catalog.packs ?? packs;
          this.catalogStatus = "ready"; this.emit();
        }
        return catalog;
      })().catch((error: unknown) => {
        if (current()) { this.catalogStatus = "error"; this.catalogError = error instanceof Error ? error.message : "Unable to load this artwork set."; this.emit(); }
        throw error;
      });
      this.emit();
    }
    return this.catalogPromise;
  }
  async load(slug: string, refresh = false): Promise<void> {
    if (!refresh && this.get(slug).status !== "idle") return;
    this.evict(slug);
    const controller = new AbortController();
    const generation = this.generation;
    let packId: string | undefined;
    this.requests.set(slug, controller);
    this.states.set(slug, { status: "loading" }); this.emit();
    const current = () => !controller.signal.aborted && generation === this.generation && (packId === undefined || this.packId === packId) && this.requests.get(slug) === controller;
    try {
      const catalog = await this.loadCatalog(refresh);
      if (!current()) return;
      packId = this.packId;
      const artwork = catalog.cards.find((card) => card.slug === slug)?.artwork;
      if (!artwork) throw new ArtworkApiError(404, "No artwork in this set.");
      if (artwork.deckId !== this.deckId || artwork.cardSlug !== slug || artwork.deckRevision !== this.deckRevision || (artwork.packId ?? DEFAULT_ARTWORK_PACK_ID) !== packId) throw new Error("Artwork identity or revision mismatch.");
      const blob = await this.transport.image(artwork, controller.signal);
      if (!current()) return;
      const url = this.transport.createUrl(blob);
      this.states.set(slug, { status: "ready", artwork, url });
    } catch (error) {
      if (!current()) return;
      const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
      this.states.set(slug, { status: status === 404 || status === 503 ? "missing" : "error" });
    } finally {
      if (current()) { this.requests.delete(slug); this.emit(); }
    }
  }
}
