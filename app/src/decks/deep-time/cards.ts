/**
 * Deep Time — the "Core Sample" visual skin.
 *
 * One parametric generative engine, 78 instantiations: each card's animated p5 sketch is DERIVED
 * from its four-axis coordinates, which is the deck's thesis made literal —
 *   suit    → form language + palette (vents: rising incandescence · strata: banded accretion ·
 *             grains: wind-borne particle drift · faults: offset blocks and the slip)
 *   rank    → composition (element count; the court adds the deck's only human silhouettes)
 *   station → the light and weather the scene plays out in (the sublimated rock cycle)
 *   number  → prime/composite character: singular unfactorable forms vs. visibly factored groups
 * Majors render as literal core samples: a banded column with a luminous event at their numbered depth.
 *
 * The sketches are emitted as raw p5 instance-mode source strings (like Ulysses's animated pack) so
 * they render via <RawP5Card> and stay clear of the Ultima-typed SketchKit registers.
 */
import deckJson from "@decks/deep-time/deck.json";
import { registerRawPack, registerPack } from "@/runtime/defineCard";
import type { DeckDataFile } from "../types";
import type { CardData } from "@/runtime/types";

const data = deckJson as unknown as DeckDataFile;

/** fnv-1a, matching runtime/kit.ts so seeds stay stable if cards ever migrate to the kit. */
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const MINOR_FACT: Record<number, { ch: string; factors: number[] }> = {
  1: { ch: "identity", factors: [] },
  2: { ch: "prime", factors: [] },
  3: { ch: "prime", factors: [] },
  4: { ch: "composite", factors: [2, 2] },
  5: { ch: "prime", factors: [] },
  6: { ch: "composite", factors: [2, 3] },
  7: { ch: "prime", factors: [] },
  8: { ch: "composite", factors: [2, 2, 2] },
  9: { ch: "composite", factors: [3, 3] },
  10: { ch: "composite", factors: [2, 5] },
  11: { ch: "prime", factors: [] },
  12: { ch: "composite", factors: [2, 2, 3] },
  13: { ch: "prime", factors: [] },
  14: { ch: "composite", factors: [2, 7] },
};

const FACE: Record<string, number> = { prospector: 1, surveyor: 2, reader: 3, witness: 4 };

