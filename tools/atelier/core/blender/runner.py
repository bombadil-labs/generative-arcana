"""Host-side adapter for the Blender backend.

  python core/blender/runner.py <scene_script.py> <out_dir> [--paint STYLE REGISTER]

1. Resolves Blender through tools/vendor/bootstrap.py and runs the scene script headless.
2. Bakes the atelier control channels from Blender's raw passes + projection metadata
   (flow from projected skeletons/grains, coherence, age from world height, mist) into the
   SAME aux-npz schema the numpy backend produced — the painter never knows.
3. Composites the environment (sky/orb/horizon/mist/grade) over the film-transparent render.
4. Prints the paint command with directives derived from the staged attention.
"""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ATELIER = Path(__file__).resolve().parents[2]
VENDOR = ATELIER.parent / "vendor"
F = np.float32


def _aniso_noise(h, w, cell_x, cell_y, rng):
    gh, gw = h // cell_y + 2, w // cell_x + 2
    g = rng.random((gh, gw)).astype(F)
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(im, dtype=F) / 255.0


def _smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def run_blender(scene_script, out_dir, extra=()):
    sys.path.insert(0, str(VENDOR))
    import bootstrap
    exe = bootstrap.resolve("blender")
    if exe is None:
        print("blender missing — run: python tools/vendor/bootstrap.py blender --install", file=sys.stderr)
        sys.exit(2)
    cmd = [str(exe), "--background", "--factory-startup", "--python", str(scene_script),
           "--", str(out_dir)] + [str(a) for a in extra]
    r = subprocess.run(cmd, capture_output=True, text=True)
    marker = [l for l in r.stdout.splitlines() if l.startswith("BSTAGE_DONE")]
    if not marker:
        print(r.stdout[-3000:], file=sys.stderr)
        print(r.stderr[-2000:], file=sys.stderr)
        sys.exit(1)
    print(marker[0])


