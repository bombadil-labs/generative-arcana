/**
 * Kit assembly + the seeded determinism layer.
 *
 * <TarotCard> builds one kit per mounted card, then `resizeKit` / `tickKit` mutate its geometry,
 * time, and pointer each frame. Sketches receive the same kit object every frame (cheap, no churn).
 */
import type p5 from "p5";
import type { CardData, PointerState, RegisterKey, StationSlug, SketchKit } from "./types";
import { STATION_TOKENS, REGISTER_TOKENS } from "./tokens";
import { buildStationLight } from "./lighting";
import { buildRegister } from "./registers";
import { buildFigures } from "./figures";
import { frac } from "./color";

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function registerKeyFor(data: CardData): RegisterKey {
  const key = data.arcana === "major" ? "major" : data.suit_slug;
  if (!key || !Object.prototype.hasOwnProperty.call(REGISTER_TOKENS, key)) {
    throw new Error(`The Ultima SketchKit does not support suit “${key}”. Use a deck-native renderer.`);
  }
  return key as RegisterKey;
}

export interface BuildKitOpts {
  reducedMotion: boolean;
  signal: (name: string, detail?: unknown) => void;
}

export function buildKit(p: p5, data: CardData, opts: BuildKitOpts): SketchKit {
  const seed = hashStr(data.slug);
  const rng = mulberry32(seed);
  // seed p5's own random/noise too, so any p.random()/p.noise() a card uses is deterministic.
  p.randomSeed(seed);
  p.noiseSeed(seed);

  const register = buildRegister(REGISTER_TOKENS[registerKeyFor(data)]);
  if (!Object.prototype.hasOwnProperty.call(STATION_TOKENS, data.station_slug)) {
    throw new Error(`The Ultima SketchKit does not support station “${data.station_slug}”. Use a deck-native renderer.`);
  }
  const light = buildStationLight(STATION_TOKENS[data.station_slug as StationSlug]);
  const fig = buildFigures(register);

  const pointer: PointerState = { x: 0.5, y: 0.5, inside: false, down: false, pressed: false };

  const kit: SketchKit = {
    p,
    data,
    w: 0, h: 0, cx: 0, cy: 0,
    u: (fraction: number) => fraction * Math.min(kit.w, kit.h),
    safe: { x: 0, y: 0, w: 0, h: 0 },
    t: 0,
    loop: (period: number, offset = 0) => frac(kit.t / period + offset),
    rng,
    reducedMotion: opts.reducedMotion,
    light,
    register,
    fig,
    palette: register.palette,
    pointer,
    signal: opts.signal,
  };
  return kit;
}

export function resizeKit(kit: SketchKit, w: number, h: number) {
  kit.w = w;
  kit.h = h;
  kit.cx = w / 2;
  kit.cy = h / 2;
  // Focal-safe region: clear of the host banner (top title band ~12% and a rank corner).
  const top = h * 0.12;
  const pad = Math.min(w, h) * 0.06;
  kit.safe = { x: pad, y: top + pad * 0.5, w: w - pad * 2, h: h - top - pad * 1.5 };
}

export function tickKit(kit: SketchKit, t: number, pointer: Partial<PointerState>) {
  kit.t = t;
  Object.assign(kit.pointer, pointer);
}