/** The shared engine. Injected per card as: `const CARD = {...};` + ENGINE. No backticks/interp inside. */
const ENGINE = `
function sketch(p) {
  var C = CARD;
  var W = 400, H = 600;
  var t = 0;
  var s0 = C.seed >>> 0;
  function rng() {
    s0 |= 0; s0 = (s0 + 0x6d2b79f5) | 0;
    var x = Math.imul(s0 ^ (s0 >>> 15), 1 | s0);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  }

  var PALS = {
    vents:  { bg: [14, 9, 8],   deep: [64, 22, 14],  mid: [172, 66, 26],  hot: [244, 142, 48],  pale: [255, 216, 142] },
    strata: { bg: [27, 20, 14], deep: [98, 58, 32],  mid: [178, 122, 66], hot: [216, 170, 106], pale: [241, 226, 198] },
    grains: { bg: [29, 25, 18], deep: [112, 94, 60], mid: [188, 162, 108],hot: [226, 206, 152], pale: [249, 242, 222] },
    faults: { bg: [15, 16, 19], deep: [45, 51, 59],  mid: [106, 116, 126],hot: [98, 198, 180],  pale: [227, 231, 235] },
    major:  { bg: [11, 10, 10], deep: [72, 58, 45],  mid: [162, 130, 86], hot: [242, 198, 112], pale: [247, 239, 223] }
  };
  var PAL = PALS[C.suit] || PALS.major;
  var ST = C.st;

  function mix(a, b, f) {
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  function fillC(c, a) { p.noStroke(); p.fill(c[0], c[1], c[2], a === undefined ? 255 : a); }
  function strokeC(c, a, w) { p.noFill(); p.stroke(c[0], c[1], c[2], a === undefined ? 255 : a); p.strokeWeight(w || 1); }

  // ---- composition helpers (the numeric axis) --------------------------------
  // n positions across [x0,x1]; composites cluster into factor groups, primes stay unbroken,
  // identity is a single centered element.
  function positions(n, x0, x1) {
    var pts = [];
    if (C.ch === 'identity' || n <= 1) { pts.push((x0 + x1) / 2); return pts; }
    var g = (C.ch === 'composite' && C.factors && C.factors.length > 1) ? C.factors[0] : 1;
    if (g > 1) {
      var per = Math.max(1, Math.round(n / g));
      var span = x1 - x0, gw = span / g;
      for (var i = 0; i < g; i++) {
        var cx = x0 + gw * (i + 0.5);
        for (var j = 0; j < per && pts.length < n; j++) {
          var off = per > 1 ? (j - (per - 1) / 2) * (gw * 0.55 / (per - 1)) : 0;
          pts.push(cx + off);
        }
      }
      while (pts.length < n) pts.push(x0 + span * rngStash[pts.length % rngStash.length]);
    } else {
      for (var k = 0; k < n; k++) pts.push(x0 + (x1 - x0) * (k / (n - 1)));
    }
    return pts;
  }

  // ---- deterministic scene state (all rng consumed in init, in fixed order) ---
  var rngStash = [];
  var plumes = [], bands = [], streams = [], specks = [], sparkles = [], motes = [], blobs = [];
  var faultTilt = 0, faultX = 0.5, slipDir = 1;

  function init() {
    for (var i = 0; i < 24; i++) rngStash.push(rng());
    var n = Math.max(1, Math.min(14, C.n || 1));

    if (C.suit === 'vents') {
      var xs = positions(n, 55, W - 55);
      for (var i2 = 0; i2 < xs.length; i2++) {
        plumes.push({ x: xs[i2], ph: rng() * 10, sp: 0.22 + rng() * 0.22, amp: 5 + rng() * 9,
                      hgt: H * (0.34 + rng() * 0.2) });
      }
    } else if (C.suit === 'strata' || C.suit === 'faults') {
      var top = H * 0.16, bot = H * 0.92, m = Math.max(3, n);
      var weights = [], tot = 0;
      for (var b = 0; b < m; b++) { var wgt = 0.5 + rng(); weights.push(wgt); tot += wgt; }
      var y = top;
      for (var b2 = 0; b2 < m; b2++) {
        var hgt2 = (bot - top) * (weights[b2] / tot);
        bands.push({ y: y, h: hgt2, sh: rng(), jit: rng() * 6.28, group: b2 });
        y += hgt2;
      }
      faultTilt = 0.12 + rng() * 0.14;
      faultX = 0.42 + rng() * 0.16;
      slipDir = rng() < 0.5 ? 1 : -1;
    } else if (C.suit === 'grains') {
      var ys = positions(n, H * 0.24, H * 0.66);
      for (var i3 = 0; i3 < ys.length; i3++) {
        var parts = [];
        for (var q = 0; q < 22; q++) parts.push({ u: rng(), ph: rng() * 6.28, r: 1.2 + rng() * 2.2 });
        streams.push({ y0: ys[i3], sp: 0.05 + rng() * 0.05, parts: parts });
      }
    } else if (C.suit === 'major') {
      var mB = 4 + (C.n || 0);
      for (var b3 = 0; b3 < mB; b3++) bands.push({ f: mB <= 1 ? 0.5 : b3 / (mB - 1), sh: rng(), jit: rng() * 6.28 });
      for (var bl = 0; bl < 8; bl++) blobs.push({ x: rng(), y: rng(), r: 24 + rng() * 40, ph: rng() * 6.28, sp: 0.1 + rng() * 0.2 });
    }

    for (var s = 0; s < 90; s++) specks.push({ x: rng() * W, y: rng() * H, r: 0.8 + rng() * 2.4, ph: rng() * 6.28, dk: rng() < 0.5 });
    for (var g2 = 0; g2 < 9; g2++) sparkles.push({ x: W * (0.12 + rng() * 0.76), y: H * (0.16 + rng() * 0.72), s: 3 + rng() * 5, ph: rng() * 6.28 });
    for (var mo = 0; mo < 12; mo++) motes.push({ x: rng() * W, ph: rng(), sway: rng() * 6.28 });
  }

  // ---- station light: the wash ------------------------------------------------
  function wash() {
    var topC = mix(PAL.bg, [255, 255, 255], 0.06);
    var botC = mix(PAL.bg, [0, 0, 0], 0.45);
    if (ST === 'burial') { topC = mix(topC, [0, 0, 0], 0.35); botC = mix(botC, [0, 0, 0], 0.4); }
    if (ST === 'uplift') topC = mix(topC, [235, 218, 178], 0.14);
    if (ST === 'crystallization') { topC = mix(topC, [168, 196, 224], 0.10); botC = mix(botC, [120, 150, 180], 0.05); }
    if (ST === 'transport') { topC = mix(topC, [148, 168, 184], 0.10); botC = mix(botC, [148, 168, 184], 0.08); }
    if (ST === 'metamorphism') { topC = mix(topC, [120, 70, 50], 0.12); botC = mix(botC, [90, 40, 30], 0.10); }
    for (var y = 0; y < H; y += 3) {
      var f = y / H;
      var c = mix(topC, botC, f);
      if (ST === 'melt' && f > 0.6) c = mix(c, [148, 52, 16], (f - 0.6) / 0.4 * 0.85);
      if (ST === 'deposition') {
        var d = Math.abs(f - 0.78);
        if (d < 0.14) c = mix(c, [222, 168, 96], (1 - d / 0.14) * 0.28);
      }
      fillC(c); p.rect(0, y, W, 3);
    }
  }

  // ---- suit scenes -------------------------------------------------------------
  function jaggedBand(yTop, hgt, xL, xR, jit, cc, alpha, foldAmp) {
    p.noStroke(); p.fill(cc[0], cc[1], cc[2], alpha);
    p.beginShape();
    var step = 16;
    for (var x = xL; x <= xR + 0.1; x += step) {
      var e = Math.sin(x * 0.045 + jit) * 2.4 + (foldAmp ? Math.sin(x * 0.02 + jit * 2) * foldAmp : 0);
      p.vertex(x, yTop + e);
    }
    for (var x2 = xR; x2 >= xL - 0.1; x2 -= step) {
      var e2 = Math.sin(x2 * 0.05 + jit * 1.7) * 2.4 + (foldAmp ? Math.sin(x2 * 0.02 + jit * 2) * foldAmp : 0);
      p.vertex(x2, yTop + hgt + e2);
    }
    p.endShape(p.CLOSE);
  }

  function drawVents() {
    fillC(mix(PAL.bg, [0, 0, 0], 0.5));
    p.rect(0, H * 0.87, W, H * 0.13);
    for (var i = 0; i < plumes.length; i++) {
      var pl = plumes[i];
      var gy = H * 0.87;
      fillC(mix(PAL.deep, [0, 0, 0], 0.4));
      p.triangle(pl.x - 26, gy, pl.x + 26, gy, pl.x, gy - 26);
      var m = 15;
      for (var k = 0; k <= m; k++) {
        var f = k / m;
        var yy = gy - 12 - f * pl.hgt;
        var wob = Math.sin(t * pl.sp * 2 + k * 0.72 + pl.ph) * pl.amp * f;
        var cc = f < 0.5 ? mix(PAL.deep, PAL.hot, f * 2) : mix(PAL.hot, PAL.pale, (f - 0.5) * 2);
        var rr = 11 - 7.5 * f;
        var breathe = 0.85 + 0.15 * Math.sin(t * 0.9 + pl.ph);
        fillC(cc, 44 * breathe);
        p.circle(pl.x + wob, yy, rr * 4.6);
        fillC(cc, 175 * breathe);
        p.circle(pl.x + wob, yy, rr * 2);
      }
      fillC(PAL.pale, 90 + 60 * Math.sin(t * 0.8 + pl.ph));
      p.circle(pl.x + Math.sin(t * pl.sp * 2 + m * 0.72 + pl.ph) * pl.amp, gy - 12 - pl.hgt, 7);
    }
  }

  function drawStrata() {
    var shades = [PAL.deep, PAL.mid, PAL.hot];
    var gGap = (C.ch === 'composite' && C.factors && C.factors.length > 1) ? C.factors[0] : 0;
    var per = gGap ? Math.ceil(bands.length / gGap) : bands.length;
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      var cc = mix(shades[i % 3], PAL.pale, b.sh * 0.3);
      var gap = gGap ? Math.floor(i / per) * 5 : 0;
      var alpha = 235;
      if (i === 0) alpha = 150 + 70 * Math.sin(t * 0.35);
      var foldAmp = ST === 'metamorphism' ? 10 : 0;
      jaggedBand(b.y + gap, b.h + 2, 14, W - 14, b.jit, cc, alpha, foldAmp);
    }
  }

  function drawFaults() {
    var shades = [PAL.deep, PAL.mid, mix(PAL.mid, PAL.pale, 0.4)];
    var T = 9;
    var phase = (t / T) % 1;
    var strain = Math.min(1, phase / 0.85);
    var slip = phase > 0.85 ? ((phase - 0.85) / 0.15) : 0;
    slip = slip * slip * (3 - 2 * slip);
    var offset = slipDir * (strain * 4 + slip * 14);
    var fx0 = W * faultX + H * faultTilt * 0.5, fx1 = W * faultX - H * faultTilt * 0.5;
    function fxAt(y) { return fx0 + (fx1 - fx0) * (y / H); }
    var gGap = (C.ch === 'composite' && C.factors && C.factors.length > 1) ? C.factors[0] : 0;
    var per = gGap ? Math.ceil(bands.length / gGap) : bands.length;
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      var cc = mix(shades[i % 3], PAL.pale, b.sh * 0.25);
      var gap = gGap ? Math.floor(i / per) * 5 : 0;
      var foldAmp = ST === 'metamorphism' ? 8 : 0;
      jaggedBand(b.y + gap, b.h + 2, 12, fxAt(b.y) - 2, b.jit, cc, 235, foldAmp);
      jaggedBand(b.y + gap + offset, b.h + 2, fxAt(b.y) + 2, W - 12, b.jit + 2, cc, 235, foldAmp);
    }
    var flash = Math.exp(-Math.pow(phase - 0.9, 2) / 0.0012);
    strokeC(PAL.hot, 60 + 195 * flash, 2 + 2 * flash);
    p.line(fx0, 0, fx1, H);
    if (flash > 0.25) { strokeC(PAL.pale, 120 * flash, 1); p.line(fx0 + 3, 0, fx1 + 3, H); }
  }

  function drawGrains() {
    fillC(mix(PAL.deep, PAL.mid, 0.3));
    p.beginShape();
    p.vertex(0, H); p.vertex(0, H * 0.86);
    for (var x = 0; x <= W; x += 20) p.vertex(x, H * 0.86 - Math.sin(x * 0.012 + 1.2) * H * 0.05);
    p.vertex(W, H);
    p.endShape(p.CLOSE);
    for (var i = 0; i < streams.length; i++) {
      var st2 = streams[i];
      for (var q = 0; q < st2.parts.length; q++) {
        var pt = st2.parts[q];
        var u = (t * st2.sp + pt.u) % 1;
        var x2 = -20 + u * (W + 40);
        var y2 = st2.y0 + (x2 - W / 2) * 0.16 + Math.sin(u * 12.5 + pt.ph) * 7;
        var cc = (q % 3 === 0) ? PAL.hot : PAL.pale;
        var vis = Math.sin(u * 3.14);
        strokeC(cc, 60 * vis, pt.r * 1.1);
        p.line(x2 - 13, y2 - 2.1, x2, y2);
        fillC(cc, 105 + 145 * vis);
        p.circle(x2, y2, pt.r * 2.6);
      }
    }
  }

  function drawMajor() {
    var xL = W * 0.26, xR = W * 0.74, yT = H * 0.14, yB = H * 0.92;
    var colH = yB - yT, colW = xR - xL;
    fillC(mix(PAL.bg, [0, 0, 0], 0.3));
    p.rect(xL - 6, yT - 6, colW + 12, colH + 12, 8);
    if (C.ch === 'identity' && C.n === 0) {
      for (var i = 0; i < blobs.length; i++) {
        var bl = blobs[i];
        var bx = xL + bl.x * colW;
        var by = yT + ((bl.y + Math.sin(t * bl.sp + bl.ph) * 0.06 + 1) % 1) * colH;
        var cc = mix(PAL.deep, PAL.hot, 0.35 + 0.65 * Math.abs(Math.sin(bl.ph + t * 0.2)));
        fillC(cc, 70);
        p.circle(bx, by, bl.r * (1 + 0.1 * Math.sin(t * 0.5 + bl.ph)));
      }
      fillC(PAL.hot, 40 + 20 * Math.sin(t * 0.6));
      p.rect(xL, yB - colH * 0.25, colW, colH * 0.25);
    } else {
      var shades = [PAL.deep, PAL.mid, mix(PAL.mid, PAL.deep, 0.5)];
      for (var b = 0; b < bands.length; b++) {
        var bd = bands[b];
        var by2 = yT + bd.f * (colH - 10);
        var cc2 = mix(shades[b % 3], PAL.pale, bd.sh * (C.n === 1 ? 0.10 : 0.28));
        var foldAmp = ST === 'metamorphism' ? 7 : 0;
        jaggedBand(by2, Math.max(6, colH / (bands.length + 2)), xL + 3, xR - 3, bd.jit, cc2, C.n === 1 ? 90 : 210, foldAmp);
      }
      var yd = yT + ((C.n + 0.5) / 22) * colH;
      if (C.ch === 'identity' && C.n === 1) {
        var gl = 0.6 + 0.4 * Math.sin(t * 0.8);
        p.push(); p.translate(W / 2, yT + colH * 0.5);
        fillC(PAL.pale, 235);
        p.quad(0, -13, 8, 0, 0, 13, -8, 0);
        fillC(PAL.hot, 120 * gl);
        p.quad(0, -22, 13, 0, 0, 22, -13, 0);
        p.pop();
      } else if (C.ch === 'prime') {
        var pulse = 0.65 + 0.35 * Math.sin(t * 0.7);
        fillC([0, 0, 0], 90); p.rect(xL + 2, yd - 9, colW - 4, 18);
        strokeC(PAL.hot, 240 * pulse, 2.5); p.line(xL + 4, yd, xR - 4, yd);
        strokeC(PAL.pale, 160 * pulse, 1); p.line(xL + 4, yd - 2, xR - 4, yd - 2);
      } else if (C.ch === 'composite') {
        var strands = Math.max(2, (C.factors || []).length);
        fillC([0, 0, 0], 70); p.rect(xL + 2, yd - 14, colW - 4, 28);
        for (var sd = 0; sd < strands; sd++) {
          var cc3 = sd % 2 === 0 ? PAL.hot : PAL.pale;
          strokeC(cc3, 200, 1.8);
          p.beginShape();
          for (var x3 = xL + 4; x3 <= xR - 4; x3 += 8) {
            p.vertex(x3, yd + Math.sin(x3 * 0.06 + t * 0.5 + sd * (6.28 / strands)) * (5 + sd * 1.5));
          }
          p.endShape();
        }
      }
    }
    strokeC(mix(PAL.pale, PAL.bg, 0.35), 130, 1.5);
    p.rect(xL - 6, yT - 6, colW + 12, colH + 12, 8);
  }

  // ---- the court: the deck's only human presences ------------------------------
  function silhouette() {
    if (!C.face) return;
    var fh = H * 0.105;
    var ink = [9, 8, 6];
    p.noStroke();
    if (C.face === 1) { // Prospector — crouched, working, a spark at the point of contact
      var fx = W * 0.30, fy = H * 0.875;
      fillC(ink, 235);
      p.arc(fx, fy, fh * 1.15, fh * 1.3, Math.PI, 2 * Math.PI);
      p.circle(fx + fh * 0.34, fy - fh * 0.62, fh * 0.38);
      p.push(); p.stroke(9, 8, 6, 235); p.strokeWeight(3);
      p.line(fx + fh * 0.42, fy - fh * 0.45, fx + fh * 0.85, fy - fh * 0.1);
      p.pop();
      var sp = Math.max(0, Math.sin(t * 2.4));
      fillC(PAL.pale, 220 * sp * sp);
      p.circle(fx + fh * 0.9, fy - fh * 0.06, 3.5);
    } else if (C.face === 2) { // Surveyor — upright, instrument staff, sighting
      var fx2 = W * 0.66, fy2 = H * 0.875;
      fillC(ink, 235);
      p.triangle(fx2 - fh * 0.26, fy2, fx2 + fh * 0.26, fy2, fx2, fy2 - fh * 0.95);
      p.circle(fx2, fy2 - fh * 1.12, fh * 0.36);
      p.push(); p.stroke(9, 8, 6, 235); p.strokeWeight(2.5);
      p.line(fx2 + fh * 0.5, fy2, fx2 + fh * 0.5, fy2 - fh * 1.5);
      p.line(fx2 + fh * 0.32, fy2 - fh * 1.32, fx2 + fh * 0.68, fy2 - fh * 1.32);
      p.pop();
    } else if (C.face === 3) { // Reader — close against the record, one hand on it
      var fx3 = W * 0.155, fy3 = H * 0.86;
      fillC(ink, 235);
      p.triangle(fx3 - fh * 0.24, fy3, fx3 + fh * 0.24, fy3, fx3, fy3 - fh * 0.9);
      p.circle(fx3 - fh * 0.1, fy3 - fh * 1.05, fh * 0.36);
      p.push(); p.stroke(9, 8, 6, 235); p.strokeWeight(3);
      p.line(fx3 - fh * 0.12, fy3 - fh * 0.62, fx3 - fh * 0.62, fy3 - fh * 0.78);
      p.pop();
    } else if (C.face === 4) { // Witness — seated, utterly still
      var fx4 = W * 0.5, fy4 = H * 0.885;
      fillC(ink, 235);
      p.arc(fx4, fy4, fh * 1.5, fh * 1.15, Math.PI, 2 * Math.PI);
      p.circle(fx4, fy4 - fh * 0.72, fh * 0.4);
    }
  }

  // ---- station post-pass ---------------------------------------------------------
  function post() {
    if (ST === 'weathering') {
      for (var i = 0; i < specks.length; i++) {
        var s = specks[i];
        var a = 26 + 26 * Math.sin(t * 0.3 + s.ph);
        fillC(s.dk ? [0, 0, 0] : PAL.pale, a);
        p.circle(s.x, s.y, s.r * 2);
      }
    } else if (ST === 'crystallization') {
      for (var i2 = 0; i2 < sparkles.length; i2++) {
        var g = sparkles[i2];
        var a2 = Math.pow(Math.max(0, Math.sin(t * 0.7 + g.ph)), 3) * 190;
        if (a2 < 4) continue;
        fillC(PAL.pale, a2);
        p.quad(g.x, g.y - g.s, g.x + g.s * 0.5, g.y, g.x, g.y + g.s, g.x - g.s * 0.5, g.y);
      }
    } else if (ST === 'transport') {
      for (var i3 = 0; i3 < 5; i3++) {
        var yy = H * (0.2 + i3 * 0.15);
        var xx = ((t * (34 + i3 * 9) + i3 * 137) % (W + 220)) - 110;
        strokeC(mix(PAL.pale, [150, 175, 195], 0.5), 34, 1.5);
        p.line(xx, yy, xx + 90 + i3 * 16, yy + 6);
      }
    } else if (ST === 'deposition') {
      for (var i4 = 0; i4 < motes.length; i4++) {
        var mo = motes[i4];
        var u = (t * 0.045 + mo.ph) % 1;
        var my = u * H * 0.8;
        fillC(PAL.pale, 90 * Math.sin(u * 3.14));
        p.circle(mo.x + Math.sin(u * 9 + mo.sway) * 10, my, 2.6);
      }
      fillC(mix(PAL.hot, PAL.pale, 0.4), 60);
      p.rect(0, H * 0.815, W, 4);
    } else if (ST === 'melt') {
      var br = 0.7 + 0.3 * Math.sin(t * 0.55);
      for (var i5 = 0; i5 < 12; i5++) {
        var f = i5 / 12;
        fillC([250, 120, 30], 34 * (1 - f) * br);
        p.rect(0, H - (i5 + 1) * (H * 0.028), W, H * 0.03);
      }
    } else if (ST === 'burial') {
      fillC([0, 0, 0], 110); p.rect(0, 0, W, H * 0.1);
      fillC([0, 0, 0], 55); p.rect(0, H * 0.1, W, H * 0.08);
    } else if (ST === 'uplift') {
      fillC([245, 228, 190], 22); p.rect(0, 0, W, H * 0.2);
      fillC([0, 0, 0], 36);
      p.triangle(0, H, 0, H * 0.55, W * 0.55, H);
    } else if (ST === 'metamorphism') {
      var sx = ((t * 16) % (W + 320)) - 160;
      p.push();
      p.translate(sx, H / 2); p.rotate(0.35);
      fillC(PAL.pale, 15);
      p.rect(-30, -H, 60, H * 2);
      p.pop();
      strokeC(mix(PAL.mid, PAL.pale, 0.3), 46, 1.4);
      for (var cv = 0; cv < 3; cv++) {
        p.beginShape();
        for (var x4 = 0; x4 <= W; x4 += 14) {
          p.vertex(x4, H * (0.3 + cv * 0.18) + Math.sin(x4 * 0.02 + cv * 2.1) * 26);
        }
        p.endShape();
      }
    }
    // universal quiet vignette
    for (var v = 0; v < 4; v++) {
      strokeC([0, 0, 0], 26 + v * 8, 10);
      p.rect(5 - v * 3, 5 - v * 3, W - 10 + v * 6, H - 10 + v * 6, 14);
    }
  }

  p.setup = function () {
    p.createCanvas(400, 600);
    p.frameRate(30);
    init();
  };

  p.draw = function () {
    t = p.frameCount / 30;
    wash();
    if (C.suit === 'vents') drawVents();
    else if (C.suit === 'strata') drawStrata();
    else if (C.suit === 'faults') drawFaults();
    else if (C.suit === 'grains') drawGrains();
    else drawMajor();
    silhouette();
    post();
  };
}
`;

const codes: Record<string, string> = {};
for (const card of Object.values(data.cards) as CardData[]) {
  const n = parseInt(card.number, 10);
  const suit = card.arcana === "major" ? "major" : (card.suit_slug as string);
  const fact =
    card.arcana === "major"
      ? { ch: card.factorization?.character ?? "prime", factors: card.factorization?.factors ?? [] }
      : MINOR_FACT[n] ?? { ch: "prime", factors: [] };
  const params = {
    seed: hashStr(card.slug),
    suit,
    n,
    ch: fact.ch,
    factors: fact.factors,
    st: card.station_slug as string,
    face: card.rank_slug ? FACE[card.rank_slug] ?? 0 : 0,
  };
  codes[card.slug] = `const CARD = ${JSON.stringify(params)};\n${ENGINE}`;
}

registerRawPack("deep-time", "core-sample", codes);
registerPack("deep-time", {
  id: "core-sample",
  label: "Core Sample",
  description: "one generative engine, 78 derivations — suit as form, rank as composition, station as light, number as character",
});
