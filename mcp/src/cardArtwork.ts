import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type { VisualPackManifest } from "../../app/src/visuals/manifest";
import { canResolveUserDeck } from "../../app/src/decks/catalog";
import type { UserDeckCatalogRepository } from "./userDeckCatalog";

export const MAX_ARTWORK_INPUT_BYTES = 3_000_000;
export const MAX_ARTWORK_OUTPUT_BYTES = 2_000_000;
export const MAX_ARTWORK_PIXELS = 16_000_000;
export const MAX_ARTWORK_EDGE = 4096;
export class ArtworkError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
export const artworkMissing = () => new ArtworkError(404, "not_found", "Card artwork is unavailable.");
export const artworkConflict = () => new ArtworkError(409, "artwork_conflict", "This deck or artwork changed. Refresh before uploading again.");
export interface ArtworkRecord {
  id: string; deckId: string; cardSlug: string; objectKey: string;
  mediaType: "image/webp"; width: number; height: number; byteLength: number; integrity: string;
  createdAt: string;
}
export interface ArtworkRepository {
  get(deckId: string, cardSlug: string): Promise<ArtworkRecord | null>;
  list(deckId: string): Promise<ArtworkRecord[]>;
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
export function artworkMetadata(record: ArtworkRecord, deckRevision: number): ArtworkMetadata {
  const { objectKey: _privateKey, ...asset } = record;
  return {
    ...asset, deckRevision,
    imageUrl: `/api/decks/${encodeURIComponent(record.deckId)}/cards/${encodeURIComponent(record.cardSlug)}/artwork/image?version=${encodeURIComponent(record.id)}`,
    visualPack: {
      schemaVersion: 1, id: `artwork-${record.id}`, label: "Card artwork",
      assets: { image: { kind: "image", path: `${record.id}.webp`, mediaType: record.mediaType, integrity: record.integrity } },
      cards: { [record.cardSlug]: { asset: "image" } },
    },
  };
}

/** Storage is always private. Authority comes from current catalog rows, never an object URL. */
export class CardArtworkService {
  private activeDecodes = 0;
  constructor(private readonly catalog: UserDeckCatalogRepository, private readonly records: ArtworkRepository, private readonly storage: PrivateArtworkStorage, private readonly allowUpload?: (ownerId: string) => Promise<boolean>) {}

  async ownedCards(ownerId: string, deckId: string) {
    const deck = await this.catalog.get(deckId);
    if (!deck || deck.ownerId !== ownerId) throw artworkMissing();
    return this.cardList(deck);
  }

  async readableCards(viewerId: string | null, deckId: string) {
    const deck = await this.catalog.get(deckId);
    if (!deck || !canResolveUserDeck(deck, viewerId)) throw artworkMissing();
    return this.cardList(deck);
  }

  private async cardList(deck: NonNullable<Awaited<ReturnType<UserDeckCatalogRepository["get"]>>>) {
    const records = new Map((await this.records.list(deck.id)).map(record => [record.cardSlug, record]));
    const cards = Object.entries(deck.manifest.data.cards).map(([slug, card]) => {
      const record = records.get(slug);
      return { slug, name: card.name, artwork: record ? artworkMetadata(record, deck.revision) : null };
    });
    return { enabled: true as const, deckRevision: deck.revision, cards };
  }

  async metadata(viewerId: string | null, deckId: string, cardSlug: string): Promise<ArtworkMetadata> {
    const deck = await this.catalog.get(deckId);
    if (!deck || !canResolveUserDeck(deck, viewerId) || !Object.hasOwn(deck.manifest.data.cards, cardSlug)) throw artworkMissing();
    const record = await this.records.get(deckId, cardSlug);
    if (!record) throw artworkMissing();
    return artworkMetadata(record, deck.revision);
  }

