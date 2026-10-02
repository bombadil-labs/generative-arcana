import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type { VisualPackManifest } from "../../app/src/visuals/manifest";
import { canResolveUserDeck } from "../../app/src/decks/catalog";
import type { UserDeckCatalogRepository } from "./userDeckCatalog";

export const MAX_ARTWORK_INPUT_BYTES = 3_000_000;
export const MAX_NATIVE_ARTWORK_INPUT_BYTES = 5_000_000;
export const MAX_ARTWORK_OUTPUT_BYTES = 2_000_000;
export const MAX_ARTWORK_PIXELS = 16_000_000;
export const MAX_ARTWORK_EDGE = 4096;
export class ArtworkError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
export const artworkMissing = () => new ArtworkError(404, "not_found", "Card artwork is unavailable.");
export const artworkConflict = () => new ArtworkError(409, "artwork_conflict", "This deck or artwork changed. Refresh before uploading again.");
export const DEFAULT_ARTWORK_PACK_ID = "saved-artwork";
export interface ArtworkPack { id: string; label: string; description?: string; createdAt?: string }
export interface ArtworkPackSummary extends ArtworkPack { cardCount: number; complete: boolean }
export const defaultArtworkPack = (): ArtworkPack => ({ id: DEFAULT_ARTWORK_PACK_ID, label: "Saved artwork" });
export function artworkPackId(value = DEFAULT_ARTWORK_PACK_ID): string {
  if (!/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(value) || value.length > 80) throw new ArtworkError(400, "artwork_pack", "Choose a visual set id with lowercase letters, numbers, hyphens, dots or underscores (up to 80 characters).");
  return value;
}
export interface ArtworkRecord {
  id: string; deckId: string; packId: string; cardSlug: string; objectKey: string;
  mediaType: "image/webp"; width: number; height: number; byteLength: number; integrity: string;
  createdAt: string;
}
export interface ArtworkRepository {
  get(deckId: string, cardSlug: string, packId?: string): Promise<ArtworkRecord | null>;
  list(deckId: string, packId?: string): Promise<ArtworkRecord[]>;
  listPacks(deckId: string): Promise<ArtworkPack[]>;
  createPack(ownerId: string, deckId: string, expectedDeckRevision: number, pack: ArtworkPack): Promise<ArtworkPack>;
  /** Must atomically recheck owner, deck revision, card membership and prior asset under a deck lock. */
  attach(ownerId: string, expectedDeckRevision: number, expectedArtworkId: string | null, record: ArtworkRecord): Promise<ArtworkRecord | null>;
}
export interface PrivateArtworkStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}
export interface ArtworkMetadata extends Omit<ArtworkRecord, "objectKey"> {
  deckRevision: number; visualPack: VisualPackManifest; imageUrl: string;
}
export function artworkMetadata(record: ArtworkRecord, deckRevision: number, pack = defaultArtworkPack()): ArtworkMetadata {
  const { objectKey: _privateKey, ...asset } = record;
  return {
    ...asset, deckRevision,
    imageUrl: `/api/decks/${encodeURIComponent(record.deckId)}/cards/${encodeURIComponent(record.cardSlug)}/artwork/image?version=${encodeURIComponent(record.id)}&packId=${encodeURIComponent(record.packId)}`,
    visualPack: {
      schemaVersion: 1, id: record.packId, label: pack.label,
      assets: { image: { kind: "image", path: `${record.id}.webp`, mediaType: record.mediaType, integrity: record.integrity } },
      cards: { [record.cardSlug]: { asset: "image" } },
    },
  };
}

/** Storage is always private. Authority comes from current catalog rows, never an object URL. */
export class CardArtworkService {
  private activeDecodes = 0;
  constructor(private readonly catalog: UserDeckCatalogRepository, private readonly records: ArtworkRepository, private readonly storage: PrivateArtworkStorage, private readonly allowUpload?: (ownerId: string) => Promise<boolean>) {}

  private async deckFor(viewerId: string | null, deckId: string, ownerOnly = false) {
    const deck = await this.catalog.get(deckId);
    if (!deck || (ownerOnly ? deck.ownerId !== viewerId : !canResolveUserDeck(deck, viewerId))) throw artworkMissing();
    return deck;
  }

  private async packFor(deckId: string, id = DEFAULT_ARTWORK_PACK_ID): Promise<ArtworkPack> {
    artworkPackId(id);
    if (id === DEFAULT_ARTWORK_PACK_ID) return defaultArtworkPack();
    const pack = (await this.records.listPacks(deckId)).find(pack => pack.id === id);
    if (!pack) throw artworkMissing();
    return pack;
  }

