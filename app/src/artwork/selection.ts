import { DEFAULT_ARTWORK_PACK_ID, type ArtworkPack } from "./api";

export function hasArtworkContent(pack: { cardCount: number; hasCover?: boolean; hasCardBack?: boolean }): boolean {
  return pack.cardCount > 0 || pack.hasCover === true || pack.hasCardBack === true;
}

/** Empty metadata is an upload destination, not a competing visual treatment. */
export function resolveArtworkPack(packs: readonly ArtworkPack[], preferred?: string): string {
  const populated = packs.filter(hasArtworkContent);
  if (populated.some((pack) => pack.id === preferred)) return preferred!;
  if (populated.length === 1) return populated[0].id;
  if (populated.length > 1) return ""; // The viewer must choose; never guess or mix sets.
  return packs.some((pack) => pack.id === preferred) ? preferred! : DEFAULT_ARTWORK_PACK_ID;
}

/** Reading/browsing show usable treatments; the editor still exposes every upload destination. */
export function visibleArtworkPacks(packs: readonly ArtworkPack[], selected: string): ArtworkPack[] {
  const populated = packs.filter(hasArtworkContent);
  return populated.length ? packs.filter((pack) => hasArtworkContent(pack) || pack.id === selected) : [...packs];
}
