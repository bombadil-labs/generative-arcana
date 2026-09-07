/**
 * The standardized card-sketch interface boundary.
 *
 * A card visual is NOT a React component. It is a small, framework-agnostic data module
 * (`CardSketch`) that draws into a p5 instance it is handed. The React layer (`<TarotCard>`)
 * owns the p5 lifecycle; the host app (`<CardFrame>`/deck browser) owns the banner chrome.
 *
 * This separation is the whole point: 78 card sketches depend only on `SketchKit`, never on
 * React or the DOM, so they are trivially testable, swappable, and portable.
 */
import type p5 from "p5";

export type StationSlug =
  | "honesty" | "compassion" | "valor" | "justice"
  | "sacrifice" | "honor" | "spirituality" | "humility";

export type SuitSlug = "crowns" | "blades" | "runes" | "moongates";
/** The register key: a suit, or "major" for the Major Arcana superset register. */
export type RegisterKey = SuitSlug | "major";

// Compatibility export for existing sketches; the data contract no longer depends on p5.
import type { CardData } from "../decks/card";
export type { CardData } from "../decks/card";

export interface Palette {
  /** Base ground / paper of the suit. */
  ground: string;
  /** Primary ink for line and fill. */
  ink: string;
  /** Suit accent (royal gold, blood-red, gold-ink, phosphor-red). */
  accent: string;
  /** A secondary, cooler accent for depth. */
  shade: string;
  /** A light value for highlights / glow cores. */
  light: string;
}

/** RGB triplet, 0–255. */
export type RGB = [number, number, number];

/**
 * A station lighting kernel — the sublimated transversal. It is LIGHT, not an object.
 * Built once per card from the station token; rebuilt cheaply per frame is unnecessary.
 */
export interface StationLight {
  station: StationSlug;
  /** Lay down the station's animated ground wash. Call first, before the scene. */
  wash(kit: SketchKit): void;
  /** Apply the station's framing vignette/atmosphere. Call last, over the scene. */
  vignette(kit: SketchKit): void;
  /** The station's current light color (temperature), for compositing glows/fills. */
  tint(t: number): RGB;
  /**
   * The station's heartbeat: a 0..1 signal carrying its motion signature
   * (ember breath, sourceless drift, charged tension, even stillness ~ constant).
   * Ride the scene's own animation on this so motion reads as the virtue.
   */
  pulse(t: number): number;
  /** Dominant light direction as a unit-ish vector, for any card that wants cast direction. */
  dir(): { x: number; y: number };
}

/** The suit rendering register — declared line & surface. */
export interface SuitRegister {
  key: RegisterKey;
  palette: Palette;
  /** Configure p5 stroke in the suit idiom (weight scaled to card size). */
  stroke(kit: SketchKit, weightU?: number, color?: string): void;
  /** Configure p5 fill in the suit idiom. */
  fill(kit: SketchKit, color?: string): void;
  /** Draw a closed path in the suit's idiom (e.g. woodcut double-bite, gilded double-line). */
  outline(kit: SketchKit, pts: Array<[number, number]>, close?: boolean): void;
  /** A soft glow/bloom appropriate to the register (strong for Moongates/Runes, faint for Blades). */
  glow(kit: SketchKit, x: number, y: number, radiusU: number, color?: string, strength?: number): void;
  /** Suit-idiom surface shading at a point/region (hatching for Blades, gold-stipple for Crowns, flat for Runes). */
  shade(kit: SketchKit, x: number, y: number, wU: number, hU: number, density?: number): void;
}

/** Reusable vector forms, drawn IN the current register. The shared "assets" that prevent drift. */
export interface Figures {
  /** A celestial disc with subtle maria; phase 0..1 controls illuminated fraction. */
  moon(kit: SketchKit, x: number, y: number, rU: number, phase?: number, color?: string): void;
  /** A rounded moongate arch with inner glow; `open` 0..1 controls the shimmer intensity. */
  moongateArch(kit: SketchKit, x: number, yBase: number, wU: number, hU: number, open?: number): void;
  /** A gestural standing figure (silhouette + posture). `lean` -1..1 tilts the stance. */
  figure(kit: SketchKit, x: number, yFeet: number, hU: number, lean?: number, color?: string): void;
  /** A heraldic crown. */
  crown(kit: SketchKit, x: number, y: number, wU: number, color?: string): void;
  /** An upright (or laid, via `angle`) sword. */
  sword(kit: SketchKit, x: number, y: number, lenU: number, angle?: number, color?: string): void;
  /** A Britannian rune-stave glyph; `complete` 0..1 grows the strokes in. */
  rune(kit: SketchKit, x: number, y: number, sU: number, complete?: number, color?: string): void;
  /** The ankh (major-arcana motif). */
  ankh(kit: SketchKit, x: number, y: number, hU: number, color?: string): void;
  /** A simple keep/tower mass (battlemented block). */
  tower(kit: SketchKit, x: number, yBase: number, wU: number, hU: number, color?: string): void;
  /** A still-water reflection of a draw callback, mirrored below `yWater` with shimmer. */
  reflect(kit: SketchKit, yWater: number, drawAbove: () => void): void;
}

/** Normalized pointer state (coordinates are 0..1 within the card; y down). */
export interface PointerState {
  x: number;
  y: number;
  inside: boolean;
  down: boolean;
  /** True only on the frame a press began (for discrete clicks/easter eggs). */
  pressed: boolean;
}

/**
 * Everything a sketch receives, rebuilt/refreshed each frame by <TarotCard>.
 * Geometry helpers (`u`, `cx`, `cy`, `safe`) and `light/register/fig/palette` are pre-bound to this card.
 */
export interface SketchKit {
  p: p5;
  data: CardData;

  // --- geometry (CSS px) ---
  w: number;
  h: number;
  cx: number;
  cy: number;
  /** fraction of the card's short side -> px. Use for ALL sizes so cards scale. */
  u: (fraction: number) => number;
  /** focal-safe rect, clear of the host banner (top title band + rank corner). */
  safe: { x: number; y: number; w: number; h: number };

  // --- time & determinism ---
  /** seconds since mount (monotonic, wall-clock based; pauses with the card). */
  t: number;
  /** a looping phase 0..1 over `period` seconds (seam-free). */
  loop: (period: number, offset?: number) => number;
  /** seeded RNG 0..1 (seeded from slug; deterministic). */
  rng: () => number;
  reducedMotion: boolean;

  // --- the shared library, pre-bound to this card ---
  light: StationLight;
  register: SuitRegister;
  fig: Figures;
  palette: Palette;

  // --- interaction & host channel ---
  pointer: PointerState;
  /** emit a named event to the host (deck browser). */
  signal: (name: string, detail?: unknown) => void;
}

/** The card visual contract. The only thing a card author implements. */
export interface CardSketch {
  slug: string;
  /** one-time allocation (particle pools, precomputed layouts). Optional. */
  init?: (kit: SketchKit) => void;
  /** per-frame render. Required. */
  draw: (kit: SketchKit) => void;
  /** called before draw when the pointer moves/presses. Optional interactivity hook. */
  onPointer?: (kit: SketchKit) => void;
  /** the single legible still frame for thumbnails / reduced-motion. Defaults to draw() at t=0. */
  poster?: (kit: SketchKit) => void;
}
