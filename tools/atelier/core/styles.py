"""Five style engines over a modeled underpainting + its G-buffer.

The critique these answer: a single uniform stroke pass reads as static — strokes must KNOW
what they're painting. Every engine here reads the aux buffers (subject mask, depth, surface
normals, material ids) and treats sky / ground / subject as different painting problems, with
stroke orientation taken from 3D form (screen-projected normals), not just image gradients.

Usage: python styles.py <render.png> <aux.npz> <style> <out.png> [seed] [args...]
       python styles.py bindings                      # print every engine's binding table
styles: vangogh | monet | picasso | sketch | watercolor | comic

All engines speak the direction plane (CONTROL_PLANE §4): key=val args set KNOBS
(edge / focus / order / chroma / weight / pull, all 0..1), `register=<gods|heroes|men|
ricorso>` applies a knob-space preset, and `palette="core:hex,hex;accent:hex"` (or
`palette=@stock.json`) supplies the stock. Aliases: clarity=→edge, focus=→focus.
vangogh additionally takes legacy positional scene directives: "<vortices|->" "<stars|->"
[register].
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

F = np.float32


# ── shared machinery ─────────────────────────────────────────────────────────

def load(img_path, aux_path):
    im = Image.open(img_path).convert("RGB")
    img = np.asarray(im, dtype=F) / 255.0
    g = np.load(aux_path)
    mask = g["mask"].astype(F)
    mat = g["material"]
    nrm = g["normal"].astype(F)
    h, w = mask.shape
    # regions: 0 = sky/background, 1 = ground plane (material 0), 2 = subject
    region = np.zeros((h, w), np.int8)
    region[(mask > 0.5) & (mat == 0)] = 1
    region[(mask > 0.5) & (mat > 0)] = 2
    extras = {
        "mist": g["mist"].astype(F) if "mist" in g.files else np.zeros((h, w), F),
        "flow": g["flow"].astype(F) if "flow" in g.files else None,
        "flowmask": g["flowmask"].astype(F) if "flowmask" in g.files else None,
        "coherence": g["coherence"].astype(F) if "coherence" in g.files else None,
        "age": g["age"].astype(F) if "age" in g.files else None,
        "depth": g["depth"].astype(F) if "depth" in g.files else None,
        "emphasis": g["emphasis"].astype(F) if "emphasis" in g.files else None,
        "mat": mat.astype(F),
    }
    return img, region, nrm, extras, w, h


def hsv_of(rgb):
    """Vectorized rgb→hsv over an (...,3) float array."""
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    d = mx - mn + 1e-9
    r, g_, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hh = np.where(mx == r, ((g_ - b) / d) % 6, np.where(mx == g_, (b - r) / d + 2, (r - g_) / d + 4)) / 6.0
    ss = np.where(mx > 1e-6, d / (mx + 1e-9), 0.0)
    return hh.astype(F), ss.astype(F), mx.astype(F)


def rgb_of(hh, ss, vv):
    """Vectorized hsv→rgb."""
    i = np.floor(hh * 6).astype(np.int32) % 6
    f = hh * 6 - np.floor(hh * 6)
    p = vv * (1 - ss)
    q = vv * (1 - f * ss)
    t = vv * (1 - (1 - f) * ss)
    r = np.choose(i, [vv, q, p, p, t, vv])
    g_ = np.choose(i, [t, vv, vv, q, p, p])
    b = np.choose(i, [p, p, t, vv, vv, q])
    return np.stack([r, g_, b], axis=-1).astype(F)


def upN(a, W, H, mode=Image.BICUBIC, lo=0.0, hi=1.0):
    """Resize a float array through PIL with a value range."""
    span = hi - lo
    im = Image.fromarray((np.clip((a - lo) / span, 0, 1) * 255).astype(np.uint8)).resize((W, H), mode)
    return np.asarray(im, dtype=F) / 255.0 * span + lo


# ── the direction plane: knobs, stock, bindings (CONTROL_PLANE §4) ───────────
#
# A knob (semantic intent) modulates, via the engine's BINDINGS (style), how the AXES
# (mechanics) respond to the BUFFERS (scene facts) — drawing from a STOCK (the palette).
# Engines respond meaningfully or shrug honestly; sensitivity lives in the binding.

KNOBS = dict(
    edge=0.5,     # how much does object identity survive?
    focus=0.5,    # how unequal is the frame's treatment? (gain on the emphasis buffer)
    order=0.6,    # how disciplined are the marks?
    chroma=0.5,   # how loud is the pigment?
    weight=0.5,   # how big/dense is the mark?
    pull=0.0,     # how faithful to the stock?
)

# Presets are points in KNOB space — portable across engines (CONTROL_PLANE §4.3).
# The Vico registers, re-expressed; vangogh's old axis values are recovered by its bindings.
REGISTERS = {
    "gods":    dict(weight=0.95, order=0.85, chroma=0.85, edge=0.70, focus=0.70),
    "heroes":  dict(weight=0.60, order=0.60, chroma=0.78, edge=0.60, focus=0.55),
    "men":     dict(weight=0.08, order=0.75, chroma=0.30, edge=0.60, focus=0.12),
    "ricorso": dict(weight=0.65, order=0.25, chroma=0.55, edge=0.15, focus=0.50),
}


def parse_stock(spec):
    """'core:8a6d4a,6b7a6d;accent:c9a45c;dark:2a2622' or a bare 'aabbcc,ddeeff' (all core),
    or '@path.json' ({role: [hex,...]}), or '@path.json#key' to pick one stock from a
    collection ({key: {role: [hex,...]}}, e.g. the Linati stocks). Returns
    {role: [(r,g,b) floats 0..1]} or None."""
    if not spec or spec in ("-", ""):
        return None
    if spec.startswith("@"):
        import json
        path, _, key = spec[1:].partition("#")
        data = json.loads(Path(path).read_text())
        if key:
            data = data[key]
        return {role: [_hex(c) for c in cols] for role, cols in data.items()
                if not role.startswith("_")}
    stock = {}
    if ":" not in spec:
        spec = "core:" + spec
    for part in spec.split(";"):
        role, _, cols = part.partition(":")
        stock[role.strip()] = [_hex(c) for c in cols.split(",") if c.strip()]
    return stock


def _hex(s):
    s = s.strip().lstrip("#")
    return tuple(int(s[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def _srgb_to_oklab(c):
    """(..., 3) sRGB 0..1 → Oklab. Björn Ottosson's fit."""
    c = np.clip(np.asarray(c, dtype=F), 0, 1)
    lin = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    l = 0.4122214708 * lin[..., 0] + 0.5363325363 * lin[..., 1] + 0.0514459929 * lin[..., 2]
    m = 0.2119034982 * lin[..., 0] + 0.6806995451 * lin[..., 1] + 0.1073969566 * lin[..., 2]
    s = 0.0883024619 * lin[..., 0] + 0.2817188376 * lin[..., 1] + 0.6299787005 * lin[..., 2]
    l, m, s = np.cbrt(l), np.cbrt(m), np.cbrt(s)
    return np.stack([0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
                     1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                     0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s], axis=-1)


def _oklab_to_srgb(lab):
    lab = np.asarray(lab, dtype=F)
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    lin = np.stack([+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s], axis=-1)
    lin = np.clip(lin, 0, None)
    return np.clip(np.where(lin > 0.0031308, 1.055 * lin ** (1 / 2.4) - 0.055, 12.92 * lin), 0, 1)


def pull_to_stock(rgb, stock, pull, roles=("core",), gate=None):
    """Pull colors toward the nearest stock pigment in Oklab, VALUE-PRESERVING: lightness
    carries form and lighting; hue/chroma are where the palette lives. `gate` (same spatial
    shape) scales pull locally — e.g. the emphasis buffer unlocking accent pigments.
    Invariant #8 applies: at high pull on smooth fields, callers must gate or soften."""
    if stock is None or pull <= 0:
        return rgb
    pigs = [p for r in roles for p in stock.get(r, [])]
    if not pigs:
        return rgb
    lab = _srgb_to_oklab(rgb)
    plab = _srgb_to_oklab(np.array(pigs, dtype=F))                # (K, 3)
    d = ((lab[..., None, 1] - plab[None, :, 1]) ** 2
         + (lab[..., None, 2] - plab[None, :, 2]) ** 2
         + 0.25 * (lab[..., None, 0] - plab[None, :, 0]) ** 2)    # chroma-weighted distance
    near = plab[np.argmin(d, axis=-1)]
    k = np.full(lab.shape[:-1], pull, F) if gate is None else np.clip(pull * gate, 0, 1).astype(F)
    lab2 = lab.copy()
    lab2[..., 1] = lab[..., 1] * (1 - k) + near[..., 1] * k
    lab2[..., 2] = lab[..., 2] * (1 - k) + near[..., 2] * k
    lab2[..., 0] = lab[..., 0] + (near[..., 0] - lab[..., 0]) * k * 0.08     # L barely moves
    return _oklab_to_srgb(lab2).astype(F)


def pull_one(c, stock, pull, roles=("core",)):
    """Tuple-in, tuple-out pull for per-stroke color paths (vangogh's jitter walk)."""
    if stock is None or pull <= 0:
        return c
    return tuple(pull_to_stock(np.array(c, dtype=F)[None], stock, pull, roles)[0])


