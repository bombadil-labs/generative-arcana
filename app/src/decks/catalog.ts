import type { DeckManifest, DeckManifestInput } from "./manifest";

/**
 * Visibility is intentionally orthogonal to ownership.
 *
 * - private: only the owner may resolve the deck.
 * - unlisted: anyone with the stable deck id/link may resolve it, but it is not discoverable.
 * - public: resolvable by anyone and eligible for catalog/discovery surfaces.
 */
export type DeckVisibility = "private" | "unlisted" | "public";

/** Compatibility input name retained while older catalog/MCP code migrates to the canonical term. */
export type UserDeckManifest = DeckManifestInput;

/**
 * Durable identity for a user-authored deck.
 *
 * Persisted records always expose the current normalized `DeckManifest`, even when imported from a
 * historical envelope. Storage format is a repository concern and need not mirror this public shape.
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
