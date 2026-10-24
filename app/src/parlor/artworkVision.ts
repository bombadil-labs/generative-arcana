import type { ArtworkStore } from '../artwork/store';
import type { ArcanaReading } from '../engine/types';
import { useOwnerAnthropic, type Settings } from './settings';
import { noVision, optionalVision, supportsVision, visionPlacements, VISION_BYTES, VISION_EDGE, type VisionInput, type VisionImage } from './vision';

/** Reuse the exact selected front's in-memory blob. Never fetch a URL supplied by a model or guest. */
export class ArtworkVision {
  private generation = 0;
  private cache = new Map<string, VisionImage>();
  constructor(private store: ArtworkStore | null | undefined) {}
  clear = () => { ++this.generation; this.cache.clear(); };
  async load(settings: Settings, reading: ArcanaReading, revealed: number, signal: AbortSignal, segment?: number): Promise<VisionInput> {
    const store = this.store, generation = this.generation;
    const model = settings.provider === 'anthropic' ? settings.anthropicModel : settings.openaiModel;
    if (!store || store.deckId !== reading.deck.id || settings.hosted || !supportsVision(settings.provider, model)) return noVision();
    return optionalVision(async local => {
      const result = noVision();
      for (const placement of visionPlacements(reading, revealed, segment)) {
        local.throwIfAborted();
        const slug = placement.card.slug;
        await store.load(slug);
        local.throwIfAborted();
        const state = store.get(slug);
        if (state.status !== 'ready' || !state.blob || state.blob.type !== 'image/webp' || state.blob.size !== state.artwork.byteLength || state.blob.size > 2_000_000) continue;
        const art = state.artwork;
        if (art.deckId !== reading.deck.id || art.cardSlug !== slug || art.deckRevision !== store.deckRevision || art.packId !== store.packId) continue;
        const key = `${art.id}:${placement.reversed}`;
        let image = this.cache.get(key);
        try {
          if (!image) {
            const bitmap = await createImageBitmap(state.blob);
            try {
              local.throwIfAborted();
              if (bitmap.width !== art.width || bitmap.height !== art.height || bitmap.width * bitmap.height > 16_000_000) continue;
              // Decode even on the owner path: broken artwork must not be described as visible.
              if (!useOwnerAnthropic(settings)) {
                const scale = Math.min(1, VISION_EDGE / Math.max(bitmap.width, bitmap.height));
                const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                const context = canvas.getContext('2d'); if (!context) continue;
                if (placement.reversed) { context.translate(canvas.width, canvas.height); context.rotate(Math.PI); }
                context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', .75));
                canvas.width = canvas.height = 0;
                if (!blob || blob.type !== 'image/webp' || !blob.size || blob.size > VISION_BYTES) continue;
                const bytes = new Uint8Array(await blob.arrayBuffer());
                let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
                image = { slug, mediaType: 'image/webp', data: btoa(binary) };
              }
            } finally { bitmap.close(); }
          }
        } catch { local.throwIfAborted(); continue; }
        local.throwIfAborted();
        if (generation !== this.generation || store.get(slug) !== state || store.packId !== art.packId) return noVision();
        if (image) { if (this.cache.size >= 3 && !this.cache.has(key)) this.cache.delete(this.cache.keys().next().value!); this.cache.set(key, image); result.images.push(image); }
        result.artwork.push({ slug, packId: art.packId, version: art.id, deckRevision: art.deckRevision });
      }
      return result;
    }, signal, noVision());
  }
}