# Each engine's binding table: knob → what it moves (declarative, printable via
# `python styles.py bindings`). An empty row is a documented shrug.
BINDINGS = {
    "vangogh": {
        "edge":   "region-stop ↔ trespass (strokes may cross silhouettes when edge < 0.25)",
        "focus":  "vortex gain 0.3→1.7; emphasis protection + contrast boost scale",
        "order":  "coherence bias ±0.25; curl contribution; stroke jitter",
        "chroma": "stroke saturation boost 1.0→1.65",
        "weight": "sky stroke length 0.4→1.4×; curl contribution",
        "pull":   "per-stroke color jitter walks toward the nearest stock pigment",
    },
    "watercolor": {
        "edge":   "bleed displacement 27→3 px; wash-edge wander; mask blur; rim-pool tightness+darkness; reserved boundary lines (gated > 0.35)",
        "focus":  "gain on emphasis: local bleed resistance + the true-color glaze",
        "order":  "wash-edge wander share; back-run bloom count 9→2",
        "chroma": "wet-plate saturation 1.2→2.0",
        "weight": "glaze opacity + band depth",
        "pull":   "wet-plate pigments mix within the stock's gamut (accent gated on emphasis)",
    },
    "comic": {
        "edge":   "ink alpha + presence; crease sensitivity; material-seam ink (off < 0.25)",
        "focus":  "the grade: off-focus chroma −72%, value compression; on-focus sat/light pop; Ben-Day gating",
        "order":  "print registration: ink offset up to 2.5 px at low order; dot lattice regularity",
        "chroma": "saturation chips 2→5 + boost",
        "weight": "cel band count 6→3 (chunkier); line thickness",
        "pull":   "quantizer chips pull to the stock — literal screen-print inks at 1.0",
    },
    "screenprint": {
        "edge":   "separation boundary crispness: loose pull ↔ tight registration line",
        "focus":  "the accent ink prints ONLY where the stager pointed (emphasis-gated)",
        "order":  "registration: layers slip up to 5 px at low order",
        "chroma": "color read boosted before ink assignment",
        "weight": "ink coverage: heavy pulls flood the dark separations",
        "pull":   "IMPLICITLY 1.0 — the stock is not a gravity well here, it IS the ink set",
    },
    "blueprint": {
        "edge":   "drawn-line presence 0.5→1.1",
        "focus":  "the surveyed object bright; context dimmed",
        "order":  "drafting hand: CAD-steady ↔ the pen breathes (wobble)",
        "chroma": "cyan of the drafting ground",
        "weight": "hatch density",
        "pull":   "— (ground + line come from stock dark/light)",
    },
    "linocut": {
        "edge":   "block-edge crispness (pre-threshold blur)",
        "focus":  "—",
        "order":  "the carver's hand: gouge-angle jitter",
        "chroma": "routes high-chroma midtones to the accent block",
        "weight": "gouge thickness, length, density",
        "pull":   "— (paper/ink/accent are the stock's light/dark/accent)",
    },
    "cutout": {
        "edge":   "cut ↔ torn paper boundaries",
        "focus":  "shadow size — the lifted piece",
        "order":  "the gluer's neatness (shadow drift)",
        "chroma": "color read boosted before paper assignment",
        "weight": "piece size (pre-blur radius 4→13)",
        "pull":   "IMPLICITLY 1.0 — every piece is stock paper",
    },
    "chrono": {
        "edge":   "echo crispness",
        "focus":  "how much the NOW outshines the then",
        "order":  "echo discipline (vertical scatter at low order)",
        "chroma": "the heat ramp on trailing echoes",
        "weight": "echo count 3→7 and spread",
        "pull":   "— (heat colors are the stock's accent+core)",
    },
    "stagelight": {
        "edge":   "terminator hardness: soft gradient light ↔ knife-edge posterized bands",
        "focus":  "the followspot: lit-lift on the loved subject, pool strength, beams above 0.5",
        "order":  "the film stock: grain + scanline whisper at low order",
        "chroma": "gel amount 0.15→0.6 + saturation of the lit world",
        "weight": "light band count 6→3 (chunkier light)",
        "pull":   "the lit result pulls toward the stock (gel comes from accent[0])",
    },
    "monet": {
        "edge":   "lost-edge sampling σ 13→3 px",
        "focus":  "—",
        "order":  "—",
        "chroma": "broken-color probability 0.1→0.5",
        "weight": "dab size 0.7→1.5×",
        "pull":   "dab colors pull toward the stock",
    },
    "sketch": {
        "edge":   "contour pass density",
        "focus":  "—",
        "order":  "hatch wobble 3.2→0.4",
        "chroma": "— (ink is ink)",
        "weight": "hatch period 1.4→0.7×",
        "pull":   "—",
    },
    "picasso": {
        "edge":   "INVERTED: fracture site count 18→70 — more assertion, more fracture; inverting boundary logic is this engine's identity",
        "focus":  "—",
        "order":  "—",
        "chroma": "palette keep-fraction",
        "weight": "—",
        "pull":   "facet tones snap toward the stock",
    },
}


def resolve_knobs(register=None, **overrides):
    """Preset (knob-space register) + explicit overrides → a full knob dict."""
    k = dict(KNOBS)
    if register:
        k.update(REGISTERS.get(register, {}))
    k.update({n: float(v) for n, v in overrides.items() if n in KNOBS})
    return k


def unbake_vignette(v, W):
    """The framer bakes an oval vignette into every card. Engines that BAND or QUANTIZE
    luminance read that radial gradient as scene structure (a giant amoeba wash, a hard
    grey oval cel). Estimate the low-frequency field, divide it out, hand it back so the
    engine can re-apply the frame mood AFTER its value logic."""
    est = np.asarray(Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(W * 0.22)), dtype=F) / 255
    est = np.maximum(est, 0.06)
    flat = np.clip(v * (est.mean() / est), 0, 1)
    return flat, est / est.mean()


def form_angle(nrm, rng, h, w):
    """Stroke orientation from surface form: along iso-normal contours (perpendicular to the
    screen-space normal), with noise where the surface faces the camera (nz→1, ill-defined)."""
    ang = np.arctan2(nrm[..., 1], nrm[..., 0]) + np.pi / 2
    facing = np.clip(np.abs(nrm[..., 2]), 0, 1) ** 2
    noise = value_noise(h, w, 24, rng) * np.pi
    return ang * (1 - facing) + noise * facing


def value_noise(h, w, cell, rng):
    gh, gw = h // cell + 2, w // cell + 2
    g = rng.random((gh, gw)).astype(F)
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(im, dtype=F) / 255.0


def rgb_to_hsv(c):
    import colorsys
    return colorsys.rgb_to_hsv(*c)


def hsv_to_rgb(c):
    import colorsys
    return colorsys.hsv_to_rgb(*c)


def jitter_color(c, rng, dh=0.0, ds=0.0, dv=0.0, boost_s=1.0):
    hh, ss, vv = rgb_to_hsv(tuple(np.clip(c, 0, 1)))
    hh = (hh + rng.normal(0, dh)) % 1.0
    ss = np.clip(ss * boost_s + rng.normal(0, ds), 0, 1)
    vv = np.clip(vv + rng.normal(0, dv), 0, 1)
    return tuple(int(q * 255) for q in hsv_to_rgb((hh, ss, vv)))


def curved_stroke(draw, x, y, ang_field, length, width, color, w, h, curl=0.0, segs=4,
                  region=None, home=None):
    """A stroke that re-samples its orientation as it travels — strokes that BEND with the field.
    With region+home set, the stroke stops at object boundaries instead of trespassing."""
    pts = [(x, y)]
    a = ang_field[min(int(y), h - 1), min(int(x), w - 1)]
    step = length / segs
    cx, cy = x, y
    for _ in range(segs):
        cx += np.cos(a) * step
        cy += np.sin(a) * step
        if region is not None and 0 <= int(cy) < h and 0 <= int(cx) < w:
            if region[int(cy), int(cx)] != home:
                break
        pts.append((cx, cy))
        if 0 <= int(cy) < h and 0 <= int(cx) < w:
            a = ang_field[int(cy), int(cx)] + curl
    if len(pts) > 1:
        draw.line(pts, fill=color, width=int(width), joint="curve")


# ── VAN GOGH: curved impasto strokes; the sky gets vortices ──────────────────
# Bindings (see BINDINGS["vangogh"]): the old VICO axis table is recovered from the
# knob-space REGISTERS presets through these mappings.

def _vg_axes(K):
    return dict(
        vort_gain=0.3 + K["focus"] * 1.4,
        coh_bias=(K["order"] - 0.6) * 0.66,
        trespass=K["edge"] < 0.25,
        sky_len=0.4 + K["weight"] * 1.0,
        sky_curl=0.05 + K["weight"] * 0.25 + (1 - K["order"]) * 0.25,
        chroma=1.0 + K["chroma"] * 0.65,
    )


