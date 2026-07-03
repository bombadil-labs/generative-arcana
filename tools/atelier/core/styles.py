"""Five style engines over a modeled underpainting + its G-buffer.

The critique these answer: a single uniform stroke pass reads as static — strokes must KNOW
what they're painting. Every engine here reads the aux buffers (subject mask, depth, surface
normals, material ids) and treats sky / ground / subject as different painting problems, with
stroke orientation taken from 3D form (screen-projected normals), not just image gradients.

Usage: python styles.py <render.png> <aux.npz> <style> <out.png>
styles: vangogh | monet | picasso | sketch | watercolor
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
    }
    return img, region, nrm, extras, w, h


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

VICO = {
    # sky_len, sky_curl, chroma, subj_coh_bias, trespass (strokes may cross silhouettes)
    "gods":    dict(sky_len=1.35, curl=0.34, chroma=1.55, coh_bias=+0.10, trespass=False, vort_gain=1.3),
    "heroes":  dict(sky_len=1.00, curl=0.30, chroma=1.50, coh_bias=0.00, trespass=False, vort_gain=1.0),
    "men":     dict(sky_len=0.45, curl=0.06, chroma=1.12, coh_bias=+0.05, trespass=False, vort_gain=0.45),
    "ricorso": dict(sky_len=1.10, curl=0.42, chroma=1.35, coh_bias=-0.30, trespass=True, vort_gain=1.0),
}


def vangogh(img, region, nrm, w, h, rng, mist=None, vortices=None, flow=None, flowmask=None, stars=None, coherence=None, age=None, register_name="heroes", depth=None, emphasis=None):
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
    R = VICO.get(register_name, VICO["heroes"])
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
            col = jitter_color(np.clip(c * 1.05 + 0.02, 0, 1), rng, dh=0.008, ds=0.02, dv=0.04, boost_s=0.8)
            col = col + (int(80 + 130 * mv),)
            dkr = tuple(int(v * 0.8) for v in col[:3]) + (int(50 * mv),)
            lit = tuple(min(255, int(v * 1.1)) for v in col[:3]) + (int(60 * mv),)
            ox, oy = light * 1.2
            curved_stroke(draw, x - ox, y - oy, ang, length, width + 1, dkr, W, H, curl)
            curved_stroke(draw, x, y, ang, length, width, col, W, H, curl)
            continue
        if r == 0:
            ang, length, width, curl = sky_ang, 30 + 26 * rng.random(), 5, 0.30
            col = jitter_color(c, rng, dh=0.02, ds=0.05, dv=0.06, boost_s=1.5)
        elif r == 1:
            ang, length, width, curl = ground_ang, 26 + 18 * rng.random(), 5, 0.05
            col = jitter_color(c, rng, dh=0.015, ds=0.04, dv=0.05, boost_s=1.3)
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
            col = jitter_color(c, rng, dh=0.018, ds=0.05, dv=0.07, boost_s=1.45)
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
            col = jitter_color(arr[y, x], rng, dh=0.008, ds=0.03, dv=0.03, boost_s=1.5)
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

def monet(img, region, nrm, w, h, rng):
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
        sx = int(np.clip(x + rng.normal(0, 7), 0, W - 1))
        sy = int(np.clip(y + rng.normal(0, 7), 0, H - 1))
        c = arr[sy, sx]
        lt = lum[y, x]
        # broken color: cool lavender dabs in light, warm dabs in shadow
        if rng.random() < 0.30:
            shift = np.array([0.05, 0.02, 0.14]) if lt > 0.45 else np.array([0.10, 0.02, -0.05])
            c = np.clip(c + shift * (0.5 + rng.random()), 0, 1)
        col = jitter_color(c, rng, dh=0.03, ds=0.06, dv=0.05, boost_s=1.1)
        rx = 7 + 9 * rng.random() + (4 if regbig[y, x] == 0 else 0)
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

def picasso(img, region, nrm, w, h, rng):
    n_sites = 42
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
        keep = 0.78 if cell_reg == 2 else 0.25
        tone = pal[pi] * (1 - keep) + mean_c * keep
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

def sketch(img, region, nrm, w, h, rng):
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
        ph = (xx * np.cos(angle) + yy * np.sin(angle)) / period
        wob = value_noise(H, W, 30, rng) * 1.6
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
    for (px, py) in pts[:: 2]:
        j = rng.normal(0, 0.7, 4)
        dr.line([(px + j[0] - 1, py + j[1]), (px + j[2] + 1, py + j[3])], fill=inkt + (200,), width=2)
    return im.resize((w, h), Image.LANCZOS)


# ── WATERCOLOR: displaced washes, pooled edges, blooms, reserved paper ───────

def watercolor(img, region, nrm, w, h, rng):
    S = 2
    W, H = w * S, h * S
    arr = np.asarray(Image.fromarray((img * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS), dtype=F) / 255
    regbig = np.asarray(Image.fromarray(region.astype(np.uint8)).resize((W, H), Image.NEAREST))
    lum = arr @ np.array([0.299, 0.587, 0.114], F)

    paper = np.array([0.96, 0.94, 0.88], F)
    grain = value_noise(H, W, 4, rng)
    out = paper[None, None] * (1 - grain[..., None] * 0.05)

    # displaced region masks → washes, 3 tone layers per region (multiply blending)
    for reg, tones in ((0, [0.75]), (1, [0.6, 0.35]), (2, [0.8, 0.5, 0.28])):
        base_m = (regbig == reg).astype(F)
        for li, tcut in enumerate(tones):
            m = base_m * (lum < tcut if reg == 2 else np.ones_like(lum))
            if reg != 2:
                m = base_m * (lum < (tcut + 0.2))
            disp = (value_noise(H, W, 26 + li * 9, rng) - 0.5) * 26
            ys2 = np.clip(np.mgrid[0:H, 0:W][0] + disp, 0, H - 1).astype(int)
            xs2 = np.clip(np.mgrid[0:H, 0:W][1] + disp.T[:H, :W] if disp.T.shape == (H, W) else np.mgrid[0:H, 0:W][1] + disp, 0, W - 1).astype(int)
            md = m[ys2, xs2]
            md = np.asarray(Image.fromarray((md * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2)), dtype=F) / 255
            wash_m = (md > 0.5).astype(F)
            # pigment = regional mean color, lightened per layer
            sel = md > 0.5
            if not sel.any():
                continue
            band_sel = sel & (regbig == reg)
            pig = arr[band_sel].mean(axis=0) if band_sel.any() else arr[sel].mean(axis=0)
            import colorsys
            hh, ss, vv = colorsys.rgb_to_hsv(*np.clip(pig, 0, 1))
            pig = np.array(colorsys.hsv_to_rgb(hh, min(1, ss * 1.6), vv), F)
            pig = 1 - (1 - pig) * (0.6 + 0.25 * li)
            # edge pooling: darker rim just inside the wash
            inner = np.asarray(Image.fromarray((wash_m * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(7)), dtype=F) / 255
            rim = np.clip(wash_m - inner, 0, 1)
            layer = pig[None, None] * wash_m[..., None]
            out = out * (1 - wash_m[..., None] * 0.72) + out * layer * 0.72
            out *= 1 - rim[..., None] * 0.18
    # reserved paper for the brightest highlights
    hi = (lum > 0.82).astype(F)
    hi = np.asarray(Image.fromarray((hi * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3)), dtype=F) / 255
    out = out * (1 - hi[..., None]) + paper[None, None] * hi[..., None]
    # blooms
    yy, xx = np.mgrid[0:H, 0:W].astype(F)
    sub_ys, sub_xs = np.where(regbig > 0)
    for _ in range(4):
        bi = rng.integers(0, len(sub_xs))
        bx, by, br = int(sub_xs[bi]), int(sub_ys[bi]), 14 + rng.random() * 30
        d = np.sqrt((xx - bx) ** 2 + (yy - by) ** 2)
        ring = np.exp(-((d - br) / 5.5) ** 2) * 0.10
        core = np.clip(1 - d / br, 0, 1) * 0.08
        out = np.clip(out + core[..., None] - ring[..., None] * 0.6, 0, 1)
    out = np.clip(out, 0, 1)
    return Image.fromarray((out * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)


STYLES = {"vangogh": vangogh, "monet": monet, "picasso": picasso, "sketch": sketch, "watercolor": watercolor}

if __name__ == "__main__":
    img_path, aux_path, style, out_path = sys.argv[1:5]
    seed = int(sys.argv[5]) if len(sys.argv) > 5 else 11
    rng = np.random.default_rng(seed)
    img, region, nrm, extras, w, h = load(img_path, aux_path)
    kwargs = {}
    if style == "vangogh":
        kwargs["mist"] = extras["mist"]
        kwargs["flow"] = extras["flow"]
        kwargs["flowmask"] = extras["flowmask"]
        kwargs["coherence"] = extras["coherence"]
        kwargs["age"] = extras["age"]
        kwargs["depth"] = extras["depth"]
        kwargs["emphasis"] = extras["emphasis"]
        if len(sys.argv) > 6:
            kwargs["vortices"] = () if sys.argv[6] in ("-", "") else tuple(
                tuple(float(q) for q in v.split(",")) for v in sys.argv[6].split(";"))
        if len(sys.argv) > 7 and sys.argv[7] not in ("-", ""):
            kwargs["stars"] = tuple(tuple(float(q) for q in v.split(",")) for v in sys.argv[7].split(";"))
        if len(sys.argv) > 8:
            kwargs["register_name"] = sys.argv[8]
    res = STYLES[style](img, region, nrm, w, h, rng, **kwargs)
    res.save(out_path)
    print(out_path)