  async createPack(input: { ownerId: string; deckId: string; packId: string; label: string; description?: string; expectedDeckRevision: number }): Promise<ArtworkPackSummary> {
    const deck = await this.deckFor(input.ownerId, input.deckId, true);
    if (deck.revision !== input.expectedDeckRevision) throw artworkConflict();
    const id = artworkPackId(input.packId);
    const label = input.label.trim(); const description = input.description?.trim();
    if (id === DEFAULT_ARTWORK_PACK_ID || !label || label.length > 80 || (description?.length ?? 0) > 500) throw new ArtworkError(400, "artwork_pack", "Choose a new set id and a name up to 80 characters, with an optional description up to 500 characters.");
    const pack = await this.records.createPack(input.ownerId, input.deckId, input.expectedDeckRevision, { id, label, ...(description ? { description } : {}), createdAt: new Date().toISOString() });
    const cards = (await this.records.list(input.deckId, id)).filter(record => Object.hasOwn(deck.manifest.data.cards, record.cardSlug));
    return { ...pack, cardCount: cards.length, complete: cards.length === Object.keys(deck.manifest.data.cards).length };
  }

  async listPacks(viewerId: string | null, deckId: string): Promise<ArtworkPackSummary[]> {
    const deck = await this.deckFor(viewerId, deckId);
    const packs = await this.records.listPacks(deckId);
    if (!packs.some(pack => pack.id === DEFAULT_ARTWORK_PACK_ID)) packs.unshift(defaultArtworkPack());
    const records = await this.records.list(deckId);
    return packs.map(pack => {
      const count = records.filter(record => record.packId === pack.id && Object.hasOwn(deck.manifest.data.cards, record.cardSlug)).length;
      return { ...pack, cardCount: count, complete: count === Object.keys(deck.manifest.data.cards).length };
    });
  }

  async ownedCards(ownerId: string, deckId: string, packId = DEFAULT_ARTWORK_PACK_ID) {
    const deck = await this.deckFor(ownerId, deckId, true);
    return this.cardList(deck, ownerId, packId);
  }

  async readableCards(viewerId: string | null, deckId: string, packId = DEFAULT_ARTWORK_PACK_ID) {
    const deck = await this.deckFor(viewerId, deckId);
    return this.cardList(deck, viewerId, packId);
  }

  private async cardList(deck: NonNullable<Awaited<ReturnType<UserDeckCatalogRepository["get"]>>>, viewerId: string | null, packId: string) {
    const pack = await this.packFor(deck.id, packId);
    const records = new Map((await this.records.list(deck.id, packId)).map(record => [record.cardSlug, record]));
    const cards = Object.entries(deck.manifest.data.cards).map(([slug, card]) => {
      const record = records.get(slug);
      return { slug, name: card.name, artwork: record ? artworkMetadata(record, deck.revision, pack) : null };
    });
    return { enabled: true as const, deckRevision: deck.revision, packId, packs: await this.listPacks(viewerId, deck.id), cards };
  }

  async metadata(viewerId: string | null, deckId: string, cardSlug: string, packId = DEFAULT_ARTWORK_PACK_ID): Promise<ArtworkMetadata> {
    const deck = await this.deckFor(viewerId, deckId);
    if (!Object.hasOwn(deck.manifest.data.cards, cardSlug)) throw artworkMissing();
    const pack = await this.packFor(deckId, packId);
    const record = await this.records.get(deckId, cardSlug, packId);
    if (!record) throw artworkMissing();
    return artworkMetadata(record, deck.revision, pack);
  }

  async image(viewerId: string | null, deckId: string, cardSlug: string, version?: string, packId = DEFAULT_ARTWORK_PACK_ID) {
    const metadata = await this.metadata(viewerId, deckId, cardSlug, packId);
    if (version && metadata.id !== version) throw artworkMissing();
    const record = await this.records.get(deckId, cardSlug, packId);
    if (!record || record.id !== metadata.id) throw artworkMissing();
    const bytes = await this.storage.get(record.objectKey);
    if (bytes.byteLength !== record.byteLength || bytes.byteLength > MAX_ARTWORK_OUTPUT_BYTES || digest(bytes) !== record.integrity) {
      throw new ArtworkError(503, "artwork_unavailable", "Artwork could not be verified. Try again later.");
    }
    // Recheck current visibility, card membership and the selected set after storage retrieval.
    const current = await this.metadata(viewerId, deckId, cardSlug, packId);
    if (current.id !== metadata.id) throw artworkMissing();
    return { metadata: current, bytes };
  }