def vangogh(img, region, nrm, w, h, rng, mist=None, vortices=None, flow=None, flowmask=None, stars=None, coherence=None, age=None, register_name="heroes", depth=None, emphasis=None, knobs=None, stock=None):
    S = 3
    W, H = w * S, h * S
    base = Image.fromarray((np.clip(img * 0.75, 0, 1) * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)
    arr = np.asarray(Image.fromarray((img * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS), dtype=F) / 255
    regbig = np.asarray(Image.fromarray(region.astype(np.uint8)).resize((W, H), Image.NEAREST))
    nrmbig = np.stack([np.asarray(Image.fromarray(((nrm[..., i] + 1) * 127).astype(np.uint8)).resize((W, H), Image.BICUBIC), dtype=F) / 127 - 1 for i in range(3)], axis=-1)
    draw = ImageDraw.Draw(base, "RGBA")

    form = form_angle(nrmbig, rng, H, W)
    # sky field: swirls centered on the STORY's points of energy, summed as direction VECTORS
    # (summing angles kinks the field; summing vectors gives counter-rotation a smooth saddle)
    K = knobs or resolve_knobs(register_name)
    R = _vg_axes(K)

    def jc(cf, **kw):
        # the color-jitter walk, palette-aware: it drifts toward the nearest stock pigment
        return jitter_color(pull_one(tuple(np.clip(cf, 0, 1)), stock, K["pull"]), rng, **kw)
    if vortices is None:
        vortices = ((0.30, 0.18, 1), (0.78, 0.34, -1))
    yy, xx = np.mgrid[0:H, 0:W].astype(F)
    vx_sum = np.full((H, W), 0.35, F)  # base lateral drift where no vortex dominates
    vy_sum = np.zeros((H, W), F)
    for (fx_, fy_, pol) in vortices:
        vx, vy = W * fx_, H * fy_
        dx, dy = xx - vx, yy - vy
        r = np.sqrt(dx * dx + dy * dy) + 1e-3
        wgt = np.exp(-r / (0.40 * W)) * 2.2 * R["vort_gain"]
        if pol == 0:
            th = np.arctan2(dy, dx)          # REPULSOR: radial outflow — the field diverts around
            wgt = np.exp(-r / (0.22 * W)) * 2.6
        else:
            th = np.arctan2(dy, dx) + pol * np.pi / 2
        vx_sum += np.cos(th) * wgt
        vy_sum += np.sin(th) * wgt
    if stars:
        for si, (sfx, sfy) in enumerate(stars):
            vx, vy = W * sfx, H * sfy
            dx, dy = xx - vx, yy - vy
            r = np.sqrt(dx * dx + dy * dy) + 1e-3
            wgt = np.exp(-r / (0.045 * W)) * 1.5
            th = np.arctan2(dy, dx) + (1 if si % 2 == 0 else -1) * np.pi / 2
            vx_sum += np.cos(th) * wgt
            vy_sum += np.sin(th) * wgt
    sky_ang = np.arctan2(vy_sum, vx_sum)
    ground_ang = np.full((H, W), 0.06, F) + value_noise(H, W, 40, rng) * 0.3
    mistbig = None
    if mist is not None and mist.max() > 0.01:
        mistbig = np.asarray(Image.fromarray((mist * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), dtype=F) / 255
    regbig_emph = None
    flowbig = fmaskbig = None
    if flow is not None and flowmask is not None and flowmask.max() > 0:
        fm = Image.fromarray((flowmask * 255).astype(np.uint8)).resize((W, H), Image.NEAREST)
        fmaskbig = np.asarray(fm, dtype=F) / 255
        fc = np.cos(flow) * flowmask
        fs = np.sin(flow) * flowmask
        fcb = np.asarray(Image.fromarray(((fc + 1) * 127).astype(np.uint8)).resize((W, H), Image.BICUBIC), dtype=F) / 127 - 1
        fsb = np.asarray(Image.fromarray(((fs + 1) * 127).astype(np.uint8)).resize((W, H), Image.BICUBIC), dtype=F) / 127 - 1
        flowbig = np.arctan2(fsb, fcb)
    embig = None
    if emphasis is not None and emphasis.max() > 0:
        embig = np.asarray(Image.fromarray((emphasis * 200).astype(np.uint8)).resize((W, H), Image.NEAREST), dtype=F) / 200
        # contrast-boost the underpainting where emphasized
        arr = np.clip(0.5 + (arr - 0.5) * (1 + 0.5 * embig[..., None]), 0, 1)

    depth_scale_big = None
    if depth is not None:
        d = np.where(depth > 1e5, np.nan, depth)
        d_ref = np.nanpercentile(d[region > 0], 20) if (region > 0).any() else 10.0
        ds = np.sqrt(np.clip(d_ref / np.maximum(np.nan_to_num(d, nan=d_ref), 1e-3), 0.12, 1.5))
        depth_scale_big = np.asarray(Image.fromarray((ds * 100).astype(np.uint8)).resize((W, H), Image.BICUBIC), dtype=F) / 100

    cohbig = agebig = None
    if coherence is not None:
        cohbig = np.asarray(Image.fromarray((coherence * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), dtype=F) / 255
    if age is not None and age.max() > 0:
        agebig = np.asarray(Image.fromarray((age * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC), dtype=F) / 255

    if embig is not None:
        regbig_emph = regbig.copy()
        regbig_emph[embig > 0.3] = 7       # a pseudo-region: outside strokes STOP here
    light = np.array([-0.55, -0.7])  # screen-space key direction (up-left; y down in screen)
    n = 15000
    xs = rng.integers(0, W, n)
    ys = rng.integers(0, H, n)
    for i in range(n):
        x, y = int(xs[i]), int(ys[i])
        r = regbig[y, x]
        c = arr[y, x]
        home = r
        mv = mistbig[y, x] if mistbig is not None else 0.0
        if mv > 0.10 and rng.random() < mv * 1.6:
            # fog participates in proportion to its local density: wisps, not a blanket
            ang, length, width, curl = ground_ang, (18 + 60 * mv) * (0.7 + 0.6 * rng.random()), 3, 0.02
            col = jc(np.clip(c * 1.05 + 0.02, 0, 1), dh=0.008, ds=0.02, dv=0.04, boost_s=0.8)
            col = col + (int(80 + 130 * mv),)
            dkr = tuple(int(v * 0.8) for v in col[:3]) + (int(50 * mv),)
            lit = tuple(min(255, int(v * 1.1)) for v in col[:3]) + (int(60 * mv),)
            ox, oy = light * 1.2
            curved_stroke(draw, x - ox, y - oy, ang, length, width + 1, dkr, W, H, curl)
            curved_stroke(draw, x, y, ang, length, width, col, W, H, curl)
            continue
        if r == 0:
            ang, length, width, curl = sky_ang, (30 + 26 * rng.random()) * R["sky_len"], 5, R["sky_curl"]
            col = jc(c, dh=0.02, ds=0.05, dv=0.06, boost_s=R["chroma"])
        elif r == 1:
            ang, length, width, curl = ground_ang, 26 + 18 * rng.random(), 5, 0.05
            col = jc(c, dh=0.015, ds=0.04, dv=0.05, boost_s=R["chroma"] * 0.87)
        else:
            if fmaskbig is not None and fmaskbig[y, x] > 0.5:
                coh = np.clip((cohbig[y, x] if cohbig is not None else 0.75) + R["coh_bias"], 0.05, 1.0)
                av = agebig[y, x] if agebig is not None else 0.0
                # coherence: disciplined coats stay long and aligned; unruly fringes jitter and shorten
                ang, curl = flowbig, 0.04 + (1 - coh) * 0.3
                length = (7 + 12 * rng.random()) * (0.6 + 0.6 * coh)
                width = 3 + (1 if av > 0.55 else 0)   # old bark: heavier strokes
                jit = rng.normal(0, (1 - coh) * 0.55)
                ang = flowbig + jit  # numpy broadcast: field + scalar jitter
                if av > 0.45 and rng.random() < av * 0.10:
                    # lichen: the years made visible
                    lc = (150 + int(rng.random() * 30), 158 + int(rng.random() * 26), 128 + int(rng.random() * 22), 165)
                    draw.ellipse([x - 3, y - 3, x + 3, y + 3], fill=lc)
            else:
                ang, length, width, curl = form, 12 + 10 * rng.random(), 4, 0.10
            col = jc(c, dh=0.018, ds=0.05, dv=0.07, boost_s=R["chroma"] * 0.96)
        if R["trespass"] and r == 2:
            home = None                      # ricorso: the world melts through its own boundaries
        if depth_scale_big is not None and r != 0:
            dsc = depth_scale_big[y, x]
            length *= dsc
            width = max(1, int(width * dsc))
        emv = embig[y, x] if embig is not None else 0.0
        if emv > 0.3:
            home = 7                       # emphasized pixels are their own protected region
            length *= 0.65
            width = max(1, width - 1)
            col = jc(arr[y, x], dh=0.008, ds=0.03, dv=0.03, boost_s=R["chroma"])
        if depth_scale_big is not None and r != 0:
            pass
        regmap = regbig_emph if embig is not None else (regbig if home is not None else None)
        # impasto: shadow underline, body, lit crest
        dkr = tuple(int(v * 0.55) for v in col[:3]) + (160,)
        lit = tuple(min(255, int(v * 1.45 + 22)) for v in col[:3]) + (170,)
        ox, oy = light * (width * 0.45)
        curved_stroke(draw, x - ox, y - oy, ang, length, width + 1, dkr, W, H, curl, region=regmap, home=home)
        curved_stroke(draw, x, y, ang, length, width, col + (235,), W, H, curl, region=regmap, home=home)
        curved_stroke(draw, x + ox, y + oy, ang, length * 0.8, max(1, width - 2), lit, W, H, curl, region=regmap, home=home)

    if stars:
        # emergent stars: a handful of SHORT BRIGHT strokes riding the same flow as everything
        # else, plus one soft warm dab — deviations in value, not interruptions in structure
        for (sfx, sfy) in stars:
            sxp, syp = W * sfx, H * sfy
            for _ in range(4 + int(rng.random() * 3)):
                jx = sxp + rng.normal(0, 7)
                jy = syp + rng.normal(0, 7)
                cc = (228 + int(rng.random() * 27), 226 + int(rng.random() * 24), 198 + int(rng.random() * 34), 220)
                curved_stroke(draw, jx, jy, sky_ang, 9 + rng.random() * 8, 3, cc, W, H, 0.2)
            draw.ellipse([sxp - 3.5, syp - 3.5, sxp + 3.5, syp + 3.5], fill=(248, 244, 222, 150))
            draw.ellipse([sxp - 1.8, syp - 1.8, sxp + 1.8, syp + 1.8], fill=(252, 250, 236, 235))
    return base.resize((w, h), Image.LANCZOS)


# ── MONET: broken color, lost edges, atmosphere ──────────────────────────────

def monet(img, region, nrm, w, h, rng, knobs=None, stock=None):
    K = dict(knobs or KNOBS)
    lost_sigma = 3 + (1 - K["edge"]) * 10          # edge: how far edges melt
    broken_p = 0.1 + K["chroma"] * 0.4             # chroma: broken-color probability
    dab_k = 0.7 + K["weight"] * 0.8                # weight: dab size
    S = 3
    W, H = w * S, h * S
    soft = Image.fromarray((img * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(5))
    arr = np.asarray(soft, dtype=F) / 255
    regbig = np.asarray(Image.fromarray(region.astype(np.uint8)).resize((W, H), Image.NEAREST))
    draw = ImageDraw.Draw(soft, "RGBA")
    lum = arr @ np.array([0.299, 0.587, 0.114], F)

    n = 9000
    xs = rng.integers(0, W, n)
    ys = rng.integers(0, H, n)
    for i in range(n):
        x, y = int(xs[i]), int(ys[i])
        # lost edges: sample color from a slightly displaced point (edges melt)
        sx = int(np.clip(x + rng.normal(0, lost_sigma), 0, W - 1))
        sy = int(np.clip(y + rng.normal(0, lost_sigma), 0, H - 1))
        c = arr[sy, sx]
        lt = lum[y, x]
        # broken color: cool lavender dabs in light, warm dabs in shadow
        if rng.random() < broken_p:
            shift = np.array([0.05, 0.02, 0.14]) if lt > 0.45 else np.array([0.10, 0.02, -0.05])
            c = np.clip(c + shift * (0.5 + rng.random()), 0, 1)
        col = jitter_color(pull_one(tuple(np.clip(c, 0, 1)), stock, K["pull"]), rng,
                           dh=0.03, ds=0.06, dv=0.05, boost_s=1.1)
        rx = (7 + 9 * rng.random() + (4 if regbig[y, x] == 0 else 0)) * dab_k
        ry = rx * (0.5 + 0.3 * rng.random())
        a = rng.random() * np.pi
        # a dab: small rotated ellipse via short fat line
        dx, dy = np.cos(a) * rx, np.sin(a) * rx
        draw.line([(x - dx, y - dy), (x + dx, y + dy)], fill=col + (215,), width=int(ry))
    out = np.asarray(soft, dtype=F) / 255
    # atmospheric glaze
    out = np.clip(out * 0.96 + np.array([0.045, 0.05, 0.08])[None, None], 0, 1)
    return Image.fromarray((out * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)


# ── PICASSO (analytic-cubist gesture): faceted planes, shifted, contoured ───

def picasso(img, region, nrm, w, h, rng, knobs=None, stock=None):
    K = dict(knobs or KNOBS)
    # edge binds INVERTED here: more assertion, more fracture — inverting boundary
    # logic is this engine's identity (CONTROL_PLANE 4.3)
    n_sites = 18 + int(K["edge"] * 60)
    # sites: subject silhouette + interior + a few in the field
    edge = (np.abs(np.diff(region.astype(F), axis=0, prepend=0)) + np.abs(np.diff(region.astype(F), axis=1, prepend=0))) > 0
    ey, ex = np.where(edge)
    idx = rng.choice(len(ex), size=min(22, len(ex)), replace=False)
    sy, sx = np.where(region == 2)
    idx2 = rng.choice(len(sx), size=min(10, len(sx)), replace=False)
    sites = np.array(
        [(ex[i], ey[i]) for i in idx] + [(sx[i], sy[i]) for i in idx2]
        + [(rng.integers(0, w), rng.integers(0, h)) for _ in range(n_sites - len(idx) - len(idx2))],
        dtype=F)
    yy, xx = np.mgrid[0:h, 0:w].astype(F)
    d = np.stack([np.sqrt((xx - s[0]) ** 2 + (yy - s[1]) ** 2) for s in sites], axis=0)
    near = np.argmin(d, axis=0)
    dsort = np.sort(d, axis=0)
    border = (dsort[1] - dsort[0]) < 1.6

    # muted analytic palette
    pal = np.array([[62, 52, 44], [104, 88, 66], [142, 122, 92], [176, 158, 124],
                    [96, 96, 92], [130, 134, 128], [180, 176, 160], [58, 62, 66]], F) / 255
    out = np.zeros((h, w, 3), F)
    for i in range(len(sites)):
        cell = near == i
        if not cell.any():
            continue
        shift = rng.integers(-9, 10, 2)
        ys2 = np.clip(yy[cell] + shift[1], 0, h - 1).astype(int)
        xs2 = np.clip(xx[cell] + shift[0], 0, w - 1).astype(int)
        mean_c = img[ys2, xs2].mean(axis=0)
        # snap to nearest palette tone but keep 35% of the true color
        pi = np.argmin(((pal - mean_c[None]) ** 2).sum(axis=1))
        cell_reg = region[int(sites[i][1]) if sites[i][1] < h else h - 1, int(sites[i][0]) if sites[i][0] < w else w - 1]
        keep = (0.4 + K["chroma"] * 0.6) if cell_reg == 2 else 0.25
        tone = pal[pi] * (1 - keep) + mean_c * keep
        if stock is not None and K["pull"] > 0:
            tone = np.array(pull_one(tuple(tone), stock, K["pull"]), F)
        grad = 0.85 + 0.3 * ((xx[cell] - sites[i][0]) / (w * 0.6))
        out[cell] = tone[None, :] * grad[:, None]
    out[border] *= 0.25
    # the subject's own contour survives the fracture (cubism fractures the object, not the world)
    se = (np.abs(np.diff((region == 2).astype(F), axis=0, prepend=0))
          + np.abs(np.diff((region == 2).astype(F), axis=1, prepend=0))) > 0
    out[se] = out[se] * 0.2
    # a few arbitrary analytic lines
    im = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))
    dr = ImageDraw.Draw(im)
    for _ in range(4):
        x0, y0 = rng.integers(0, w), rng.integers(0, h)
        a = rng.random() * np.pi
        L = h
        dr.line([(x0 - np.cos(a) * L, y0 - np.sin(a) * L), (x0 + np.cos(a) * L, y0 + np.sin(a) * L)],
                fill=(30, 28, 26), width=1)
    return im


# ── NATURALIST SKETCH: ink contours + tonal hatching on paper ────────────────

def sketch(img, region, nrm, w, h, rng, knobs=None, stock=None):
    K = dict(knobs or KNOBS)
    per_k = 1.4 - K["weight"] * 0.8                # weight: hatch density
    wob_amp = 4.0 * (1 - K["order"])               # order: pen steadiness
    S = 2
    W, H = w * S, h * S
    lum = np.asarray(Image.fromarray((((img @ np.array([0.299, 0.587, 0.114], F))) * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS), dtype=F) / 255
    regbig = np.asarray(Image.fromarray(region.astype(np.uint8)).resize((W, H), Image.NEAREST))

    paper = np.array([0.93, 0.89, 0.80], F)
    ink = np.array([0.24, 0.19, 0.14], F)
    fiber = value_noise(H, W, 3, rng) * 0.03
    out = paper[None, None] * (1 - fiber[..., None])

    yy, xx = np.mgrid[0:H, 0:W].astype(F)
    subj = regbig == 2

    def hatch(angle, period, duty):
        ph = (xx * np.cos(angle) + yy * np.sin(angle)) / (period * per_k)
        wob = value_noise(H, W, 30, rng) * wob_amp
        return ((ph + wob) % 1.0) < duty

    # tone bands (subject only): light→sparse, dark→cross-hatch
    t1 = subj & (lum < 0.62) & hatch(0.72, 7.0, 0.28)
    t2 = subj & (lum < 0.40) & hatch(0.72, 4.6, 0.34)
    t3 = subj & (lum < 0.22) & hatch(-0.72, 4.6, 0.34)
    gsh = (regbig == 1) & (lum < 0.5) & hatch(0.02, 8.0, 0.2)   # sparse ground ticks
    for m, a in ((t1, 0.55), (t2, 0.6), (t3, 0.7), (gsh, 0.35)):
        out = out * (1 - m[..., None] * a) + ink[None, None] * m[..., None] * a

    # contour: region boundaries traced with jittered pen passes
    e = (np.abs(np.diff(regbig.astype(F), axis=0, prepend=0)) + np.abs(np.diff(regbig.astype(F), axis=1, prepend=0))) > 0
    im = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))
    dr = ImageDraw.Draw(im, "RGBA")
    eyy, exx = np.where(e)
    order = np.argsort(eyy * W + exx)
    pts = list(zip(exx[order].tolist(), eyy[order].tolist()))
    inkt = tuple(int(v * 255) for v in ink)
    for (px, py) in pts[:: max(1, 3 - int(K["edge"] * 2))]:
        j = rng.normal(0, 0.7, 4)
        dr.line([(px + j[0] - 1, py + j[1]), (px + j[2] + 1, py + j[3])], fill=inkt + (200,), width=2)
    return im.resize((w, h), Image.LANCZOS)


# ── WATERCOLOR v2: layered glazes with a BOUNDARY-CLARITY knob ───────────────
#
# clarity ∈ [0,1] is the ONE knob: how much shapes keep their identity.
#   1.0 → glazed hard-edge watercolor: washes end where objects end, pigment pools in a
#         tight dark rim at the true boundary, thin reserved-paper lines separate objects.
#   0.0 → wet-in-wet: color is sampled through a displacement field so it bleeds across
#         boundaries, wash edges wander, rims soften, blooms multiply. Objects are implied.
# Emphasis is honored as LOCAL clarity: the emphasized thing stays crisp in a soft world.

def watercolor(img, region, nrm, w, h, rng, depth=None, emphasis=None, mat=None,
               knobs=None, stock=None, clarity=None):
    S = 2
    W, H = w * S, h * S
    K = dict(knobs or KNOBS)
    if clarity is not None:                       # back-compat: clarity was edge's maiden name
        K["edge"] = float(clarity)
    edge = float(np.clip(K["edge"], 0, 1))
    arr = np.stack([upN(img[..., i], W, H) for i in range(3)], axis=-1)
    regbig = np.asarray(Image.fromarray(region.astype(np.uint8)).resize((W, H), Image.NEAREST))
    matbig = np.asarray(Image.fromarray((mat if mat is not None else region).astype(np.uint8)).resize((W, H), Image.NEAREST))
    yy, xx = np.mgrid[0:H, 0:W].astype(F)

    # the wet plate: colors sampled through a displacement field — bleed grows as edge falls
    amp = 3.0 + (1.0 - edge) * 24.0
    dxf = (value_noise(H, W, 34, rng) - 0.5) * 2 * amp
    dyf = (value_noise(H, W, 41, rng) - 0.5) * 2 * amp
    embig = None
    if emphasis is not None and emphasis.max() > 0:
        embig = upN(emphasis, W, H, Image.NEAREST)
        # focus = how strongly the emphasized thing resists the bleed
        keep = np.clip(embig * (0.6 + 1.6 * K["focus"]), 0, 1)
        dxf *= (1 - keep)
        dyf *= (1 - keep)
    ys2 = np.clip(yy + dyf, 0, H - 1).astype(np.int32)
    xs2 = np.clip(xx + dxf, 0, W - 1).astype(np.int32)
    wet = arr[ys2, xs2]
    blur_r = 1.5 + (1.0 - edge) * 4.5
    wet = np.stack([np.asarray(Image.fromarray((wet[..., i] * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(blur_r)), dtype=F) / 255 for i in range(3)], axis=-1)
    hh, ss, vv = hsv_of(wet)
    wet = rgb_of(hh, np.clip(ss * (1.2 + K["chroma"] * 0.8), 0, 1), np.clip(vv * 1.06, 0, 1))
    if stock is not None and K["pull"] > 0:
        # pigments mix within the stock's gamut; accent unlocks where the stager pointed
        wet = pull_to_stock(wet, stock, K["pull"], roles=("core", "dark", "light"))
        if embig is not None and "accent" in stock:
            wet = pull_to_stock(wet, stock, K["pull"], roles=("accent",), gate=embig)
    raw_lum = wet @ np.array([0.299, 0.587, 0.114], F)
    # band on VIGNETTE-FLATTENED luminance or the washes chase the frame's oval, not the scene
    lum, vig = unbake_vignette(raw_lum, W)

    paper = np.array([0.965, 0.945, 0.895], F)
    fiber = value_noise(H, W, 3, rng)
    out = paper[None, None] * (1 - fiber[..., None] * 0.03)

    # the sky is ONE wash (banding a smooth gradient invents shapes that aren't there)
    skym = np.asarray(Image.fromarray(((regbig == 0) * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(1.5 + (1 - edge) * 3)), dtype=F) / 255
    sky_pig = 1 - (1 - wet) * 0.62
    out = out * (1 - skym[..., None] * 0.8) + out * sky_pig * skym[..., None] * 0.8

    # base wash over ALL land: everything gets pigment before the bands deepen it — bare
    # paper is a decision reserved for true highlights, never a gap in coverage
    gm = np.asarray(Image.fromarray(((regbig > 0) * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(1.2 + (1 - edge) * 2.5)), dtype=F) / 255
    base_pig = 1 - (1 - wet) * 0.52
    base_op = 0.65 + K["weight"] * 0.25
    out = out * (1 - gm[..., None] * base_op) + out * base_pig * gm[..., None] * base_op

    # GROUND: soft continuous glazes that follow the real value gradient. Thresholding a
    # smooth haze-lit ground invents contour-map amoebas; a ramp cannot.
    scene_l = lum[regbig > 0]
    g_bands = np.percentile(scene_l, (65, 38)) if scene_l.size else np.array((0.6, 0.4))
    for li, tcut in enumerate(g_bands):
        ramp = np.clip((tcut - lum) * 6.0, 0, 1) * (regbig > 0)
        ramp = np.asarray(Image.fromarray((ramp * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(1.5 + (1 - edge) * 2.0)), dtype=F) / 255
        pig = 1 - (1 - wet) * (0.58 + 0.12 * li)
        g_op = 0.5 + K["weight"] * 0.2
        out = out * (1 - ramp[..., None] * g_op) + out * pig * ramp[..., None] * g_op

    # SUBJECTS: banded, displaced, rim-pooled washes — structure is real there, so hard
    # wash edges carry information instead of inventing it
    subj_l = lum[regbig == 2]
    s_bands = np.percentile(subj_l, (72, 46, 22)) if subj_l.size else np.array((0.6, 0.42, 0.25))
    for li, tcut in enumerate(s_bands):
        m = ((lum < tcut) & (regbig == 2)).astype(F)
        edge_amp = 1.0 + (1.0 - edge) * 5.0 + (1.0 - K["order"]) * 4.0
        dd = (value_noise(H, W, 23 + 7 * li, rng) - 0.5) * 2 * edge_amp
        my = np.clip(yy + dd, 0, H - 1).astype(np.int32)
        mx_ = np.clip(xx + dd.T[:H, :W] if dd.T.shape == (H, W) else xx + dd, 0, W - 1).astype(np.int32)
        m = m[my, mx_]
        m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(1.0 + (1 - edge) * 2.5)), dtype=F) / 255
        wash = (m > 0.5).astype(F)
        pig = 1 - (1 - wet) * (0.42 + K["weight"] * 0.16 + 0.13 * li)   # deeper bands glaze darker
        s_op = 0.6 + K["weight"] * 0.2
        out = out * (1 - wash[..., None] * s_op) + out * pig * wash[..., None] * s_op
        # pigment pools at the wash edge: tight and dark when crisp, soft when wet
        pool_px = int(3 + edge * 4) | 1
        inner = np.asarray(Image.fromarray((wash * 255).astype(np.uint8)).filter(
            ImageFilter.MinFilter(pool_px)), dtype=F) / 255
        rim = np.clip(wash - inner, 0, 1)
        out *= 1 - rim[..., None] * (0.06 + edge * 0.16)

    # object boundaries: at high clarity the paper shows through in a thin reserved line
    if edge > 0.35:
        bound = (np.abs(np.diff(regbig.astype(F), axis=0, prepend=0))
                 + np.abs(np.diff(regbig.astype(F), axis=1, prepend=0))
                 + np.abs(np.diff(matbig, axis=0, prepend=0))
                 + np.abs(np.diff(matbig, axis=1, prepend=0))) > 0
        bnd = np.asarray(Image.fromarray((bound * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(0.6)), dtype=F) / 255
        res = np.clip(bnd * (edge - 0.35) / 0.65, 0, 1) * 0.5
        out = out * (1 - res[..., None]) + paper[None, None] * res[..., None]

    # depth dilution: the far city thins toward the paper (watercolor's own aerial perspective)
    if depth is not None:
        d = np.where(depth > 1e5, np.nan, depth)
        if (region > 0).any():
            d_ref = np.nanpercentile(d[region > 0], 25)
            dil = np.clip(1 - d_ref / np.maximum(np.nan_to_num(d, nan=d_ref), 1e-3), 0, 1) * 0.35
            dilbig = upN(dil, W, H)
            out = out * (1 - dilbig[..., None]) + paper[None, None] * dilbig[..., None] * 0.985

    # reserved paper for TRUE highlights — adaptive: only the scene's top few percent may
    # reserve, or a bright haze-lit foreground turns into acres of white amoeba
    hi_t = max(0.84, float(np.percentile(raw_lum, 96.5)))
    hi = np.asarray(Image.fromarray(((raw_lum > hi_t) * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(2.5)), dtype=F) / 255
    out = out * (1 - hi[..., None] * 0.9) + paper[None, None] * hi[..., None] * 0.9

    # subjects keep their identity: one true-color glaze so figures don't dissolve into bands
    subj = np.asarray(Image.fromarray(((regbig == 2) * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(1.2)), dtype=F) / 255
    sg = subj[..., None] * (0.3 + 0.25 * edge)
    out = out * (1 - sg) + out * (1 - (1 - arr) * 0.7) * sg

    # granulation settles into the darks; blooms multiply as the sheet gets wetter
    gran = value_noise(H, W, 2, rng)
    out *= 1 - (gran[..., None] - 0.5) * np.clip(0.55 - lum, 0, 1)[..., None] * 0.22
    sub_ys, sub_xs = np.where(regbig > 0)
    if len(sub_xs):
        for _ in range(2 + int((1 - K["order"]) * 7)):
            bi = rng.integers(0, len(sub_xs))
            bx, by, br = int(sub_xs[bi]), int(sub_ys[bi]), 12 + rng.random() * 34
            d2 = np.sqrt((xx - bx) ** 2 + (yy - by) ** 2)
            ring = np.exp(-((d2 - br) / 5.0) ** 2) * 0.09
            core = np.clip(1 - d2 / br, 0, 1) * 0.07
            out = np.clip(out + core[..., None] - ring[..., None] * 0.55, 0, 1)
    if embig is not None:
        # the focused thing gets one extra true-color glaze — crisp in the soft world
        gl = np.clip(embig, 0, 1)[..., None] * (0.25 + K["focus"] * 0.35)
        out = out * (1 - gl) + out * (1 - (1 - arr) * 0.55) * gl
    # re-apply the frame mood gently — a watercolor page carries its vignette in dilution
    out *= (1 + (vig[..., None] - 1) * 0.35)
    out = np.clip(out, 0, 1)
    return Image.fromarray((out * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)


# ── COMIC: cel-quantized color, depth-weighted ink, a FOCUS knob ─────────────
#
# focus ∈ [0,1] is the ONE knob: how strongly the frame grades attention.
#   0.0 → flat democracy: everything equally saturated and lit, an even Sunday-strip page.
#   1.0 → hard cinematic grade: the focused subject holds full chroma and value while the
#         rest of the frame desaturates toward a muted key and compresses toward mid-tone;
#         Ben-Day dots creep into the unfocused shadows.
# The focus FIELD comes from the emphasis buffer when the stager set one; otherwise the
# subject region (blurred) stands in — subjects focused, world behind them graded down.

def comic(img, region, nrm, w, h, rng, depth=None, emphasis=None, mat=None,
          knobs=None, stock=None, focus=None):
    S = 2
    W, H = w * S, h * S
    K = dict(knobs or KNOBS)
    if focus is not None:                          # back-compat: focus predates the knob dict
        K["focus"] = float(focus)
    focus = float(np.clip(K["focus"], 0, 1))
    arr = np.stack([upN(img[..., i], W, H) for i in range(3)], axis=-1)
    # flatten local texture so the quantization reads as CELS, not noise
    arr = np.stack([np.asarray(Image.fromarray((arr[..., i] * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(2.2)), dtype=F) / 255 for i in range(3)], axis=-1)
    regbig = np.asarray(Image.fromarray(region.astype(np.uint8)).resize((W, H), Image.NEAREST))
    matbig = np.asarray(Image.fromarray((mat if mat is not None else region).astype(np.uint8)).resize((W, H), Image.NEAREST))
    nrmbig = np.stack([upN(nrm[..., i], W, H, lo=-1.0, hi=1.0) for i in range(3)], axis=-1)

    # cel quantization: value snaps to bands, saturation to three chips, hue survives intact.
    # Quantize VIGNETTE-FLATTENED value or the frame's oval becomes a hard grey cel.
    hh, ss, vv = hsv_of(arr)
    vflat, vig = unbake_vignette(vv, W)
    # invariant #9: the value read stretches to the scene's own percentiles. Self-gating:
    # a hazy compressed scene gets its contrast back; a noir scene (already wide) is ~unmoved
    p5, p95 = np.percentile(vflat, (5, 95))
    vflat = np.clip((vflat - p5) / max(p95 - p5, 0.05), 0, 1) * 0.92 + 0.04
    nb = 3 + int(round((1 - K["weight"]) * 3))          # weight: chunkier cels = fewer bands
    v_edges = np.linspace(0.15, 0.90, nb - 1).astype(F)
    v_mids = np.linspace(0.10, 0.96, nb).astype(F)
    # invariant #8, comic dialect: a band edge crossing a SMOOTH field (a road, a floor)
    # becomes a wandering amoeba. The printed answer is a screentone gradient — dither the
    # threshold in smooth areas so the cel break dissolves into stipple; hard edges stay
    # hard exactly where the scene has real structure.
    gmag = np.abs(np.diff(vflat, axis=0, prepend=0)) + np.abs(np.diff(vflat, axis=1, prepend=0))
    gmag = np.asarray(Image.fromarray((np.clip(gmag * 30, 0, 1) * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(5)), dtype=F) / 255
    smoothw = np.clip(1 - gmag * 2.2, 0, 1)
    span = float(v_mids[1] - v_mids[0]) if nb > 1 else 0.2
    dn = (value_noise(H, W, 2, rng) - 0.5) * span * 0.6
    vq = v_mids[np.digitize(vflat + dn * smoothw * (regbig > 0), v_edges)]
    # the sky is ONE cel: banding a smooth gradient leaves a jagged quantization seam where
    # the vignette estimate under-corrects the corners
    if (regbig == 0).any():
        sky_chip = v_mids[np.digitize(np.median(vflat[regbig == 0]), v_edges)]
        vq = np.where(regbig == 0, sky_chip, vq)
    vq_scene = vq.copy()                       # pre-grade scene bands: true shadows live here
    chips = 2 + int(round(K["chroma"] * 3))            # chroma: 2..5 saturation chips + boost
    sq = np.round(np.clip(ss * (1.1 + K["chroma"] * 0.5), 0, 1) * (chips - 1)) / (chips - 1)
    # the focus field
    if emphasis is not None and emphasis.max() > 0:
        fld = upN(emphasis, W, H, Image.NEAREST)
        fld = np.asarray(Image.fromarray((np.clip(fld, 0, 1) * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(6)), dtype=F) / 255
    else:
        fld = np.asarray(Image.fromarray(((regbig == 2) * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(18)), dtype=F) / 255
    fld = np.clip(fld * 1.5, 0, 1)
    # the grade: unfocused loses chroma and compresses toward the page's mid-grey key
    lose = focus * (1 - fld)
    sq = sq * (1 - 0.72 * lose)
    vq = vq * (1 - lose) + (0.58 + (vq - 0.58) * 0.55) * lose
    # focused pops: one saturation chip up, a touch of light
    sq = np.clip(sq + fld * focus * 0.18, 0, 1)
    vq = np.clip(vq + fld * focus * 0.06, 0, 1)
    out = rgb_of(hh, sq, vq)

    # ink: depth discontinuities + silhouette + material seams + normal creases
    ink = np.zeros((H, W), bool)
    ink |= (np.abs(np.diff(regbig.astype(F), axis=0, prepend=0))
            + np.abs(np.diff(regbig.astype(F), axis=1, prepend=0))) > 0
    if K["edge"] > 0.25:                                # material-seam ink is an edge assertion
        ink |= (np.abs(np.diff(matbig, axis=0, prepend=0))
                + np.abs(np.diff(matbig, axis=1, prepend=0))) > 0.5
    dbig = None
    if depth is not None:
        d = np.where(depth > 1e5, np.nan, depth)
        d_ref = np.nanpercentile(d[region > 0], 25) if (region > 0).any() else 10.0
        dn = np.nan_to_num(d, nan=float(np.nanmax(d)) if np.isfinite(np.nanmax(d)) else 1e4)
        dbig = upN(np.clip(dn / (d_ref * 8), 0, 1), W, H)
        gy = np.abs(np.diff(dbig, axis=0, prepend=0))
        gx = np.abs(np.diff(dbig, axis=1, prepend=0))
        ink |= ((gy + gx) > 0.015) & (regbig > 0)
    ncre = 1 - np.clip((nrmbig[2:, :, :] * nrmbig[:-2, :, :]).sum(-1), -1, 1)
    crease = np.zeros((H, W), F)
    crease[1:-1] = ncre
    ink |= (crease > (0.75 - K["edge"] * 0.4)) & (regbig == 2)
    # line weight follows nearness: the close world is drawn heavier
    inkim = Image.fromarray((ink * 255).astype(np.uint8))
    heavy = np.asarray(inkim.filter(ImageFilter.MaxFilter(3)), dtype=bool)
    if dbig is not None:
        near = dbig < 0.10
        ink = np.where(near, heavy, ink)
    else:
        ink = heavy
    ink_f = np.asarray(Image.fromarray((ink * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(0.5)), dtype=F) / 255
    if K["order"] < 0.6:                                # low order: the print slips register
        slip = (1 - K["order"]) * 2.5 * S / 2
        ink_f = np.roll(ink_f, (int(rng.integers(-slip, slip + 1)),
                                int(rng.integers(-slip, slip + 1))), axis=(0, 1))
    if stock is not None and K["pull"] > 0:
        # the chips pull to the stock — literal screen-print inks at pull=1
        out = pull_to_stock(out, stock, K["pull"], roles=("core", "dark", "light"))
        if "accent" in stock:
            out = pull_to_stock(out, stock, K["pull"], roles=("accent",), gate=fld * focus)
    ink_alpha = min(0.95, 0.6 + K["edge"] * 0.45)
    INK = np.array([0.105, 0.09, 0.085], F)
    out = out * (1 - ink_f[..., None] * ink_alpha) + INK[None, None] * ink_f[..., None] * ink_alpha

    # Ben-Day dots settle into the UNFOCUSED shadows — the grade made printable
    if focus > 0.15:
        period = 7
        dotmask = (((np.mgrid[0:H, 0:W][0] % period) - period / 2) ** 2
                   + ((np.mgrid[0:H, 0:W][1] % period) - period / 2) ** 2) < (period * 0.30) ** 2
        shadow = (vq_scene < 0.3) & (fld < 0.4) & (regbig > 0)
        dots = dotmask & shadow
        out = np.where(dots[..., None], out * 0.72, out)

    # the frame mood returns as a soft printed grade, not a quantized shape
    out = np.clip(out * 1.05, 0, 1) * (1 + (vig[..., None] - 1) * 0.3)
    out = np.clip(out, 0, 1)
    return Image.fromarray((out * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)


# ── STAGELIGHT: concert light on a void — light does the drawing ─────────────
#
# Born from the Byrne deck (Stop Making Sense / American Utopia): a body in hard stage
# light against blackness. No ink, no washes — the image is MADE of light: posterized
# light bands on the subject, a followspot pool on the floor, the stock's accent as the
# gel, beams in the haze when focus runs high. The void is a color too.

def stagelight(img, region, nrm, w, h, rng, depth=None, emphasis=None, mat=None,
               knobs=None, stock=None):
    S = 2
    W, H = w * S, h * S
    K = dict(knobs or KNOBS)
    arr = np.stack([upN(img[..., i], W, H) for i in range(3)], axis=-1)
    regbig = np.asarray(Image.fromarray(region.astype(np.uint8)).resize((W, H), Image.NEAREST))
    yy, xx = np.mgrid[0:H, 0:W].astype(F)

    hh, ss, vv = hsv_of(arr)
    vflat, vig = unbake_vignette(vv, W)

    # the gel: the stock's first accent pigment tints the light itself
    gel = np.array(stock["accent"][0], F) if (stock and stock.get("accent")) else np.array([0.55, 0.65, 0.9], F)
    gel_amt = 0.15 + K["chroma"] * 0.45

    # light bands on the subject: weight = chunkier (fewer) bands; edge = terminator hardness
    nb = 6 - int(round(K["weight"] * 3))
    v_mids = np.linspace(0.06, 1.0, nb).astype(F)
    v_edges = ((v_mids[:-1] + v_mids[1:]) / 2).astype(F)
    vq = v_mids[np.digitize(vflat, v_edges)]
    vband = vflat * (1 - K["edge"]) + vq * K["edge"]           # knife-edge terminator at 1.0

    # the focus field: who the followspot loves
    if emphasis is not None and emphasis.max() > 0:
        fld = np.asarray(Image.fromarray((np.clip(upN(emphasis, W, H, Image.NEAREST), 0, 1)
                                          * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(8)), dtype=F) / 255
    else:
        fld = np.asarray(Image.fromarray(((regbig == 2) * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(16)), dtype=F) / 255
    fld = np.clip(fld * 1.5, 0, 1)

    # assemble by region: subject in banded light, ground crushed, sky = the void
    lift = 1.0 + fld * K["focus"] * 0.9                        # the loved one is LIT
    subj_v = np.clip(vband * lift, 0, 1.08)
    ground_v = np.clip(vband * (0.16 + 0.2 * (1 - K["focus"])), 0, 1)
    void_v = np.clip(vflat * 0.05 + 0.015, 0, 1)
    v_out = np.where(regbig == 2, subj_v, np.where(regbig == 1, ground_v, void_v))
    s_out = np.clip(ss * (0.5 + K["chroma"] * 0.6), 0, 1) * np.where(regbig == 0, 0.3, 1.0)
    out = rgb_of(hh, s_out.astype(F), np.clip(v_out, 0, 1).astype(F))
    # gel the lit side: tint scales with how lit a pixel is
    out = out * (1 - gel_amt * v_out[..., None]) + gel[None, None] * gel_amt * v_out[..., None] * (0.4 + 0.6 * out)

    # the followspot pool on the floor, under the subject
    subj_ys, subj_xs = np.where(regbig == 2)
    if len(subj_xs):
        cx = float(subj_xs.mean())
        yb = float(np.percentile(subj_ys, 97))
        rx, ry = (subj_xs.max() - subj_xs.min()) * 1.4 + 30, H * 0.06
        pool = np.exp(-((xx - cx) / rx) ** 2 - ((yy - yb - ry * 0.4) / ry) ** 2)
        pool = pool * (regbig == 1) * (0.25 + K["focus"] * 0.3)
        out = np.clip(out + gel[None, None] * pool[..., None] * 0.7
                      + np.array([1.0, 1.0, 1.0], F)[None, None] * pool[..., None] * 0.25, 0, 1.1)
        # beams: two soft shafts converging on the subject when the followspot commits
        if K["focus"] > 0.5 and len(subj_ys):
            ct = float(np.percentile(subj_ys, 15))
            for bx in (W * 0.12, W * 0.88):
                t = np.clip((yy / max(ct, 1.0)), 0, 1)
                axis_x = bx + (cx - bx) * t
                hw = 14 + t * (rx * 0.5)
                beam = np.exp(-((xx - axis_x) / hw) ** 2) * (1 - t * 0.55) * (yy < yb)
                out = np.clip(out + (gel * 0.55 + 0.25)[None, None]
                              * beam[..., None] * 0.10 * (K["focus"] - 0.4), 0, 1.1)

    # order: the film the concert was shot on — grain and a whisper of scanline
    disorder = 1 - K["order"]
    if disorder > 0.05:
        grain = (value_noise(H, W, 2, rng) - 0.5) * 0.10 * disorder
        scan = (np.sin(yy * np.pi / 2.0) * 0.5 + 0.5) * 0.05 * disorder
        out = np.clip(out + grain[..., None] - scan[..., None], 0, 1.1)

    if stock is not None and K["pull"] > 0:
        out = np.clip(out, 0, 1)
        out = pull_to_stock(out, stock, K["pull"] * 0.7, roles=("core", "dark", "light"))

    # the frame's own darkness returns; the void eats the corners willingly
    out = np.clip(out, 0, 1) * (1 + (vig[..., None] - 1) * 0.5)
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)


# ── SCREENPRINT: the gig poster — the stock IS the ink set ───────────────────
#
# Born from the Byrne deck's other lineage: hand-pulled concert posters. Unlike every
# other engine, the stock here is not a gravity well but the LITERAL ink set: each pixel
# is assigned to its nearest ink and printed flat. order = registration (layers slip at
# low order); weight = ink coverage (dark separations fatten); edge = boundary crispness
# (a loose pull vs a tight one); focus gates the accent ink to where the stager pointed;
# chroma boosts the color read before assignment. Smooth fields dither into halftone
# instead of growing amoebas (invariant #8, print dialect).

def screenprint(img, region, nrm, w, h, rng, depth=None, emphasis=None, mat=None,
                knobs=None, stock=None):
    S = 2
    W, H = w * S, h * S
    K = dict(knobs or KNOBS)
    arr = np.stack([upN(img[..., i], W, H) for i in range(3)], axis=-1)
    arr = np.stack([np.asarray(Image.fromarray((arr[..., i] * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(1.8)), dtype=F) / 255 for i in range(3)], axis=-1)
    regbig = np.asarray(Image.fromarray(region.astype(np.uint8)).resize((W, H), Image.NEAREST))

    hh, ss, vv = hsv_of(arr)
    vflat, vig = unbake_vignette(vv, W)

    if stock is None:
        stock = {"core": [(0.35, 0.38, 0.42), (0.62, 0.58, 0.52)],
                 "accent": [(0.82, 0.28, 0.20)], "dark": [(0.12, 0.12, 0.14)],
                 "light": [(0.93, 0.91, 0.86)]}
    paper = np.array(stock.get("light", [(0.94, 0.92, 0.88)])[0], F)
    inks = [np.array(p, F) for r in ("core", "accent", "dark") for p in stock.get(r, [])]
    accent_start = len(stock.get("core", []))
    accent_n = len(stock.get("accent", []))

    # the color each pixel ASKS for: flattened value, boosted chroma
    ask = rgb_of(hh, np.clip(ss * (1.0 + K["chroma"] * 0.8), 0, 1), vflat)
    lab = _srgb_to_oklab(ask)
    ilab = _srgb_to_oklab(np.array(inks + [tuple(paper)], F))     # paper is a "print nothing"
    d2 = ((lab[..., None, 1] - ilab[None, None, :, 1]) ** 2
          + (lab[..., None, 2] - ilab[None, None, :, 2]) ** 2
          + 1.6 * (lab[..., None, 0] - ilab[None, None, :, 0]) ** 2)
    order2 = np.argsort(d2, axis=-1)
    assign = order2[..., 0]
    second = order2[..., 1]
    # focus gates the accent inks: off-focus pixels asking for accent get their runner-up
    if accent_n and emphasis is not None and emphasis.max() > 0:
        fld = np.asarray(Image.fromarray((np.clip(upN(emphasis, W, H, Image.NEAREST), 0, 1)
                                          * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(8)), dtype=F) / 255
        is_accent = (assign >= accent_start) & (assign < accent_start + accent_n)
        assign = np.where(is_accent & (fld * (0.4 + K["focus"]) < 0.35), second, assign)

    # invariant #8, print dialect: halftone ONLY where the assignment is genuinely
    # AMBIGUOUS (top two inks nearly tie) and the field is smooth — a boundary zone
    # dissolves into dither; a solid area stays a solid pull
    df = np.take_along_axis(d2, order2[..., :1], axis=-1)[..., 0]
    ds = np.take_along_axis(d2, order2[..., 1:2], axis=-1)[..., 0]
    ambig = df > ds * 0.55
    gmag = np.abs(np.diff(vflat, axis=0, prepend=0)) + np.abs(np.diff(vflat, axis=1, prepend=0))
    gmag = np.asarray(Image.fromarray((np.clip(gmag * 30, 0, 1) * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(5)), dtype=F) / 255
    smoothw = np.clip(1 - gmag * 2.2, 0, 1)
    dn = value_noise(H, W, 2, rng)
    flip = ambig & (dn > 0.55) & (smoothw > 0.4)
    assign = np.where(flip, second, assign)

    fiber = value_noise(H, W, 3, rng)
    out = paper[None, None] * (1 - fiber[..., None] * 0.05)
    ink_order = sorted(range(len(inks)), key=lambda i: -float(inks[i].mean()))  # light→dark
    for i in ink_order:
        m = (assign == i).astype(F)
        if K["weight"] > 0.55 and float(inks[i].mean()) < 0.35:
            px = int((K["weight"] - 0.55) * 6) * 2 + 3
            m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(
                ImageFilter.MaxFilter(px)), dtype=F) / 255      # heavy pulls flood the darks
        m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(0.6 + (1 - K["edge"]) * 2.4)), dtype=F) / 255
        m = (m > 0.5).astype(F)
        slip = (1 - K["order"]) * 5.0
        m = np.roll(m, (int(rng.integers(-slip, slip + 1)), int(rng.integers(-slip, slip + 1))),
                    axis=(0, 1))
        # true overprint: ink multiplies the paper (and prior inks) like real translucent pulls
        out = out * (1 - m[..., None] * 0.88) + (out * inks[i][None, None]
                                                 * 1.12) * m[..., None] * 0.88
    out = np.clip(out, 0, 1) * (1 + (vig[..., None] - 1) * 0.2)
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)



# ── THE SUIT ENGINES: what the minor arcana yearn for ────────────────────────
# Suit → engine + stock; rank → knobs; station → light rig (set at stage time).
# blueprint = Structures ("architectural drawings, precise lines, measured spaces")
# linocut   = Rivers     ("loops and spirals, repetitive structures, earth tones")
# cutout    = Curiosity  ("bright optimistic paper, infographics that invite")
# chrono    = Dance      ("motion blur, layered choreography, heat visible")


def blueprint(img, region, nrm, w, h, rng, depth=None, emphasis=None, mat=None,
              knobs=None, stock=None):
    """White line-work on the drafting blue: edges become drawn lines, shadow becomes
    hatching, the world gets a graph grid and a title block. edge = line presence;
    weight = hatch density; order = drafting steadiness (CAD vs hand); chroma = cyan
    of the ground; focus = the surveyed object bright, context dimmed."""
    S = 2
    W, H = w * S, h * S
    K = dict(knobs or KNOBS)
    arr = np.stack([upN(img[..., i], W, H) for i in range(3)], axis=-1)
    regbig = np.asarray(Image.fromarray(region.astype(np.uint8)).resize((W, H), Image.NEAREST))
    matbig = np.asarray(Image.fromarray((mat if mat is not None else region).astype(np.uint8)).resize((W, H), Image.NEAREST))
    nrmbig = np.stack([upN(nrm[..., i], W, H, lo=-1.0, hi=1.0) for i in range(3)], axis=-1)
    lum = arr @ np.array([0.299, 0.587, 0.114], F)

    ground = np.array(stock["dark"][0], F) if (stock and stock.get("dark")) else np.array([0.07, 0.13, 0.30], F)
    ground = ground * (1 - K["chroma"] * 0.3) + np.array([0.05, 0.12, 0.38], F) * (K["chroma"] * 0.3)
    line = np.array(stock["light"][0], F) if (stock and stock.get("light")) else np.array([0.86, 0.93, 0.97], F)

    yy, xx = np.mgrid[0:H, 0:W].astype(F)
    out = ground[None, None] * (1 - value_noise(H, W, 3, rng)[..., None] * 0.06)
    for period, a in ((14, 0.05), (70, 0.11)):
        gl = ((xx % period) < 1.0) | ((yy % period) < 1.0)
        out = out * (1 - gl[..., None] * a) + line[None, None] * gl[..., None] * a

    # drawn lines: silhouettes, material seams, depth steps, creases (the comic sources)
    ink = np.zeros((H, W), bool)
    ink |= (np.abs(np.diff(regbig.astype(F), axis=0, prepend=0))
            + np.abs(np.diff(regbig.astype(F), axis=1, prepend=0))) > 0
    ink |= (np.abs(np.diff(matbig, axis=0, prepend=0))
            + np.abs(np.diff(matbig, axis=1, prepend=0))) > 0.5
    if depth is not None:
        d = np.where(depth > 1e5, np.nan, depth)
        dmax = float(np.nanmax(d)) if np.isfinite(np.nanmax(d)) else 1e4
        dn = np.nan_to_num(d, nan=dmax)
        dref = np.nanpercentile(d[region > 0], 60) if (region > 0).any() else 10.0
        dbig = upN(np.clip(dn / dref / 4, 0, 1), W, H)
        ink |= ((np.abs(np.diff(dbig, axis=0, prepend=0))
                 + np.abs(np.diff(dbig, axis=1, prepend=0))) > 0.02) & (regbig > 0)
    ncre = 1 - np.clip((nrmbig[2:, :, :] * nrmbig[:-2, :, :]).sum(-1), -1, 1)
    crease = np.zeros((H, W), F)
    crease[1:-1] = ncre
    ink |= (crease > 0.5) & (regbig == 2)
    if K["order"] < 0.75:                       # hand drafting: the pen breathes
        wob = (value_noise(H, W, 6, rng) - 0.5) * (1 - K["order"]) * 3.0
        my = np.clip(yy + wob, 0, H - 1).astype(np.int32)
        mx_ = np.clip(xx + (wob.T[:H, :W] if wob.T.shape == (H, W) else wob), 0, W - 1).astype(np.int32)
        ink = ink[my, mx_]
    ink_f = np.asarray(Image.fromarray((ink * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(0.5)), dtype=F) / 255

    # hatching where the render is in shadow — measured, diagonal
    ph = (xx * 0.707 + yy * 0.707) / (9.0 - K["weight"] * 3.0)
    hatch = ((ph % 1.0) < 0.16) & (lum < 0.42) & (regbig > 0)
    hatch_f = hatch.astype(F) * 0.4

    lvl = np.clip(ink_f * (0.5 + K["edge"] * 0.6) + hatch_f, 0, 1)
    if emphasis is not None and emphasis.max() > 0:
        fld = np.clip(upN(emphasis, W, H, Image.NEAREST) * 1.4, 0, 1)
        lvl *= (0.45 + 0.55 * np.clip(fld + (1 - K["focus"]), 0, 1))
    out = out * (1 - lvl[..., None]) + line[None, None] * lvl[..., None]

    # drafting furniture: margin frame + an empty title block
    fr = (((xx > W * 0.03) & (xx < W * 0.032)) | ((xx > W * 0.968) & (xx < W * 0.97))
          | ((yy > H * 0.02) & (yy < H * 0.023)) | ((yy > H * 0.977) & (yy < H * 0.98)))
    tbx = (xx > W * 0.62) & (xx < W * 0.968) & (yy > H * 0.9) & (yy < H * 0.977)
    tb_edge = tbx & (((xx < W * 0.627) | (xx > W * 0.961))
                     | ((yy < H * 0.906) | (yy > H * 0.971))
                     | ((yy > H * 0.935) & (yy < H * 0.939)))
    furn = fr | tb_edge
    out = out * (1 - furn[..., None] * 0.8) + line[None, None] * furn[..., None] * 0.8
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)


def linocut(img, region, nrm, w, h, rng, depth=None, emphasis=None, mat=None,
            knobs=None, stock=None):
    """Carved ink: solids in the darks, paper in the lights, and in between —
    parallel gouge lines riding the CONTOURS of the form (the rhythm made visible).
    weight = gouge thickness/density; order = the carver's hand; edge = block-edge
    crispness; chroma routes high-chroma midtones to the accent block."""
    S = 2
    W, H = w * S, h * S
    K = dict(knobs or KNOBS)
    arr = np.stack([upN(img[..., i], W, H) for i in range(3)], axis=-1)
    regbig = np.asarray(Image.fromarray(region.astype(np.uint8)).resize((W, H), Image.NEAREST))
    hh, ss, vv = hsv_of(arr)
    vflat, vig = unbake_vignette(vv, W)
    vs = np.asarray(Image.fromarray((np.clip(vflat, 0, 1) * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(2.5 + (1 - K["edge"]) * 3)), dtype=F) / 255

    paper = np.array(stock["light"][0], F) if (stock and stock.get("light")) else np.array([0.93, 0.89, 0.8], F)
    ink = np.array(stock["dark"][0], F) if (stock and stock.get("dark")) else np.array([0.16, 0.11, 0.09], F)
    accent = np.array(stock["accent"][0], F) if (stock and stock.get("accent")) else None

    sel = vs[regbig > 0] if (regbig > 0).any() else vs.ravel()
    t_dark, t_light = np.percentile(sel, (22, 80))
    fiber = value_noise(H, W, 3, rng)
    base = Image.fromarray((np.clip(paper[None, None] * (1 - fiber[..., None] * 0.05), 0, 1)
                            * 255).astype(np.uint8))
    draw = ImageDraw.Draw(base, "RGBA")

    solid = (vs < t_dark) & (regbig > 0)
    solid_f = np.asarray(Image.fromarray((solid * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(1.0)), dtype=F) / 255
    solid_m = solid_f > 0.5

    gy, gx = np.gradient(vs)
    cont = np.arctan2(gy, gx) + np.pi / 2
    mid = (vs >= t_dark) & (vs < t_light) & (regbig > 0)
    ys_, xs_ = np.where(mid)
    inkt = tuple(int(v * 255) for v in ink)
    acct = tuple(int(v * 255) for v in accent) if accent is not None else inkt
    n = min(9000, len(xs_) * 2)
    if len(xs_):
        idx = rng.integers(0, len(xs_), n)
        for i in idx:
            x, y = int(xs_[i]), int(ys_[i])
            dark = (t_light - vs[y, x]) / max(t_light - t_dark, 1e-3)
            if rng.random() > 0.25 + dark * 0.75:
                continue
            length = (9 + 13 * dark) * (0.7 + K["weight"] * 0.6)
            width = max(2, int(1 + dark * 2.4 + K["weight"] * 1.6))
            jit = rng.normal(0, (1 - K["order"]) * 0.5)
            col = acct if (K["chroma"] > 0.25 and ss[y, x] > 0.33 and accent is not None) else inkt
            curved_stroke(draw, x, y, cont + jit, length, width, col + (235,), W, H, 0.06)

    out = np.asarray(base, dtype=F) / 255
    out = out * (1 - solid_m[..., None]) + ink[None, None] * solid_m[..., None]
    out = np.clip(out * (1 - (value_noise(H, W, 2, rng)[..., None] - 0.5)
                         * solid_m[..., None] * 0.12), 0, 1)
    out = out * (1 + (vig[..., None] - 1) * 0.25)
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)


def cutout(img, region, nrm, w, h, rng, depth=None, emphasis=None, mat=None,
           knobs=None, stock=None):
    """Paper shapes with scissors and glue: big flat pieces in the stock's colors,
    every piece casting a small honest shadow (the paper has THICKNESS). edge = cut
    vs torn; weight = piece size; order = the gluer's neatness (shadow drift);
    focus sizes the shadows (lifted paper)."""
    S = 2
    W, H = w * S, h * S
    K = dict(knobs or KNOBS)
    arr = np.stack([upN(img[..., i], W, H) for i in range(3)], axis=-1)
    blur_r = 4.0 + K["weight"] * 9.0
    arr = np.stack([np.asarray(Image.fromarray((arr[..., i] * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(blur_r)), dtype=F) / 255 for i in range(3)], axis=-1)
    hh, ss, vv = hsv_of(arr)
    vflat, vig = unbake_vignette(vv, W)
    # invariant #9 for paper: stretch value to the scene's own percentiles, or a dark
    # stage maps every pixel to the black paper and the collage is one sheet
    p5, p95 = np.percentile(vflat, (5, 95))
    vflat = np.clip((vflat - p5) / max(p95 - p5, 0.05), 0, 1) * 0.85 + 0.08
    ask = rgb_of(hh, np.clip(ss * (1.1 + K["chroma"] * 0.7), 0, 1), vflat)

    if stock is None:
        stock = {"core": [(0.85, 0.66, 0.16), (0.29, 0.54, 0.78), (0.33, 0.63, 0.38)],
                 "accent": [(0.82, 0.36, 0.24)], "dark": [(0.2, 0.22, 0.26)],
                 "light": [(0.94, 0.92, 0.85)]}
    papers = [np.array(p, F) for r in ("light", "core", "accent", "dark") for p in stock.get(r, [])]
    lab = _srgb_to_oklab(ask)
    plab = _srgb_to_oklab(np.array(papers, F))
    d2 = ((lab[..., None, 1] - plab[None, None, :, 1]) ** 2
          + (lab[..., None, 2] - plab[None, None, :, 2]) ** 2
          + 1.3 * (lab[..., None, 0] - plab[None, None, :, 0]) ** 2)
    assign = np.argmin(d2, axis=-1)

    # a paper piece has ONE color — and the material buffer knows where the pieces are.
    # Subject parts vote as wholes (median ask → nearest paper); sky and ground stay
    # per-pixel (their gradients already blur into big blobs).
    regbig = np.asarray(Image.fromarray(region.astype(np.uint8)).resize((W, H), Image.NEAREST))
    if mat is not None:
        matbig = np.asarray(Image.fromarray(mat.astype(np.float32)).resize((W, H), Image.NEAREST))
        for pid in np.unique(matbig[regbig == 2]):
            pm = (matbig == pid) & (regbig == 2)
            if pm.sum() < 40:
                continue
            piece_lab = np.median(lab[pm], axis=0)
            pd = ((piece_lab[1] - plab[:, 1]) ** 2 + (piece_lab[2] - plab[:, 2]) ** 2
                  + 1.3 * (piece_lab[0] - plab[:, 0]) ** 2)
            assign[pm] = int(np.argmin(pd))

    yy, xx = np.mgrid[0:H, 0:W].astype(F)
    torn_amp = 2.0 + (1 - K["edge"]) * 7.0
    torn_freq = 24 if K["edge"] > 0.5 else 9
    dd = (value_noise(H, W, torn_freq, rng) - 0.5) * 2 * torn_amp
    my = np.clip(yy + dd, 0, H - 1).astype(np.int32)
    mx_ = np.clip(xx + (dd.T[:H, :W] if dd.T.shape == (H, W) else dd), 0, W - 1).astype(np.int32)
    assign = assign[my, mx_]

    out = np.ones((H, W, 3), F) * papers[0][None, None]
    shadow_dx = 3 + int(K["focus"] * 2)
    for i in range(len(papers)):
        m = (assign == i).astype(F)
        if not m.any():
            continue
        m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(1.2)), dtype=F) / 255
        m = (m > 0.5).astype(F)
        jx = shadow_dx + int(rng.integers(0, max(1, int((1 - K["order"]) * 4))))
        jy = shadow_dx + int(rng.integers(0, max(1, int((1 - K["order"]) * 4))))
        sh = np.roll(m, (jy, jx), axis=(0, 1)) * (1 - m)
        sh = np.asarray(Image.fromarray((sh * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(2.0)), dtype=F) / 255
        out *= (1 - sh[..., None] * 0.22)
        tex = 1 - (value_noise(H, W, 4, rng)[..., None] - 0.5) * 0.05
        out = out * (1 - m[..., None]) + papers[i][None, None] * tex * m[..., None]
    out = np.clip(out, 0, 1) * (1 + (vig[..., None] - 1) * 0.15)
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)


def chrono(img, region, nrm, w, h, rng, depth=None, emphasis=None, mat=None,
           knobs=None, stock=None):
    """Chronophotography: the subject echoed backward through its own motion — one
    body becoming three becoming heat. Echoes trail the move; the NOW-body stays
    crisp on top. weight = echo count/spread; order = echo discipline; chroma = the
    heat ramp; focus = how much the now outshines the then; edge = echo crispness."""
    S = 2
    W, H = w * S, h * S
    K = dict(knobs or KNOBS)
    arr = np.stack([upN(img[..., i], W, H) for i in range(3)], axis=-1)
    regbig = np.asarray(Image.fromarray(region.astype(np.uint8)).resize((W, H), Image.NEAREST))
    subj = (regbig == 2).astype(F)

    if stock:
        heat = [np.array(c, F) for c in (stock.get("accent", []) + stock.get("core", []))]
    else:
        heat = [np.array([0.9, 0.35, 0.2], F), np.array([0.95, 0.6, 0.2], F),
                np.array([0.98, 0.8, 0.35], F)]
    def _shift(a, dy, dx):
        # zero-fill shift: echoes leave the frame, they do NOT wrap around the back
        out_ = np.zeros_like(a)
        ys0, ys1 = max(0, dy), min(a.shape[0], a.shape[0] + dy)
        xs0, xs1 = max(0, dx), min(a.shape[1], a.shape[1] + dx)
        out_[ys0:ys1, xs0:xs1] = a[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx]
        return out_

    n_echo = 3 + int(round(K["weight"] * 4))
    step_x = -int(W * 0.035)
    out = arr.copy()
    covered = subj.copy()
    for k in range(1, n_echo + 1):
        dx = step_x * k
        dy = int(rng.integers(-1, 2) * (1 - K["order"]) * 6 * k)
        em = _shift(subj, dy, dx)
        ec = _shift(arr, dy, dx)
        blur = 0.6 + (1 - K["edge"]) * 1.8 + k * 0.5
        em = np.asarray(Image.fromarray((em * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(blur)), dtype=F) / 255
        hcol = heat[min(k - 1, len(heat) - 1)]
        t = k / n_echo
        tint = ec * (1 - K["chroma"] * (0.35 + t * 0.4)) + hcol[None, None] * (K["chroma"] * (0.35 + t * 0.4))
        a = em * (0.62 - t * 0.42) * (1 - covered)
        out = out * (1 - a[..., None]) + tint * a[..., None]
        covered = np.clip(covered + em * 0.5, 0, 1)
    pop = 1.0 + K["focus"] * 0.22
    out = np.where(subj[..., None] > 0.5,
                   np.clip(0.5 + (out - 0.5) * pop + 0.03 * K["focus"], 0, 1), out)
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)


STYLES = {"vangogh": vangogh, "monet": monet, "picasso": picasso, "sketch": sketch,
          "watercolor": watercolor, "comic": comic, "stagelight": stagelight,
          "screenprint": screenprint,
          "blueprint": blueprint, "linocut": linocut, "cutout": cutout, "chrono": chrono}

def print_bindings():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")     # the tables use arrows; cp1252 chokes
    for engine, table in BINDINGS.items():
        print(f"\n{engine}")
        for knob, binding in table.items():
            print(f"  {knob:<7} {binding}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "bindings":
        print_bindings()
        sys.exit(0)
    img_path, aux_path, style, out_path = sys.argv[1:5]
    seed = int(sys.argv[5]) if len(sys.argv) > 5 else 11
    rng = np.random.default_rng(seed)
    img, region, nrm, extras, w, h = load(img_path, aux_path)

    # split trailing args: key=val tokens are direction (knobs / register / palette / aliases);
    # bare tokens are vangogh's legacy positional directives (vortices, stars, register)
    kv, pos = {}, []
    for tok in sys.argv[6:]:
        (kv.update([tok.split("=", 1)]) if "=" in tok else pos.append(tok))

    register = kv.pop("register", None)
    stock = parse_stock(kv.pop("palette", None))
    if "clarity" in kv:                        # aliases from the knobs' maiden names
        kv["edge"] = kv.pop("clarity")
    overrides = {k: v for k, v in kv.items() if k in KNOBS}

    kwargs = {}
    if style == "vangogh":
        for name in ("mist", "flow", "flowmask", "coherence", "age", "depth", "emphasis"):
            kwargs[name] = extras[name]
        if len(pos) > 0:
            kwargs["vortices"] = () if pos[0] in ("-", "") else tuple(
                tuple(float(q) for q in v.split(",")) for v in pos[0].split(";"))
        if len(pos) > 1 and pos[1] not in ("-", ""):
            kwargs["stars"] = tuple(tuple(float(q) for q in v.split(",")) for v in pos[1].split(";"))
        if len(pos) > 2:
            register = register or pos[2]
        kwargs["register_name"] = register or "heroes"
    elif style in ("watercolor", "comic", "stagelight", "screenprint",
                   "blueprint", "linocut", "cutout", "chrono"):
        kwargs["depth"] = extras["depth"]
        kwargs["emphasis"] = extras["emphasis"]
        kwargs["mat"] = extras["mat"]

    kwargs["knobs"] = resolve_knobs(register, **overrides)
    kwargs["stock"] = stock
    res = STYLES[style](img, region, nrm, w, h, rng, **kwargs)
    res.save(out_path)
    print(out_path)
