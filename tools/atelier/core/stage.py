"""The STAGER — the middle layer between sculptor and painter.

The sculptor (creatures.py) makes artifacts with affordances: anchor points, flow skeletons,
per-part grains, coherence, age. The painter (styles.py) renders strokes from channels and
directives. The stager owns everything in between — the semantics of how artifacts become a
scene:

  - placement by RELATION, not coordinates: perch_on(anchor), look_at(target)
  - the environment: ground, night sky, moon, far hills, low mist
  - the attention structure: narrative points that become the painter's field vortices
  - compilation: renders the scene, bakes ALL control channels into the G-buffer
    (flow / coherence / age from each placement; mist from the atmosphere), and emits the
    painter's directives (vortices, stars) in one bundle.

Scene scripts become declarative: place, relate, attend, render.
"""

from pathlib import Path

import numpy as np
from PIL import Image

from sdflib import Scene, render as sdf_render, sd_plane_y

F = np.float32


def _aniso_noise(h, w, cell_x, cell_y, rng):
    gh, gw = h // cell_y + 2, w // cell_x + 2
    g = rng.random((gh, gw)).astype(F)
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(im, dtype=F) / 255.0


def _smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


class Placement:
    def __init__(self, info):
        self.info = info

    def anchor(self, name):
        return self.info["anchors"][name]


