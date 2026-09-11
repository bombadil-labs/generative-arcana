import { registerSpreadKitPack } from "@/runtime/defineCard";
import { defineSpreadScene, type SpreadSceneKit, type SpreadScenePlacement } from "@/runtime/spreadScene";

type RGB = readonly [number, number, number];

const FAMILY: Record<string, RGB> = {
  vents: [198, 78, 34],
  strata: [159, 111, 67],
  grains: [194, 169, 112],
  faults: [76, 91, 98],
  major: [205, 168, 91],
};

const STATION: Record<string, RGB> = {
  melt: [174, 54, 24],
  crystallization: [124, 168, 195],
  uplift: [203, 184, 135],
  weathering: [153, 140, 111],
  transport: [108, 144, 159],
  deposition: [192, 146, 88],
  burial: [69, 58, 50],
  metamorphism: [130, 72, 60],
};

const coreSample = defineSpreadScene({
  spreadId: "core-sample",
  draw: drawCoreSample,

  onPointer(kit) {
    if (!kit.pointer.pressed) return;
    const index = placementAtY(kit.pointer.y, kit.scene.placements.length);
    const placement = kit.scene.placements[index];
    if (placement) kit.signal("inspect-placement", { index, cardSlug: placement.card.slug });
  },

  poster(kit) {
    // draw() is already deterministic at t=0 and remains legible without motion.
    drawCoreSample({ ...kit, t: 0, reducedMotion: true });
  },
});

registerSpreadKitPack("deep-time", "core-sample", [coreSample]);

function drawCoreSample(kit: SpreadSceneKit) {
  const { p, scene, w, h, t, pointer, reducedMotion } = kit;
  const n = scene.placements.length;
  if (!n) return;
  const bandH = h / n;
  const hover = pointer.inside ? placementAtY(pointer.y, n) : -1;

  p.background(13, 12, 11);
  p.noStroke();

  // The spread's five positions are literally one shared stratigraphic column.
  // Position 0 (Basement) belongs at the bottom; Weather belongs at the top.
  for (const placement of scene.placements) {
    const y = bandY(placement.index, n, h);
    const family = familyOf(placement);
    const base = FAMILY[family] ?? FAMILY.major;
    const station: RGB = STATION[placement.render.context.station.slug] ?? [128, 128, 128];
    const mixed = mix(base, station, 0.24);
    const hoverLift = hover === placement.index ? 24 : 0;

    p.fill(
      Math.min(255, mixed[0] + hoverLift),
      Math.min(255, mixed[1] + hoverLift),
      Math.min(255, mixed[2] + hoverLift),
    );
    p.rect(0, y, w, bandH + 1);

    drawBandTexture(p, placement, y, bandH, w, t, reducedMotion);

    if (placement.reversed) {
      p.noFill();
      p.stroke(20, 18, 17, 88);
      p.strokeWeight(1);
      const spacing = Math.max(9, Math.min(w, h) * 0.02);
      for (let x = -bandH; x < w + bandH; x += spacing) {
        p.line(x, y + bandH, x + bandH, y);
      }
    }

    if (hover === placement.index) {
      p.noFill();
      p.stroke(248, 238, 209, 210);
      p.strokeWeight(Math.max(1, Math.min(w, h) * 0.003));
      p.rect(2, y + 2, w - 4, bandH - 4);
    }
  }

  // Cross-card phenomena are drawn AFTER the layers, on one canvas, so they can
  // physically traverse placement boundaries. This is the point of a Living Spread.
  for (const placement of scene.placements) {
    const family = familyOf(placement);
    if (family === "faults") drawFault(p, placement, n, w, h, t, reducedMotion);
    if (family === "vents") drawPlume(p, placement, n, w, h, t, reducedMotion);
    if (family === "grains") drawGrains(p, placement, n, w, h, t, reducedMotion);
    if (placement.card.arcana === "major") drawMajorEvent(p, placement, n, w, h, t, reducedMotion);
  }

  drawColumnLabels(p, scene.placements, n, w, h, hover);
}

function familyOf(placement: SpreadScenePlacement): string {
  return placement.render.context.family.kind === "major"
    ? "major"
    : placement.render.context.family.slug ?? "major";
}

