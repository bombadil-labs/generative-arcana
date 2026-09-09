import type { Spread } from "./spreads";
import type { DeckDataFile } from "./types";

/**
 * Visibility is intentionally orthogonal to ownership.
 *
 * - private: only the owner may resolve the deck.
 * - unlisted: anyone with the stable deck id/link may resolve it, but it is not discoverable.
 * - public: resolvable by anyone and eligible for catalog/discovery surfaces.
 */
export type DeckVisibility = "private" | "unlisted" | "public";

/**
 * Canonical renderer-, host-, auth-, and catalog-independent authored artifact.
 *
 * Every authoring route (manual upload, LLM-assisted creation, future editors/importers) should
 * terminate in this shape before persistence. Resource identity, owner, revision, visibility, and
 * provider/session metadata are catalog concerns and never belong inside the manifest.
 *
 * `data.slug` is authored metadata. It is not the globally stable resource identity assigned when
 * a manifest enters a Generative Arcana catalog.
 */
export interface DeckManifest {
  data: DeckDataFile;
  tagline: string;
  spreads?: Spread[];
}

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