  async assertUpload(ownerId: string, deckId: string, cardSlug: string, expectedDeckRevision: number, expectedArtworkId: string | null, packId = DEFAULT_ARTWORK_PACK_ID) {
    const deck = await this.deckFor(ownerId, deckId, true);
    if (!Object.hasOwn(deck.manifest.data.cards, cardSlug)) throw artworkMissing();
    if (deck.revision !== expectedDeckRevision) throw artworkConflict();
    await this.packFor(deckId, packId);
    const current = await this.records.get(deckId, cardSlug, packId);
    if ((current?.id ?? null) !== expectedArtworkId) throw artworkConflict();
  }

  async upload(input: { ownerId: string; deckId: string; cardSlug: string; packId?: string; expectedDeckRevision: number; expectedArtworkId: string | null; mediaType: string } & ({ bytes: Uint8Array; loadBytes?: never } | { bytes?: never; loadBytes: () => Promise<Uint8Array> })): Promise<ArtworkMetadata> {
    const packId = artworkPackId(input.packId);
    await this.assertUpload(input.ownerId, input.deckId, input.cardSlug, input.expectedDeckRevision, input.expectedArtworkId, packId);
    if (this.allowUpload && !await this.allowUpload(input.ownerId)) throw new ArtworkError(429, "artwork_rate_limit", "Too many uploads. Try again in a minute.");
    if (this.activeDecodes >= 2) throw new ArtworkError(429, "artwork_busy", "Artwork processing is busy. Try again shortly.");
    this.activeDecodes++;
    let image: Awaited<ReturnType<typeof normalizeArtwork>>;
    // Only the internal lazy native-file path gets the larger fetch budget. Browser/raw bytes stay at 3 MB.
    try { image = input.loadBytes
      ? await normalizeArtworkWithinLimit(await input.loadBytes(), input.mediaType, MAX_NATIVE_ARTWORK_INPUT_BYTES)
      : await normalizeArtwork(input.bytes, input.mediaType); }
    finally { this.activeDecodes--; }
    const id = randomUUID();
    const record: ArtworkRecord = {
      id, deckId: input.deckId, packId, cardSlug: input.cardSlug,
      objectKey: `card-artwork/${id}.webp`, mediaType: "image/webp", width: image.width, height: image.height,
      byteLength: image.bytes.byteLength, integrity: digest(image.bytes), createdAt: new Date().toISOString(),
    };
    await this.storage.put(record.objectKey, image.bytes);
    let previous: ArtworkRecord | null;
    try { previous = await this.records.attach(input.ownerId, input.expectedDeckRevision, input.expectedArtworkId, record); }
    catch (error) {
      // Only clean up definitely rejected writes. Unknown DB/commit outcomes may have succeeded.
      if (error instanceof ArtworkError && [404, 409].includes(error.status)) await this.storage.delete(record.objectKey).catch(() => undefined);
      throw error;
    }
    if (previous) await this.storage.delete(previous.objectKey).catch(() => undefined);
    return artworkMetadata(record, input.expectedDeckRevision, await this.packFor(input.deckId, packId));
  }
}