def bake(out_dir):
    out = Path(out_dir)
    raw = np.load(out / "raw.npz")
    meta = json.loads((out / "meta.json").read_text(encoding="utf-8"))
    w, h = meta["w"], meta["h"]
    mask = raw["mask"].astype(np.uint8)
    depth = raw["depth"].astype(F)
    material = raw["material"]
    pos = raw["position"].astype(F)          # world (blender): z is height
    n_world = raw["normal"].astype(F)

    # normals → camera space (painter expects x right, y up, z toward camera)
    R = np.array(meta["cam_rot"], dtype=F)   # world→camera rotation
    n_cam = n_world @ R.T
    normal = n_cam.astype(F)

    yy, xx = np.mgrid[0:h, 0:w].astype(F)
    fy = yy / h
    rng = np.random.default_rng(43)

    mc = dict(rise=0.72, peak=0.90, strength=1.9, cap=0.62)
    mc.update(meta.get("mist_cfg") or {})
    wisp = 0.62 * _aniso_noise(h, w, 130, 13, rng) + 0.38 * _aniso_noise(h, w, 55, 7, rng)
    env = _smoothstep(mc["rise"], mc["peak"], fy) * (1 - 0.45 * _smoothstep(0.955, 1.0, fy))
    mist = np.clip(env * np.power(wisp, 1.7) * mc["strength"], 0, mc["cap"]).astype(F)

    flow = np.zeros((h, w), F)
    flowmask = np.zeros((h, w), np.uint8)
    coherence = np.zeros((h, w), F)
    age = np.zeros((h, w), F)
    px = xx  # pixel coords
    py = yy

    for pl in meta["placements"]:
        i0, i1 = pl["span"]
        base_coh = pl["coherence"]
        for idx_s, ang in (pl.get("grains2d") or {}).items():
            sel = material == int(idx_s)
            if sel.any():
                flow[sel] = ang
                flowmask[sel] = 1
                coherence[sel] = base_coh
        sk = pl.get("skeleton2d")
        if sk:
            sel = (material >= i0) & (material < i1)
            if sel.any():
                sx, sy_ = px[sel], py[sel]
                pts = [(p[0] * w, p[1] * h) for p in sk]
                best_d = np.full(sx.shape, np.inf, F)
                best_tx = np.zeros(sx.shape, F)
                best_ty = np.zeros(sx.shape, F)
                for a, b in zip(pts[:-1], pts[1:]):
                    ex, ey = b[0] - a[0], b[1] - a[1]
                    L2 = ex * ex + ey * ey or 1e-9
                    t = np.clip(((sx - a[0]) * ex + (sy_ - a[1]) * ey) / L2, 0, 1)
                    d = np.sqrt((sx - (a[0] + t * ex)) ** 2 + (sy_ - (a[1] + t * ey)) ** 2)
                    upd = d < best_d
                    best_d[upd] = d[upd]
                    n = np.sqrt(L2)
                    best_tx[upd], best_ty[upd] = ex / n, ey / n
                d_units = best_d / max(pl["px_per_unit"], 1e-6)
                droop = pl["droop"]
                k = np.clip(d_units / 0.30, 0, 0.8) * (1 if droop > 0 else 0)
                dirx = best_tx * (1 - k)
                diry = best_ty * (1 - k) + k * droop      # image y is down = gravity
                ln = np.sqrt(dirx ** 2 + diry ** 2) + 1e-9
                flow[sel] = np.arctan2(diry / ln, dirx / ln)
                flowmask[sel] = 1
                coherence[sel] = base_coh * (1 - 0.45 * np.clip(d_units / 0.30, 0, 1))
        if pl.get("aged"):
            sel = (material >= i0) & (material < i1)
            if sel.any():
                hts = pl.get("anchors_height", {})
                base_h, top_h = hts.get("base", 0.0), hts.get("top", 3.0)
                age[sel] = 1 - np.clip((pos[..., 2][sel] - base_h) / max(top_h - base_h, 1e-6), 0, 1)

    emphasis = np.zeros((h, w), F)
    for (span, strength) in meta.get("emphasis", []):
        sel = (material >= span[0]) & (material < span[1])
        emphasis[sel] = np.maximum(emphasis[sel], strength)
    for _ in range(3):   # dilate ~3 px so thin geometry (masts) is protected, not buried
        emphasis = np.maximum.reduce([emphasis,
                                      np.roll(emphasis, 1, 0), np.roll(emphasis, -1, 0),
                                      np.roll(emphasis, 1, 1), np.roll(emphasis, -1, 1)])

    np.savez_compressed(out / "aux.npz", mask=mask, depth=depth, normal=normal,
                        material=material.astype(np.int16), flow=flow, flowmask=flowmask,
                        coherence=coherence, age=age, mist=mist, emphasis=emphasis)

    # ── environment composite over the transparent render ──
    cfg = dict(top=(16, 20, 38), mid=(44, 46, 70),
               orb=dict(pos=(0.20, 0.155), r=0.072, color=(232, 228, 210), halo=0.5),
               horizon="hills",
               sea=dict(level=0.74, color=(38, 52, 54), far=(52, 62, 66)),
               grade=(0.94, 0.97, 1.08), mist_color=(124, 130, 152))
    cfg.update(meta.get("sky_cfg") or {})
    combined = np.asarray(Image.open(out / "combined.png").convert("RGBA"), dtype=F) / 255
    img = combined[..., :3]
    fx = xx / w
    sky_top = np.array(cfg["top"], F) / 255
    sky_mid = np.array(cfg["mid"], F) / 255
    sky = sky_top[None, None] * (1 - fy)[..., None] + sky_mid[None, None] * fy[..., None]
    orb = cfg["orb"]
    if orb:
        mx, my = orb.get("pos") or (0.2, 0.155)
        d = np.sqrt(((fx - mx) * (w / h)) ** 2 + (fy - my) ** 2)
        disc = np.clip(1 - (d / orb["r"]) ** 8, 0, 1)
        halo = np.exp(-((d - orb["r"]) / 0.20).clip(0) * 3.2) * orb["halo"]
        moon_c = np.array(orb["color"], F) / 255
        sky = sky * (1 - disc[..., None]) + moon_c[None, None] * disc[..., None]
        sky += (halo * 0.55)[..., None] * moon_c[None, None]
    if cfg["horizon"] == "hills":
        for base, amp, tone in ((0.72, 0.035, (30, 30, 44)), (0.78, 0.05, (24, 24, 34))):
            ridge = base + amp * np.sin(fx * 7.0 + base * 20) + amp * 0.5 * np.sin(fx * 17.0 + 2)
            band = np.clip((fy - ridge) / 0.012, 0, 1)
            c = np.array(tone, F) / 255
            sky = sky * (1 - band[..., None]) + c[None, None] * band[..., None]
    elif cfg["horizon"] == "sea":
        sea = cfg["sea"]
        lvl = sea["level"]
        band = np.clip((fy - lvl) / 0.008, 0, 1)
        near = np.array(sea["color"], F) / 255
        far = np.array(sea["far"], F) / 255
        mixv = np.clip((fy - lvl) / 0.25, 0, 1)
        seac = far[None, None] * (1 - mixv)[..., None] + near[None, None] * mixv[..., None]
        if orb:
            lane = np.exp(-((fx - orb["pos"][0]) / 0.06) ** 2) * np.clip((fy - lvl) / 0.02, 0, 1) * 0.20
            seac += lane[..., None] * (np.array(orb["color"], F) / 255)[None, None]
        sky = sky * (1 - band[..., None]) + seac * band[..., None]

    m = mask.astype(F)
    outimg = img * m[..., None] + sky * (1 - m)[..., None]
    aerial = cfg.get("aerial")
    if aerial:
        d0, d1 = aerial.get("start", 5.0), aerial.get("end", 16.0)
        strength = aerial.get("strength", 0.7)
        hazec = np.array(aerial.get("color", cfg["mid"]), F) / 255
        dref = np.where(depth > 1e5, d1, depth)   # missed rays → fully hazed
        f = _smoothstep(d0, d1, dref) * strength * m
        outimg = outimg * (1 - f[..., None]) + hazec[None, None] * f[..., None]
    mist_c = np.array(cfg["mist_color"], F) / 255
    outimg = outimg * (1 - mist[..., None]) + mist_c[None, None] * mist[..., None]
    outimg *= np.array(cfg["grade"], F)[None, None]
    vign = 1 - 0.32 * (((fx - 0.5) * 2) ** 2 + ((fy - 0.52) * 2) ** 2) ** 1.2
    outimg *= vign[..., None]
    final = (np.clip(outimg, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(final).save(out / "card.png")

    vort_pts = []
    if cfg.get("orb"):
        vort_pts.append((orb["pos"][0], orb["pos"][1], 1))
    for (p2, pol) in meta.get("attention", []):
        vort_pts.append((p2[0], p2[1], pol))
    vort = ";".join("%.3f,%.3f,%d" % v for v in vort_pts) or "-"
    stars = ";".join("%.2f,%.2f" % tuple(p) for p in meta.get("stars", [])) or "-"
    print(f"baked: {out / 'card.png'}  {out / 'aux.npz'}")
    print(f'paint: python core/styles.py {out}/card.png {out}/aux.npz vangogh {out}/painted.png 5 "{vort}" "{stars}" heroes')


if __name__ == "__main__":
    scene = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2]).resolve()
    run_blender(scene, out, extra=sys.argv[3:])
    bake(out)
