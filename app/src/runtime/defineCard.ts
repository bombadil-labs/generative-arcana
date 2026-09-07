/** Authoring helper + the per-deck, per-skin slug→content registry the browser resolves cards through.
 *
 * A deck can ship any number of skins — each a named art treatment over the same cards. A skin says
 * nothing about HOW a card draws: renderer choice remains per-card. Registration is explicit in
 * `(deckId, packId)` scope; card definition modules themselves are pure and import-order independent.
 *
 * Registry state lives in `VisualRegistry` instances. The app uses the exported default instance and
 * function facade; other hosts can own isolated registries without sharing process-global state.
 */
import type { CardSketch } from "./types";

/** Identity helper that pins the type so card modules get full inference. */
export function defineCard(sketch: CardSketch): CardSketch {
  return sketch;
}

/**
 * Compatibility authoring alias for existing card modules. This no longer mutates registry state;
 * ownership is established only when a pack explicitly registers the returned definitions.
 * @deprecated Prefer `defineCard` in new card modules.
 */
export function registerCard(sketch: CardSketch): CardSketch {
  return defineCard(sketch);
}

interface KitVisual { kind: "kit"; sketch: CardSketch }
interface P5Visual { kind: "p5"; code: string }
interface ImageVisual { kind: "image"; url: string }
type StoredVisual = KitVisual | P5Visual | ImageVisual;
type VisualKind = StoredVisual["kind"];

/** A skin is a named art treatment. It says nothing about how any card draws — that's per-card. */
export interface VisualPack {
  id: string;
  label: string;
  /** optional one-line note for the skin selector. */
  description?: string;
}

/** The drawable content for a card, tagged by renderer so <CardArt> can draw it. */
export type ResolvedVisual =
  | { packId: string; kind: "kit"; sketch: CardSketch }
  | { packId: string; kind: "p5"; code: string }
  | { packId: string; kind: "image"; url: string };

/**
 * Stateful visual-pack index for one host/runtime.
 *
 * Identity is represented structurally by nested Maps rather than encoded composite string keys.
 * Creating an instance creates an isolated registry, which is useful for tests, server requests, and
 * future MCP hosts; the browser-facing function exports below delegate to one default instance.
 */
export class VisualRegistry {
  private readonly content = new Map<string, Map<string, Map<string, StoredVisual>>>();
  private readonly packs = new Map<string, VisualPack[]>();

  private assertScope(deckId: string, packId: string): void {
    if (!deckId.trim() || !packId.trim()) throw new Error("Visual registrations require non-empty deck and skin ids.");
  }

  private packContent(deckId: string, packId: string): Map<string, StoredVisual> | undefined {
    return this.content.get(deckId)?.get(packId);
  }

  private setPackContent(deckId: string, packId: string, entries: Map<string, StoredVisual>): void {
    if (!entries.size) {
      const byPack = this.content.get(deckId);
      if (!byPack) return;
      byPack.delete(packId);
      if (!byPack.size) this.content.delete(deckId);
      return;
    }
    let byPack = this.content.get(deckId);
    if (!byPack) {
      byPack = new Map();
      this.content.set(deckId, byPack);
    }
    byPack.set(packId, entries);
  }

  /** Replace one renderer-kind slice atomically while preserving other renderer kinds in a mixed skin. */
  private replaceKind(deckId: string, packId: string, kind: VisualKind, entries: Array<[string, StoredVisual]>): void {
    this.assertScope(deckId, packId);
    const current = this.packContent(deckId, packId);
    const next = new Map<string, StoredVisual>();
    if (current) {
      for (const [slug, visual] of current) if (visual.kind !== kind) next.set(slug, visual);
    }

    const seen = new Set<string>();
    for (const [slug, visual] of entries) {
      if (!slug.trim()) throw new Error("Visual registrations require non-empty card slugs.");
      if (seen.has(slug)) throw new Error(`Duplicate ${kind} visual for card: ${slug}.`);
      if (next.has(slug)) throw new Error(`Card ${slug} already has a different renderer in ${deckId}/${packId}.`);
      seen.add(slug);
      next.set(slug, visual);
    }

    this.setPackContent(deckId, packId, next);
  }

  // ── typed kit sketches (rendered by <TarotCard>) ────────────────────────────

  registerKitPack(deckId: string, packId: string, sketches: readonly CardSketch[]): void {
    const entries: Array<[string, StoredVisual]> = sketches.map((sketch) => {
      if (!sketch || typeof sketch.slug !== "string" || typeof sketch.draw !== "function") {
        throw new Error("Kit visual packs may contain only valid CardSketch definitions.");
      }
      return [sketch.slug, { kind: "kit", sketch }];
    });
    this.replaceKind(deckId, packId, "kit", entries);
  }

