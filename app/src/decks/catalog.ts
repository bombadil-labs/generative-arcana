import type { DeckManifest } from "./manifest";

/**
 * Visibility is intentionally orthogonal to ownership.
 *
 * - private: only the owner may resolve the deck.
 * - unlisted: anyone with the stable deck id/link may resolve it, but it is not discoverable.
 * - public: resolvable by anyone and eligible for catalog/discovery surfaces.
 */
export type DeckVisibility = "private" | "unlisted" | "public";

/** Compatibility name retained while older catalog/MCP code migrates to the canonical term. */
export type UserDeckManifest = DeckManifest;

/**
 * Durable identity for a user-authored deck.
 *
 * `id` is an opaque, globally stable resource identity and must not be derived from the mutable deck
 * name or slug. `slug` is presentation/routing metadata and may change independently.
 */
export interface UserDeckRecord {
  id: string;
  ownerId: string;
  slug: string;
  manifest: DeckManifest;
  visibility: DeckVisibility;
  revision: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export function canResolveUserDeck(deck: UserDeckRecord, viewerId: string | null): boolean {
  if (viewerId === deck.ownerId) return true;
  return deck.visibility === "unlisted" || deck.visibility === "public";
}

export function isDiscoverableUserDeck(deck: UserDeckRecord): boolean {
  return deck.visibility === "public";
}