class Stage:
    def __init__(self, frame=(-1.35, 1.15, -0.10, 3.65), ground=(40, 36, 34)):
        self.frame = frame
        self.scene = Scene()
        self.scene.add(lambda p: sd_plane_y(p, 0.0), ground, k=0.0)
        self.placed = []
        self.attention = []      # scene-space narrative points → painter vortices
        self.star_pts = []       # fractional sky points
        self.moon = (0.20, 0.155)
        self.mist_cfg = dict(rise=0.72, peak=0.90, strength=1.9, cap=0.62)
        self.sky_cfg = dict(
            top=(16, 20, 38), mid=(44, 46, 70),
            orb=dict(pos=None, r=0.072, color=(232, 228, 210), halo=0.5),  # pos None → use self.moon
            horizon="hills",              # "hills" | "sea" | None
            sea=dict(level=0.74, color=(38, 52, 54), far=(52, 62, 66)),
            grade=(0.94, 0.97, 1.08),
            mist_color=(124, 130, 152),
        )

    # ── placement by relation ────────────────────────────────────────────────
    def place(self, builder, at=None, perch_on=None, look_at=None, mirror=False, **pose):
        if perch_on is not None:
            fl = getattr(builder, "feet_local", (0.0, 0.0))
            at = (perch_on[0] - (-fl[0] if mirror else fl[0]), perch_on[1] + 0.005 - fl[1])
        if at is None:
            at = (0.0, 0.0)
        if look_at is not None and hasattr(builder, "solve_pose"):
            pose.update(builder.solve_pose(at, look_at, mirror))
        info = builder(self.scene, origin=at, mirror=mirror, **pose)
        pl = Placement(info)
        self.placed.append(pl)
        return pl

    def attend(self, *points, polarity=None):
        """Narrative attention points (scene coords or 'moon'); become field vortices.
        polarity: list matching points, +1/-1 swirl, 0 = REPULSOR (the field diverts around)."""
        for i, pt in enumerate(points):
            pol = polarity[i] if polarity else (-1 if (len(self.attention) % 2 == 0) else 1)
            self.attention.append((self.moon if pt == "moon" else pt, pol))
        self.include_orb_vortex = getattr(self, "include_orb_vortex", True)

    def stars(self, *frac_points):
        self.star_pts.extend(frac_points)

    # ── coordinate helpers ───────────────────────────────────────────────────
    def to_frac(self, pt):
        f = self.frame
        return ((pt[0] - f[0]) / (f[1] - f[0]), 1.0 - (pt[1] - f[2]) / (f[3] - f[2]))

    # ── compile: render + bake channels + environment + directives ──────────
    def render(self, w=340, h=510, out_png=None, aux_path=None, **light):
        aux_path = str(aux_path)
        defaults = dict(
            key_dir=(-0.5, 0.75, 0.45), key_col=(0.82, 0.86, 1.0), key_i=0.95,
            fill_dir=(0.4, -0.2, 0.7), fill_col=(0.9, 0.65, 0.45), fill_i=0.12,
            rim_dir=(-0.45, 0.4, -0.75), rim_col=(0.85, 0.9, 1.0), rim_i=0.75,
            ambient=0.10, bg_top=(20, 22, 40), bg_bot=(30, 30, 44),
        )
        defaults.update(light)
        img = sdf_render(self.scene, w=w, h=h, frame=self.frame, aux=aux_path, **defaults)
        mist = self._bake_channels(aux_path)
        img = self._environment(img, aux_path, mist)
        if out_png:
            Image.fromarray(img).save(out_png)
        return img

    def paint_directives(self):
        """The painter's CLI bundle derived from staged semantics."""
        pts = []
        if getattr(self, "include_orb_vortex", True) and self.sky_cfg["orb"] is not None:
            pts.append((self._moon_scene(), 1))
        pts.extend(self.attention)
        vort = ";".join("%.3f,%.3f,%d" % (self.to_frac(p) + (pol,)) for p, pol in pts) or "-"
        stars = ";".join("%.2f,%.2f" % p for p in self.star_pts) or "-"
        return vort, stars

    def _moon_scene(self):
        f = self.frame
        return (f[0] + self.moon[0] * (f[1] - f[0]), f[2] + (1 - self.moon[1]) * (f[3] - f[2]))

    # ── channel baking (flow / coherence / age / mist) ───────────────────────
    def _bake_channels(self, npz_path):
        g = dict(np.load(npz_path))
        mat = g["material"]
        h, w = mat.shape
        yy, xx = np.mgrid[0:h, 0:w].astype(F)
        fy, fx = yy / h, xx / w
        rng = np.random.default_rng(43)
        f = self.frame
        sx = f[0] + fx * (f[1] - f[0])
        sy = f[2] + (1 - fy) * (f[3] - f[2])

        mc = self.mist_cfg
        wisp = 0.62 * _aniso_noise(h, w, 130, 13, rng) + 0.38 * _aniso_noise(h, w, 55, 7, rng)
        env = _smoothstep(mc["rise"], mc["peak"], fy) * (1 - 0.45 * _smoothstep(0.955, 1.0, fy))
        mist = np.clip(env * np.power(wisp, 1.7) * mc["strength"], 0, mc["cap"]).astype(F)

        flow = np.zeros((h, w), F)
        flowmask = np.zeros((h, w), np.uint8)
        coherence = np.zeros((h, w), F)
        age = np.zeros((h, w), F)

        for pl in self.placed:
            info = pl.info
            base_coh = info.get("coherence", 0.7)

            # per-part grains: bark follows the limb it is on (local axis, not a global one)
            for (idx, a, b) in info.get("grains", ()):
                sel = mat == idx
                if not sel.any():
                    continue
                ex, ey = b[0] - a[0], b[1] - a[1]
                n = np.hypot(ex, ey) or 1e-9
                flow[sel] = np.arctan2(-(ey / n), ex / n)  # image y down
                flowmask[sel] = 1
                coherence[sel] = base_coh

            # skeleton coats: smooth cross-part fur/feather flow with droop
            if info.get("skeleton"):
                i0, i1 = info["span"]
                sel = (mat >= i0) & (mat < i1)
                if sel.any():
                    px, py = sx[sel], sy[sel]
                    best_d = np.full(px.shape, np.inf, F)
                    best_tx = np.zeros(px.shape, F)
                    best_ty = np.zeros(px.shape, F)
                    sk = info["skeleton"]
                    for a, b in zip(sk[:-1], sk[1:]):
                        ex, ey = b[0] - a[0], b[1] - a[1]
                        L2 = ex * ex + ey * ey or 1e-9
                        t = np.clip(((px - a[0]) * ex + (py - a[1]) * ey) / L2, 0, 1)
                        d = np.sqrt((px - (a[0] + t * ex)) ** 2 + (py - (a[1] + t * ey)) ** 2)
                        upd = d < best_d
                        best_d[upd] = d[upd]
                        n = np.sqrt(L2)
                        best_tx[upd], best_ty[upd] = ex / n, ey / n
                    droop = info.get("droop", 0.7)
                    k = np.clip(best_d / 0.30, 0, 0.8) * (1 if droop > 0 else 0)
                    dirx = best_tx * (1 - k)
                    diry = best_ty * (1 - k) - k * droop
                    ln = np.sqrt(dirx ** 2 + diry ** 2) + 1e-9
                    flow[sel] = np.arctan2(-diry / ln, dirx / ln)
                    flowmask[sel] = 1
                    coherence[sel] = base_coh * (1 - 0.45 * np.clip(best_d / 0.30, 0, 1))

            # age: height above the artifact's base, for aged things (old below, young above)
            if info.get("aged"):
                i0, i1 = info["span"]
                sel = (mat >= i0) & (mat < i1)
                if sel.any():
                    base_y = info["anchors"].get("base", (0, 0))[1]
                    top_y = info["anchors"].get("top", (0, 3))[1]
                    age[sel] = 1 - np.clip((sy[sel] - base_y) / max(top_y - base_y, 1e-6), 0, 1)

        g.update(mist=mist, flow=flow, flowmask=flowmask, coherence=coherence, age=age)
        np.savez_compressed(npz_path, **g)
        return mist

    # ── the environment pass (sky, moon, hills, mist, grade) ─────────────────
    def _environment(self, img8, npz_path, mist):
        g = np.load(npz_path)
        mask = g["mask"].astype(F)
        h, w = mask.shape
        img = img8.astype(F) / 255.0
        yy, xx = np.mgrid[0:h, 0:w].astype(F)
        fy, fx = yy / h, xx / w

        cfg = self.sky_cfg
        sky_top = np.array(cfg["top"], F) / 255
        sky_mid = np.array(cfg["mid"], F) / 255
        sky = sky_top[None, None] * (1 - fy)[..., None] + sky_mid[None, None] * fy[..., None]

        orb = cfg["orb"]
        if orb is None:
            orb = dict(pos=(0.5, -2.0), r=0.001, color=(0, 0, 0), halo=0.0)  # effectively no orb
        mx, my = orb["pos"] or self.moon
        mr = orb["r"]
        d = np.sqrt(((fx - mx) * (w / h)) ** 2 + (fy - my) ** 2)
        disc = np.clip(1 - (d / mr) ** 8, 0, 1)
        halo = np.exp(-((d - mr) / 0.20).clip(0) * 3.2) * orb["halo"]
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
            seac = far[None, None] * (1 - np.clip((fy - lvl) / 0.25, 0, 1))[..., None]                  + near[None, None] * np.clip((fy - lvl) / 0.25, 0, 1)[..., None]
            # a lit lane under the orb
            lane = np.exp(-((fx - mx) / 0.06) ** 2) * np.clip((fy - lvl) / 0.02, 0, 1) * 0.20
            seac += lane[..., None] * moon_c[None, None]
            sky = sky * (1 - band[..., None]) + seac * band[..., None]

        out = img * mask[..., None] + sky * (1 - mask)[..., None]
        mist_c = np.array(cfg["mist_color"], F) / 255
        out = out * (1 - mist[..., None]) + mist_c[None, None] * mist[..., None]
        out *= np.array(cfg["grade"], F)[None, None]
        vign = 1 - 0.32 * (((fx - 0.5) * 2) ** 2 + ((fy - 0.52) * 2) ** 2) ** 1.2
        out *= vign[..., None]
        return (np.clip(out, 0, 1) * 255).astype(np.uint8)
