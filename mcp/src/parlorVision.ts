import sharp from 'sharp';
import type { CardArtworkService } from './cardArtwork';
import type { ArcanaReading } from '../../app/src/engine/types';
import { optionalVision, supportsVision, visionPlacements, VISION_BYTES, VISION_EDGE, type ArtworkReference, type VisionImage } from '../../app/src/parlor/vision';
import { ParlorFault } from './parlorConfig';

export type ParlorArtwork = Pick<CardArtworkService, 'image'>;
const invalid = (): never => { throw new ParlorFault(400, 'invalid_artwork_reference'); };
/** References only: no URLs, remote fetch instructions, arbitrary bytes, backs or covers. */
export function artworkReferences(value: unknown, reading: ArcanaReading, revealed: number, segment?: number): ArtworkReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) return invalid();
  const allowed = new Set(visionPlacements(reading, revealed, segment).map(p => p.card.slug));
  const seen = new Set<string>();
  return value.map(v => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== 'deckRevision,packId,slug,version') return invalid();
    if (typeof v.slug !== 'string' || !allowed.has(v.slug) || seen.has(v.slug) || typeof v.packId !== 'string' || v.packId.length > 80 || !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(v.packId)
      || typeof v.version !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v.version) || !Number.isSafeInteger(v.deckRevision) || v.deckRevision < 1) return invalid();
    seen.add(v.slug); return { slug: v.slug, packId: v.packId, version: v.version, deckRevision: v.deckRevision };
  });
}
/** Owner-authorized, version-checked private storage read; resized bytes exist only for this request. */
export async function ownerVision(artwork: ParlorArtwork | undefined, owner: string, reading: ArcanaReading, model: string, refs: ArtworkReference[], signal: AbortSignal): Promise<VisionImage[]> {
  if (!artwork || !refs.length || !supportsVision('anthropic', model)) return [];
  return optionalVision(async local => {
    const images = await Promise.all(refs.map(async ref => {
      try {
        local.throwIfAborted();
        const { metadata, bytes } = await artwork.image(owner, reading.deck.id, ref.slug, ref.version, ref.packId);
        local.throwIfAborted();
        if (metadata.id !== ref.version || metadata.deckId !== reading.deck.id || metadata.cardSlug !== ref.slug || metadata.packId !== ref.packId || metadata.deckRevision !== ref.deckRevision || metadata.mediaType !== 'image/webp' || bytes.byteLength !== metadata.byteLength || bytes.byteLength > 2_000_000) return null;
        const reversed = reading.placements.find(p => p.card.slug === ref.slug)!.reversed;
        const source = sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'warning' });
        const info = await source.metadata();
        if (info.width !== metadata.width || info.height !== metadata.height || info.format !== 'webp' || (info.pages ?? 1) !== 1) return null;
        const resized = await source.rotate(reversed ? 180 : 0).resize(VISION_EDGE, VISION_EDGE, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).timeout({ seconds: 5 }).toBuffer();
        local.throwIfAborted();
        if (!resized.length || resized.length > VISION_BYTES) return null;
        return { slug: ref.slug, mediaType: 'image/webp' as const, data: resized.toString('base64') };
      } catch { return null; }
    }));
    local.throwIfAborted();
    return images.filter((i): i is VisionImage => i !== null);
  }, signal, []);
}