  // ── raw-p5 packs (instance-mode source strings, rendered by <RawP5Card>) ────

  registerRawPack(deckId: string, packId: string, codes: Record<string, string>): void {
    const entries: Array<[string, StoredVisual]> = Object.entries(codes).map(([slug, code]) => {
      if (typeof code !== "string") throw new Error(`Raw p5 visual for ${slug} must be source text.`);
      return [slug, { kind: "p5", code }];
    });
    this.replaceKind(deckId, packId, "p5", entries);
  }

  // ── image packs (one URL per slug, rendered as <img>) ───────────────────────

  registerImagePack(deckId: string, packId: string, urls: Record<string, string>): void {
    const entries: Array<[string, StoredVisual]> = Object.entries(urls).map(([slug, url]) => {
      if (typeof url !== "string") throw new Error(`Image visual for ${slug} must be a URL string.`);
      return [slug, { kind: "image", url }];
    });
    this.replaceKind(deckId, packId, "image", entries);
  }

  // ── skin metadata (names + ordering; renderer-neutral) ──────────────────────

  /** Register or update pack metadata while preserving its original fallback position. */
  registerPack(deckId: string, pack: VisualPack): void {
    if (!deckId.trim() || !pack.id.trim() || !pack.label.trim()) throw new Error("Visual packs require non-empty deck id, pack id, and label.");
    const list = [...(this.packs.get(deckId) ?? [])];
    const index = list.findIndex((p) => p.id === pack.id);
    const copy = { ...pack };
    if (index >= 0) list[index] = copy;
    else list.push(copy);
    this.packs.set(deckId, list);
  }

  /** Return a defensive snapshot; callers cannot mutate registry ordering or metadata. */
  listPacks(deckId: string): VisualPack[] {
    return (this.packs.get(deckId) ?? []).map((pack) => ({ ...pack }));
  }

  /** Remove all pack metadata and visual content owned by one deck in this registry instance. */
  clearDeck(deckId: string): void {
    this.packs.delete(deckId);
    this.content.delete(deckId);
  }

  // ── resolution ──────────────────────────────────────────────────────────────

  private contentFor(deckId: string, packId: string, slug: string): ResolvedVisual | null {
    const found = this.packContent(deckId, packId)?.get(slug);
    if (!found) return null;
    if (found.kind === "kit") return { packId, kind: "kit", sketch: found.sketch };
    if (found.kind === "p5") return { packId, kind: "p5", code: found.code };
    return { packId, kind: "image", url: found.url };
  }

  /** True if ANY registered skin has art for this card — for illustrated counts/affordances. */
  isIllustrated(deckId: string, slug: string): boolean {
    return this.listPacks(deckId).some((pack) => this.contentFor(deckId, pack.id, slug) !== null);
  }

  /**
   * Resolve a card's visual: prefer `preferPackId`, else fall back, in registration order, to any skin
   * that has the card. Returns null if no registered skin has it.
   */
  resolveVisual(deckId: string, slug: string, preferPackId?: string): ResolvedVisual | null {
    const packs = this.listPacks(deckId);
    const ordered = preferPackId
      ? [...packs.filter((p) => p.id === preferPackId), ...packs.filter((p) => p.id !== preferPackId)]
      : packs;
    for (const pack of ordered) {
      const found = this.contentFor(deckId, pack.id, slug);
      if (found) return found;
    }
    return null;
  }
}

/** Default registry used by the browser app and existing pack side-effect modules. */
export const visualRegistry = new VisualRegistry();

// Compatibility/application facade. New hosts may depend on VisualRegistry directly.
export function registerKitPack(deckId: string, packId: string, sketches: readonly CardSketch[]): void {
  visualRegistry.registerKitPack(deckId, packId, sketches);
}

export function registerRawPack(deckId: string, packId: string, codes: Record<string, string>): void {
  visualRegistry.registerRawPack(deckId, packId, codes);
}

export function registerImagePack(deckId: string, packId: string, urls: Record<string, string>): void {
  visualRegistry.registerImagePack(deckId, packId, urls);
}

export function registerPack(deckId: string, pack: VisualPack): void {
  visualRegistry.registerPack(deckId, pack);
}

export function listPacks(deckId: string): VisualPack[] {
  return visualRegistry.listPacks(deckId);
}

export function isIllustrated(deckId: string, slug: string): boolean {
  return visualRegistry.isIllustrated(deckId, slug);
}

export function resolveVisual(deckId: string, slug: string, preferPackId?: string): ResolvedVisual | null {
  return visualRegistry.resolveVisual(deckId, slug, preferPackId);
}
