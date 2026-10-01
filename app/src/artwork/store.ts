import { getReadableArtwork, getArtworkImage, ArtworkApiError, type CardArtwork, type OwnedArtworkCatalog } from "./api";

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
/** One disposable catalog route's artwork. Nothing enters deck JSON or the trusted skin registry. */
export class ArtworkStore {
  private states = new Map<string, ArtworkState>();
  private requests = new Map<string, AbortController>();
  private listeners = new Set<() => void>();
  private catalogPromise: Promise<OwnedArtworkCatalog> | null = null;
  private catalogController: AbortController | null = null;
  private version = 0;
  private generation = 0;
  constructor(readonly deckId: string, readonly deckRevision: number, private transport: ArtworkTransport = browserTransport) {}
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getVersion = (): number => this.version;
  get(slug: string): ArtworkState { return this.states.get(slug) ?? EMPTY_ARTWORK; }
  has(slug: string): boolean { return this.get(slug).status === "ready"; }
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
    for (const slug of new Set([...this.states.keys(), ...this.requests.keys()])) this.evict(slug);
    this.emit();
  }
  fail(slug: string): void { this.evict(slug); this.states.set(slug, { status: "error" }); this.emit(); }
  async load(slug: string, refresh = false): Promise<void> {
    if (!refresh && this.get(slug).status !== "idle") return;
    this.evict(slug);
    if (refresh) { this.catalogController?.abort(); this.catalogPromise = null; }
    const controller = new AbortController();
    const generation = this.generation;
    this.requests.set(slug, controller);
    this.states.set(slug, { status: "loading" }); this.emit();
    const current = () => !controller.signal.aborted && generation === this.generation && this.requests.get(slug) === controller;
    try {
      if (!this.catalogPromise) {
        this.catalogController = new AbortController();
        this.catalogPromise = this.transport.catalog(this.deckId, this.catalogController.signal);
      }
      const catalog = await this.catalogPromise;
      const artwork = catalog.cards.find((card) => card.slug === slug)?.artwork;
      if (!artwork) throw new ArtworkApiError(404, "No artwork.");
      if (!current()) return;
      if (artwork.deckId !== this.deckId || artwork.cardSlug !== slug || artwork.deckRevision !== this.deckRevision) throw new Error("Artwork revision mismatch.");
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
