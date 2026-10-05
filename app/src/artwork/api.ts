/** Artwork is a separate, access-checked resource. Never trust a returned URL as an image source. */
export const DEFAULT_ARTWORK_PACK_ID = "saved-artwork";
export interface ArtworkPack {
  id: string;
  label: string;
  description?: string;
  cardCount: number;
  complete: boolean;
  hasCover?: boolean;
  hasCardBack?: boolean;
}
export interface CardArtwork {
  id: string;
  deckId: string;
  cardSlug: string;
  packId: string;
  mediaType: "image/webp";
  width: number;
  height: number;
  byteLength: number;
  integrity: string;
  deckRevision: number;
}
export type PackArtworkSlot = "cover" | "cardBack";
export interface PackArtworkAsset extends Omit<CardArtwork, "cardSlug"> { slot: PackArtworkSlot; }
export interface OwnedArtworkCatalog {
  enabled: true;
  deckRevision: number;
  packId: string;
  packs: ArtworkPack[];
  cover?: PackArtworkAsset | null;
  cardBack?: PackArtworkAsset | null;
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
export function packArtworkPath(deckId: string, slot: PackArtworkSlot): string {
  if (slot !== "cover" && slot !== "cardBack") throw new Error("Unknown artwork asset slot.");
  return `/api/decks/${encodeURIComponent(deckId)}/artwork/assets/${slot}`;
}
function packQuery(packId?: string): string { return packId ? `?packId=${encodeURIComponent(packId)}` : ""; }
export function validateArtworkFile(file: Pick<File, "type" | "size">): string | null {
  if (!INPUT_TYPES.has(file.type)) return "Choose a PNG, JPEG, or WebP image. SVG and animated images are not supported.";
  if (file.size <= 0) return "This image file is empty.";
  if (file.size > MAX_ARTWORK_INPUT_BYTES) return "Choose an image no larger than 3 MB.";
  return null;
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function positiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function validPackId(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(value) && value.length <= 80; }
function parseArtwork(value: unknown, deckId: string, cardSlug: string, packId = DEFAULT_ARTWORK_PACK_ID): CardArtwork {
  if (!record(value) || value.deckId !== deckId || value.cardSlug !== cardSlug || (value.packId ?? DEFAULT_ARTWORK_PACK_ID) !== packId || typeof value.id !== "string" || !value.id || value.id.length > 200 || /[\r\n]/.test(value.id)
    || value.mediaType !== "image/webp" || !positiveInteger(value.width) || !positiveInteger(value.height) || value.width * value.height > 16_000_000
    || !positiveInteger(value.byteLength) || value.byteLength > MAX_OUTPUT_BYTES || !positiveInteger(value.deckRevision) || typeof value.integrity !== "string") {
    throw new Error("The server returned invalid artwork metadata.");
  }
  // Pick known data fields only: URLs, scripts, and renderer content are never accepted here.
  return { id: value.id, deckId, cardSlug, packId, mediaType: "image/webp", width: value.width, height: value.height, byteLength: value.byteLength, integrity: value.integrity, deckRevision: value.deckRevision };
}
function parsePackAsset(value: unknown, deckId: string, slot: PackArtworkSlot, packId = DEFAULT_ARTWORK_PACK_ID): PackArtworkAsset {
  if (!record(value) || value.slot !== slot) throw new Error("The server returned invalid artwork asset metadata.");
  const { cardSlug: _cardSlug, ...metadata } = parseArtwork({ ...value, cardSlug: "asset" }, deckId, "asset", packId);
  return { ...metadata, slot };
}
function parsePack(value: unknown): ArtworkPack {
  if (!record(value) || !validPackId(value.id) || typeof value.label !== "string" || !value.label.trim() || value.label.length > 80
    || (value.description !== undefined && (typeof value.description !== "string" || value.description.length > 500))
    || (value.hasCover !== undefined && typeof value.hasCover !== "boolean") || (value.hasCardBack !== undefined && typeof value.hasCardBack !== "boolean")
    || typeof value.cardCount !== "number" || !Number.isSafeInteger(value.cardCount) || value.cardCount < 0 || typeof value.complete !== "boolean") throw new Error("The server returned an invalid artwork set.");
  return { id: value.id, label: value.label, ...(value.description === undefined ? {} : { description: value.description }), cardCount: value.cardCount, complete: value.complete, ...(value.hasCover === undefined ? {} : { hasCover: value.hasCover }), ...(value.hasCardBack === undefined ? {} : { hasCardBack: value.hasCardBack }) };
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
export async function getCardArtwork(deckId: string, cardSlug: string, signal?: AbortSignal, packId?: string): Promise<CardArtwork> {
  return parseArtwork(await json(`${artworkPath(deckId, cardSlug)}${packQuery(packId)}`, { signal }), deckId, cardSlug, packId);
}
export async function getArtworkImage(metadata: CardArtwork, signal?: AbortSignal): Promise<Blob> {
  return fetchArtworkImage(artworkPath(metadata.deckId, metadata.cardSlug), metadata, signal);
}
export async function getPackArtworkAsset(deckId: string, slot: PackArtworkSlot, signal?: AbortSignal, packId?: string): Promise<PackArtworkAsset> {
  return parsePackAsset(await json(`${packArtworkPath(deckId, slot)}${packQuery(packId)}`, { signal }), deckId, slot, packId);
}
export async function getPackArtworkImage(metadata: PackArtworkAsset, signal?: AbortSignal): Promise<Blob> {
  return fetchArtworkImage(packArtworkPath(metadata.deckId, metadata.slot), metadata, signal);
}
async function fetchArtworkImage(path: string, metadata: CardArtwork | PackArtworkAsset, signal?: AbortSignal): Promise<Blob> {
  const response = await request(`${path}/image?version=${encodeURIComponent(metadata.id)}&packId=${encodeURIComponent(metadata.packId ?? DEFAULT_ARTWORK_PACK_ID)}`, { signal, headers: { accept: "image/webp" } });
  if (response.headers.get("content-type")?.split(";")[0].trim() !== "image/webp") throw new Error("Unsupported artwork image response.");
  const blob = await response.blob();
  if (blob.size !== metadata.byteLength || blob.size > MAX_OUTPUT_BYTES) throw new Error("Artwork changed while loading. Reopen the deck to refresh it.");
  return blob;
}
export async function getOwnedArtwork(deckId: string, signal?: AbortSignal, packId?: string): Promise<OwnedArtworkCatalog> {
  return parseCatalog(await json(`/api/me/decks/${encodeURIComponent(deckId)}/artwork${packQuery(packId)}`, { signal }), deckId, packId);
}
export async function getReadableArtwork(deckId: string, signal?: AbortSignal, packId?: string): Promise<OwnedArtworkCatalog> {
  return parseCatalog(await json(`/api/decks/${encodeURIComponent(deckId)}/artwork${packQuery(packId)}`, { signal }), deckId, packId);
}
function parseCatalog(value: unknown, deckId: string, packId = DEFAULT_ARTWORK_PACK_ID): OwnedArtworkCatalog {
  if (!record(value) || value.enabled !== true || !positiveInteger(value.deckRevision) || !Array.isArray(value.cards) || (value.packId ?? DEFAULT_ARTWORK_PACK_ID) !== packId) throw new Error("The server returned an invalid artwork catalog.");
  const seen = new Set<string>();
  const cards = value.cards.map((card: unknown) => {
    if (!record(card) || typeof card.slug !== "string" || !card.slug || typeof card.name !== "string" || seen.has(card.slug)) throw new Error("The server returned an invalid artwork card.");
    seen.add(card.slug);
    return { slug: card.slug, name: card.name, artwork: card.artwork === null ? null : parseArtwork(card.artwork, deckId, card.slug, packId) };
  });
  const cardCount = cards.filter((card) => card.artwork).length;
  const packs = value.packs === undefined && packId === DEFAULT_ARTWORK_PACK_ID
    ? [{ id: DEFAULT_ARTWORK_PACK_ID, label: "Saved artwork", cardCount, complete: cardCount === cards.length }]
    : Array.isArray(value.packs) ? value.packs.map(parsePack) : [];
  if (!packs.some((pack) => pack.id === packId) || !packs.some((pack) => pack.id === DEFAULT_ARTWORK_PACK_ID) || new Set(packs.map((pack) => pack.id)).size !== packs.length) throw new Error("The server returned an invalid artwork set catalog.");
  const cover = value.cover == null ? null : parsePackAsset(value.cover, deckId, "cover", packId);
  const cardBack = value.cardBack == null ? null : parsePackAsset(value.cardBack, deckId, "cardBack", packId);
  if ([cover, cardBack].some((asset) => asset && asset.deckRevision !== value.deckRevision)) throw new Error("The server returned invalid artwork asset revision metadata.");
  return { enabled: true, deckRevision: value.deckRevision, packId, packs, cards, cover, cardBack };
}
export async function uploadCardArtwork(deckId: string, cardSlug: string, file: File, deckRevision: number, artworkVersion: string | null, signal?: AbortSignal, packId?: string): Promise<CardArtwork> {
  const error = validateArtworkFile(file);
  if (error) throw new Error(error);
  if (!positiveInteger(deckRevision)) throw new Error("Refresh this deck before uploading.");
  return parseArtwork(await json(`/api/me/decks/${encodeURIComponent(deckId)}/cards/${encodeURIComponent(cardSlug)}/artwork${packQuery(packId)}`, {
    method: "PUT", signal, body: file,
    headers: { "content-type": file.type, "x-arcana-deck-revision": String(deckRevision), "x-arcana-artwork-version": artworkVersion ?? "none" },
  }), deckId, cardSlug, packId);
}
export async function createArtworkSet(deckId: string, input: { id: string; label: string; description?: string; expectedDeckRevision: number }, signal?: AbortSignal): Promise<ArtworkPack> {
  const id = input.id.trim(), label = input.label.trim(), description = input.description?.trim();
  if (id === DEFAULT_ARTWORK_PACK_ID) throw new Error("Saved artwork already exists. Choose a new set ID.");
  if (!validPackId(id)) throw new Error("Use lowercase letters, numbers, and hyphens, periods, or underscores for the set ID (up to 80 characters).");
  if (!label || label.length > 80) throw new Error("Give your set a name of up to 80 characters.");
  if (description && description.length > 500) throw new Error("Keep the description to 500 characters.");
  if (!positiveInteger(input.expectedDeckRevision)) throw new Error("Refresh this deck before creating a set.");
  const pack = parsePack(await json(`/api/me/decks/${encodeURIComponent(deckId)}/artwork/sets`, {
    method: "POST", signal, headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, label, ...(description ? { description } : {}), expectedDeckRevision: input.expectedDeckRevision }),
  }));
  if (pack.id !== id) throw new Error("The server returned a different artwork set.");
  return pack;
}

export async function uploadPackArtworkAsset(deckId: string, slot: PackArtworkSlot, file: File, deckRevision: number, artworkVersion: string | null, signal?: AbortSignal, packId?: string): Promise<PackArtworkAsset> {
  const error = validateArtworkFile(file);
  if (error) throw new Error(error);
  if (!positiveInteger(deckRevision)) throw new Error("Refresh this deck before uploading.");
  const path = packArtworkPath(deckId, slot).replace("/api/decks/", "/api/me/decks/");
  return parsePackAsset(await json(`${path}${packQuery(packId)}`, {
    method: "PUT", signal, body: file,
    headers: { "content-type": file.type, "x-arcana-deck-revision": String(deckRevision), "x-arcana-artwork-version": artworkVersion ?? "none" },
  }), deckId, slot, packId);
}