function bandY(index: number, count: number, h: number): number {
  return (count - 1 - index) * (h / count);
}

function placementAtY(y01: number, count: number): number {
  const topBand = Math.max(0, Math.min(count - 1, Math.floor(y01 * count)));
  return count - 1 - topBand;
}

function drawBandTexture(
  p: import("p5").default,
  placement: SpreadScenePlacement,
  y: number,
  bandH: number,
  w: number,
  t: number,
  reducedMotion: boolean,
) {
  const family = familyOf(placement);
  const seed = hash(placement.card.slug);
  const motion = reducedMotion ? 0 : t;

  if (family === "strata") {
    p.stroke(246, 226, 190, 90);
    p.strokeWeight(1);
    for (let i = 1; i <= 5; i++) {
      p.beginShape();
      for (let x = 0; x <= w; x += Math.max(12, w / 28)) {
        const yy = y + (bandH * i) / 6 + Math.sin(x * 0.025 + seed * 0.001 + motion * 0.12) * bandH * 0.025;
        p.vertex(x, yy);
      }
      p.endShape();
    }
  } else if (family === "faults") {
    p.stroke(226, 234, 232, 80);
    p.strokeWeight(1);
    for (let i = 0; i < 7; i++) {
      const x = ((seed * (i + 3)) % 997) / 997 * w;
      p.line(x, y + bandH * 0.1, x + bandH * 0.22, y + bandH * 0.9);
    }
  } else if (family === "vents") {
    p.noStroke();
    for (let i = 0; i < 18; i++) {
      const u = frac(Math.sin(seed * 0.00017 + i * 91.17) * 43758.5453);
      const v = frac(Math.sin(seed * 0.00031 + i * 47.91) * 24634.6345);
      p.fill(255, 190, 96, 45 + 70 * (1 - v));
      p.circle(u * w, y + v * bandH, 2 + (i % 4));
    }
  } else if (family === "grains") {
    p.noStroke();
    for (let i = 0; i < 28; i++) {
      const u0 = frac(Math.sin(seed * 0.00029 + i * 33.73) * 19341.77);
      const v0 = frac(Math.sin(seed * 0.00041 + i * 17.11) * 77821.23);
      const u = frac(u0 + motion * (0.012 + (i % 5) * 0.002));
      p.fill(252, 237, 197, 85);
      p.circle(u * w, y + v0 * bandH, 1.5 + (i % 3));
    }
  } else {
    p.stroke(247, 226, 179, 58);
    p.strokeWeight(1);
    const lines = 3 + (seed % 4);
    for (let i = 1; i <= lines; i++) p.line(0, y + bandH * i / (lines + 1), w, y + bandH * i / (lines + 1));
  }
}

function drawFault(
  p: import("p5").default,
  placement: SpreadScenePlacement,
  count: number,
  w: number,
  h: number,
  t: number,
  reducedMotion: boolean,
) {
  const seed = hash(placement.card.slug);
  const phase = reducedMotion ? 0 : Math.sin(t * 0.38 + seed * 0.001) * w * 0.008;
  const x0 = w * (0.28 + ((seed % 41) / 100)) + phase;
  const lean = w * (0.12 + ((seed >>> 5) % 13) / 100);

  p.noFill();
  p.stroke(151, 227, 210, 185);
  p.strokeWeight(Math.max(1.5, Math.min(w, h) * 0.005));
  p.beginShape();
  for (let y = -8; y <= h + 8; y += h / 14) {
    const x = x0 + (y / h - 0.5) * lean + Math.sin(y * 0.033 + seed) * 3;
    p.vertex(x, y);
  }
  p.endShape();

  p.stroke(12, 15, 17, 135);
  p.strokeWeight(Math.max(2, Math.min(w, h) * 0.009));
  p.line(x0 + 7, 0, x0 + lean + 7, h);

  // A small throw marker originates in the card's own stratum but the fault itself crosses all strata.
  const y = bandY(placement.index, count, h);
  p.stroke(224, 239, 232, 160);
  p.strokeWeight(1);
  p.line(x0 - 22, y + h / count * 0.5, x0 + 22, y + h / count * 0.5 - 10);
}

