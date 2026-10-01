/** Artwork is a separate, access-checked resource. Never trust a returned URL as an image source. */
export interface CardArtwork {
  id: string;
  deckId: string;
  cardSlug: string;
  mediaType: "image/webp";
  width: number;
  height: number;
  byteLength: number;
  integrity: string;
  deckRevision: number;
}
export interface OwnedArtworkCatalog {
  enabled: true;
  deckRevision: number;
  cards: { slug: string; name: string; artwork: CardArtwork | null }[];
}
export const MAX_ARTWORK_INPUT_BYTES = 3_000_000;
const INPUT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_OUTPUT_BYTES = 2_000_000;

export class ArtworkApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "ArtworkApiError"; }
}
export function artworkPath(deckId: string, cardSlug: string): string {
  return `/api/decks/${encodeURIComponent(deckId)}/cards/${encodeURIComponent(cardSlug)}/artwork`;
}
export function validateArtworkFile(file: Pick<File, "type" | "size">): string | null {
  if (!INPUT_TYPES.has(file.type)) return "Choose a PNG, JPEG, or WebP image. SVG and animated images are not supported.";
  if (file.size <= 0) return "This image file is empty.";
  if (file.size > MAX_ARTWORK_INPUT_BYTES) return "Choose an image no larger than 3 MB.";
  return null;
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function positiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function parseArtwork(value: unknown, deckId: string, cardSlug: string): CardArtwork {
  if (!record(value) || value.deckId !== deckId || value.cardSlug !== cardSlug || typeof value.id !== "string" || !value.id || value.id.length > 200 || /[\r\n]/.test(value.id)
    || value.mediaType !== "image/webp" || !positiveInteger(value.width) || !positiveInteger(value.height) || value.width * value.height > 16_000_000
    || !positiveInteger(value.byteLength) || value.byteLength > MAX_OUTPUT_BYTES || !positiveInteger(value.deckRevision) || typeof value.integrity !== "string") {
    throw new Error("The server returned invalid artwork metadata.");
  }
  // Pick known data fields only: URLs, scripts, and renderer content are never accepted here.
  return { id: value.id, deckId, cardSlug, mediaType: "image/webp", width: value.width, height: value.height, byteLength: value.byteLength, integrity: value.integrity, deckRevision: value.deckRevision };
}
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store", redirect: "error" });
  if (!response.ok) {
    let message = response.status === 503 ? "Artwork uploads are not available on this deployment." : `Artwork request failed (${response.status}).`;
    try { const body: unknown = await response.json(); if (record(body) && typeof body.message === "string" && body.message.trim()) message = body.message; } catch { /* preserve transport error */ }
    throw new ArtworkApiError(response.status, message);
  }
  return response;
}
async function json(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await request(path, { ...init, headers: { accept: "application/json", ...init.headers } });
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Artwork is not available on this deployment.");
  return response.json();
}
export async function getCardArtwork(deckId: string, cardSlug: string, signal?: AbortSignal): Promise<CardArtwork> {
  return parseArtwork(await json(artworkPath(deckId, cardSlug), { signal }), deckId, cardSlug);
}
export async function getArtworkImage(metadata: CardArtwork, signal?: AbortSignal): Promise<Blob> {
  const response = await request(`${artworkPath(metadata.deckId, metadata.cardSlug)}/image?version=${encodeURIComponent(metadata.id)}`, { signal, headers: { accept: "image/webp" } });
  if (response.headers.get("content-type")?.split(";")[0].trim() !== "image/webp") throw new Error("Unsupported artwork image response.");
  const blob = await response.blob();
  if (blob.size !== metadata.byteLength || blob.size > MAX_OUTPUT_BYTES) throw new Error("Artwork changed while loading. Reopen the deck to refresh it.");
  return blob;
}
export async function getOwnedArtwork(deckId: string, signal?: AbortSignal): Promise<OwnedArtworkCatalog> {
  const value = await json(`/api/me/decks/${encodeURIComponent(deckId)}/artwork`, { signal });
  return parseCatalog(value, deckId);
}
export async function getReadableArtwork(deckId: string, signal?: AbortSignal): Promise<OwnedArtworkCatalog> {
  return parseCatalog(await json(`/api/decks/${encodeURIComponent(deckId)}/artwork`, { signal }), deckId);
}
function parseCatalog(value: unknown, deckId: string): OwnedArtworkCatalog {
  if (!record(value) || value.enabled !== true || !positiveInteger(value.deckRevision) || !Array.isArray(value.cards)) throw new Error("The server returned an invalid artwork catalog.");
  const seen = new Set<string>();
  const cards = value.cards.map((card: unknown) => {
    if (!record(card) || typeof card.slug !== "string" || !card.slug || typeof card.name !== "string" || seen.has(card.slug)) throw new Error("The server returned an invalid artwork card.");
    seen.add(card.slug);
    return { slug: card.slug, name: card.name, artwork: card.artwork === null ? null : parseArtwork(card.artwork, deckId, card.slug) };
  });
  return { enabled: true, deckRevision: value.deckRevision, cards };
}
export async function uploadCardArtwork(deckId: string, cardSlug: string, file: File, deckRevision: number, artworkVersion: string | null, signal?: AbortSignal): Promise<CardArtwork> {
  const error = validateArtworkFile(file);
  if (error) throw new Error(error);
  if (!positiveInteger(deckRevision)) throw new Error("Refresh this deck before uploading.");
  return parseArtwork(await json(`/api/me/decks/${encodeURIComponent(deckId)}/cards/${encodeURIComponent(cardSlug)}/artwork`, {
    method: "PUT", signal, body: file,
    headers: { "content-type": file.type, "x-arcana-deck-revision": String(deckRevision), "x-arcana-artwork-version": artworkVersion ?? "none" },
  }), deckId, cardSlug);
}