export async function normalizeArtwork(bytes: Uint8Array, mediaType: string) {
  return normalizeArtworkWithinLimit(bytes, mediaType, MAX_ARTWORK_INPUT_BYTES);
}
async function normalizeArtworkWithinLimit(bytes: Uint8Array, mediaType: string, maxInputBytes: number) {
  if (!bytes.byteLength || bytes.byteLength > maxInputBytes) throw new ArtworkError(413, "artwork_size", `Choose an image up to ${maxInputBytes / 1_000_000} MB.`);
  const format = ({ "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" } as Record<string, string>)[mediaType];
  if (!format) throw new ArtworkError(415, "artwork_format", "Choose a static PNG, JPEG, or WebP image. SVG and animations are not supported.");
  try {
    assertRasterContainer(bytes, format);
    const image = sharp(bytes, { limitInputPixels: MAX_ARTWORK_PIXELS, failOn: "warning", animated: true });
    const info = await image.metadata();
    if (info.format !== format || !info.width || !info.height || (info.pages ?? 1) !== 1) throw new Error("Invalid format or animated image");
    const result = await image.rotate().resize({ width: MAX_ARTWORK_EDGE, height: MAX_ARTWORK_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85, effort: 4 }).timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
    if (result.data.byteLength > MAX_ARTWORK_OUTPUT_BYTES) throw new ArtworkError(413, "artwork_size", "The processed image is too large. Choose a smaller image.");
    return { bytes: result.data, width: result.info.width, height: result.info.height };
  } catch (error) {
    if (error instanceof ArtworkError) throw error;
    throw new ArtworkError(415, "artwork_format", "The file must be a valid, static PNG, JPEG, or WebP image with at most 16 million pixels.");
  }
}
/** Reject other decoders (especially SVG) before handing attacker bytes to libvips. */
function assertRasterContainer(bytes: Uint8Array, format: string) {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (format === "jpeg") {
    if (data.length < 3 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) throw new Error("Invalid JPEG signature");
    return;
  }
  if (format === "png") {
    if (!data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error("Invalid PNG signature");
    for (let offset = 8; offset + 12 <= data.length;) {
      const length = data.readUInt32BE(offset);
      if (data.toString("ascii", offset + 4, offset + 8) === "acTL") throw new Error("Animated PNG is unsupported");
      if (length > data.length - offset - 12) throw new Error("Truncated PNG chunk");
      offset += length + 12;
    }
    return;
  }
  if (data.length < 12 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP") throw new Error("Invalid WebP signature");
  for (let offset = 12; offset + 8 <= data.length;) {
    const chunk = data.toString("ascii", offset, offset + 4);
    if (chunk === "ANIM" || chunk === "ANMF") throw new Error("Animated WebP is unsupported");
    const length = data.readUInt32LE(offset + 4);
    if (length > data.length - offset - 8) throw new Error("Truncated WebP chunk");
    offset += 8 + length + (length % 2);
  }
}

function digest(bytes: Uint8Array) { return `sha256-${createHash("sha256").update(bytes).digest("base64")}`; }

/** Isolated local/test implementation. Never selected by production configuration. */
export class InMemoryArtworkRepository implements ArtworkRepository {
  private records = new Map<string, ArtworkRecord>();
  private packs = new Map<string, ArtworkPack>();
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly catalog: UserDeckCatalogRepository) {}
  async get(deckId: string, cardSlug: string, packId = DEFAULT_ARTWORK_PACK_ID) { return structuredClone(this.records.get(JSON.stringify([deckId, packId, cardSlug])) ?? null); }
  async list(deckId: string, packId?: string) { return structuredClone([...this.records.values()].filter(record => record.deckId === deckId && (packId === undefined || record.packId === packId))); }
  async listPacks(deckId: string) { return structuredClone([...this.packs.entries()].filter(([key]) => JSON.parse(key)[0] === deckId).map(([, pack]) => pack)); }
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.tail.then(run); this.tail = next.then(() => undefined, () => undefined); return next;
  }
  createPack(ownerId: string, deckId: string, revision: number, pack: ArtworkPack): Promise<ArtworkPack> {
    return this.serial(async () => {
      const deck = await this.catalog.get(deckId);
      if (!deck || deck.ownerId !== ownerId) throw artworkMissing();
      if (deck.revision !== revision) throw artworkConflict();
      const key = JSON.stringify([deckId, pack.id]); const previous = this.packs.get(key);
      if (previous) {
        if (previous.label !== pack.label || previous.description !== pack.description) throw artworkConflict();
        return structuredClone(previous);
      }
      if ((await this.listPacks(deckId)).length >= 32) throw new ArtworkError(400, "artwork_pack_limit", "This deck already has 32 visual sets.");
      this.packs.set(key, structuredClone(pack)); return structuredClone(pack);
    });
  }
  attach(ownerId: string, revision: number, expected: string | null, record: ArtworkRecord): Promise<ArtworkRecord | null> {
    return this.serial(async () => {
      const deck = await this.catalog.get(record.deckId);
      if (!deck || deck.ownerId !== ownerId || !Object.hasOwn(deck.manifest.data.cards, record.cardSlug)) throw artworkMissing();
      if (deck.revision !== revision) throw artworkConflict();
      if (record.packId !== DEFAULT_ARTWORK_PACK_ID && !this.packs.has(JSON.stringify([record.deckId, record.packId]))) throw artworkMissing();
      const key = JSON.stringify([record.deckId, record.packId, record.cardSlug]);
      const previous = this.records.get(key) ?? null;
      if ((previous?.id ?? null) !== expected) throw artworkConflict();
      this.records.set(key, structuredClone(record));
      return structuredClone(previous);
    });
  }
}
export class InMemoryArtworkStorage implements PrivateArtworkStorage {
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array) { if (this.objects.has(key)) throw new Error("Immutable key exists"); this.objects.set(key, new Uint8Array(bytes)); }
  async get(key: string) { const bytes = this.objects.get(key); if (!bytes) throw artworkMissing(); return new Uint8Array(bytes); }
  async delete(key: string) { this.objects.delete(key); }
}