function drawPlume(
  p: import("p5").default,
  placement: SpreadScenePlacement,
  count: number,
  w: number,
  h: number,
  t: number,
  reducedMotion: boolean,
) {
  const seed = hash(placement.card.slug);
  const y0 = bandY(placement.index, count, h) + h / count * 0.72;
  const x0 = w * (0.22 + ((seed % 57) / 100));
  const pulse = reducedMotion ? 0 : t * 0.55;

  p.noStroke();
  const steps = 34;
  for (let i = 0; i < steps; i++) {
    const f = i / (steps - 1);
    const y = y0 - f * (y0 + h * 0.08);
    const x = x0 + Math.sin(f * 11 + seed * 0.001 + pulse) * w * (0.008 + f * 0.022);
    const radius = Math.max(3, Math.min(w, h) * (0.006 + f * 0.018));
    p.fill(255, 123 + f * 80, 56, 22 + f * 68);
    p.circle(x, y, radius * 3.2);
    p.fill(255, 222, 153, 55 + f * 80);
    p.circle(x, y, radius);
  }
}

function drawGrains(
  p: import("p5").default,
  placement: SpreadScenePlacement,
  count: number,
  w: number,
  h: number,
  t: number,
  reducedMotion: boolean,
) {
  const seed = hash(placement.card.slug);
  const sourceY = bandY(placement.index, count, h) + h / count * 0.5;
  const motion = reducedMotion ? 0 : t;

  p.noStroke();
  for (let i = 0; i < 42; i++) {
    const base = frac(Math.sin(seed * 0.00013 + i * 78.233) * 91237.17);
    const drift = frac(base + motion * (0.018 + (i % 7) * 0.0017));
    const x = drift * w;
    const wave = Math.sin(i * 1.81 + motion * 0.7) * h * 0.055;
    const y = sourceY + wave + ((i % 9) - 4) * 2.5;
    p.fill(247, 226, 174, 95);
    p.circle(x, y, 1.5 + (i % 4) * 0.8);
  }
}

function drawMajorEvent(
  p: import("p5").default,
  placement: SpreadScenePlacement,
  count: number,
  w: number,
  h: number,
  t: number,
  reducedMotion: boolean,
) {
  const seed = hash(placement.card.slug);
  const y = bandY(placement.index, count, h) + h / count * 0.5;
  const x = w * (0.35 + ((seed % 31) / 100));
  const pulse = reducedMotion ? 0 : (Math.sin(t * 0.9 + seed) + 1) / 2;
  const r = Math.min(w, h) * (0.045 + pulse * 0.02);

  p.noFill();
  p.stroke(255, 222, 142, 120);
  p.strokeWeight(Math.max(1, Math.min(w, h) * 0.004));
  p.circle(x, y, r * 2);
  p.stroke(255, 240, 198, 48);
  p.circle(x, y, r * 3.6);
}

function drawColumnLabels(
  p: import("p5").default,
  placements: readonly SpreadScenePlacement[],
  count: number,
  w: number,
  h: number,
  hover: number,
) {
  const bandH = h / count;
  const pad = Math.max(8, Math.min(w, h) * 0.018);
  p.textFont("monospace");
  p.textSize(Math.max(10, Math.min(15, bandH * 0.105)));

  for (const placement of placements) {
    const y = bandY(placement.index, count, h);
    const active = hover === placement.index;
    p.noStroke();
    p.fill(255, 246, 222, active ? 245 : 190);
    p.textAlign(p.LEFT, p.TOP);
    p.text(placement.position.name.toUpperCase(), pad, y + pad);

    p.fill(255, 246, 222, active ? 230 : 155);
    p.textAlign(p.RIGHT, p.BOTTOM);
    const suffix = placement.reversed ? " · REVERSED" : "";
    p.text(`${placement.card.name}${suffix}`, w - pad, y + bandH - pad);
  }
}

function mix(a: RGB, b: RGB, f: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

function hash(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function frac(value: number): number {
  return value - Math.floor(value);
}