  async image(viewerId: string | null, deckId: string, cardSlug: string, version?: string) {
    const metadata = await this.metadata(viewerId, deckId, cardSlug);
    if (version && metadata.id !== version) throw artworkMissing();
    const record = await this.records.get(deckId, cardSlug);
    if (!record || record.id !== metadata.id) throw artworkMissing();
    const bytes = await this.storage.get(record.objectKey);
    if (bytes.byteLength !== record.byteLength || bytes.byteLength > MAX_ARTWORK_OUTPUT_BYTES || digest(bytes) !== record.integrity) {
      throw new ArtworkError(503, "artwork_unavailable", "Artwork could not be verified. Try again later.");
    }
    // Do not finish a read authorized before a concurrent revocation/deletion/replacement.
    const current = await this.metadata(viewerId, deckId, cardSlug);
    if (current.id !== metadata.id) throw artworkMissing();
    return { metadata: current, bytes };
  }

  async assertUpload(ownerId: string, deckId: string, cardSlug: string, expectedDeckRevision: number, expectedArtworkId: string | null) {
    const deck = await this.catalog.get(deckId);
    if (!deck || deck.ownerId !== ownerId || !Object.hasOwn(deck.manifest.data.cards, cardSlug)) throw artworkMissing();
    if (deck.revision !== expectedDeckRevision) throw artworkConflict();
    const current = await this.records.get(deckId, cardSlug);
    if ((current?.id ?? null) !== expectedArtworkId) throw artworkConflict();
  }

  async upload(input: { ownerId: string; deckId: string; cardSlug: string; expectedDeckRevision: number; expectedArtworkId: string | null; mediaType: string; bytes: Uint8Array }): Promise<ArtworkMetadata> {
    await this.assertUpload(input.ownerId, input.deckId, input.cardSlug, input.expectedDeckRevision, input.expectedArtworkId);
    if (this.allowUpload && !await this.allowUpload(input.ownerId)) throw new ArtworkError(429, "artwork_rate_limit", "Too many uploads. Try again in a minute.");
    if (this.activeDecodes >= 2) throw new ArtworkError(429, "artwork_busy", "Artwork processing is busy. Try again shortly.");
    this.activeDecodes++;
    let image: Awaited<ReturnType<typeof normalizeArtwork>>;
    try { image = await normalizeArtwork(input.bytes, input.mediaType); }
    finally { this.activeDecodes--; }
    const id = randomUUID();
    const record: ArtworkRecord = {
      id, deckId: input.deckId, cardSlug: input.cardSlug,
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
    return artworkMetadata(record, input.expectedDeckRevision);
  }
}

export async function normalizeArtwork(bytes: Uint8Array, mediaType: string) {
  if (!bytes.byteLength || bytes.byteLength > MAX_ARTWORK_INPUT_BYTES) throw new ArtworkError(413, "artwork_size", "Choose an image up to 3 MB.");
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
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly catalog: UserDeckCatalogRepository) {}
  async get(deckId: string, cardSlug: string) { return structuredClone(this.records.get(JSON.stringify([deckId, cardSlug])) ?? null); }
  async list(deckId: string) { return structuredClone([...this.records.values()].filter(record => record.deckId === deckId)); }
  attach(ownerId: string, revision: number, expected: string | null, record: ArtworkRecord): Promise<ArtworkRecord | null> {
    const next = this.tail.then(async () => {
      const deck = await this.catalog.get(record.deckId);
      if (!deck || deck.ownerId !== ownerId || !Object.hasOwn(deck.manifest.data.cards, record.cardSlug)) throw artworkMissing();
      if (deck.revision !== revision) throw artworkConflict();
      const key = JSON.stringify([record.deckId, record.cardSlug]);
      const previous = this.records.get(key) ?? null;
      if ((previous?.id ?? null) !== expected) throw artworkConflict();
      this.records.set(key, structuredClone(record));
      return structuredClone(previous);
    });
    this.tail = next.then(() => undefined, () => undefined);
    return next;
  }
}
export class InMemoryArtworkStorage implements PrivateArtworkStorage {
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array) { if (this.objects.has(key)) throw new Error("Immutable key exists"); this.objects.set(key, new Uint8Array(bytes)); }
  async get(key: string) { const bytes = this.objects.get(key); if (!bytes) throw artworkMissing(); return new Uint8Array(bytes); }
  async delete(key: string) { this.objects.delete(key); }
}
