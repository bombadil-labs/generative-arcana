import type p5 from "p5";
import type { CardData } from "../decks/card";
import type { CardRenderSpec } from "../decks/renderSpec";
import type { SpreadPosition } from "../decks/spreads";
import type { PointerState } from "./types";

/** Normalized scene-space rectangle. Coordinates are 0..1 within the shared spread canvas. */
export interface SpreadSceneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One dealt card as seen by a shared spread renderer.
 *
 * `card` is the authored symbolic card; `render` is the fully resolved, deliberately denormalized
 * artist/renderer handoff. `rect` is host layout information, not authored deck data.
 */
export interface SpreadScenePlacement {
  index: number;
  position: SpreadPosition;
  card: CardData;
  render: CardRenderSpec;
  reversed: boolean;
  meaning: string;
  rect: SpreadSceneRect;
}

/** Immutable semantic input for one rendered spread scene. */
export interface SpreadSceneData {
  deckId: string;
  spreadId: string;
  spreadName: string;
  spreadDescription: string;
  question: string;
  /** Stable seed material chosen by the host (normally the reading token). */
  seed: string;
  placements: readonly SpreadScenePlacement[];
}

/**
 * Runtime kit for a single shared spread canvas.
 *
 * This deliberately parallels `SketchKit` without inheriting card-family assumptions. A scene may
 * use the resolved render specs however it wishes: connect motifs across cards, let particles cross
 * placement boundaries, blend station weather, or ignore card rectangles entirely.
 */
export interface SpreadSceneKit {
  p: p5;
  scene: SpreadSceneData;

  w: number;
  h: number;
  cx: number;
  cy: number;
  /** fraction of the scene's short side -> px */
  u: (fraction: number) => number;

  t: number;
  loop: (period: number, offset?: number) => number;
  rng: () => number;
  reducedMotion: boolean;

  pointer: PointerState;
  signal: (name: string, detail?: unknown) => void;
}

/**
 * A shared spread visual program. The browser currently executes these with p5, but the deck/reading
 * ontology never needs to know that. Registration is runtime capability glue, parallel to card skins.
 */
export interface SpreadSketch {
  /** Spread id this scene renders, e.g. `three-card` or `core-sample`. */
  spreadId: string;
  init?: (kit: SpreadSceneKit) => void;
  draw: (kit: SpreadSceneKit) => void;
  onPointer?: (kit: SpreadSceneKit) => void;
  /** Single legible still frame for thumbnails/reduced motion. Defaults to draw() at t=0. */
  poster?: (kit: SpreadSceneKit) => void;
}

/** Identity helper that pins the type for scene modules. */
export function defineSpreadScene(scene: SpreadSketch): SpreadSketch {
  return scene;
}
