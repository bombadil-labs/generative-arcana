"""Composition study: "The Fox and the Crow" — now built from the posable sculpture library.

The scene composes reusable primitives (creatures.fox / crow / bare_tree), then bakes
painter-facing channels into the G-buffer:
  - flow: per-pixel fur/feather direction from each creature's skeleton (hair lies nose→tail,
    draping downward off the spine) — so the paint pass can comb the coat instead of flaming it
  - mist: ground fog as height-enveloped anisotropic noise (wisps and gaps, not ovals)
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parents[2] / "core"))
sys.path.insert(0, str(Path(__file__).parent))
from sdflib import Scene, render, sd_plane_y
from creatures import fox, crow, bare_tree

GROUND = (40, 36, 34)
FRAME = (-1.35, 1.15, -0.10, 3.65)

s = Scene()
s.add(lambda p: sd_plane_y(p, 0.0), GROUND, k=0.0)

FOX = fox(s, origin=(-0.62, 0.0), head_pitch=0.20)          # seated lower-left, gazing up
TREE = bare_tree(s, origin=(0.62, 0.0))                      # right third
CROW = crow(s, origin=(0.05, 2.18))                          # perched at the branch end


def scene_to_frac(pt):
    """Scene (x, y) → fractional image coords (fx, fy), y down."""
    fx = (pt[0] - FRAME[0]) / (FRAME[1] - FRAME[0])
    fy = 1.0 - (pt[1] - FRAME[2]) / (FRAME[3] - FRAME[2])
    return fx, fy


def _aniso_noise(h, w, cell_x, cell_y, rng):
    gh, gw = h // cell_y + 2, w // cell_x + 2
    g = rng.random((gh, gw)).astype(np.float32)
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32) / 255.0


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def bake_channels(npz_path):
    """Add mist + flow channels to the aux npz (computed from geometry, for the paint pass)."""
    g = dict(np.load(npz_path))
    mat = g["material"]
    h, w = mat.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    fy, fx = yy / h, xx / w
    rng = np.random.default_rng(43)

    # ── mist: wisps with gaps, hugging the ground ──
    wisp = 0.62 * _aniso_noise(h, w, 130, 13, rng) + 0.38 * _aniso_noise(h, w, 55, 7, rng)
    env = smoothstep(0.72, 0.90, fy) * (1 - 0.45 * smoothstep(0.955, 1.0, fy))
    mist = np.clip(env * np.power(wisp, 1.7) * 1.9, 0, 0.62).astype(np.float32)
    g["mist"] = mist

    # ── flow: fur direction from creature skeletons ──
    sx = FRAME[0] + fx * (FRAME[1] - FRAME[0])
    sy = FRAME[2] + (1 - fy) * (FRAME[3] - FRAME[2])
    flow = np.zeros((h, w), np.float32)
    flowmask = np.zeros((h, w), np.uint8)
    coherence = np.zeros((h, w), np.float32)
    age = np.zeros((h, w), np.float32)
    for info in (FOX, CROW, TREE):
        if info["skeleton"] is None:
            continue
        i0, i1 = info["span"]
        sel = (mat >= i0) & (mat < i1)
        if not sel.any():
            continue
        px, py = sx[sel], sy[sel]
        best_d = np.full(px.shape, np.inf, np.float32)
        best_tx = np.zeros(px.shape, np.float32)
        best_ty = np.zeros(px.shape, np.float32)
        best_arc = np.zeros(px.shape, np.float32)
        sk = info["skeleton"]
        seg_l = [np.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(sk[:-1], sk[1:])]
        total_l = sum(seg_l) or 1e-9
        arc0 = 0.0
        seg_i = 0
        for a, b in zip(sk[:-1], sk[1:]):
            ax, ay = a
            bx, by = b
            ex, ey = bx - ax, by - ay
            L2 = ex * ex + ey * ey or 1e-9
            t = np.clip(((px - ax) * ex + (py - ay) * ey) / L2, 0, 1)
            qx, qy = ax + t * ex, ay + t * ey
            d = np.sqrt((px - qx) ** 2 + (py - qy) ** 2)
            upd = d < best_d
            best_d[upd] = d[upd]
            n = np.sqrt(L2)
            best_tx[upd], best_ty[upd] = ex / n, ey / n
            best_arc[upd] = (arc0 + t[upd] * seg_l[seg_i]) / total_l
            arc0 += seg_l[seg_i]
            seg_i += 1
        # drape: fur leaves the spine and falls with distance from it
        droop = info.get("droop", 0.7)
        k = np.clip(best_d / 0.30, 0, 0.8) * (1 if droop > 0 else 0)
        dirx = best_tx * (1 - k)
        diry = best_ty * (1 - k) + (-1.0) * k * droop
        ln = np.sqrt(dirx ** 2 + diry ** 2) + 1e-9
        # image space: y is down
        flow[sel] = np.arctan2(-diry / ln, dirx / ln)
        flowmask[sel] = 1
        # coherence: disciplined near the spine, unruly at the fringes (character in deviation)
        base_coh = info.get("coherence", 0.7)
        coherence[sel] = base_coh * (1 - 0.45 * np.clip(best_d / 0.30, 0, 1))
        # age: arc position along the growth skeleton — for aged things, 0 = origin (oldest)
        age[sel] = (1 - best_arc) if info.get("aged") else 0.0
    g["flow"] = flow
    g["flowmask"] = flowmask
    g["coherence"] = coherence
    g["age"] = age
    np.savez_compressed(npz_path, **g)
    return mist


def post(img8, npz_path):
    """Environment: sky, moon, hills where mask==0; then the baked mist over everything."""
    mist = bake_channels(npz_path)
    g = np.load(npz_path)
    mask = g["mask"].astype(np.float32)
    h, w = mask.shape
    img = img8.astype(np.float32) / 255.0
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    fy, fx = yy / h, xx / w

    sky_top = np.array([16, 20, 38], np.float32) / 255
    sky_mid = np.array([44, 46, 70], np.float32) / 255
    sky = sky_top[None, None] * (1 - fy)[..., None] + sky_mid[None, None] * fy[..., None]

    mx, my, mr = 0.20, 0.155, 0.072
    d = np.sqrt(((fx - mx) * (w / h)) ** 2 + (fy - my) ** 2)
    disc = np.clip(1 - (d / mr) ** 8, 0, 1)
    halo = np.exp(-((d - mr) / 0.20).clip(0) * 3.2) * 0.5
    moon_c = np.array([232, 228, 210], np.float32) / 255
    sky = sky * (1 - disc[..., None]) + moon_c[None, None] * disc[..., None]
    sky += (halo * 0.55)[..., None] * moon_c[None, None]

    for base, amp, tone in ((0.72, 0.035, (30, 30, 44)), (0.78, 0.05, (24, 24, 34))):
        ridge = base + amp * np.sin(fx * 7.0 + base * 20) + amp * 0.5 * np.sin(fx * 17.0 + 2)
        band = np.clip((fy - ridge) / 0.012, 0, 1)
        c = np.array(tone, np.float32) / 255
        sky = sky * (1 - band[..., None]) + c[None, None] * band[..., None]

    out = img * mask[..., None] + sky * (1 - mask)[..., None]

    mist_c = np.array([124, 130, 152], np.float32) / 255
    out = out * (1 - mist[..., None]) + mist_c[None, None] * mist[..., None]

    out *= np.array([0.94, 0.97, 1.08], np.float32)[None, None]
    vign = 1 - 0.32 * (((fx - 0.5) * 2) ** 2 + ((fy - 0.52) * 2) ** 2) ** 1.2
    out *= vign[..., None]
    return (np.clip(out, 0, 1) * 255).astype(np.uint8)


if __name__ == "__main__":
    tag = sys.argv[1] if len(sys.argv) > 1 else "v3"
    outdir = Path(__file__).parent / "out"
    outdir.mkdir(exist_ok=True)
    npz = outdir / "e_scene_aux.npz"
    img = render(
        s, w=340, h=510, frame=FRAME,
        key_dir=(-0.5, 0.75, 0.45), key_col=(0.82, 0.86, 1.0), key_i=0.95,
        fill_dir=(0.4, -0.2, 0.7), fill_col=(0.9, 0.65, 0.45), fill_i=0.12,
        rim_dir=(-0.45, 0.4, -0.75), rim_col=(0.85, 0.9, 1.0), rim_i=0.75,
        ambient=0.10, bg_top=(20, 22, 40), bg_bot=(30, 30, 44),
        aux=str(npz),
    )
    img = post(img, npz)
    Image.fromarray(img).save(outdir / f"e_scene_{tag}.png")
    crow_pt = scene_to_frac((0.05 - 0.08, 2.18 + 0.24))
    print(outdir / f"e_scene_{tag}.png")
    print("vortices: 0.200,0.155,1;%.3f,%.3f,-1" % (crow_pt[0], crow_pt[1]))
