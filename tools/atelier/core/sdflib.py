"""Sculpt-then-photograph: a tiny vectorized SDF raymarcher for representational illustration.

The idea: instead of DRAWING a subject (outlines at coordinates — which fails blind), MODEL it
as smooth-blended 3D primitives (spheres/capsules/ellipsoids melting together like clay) and
then LIGHT it. Realism comes from shading physics, not from line accuracy; smooth-min blending
produces organic, fleshy transitions no outline pass can fake.

Pure numpy; orthographic camera; Lambert key/fill/rim + cheap normal-ray ambient occlusion.
"""

import numpy as np

F = np.float32


def _n(v):
    v = np.asarray(v, dtype=F)
    return v / np.linalg.norm(v)


# ── primitives (p: (N,3) points; return (N,) distances) ─────────────────────

def sd_sphere(p, c, r):
    return np.linalg.norm(p - np.asarray(c, dtype=F), axis=1) - F(r)


def sd_ellipsoid(p, c, radii):
    # IQ's approximation — good enough for organic parts
    q = (p - np.asarray(c, dtype=F)) / np.asarray(radii, dtype=F)
    k0 = np.linalg.norm(q, axis=1)
    k1 = np.linalg.norm(q / np.asarray(radii, dtype=F), axis=1)
    return np.where(k1 > 1e-9, k0 * (k0 - 1.0) / np.maximum(k1, 1e-9), k0 - 1.0)


def sd_capsule(p, a, b, ra, rb=None):
    """Capsule from a to b; radius may taper linearly ra→rb (a rounded cone)."""
    a = np.asarray(a, dtype=F)
    b = np.asarray(b, dtype=F)
    if rb is None:
        rb = ra
    pa = p - a
    ba = b - a
    denom = float(np.dot(ba, ba)) or 1e-9
    h = np.clip((pa @ ba) / denom, 0.0, 1.0)
    d = np.linalg.norm(pa - np.outer(h, ba), axis=1)
    return d - (F(ra) + (F(rb) - F(ra)) * h)


def sd_plane_y(p, y):
    return p[:, 1] - F(y)


# ── smooth blending ──────────────────────────────────────────────────────────

def smin(a, b, k):
    """Polynomial smooth min — the 'clay' operator."""
    h = np.clip(0.5 + 0.5 * (b - a) / F(k), 0.0, 1.0)
    return b + (a - b) * h - F(k) * h * (1.0 - h)


# ── scene = list of parts; each part: (name, sdf_callable, albedo, blend_k) ──

class Scene:
    def __init__(self):
        self.parts = []

    def add(self, sdf, albedo, k=0.02, shiny=0.0):
        self.parts.append((sdf, np.asarray(albedo, dtype=F) / 255.0, F(k), F(shiny)))
        return self

    def dist(self, p):
        d = self.parts[0][0](p)
        for sdf, _c, k, _s in self.parts[1:]:
            d = smin(d, sdf(p), k) if k > 0 else np.minimum(d, sdf(p))
        return d

    def dist_color(self, p):
        """Distance + soft material blend (Gaussian weights on per-part distance)."""
        ds = np.stack([sdf(p) for sdf, _c, _k, _s in self.parts], axis=0)  # (P,N)
        d = ds[0]
        for i in range(1, len(self.parts)):
            k = self.parts[i][2]
            d = smin(d, ds[i], k) if k > 0 else np.minimum(d, ds[i])
        sigma = F(0.016)
        w = np.exp(-np.maximum(ds, 0.0) ** 2 / (2 * sigma * sigma)) + 1e-6
        w /= w.sum(axis=0, keepdims=True)
        cols = np.stack([c for _f, c, _k, _s in self.parts], axis=0)  # (P,3)
        shin = np.stack([s for _f, _c, _k, s in self.parts], axis=0)  # (P,)
        albedo = np.einsum("pn,pc->nc", w, cols)
        shiny = np.einsum("pn,p->n", w, shin)
        return d, albedo, shiny


# ── renderer ─────────────────────────────────────────────────────────────────

def render(scene, w=300, h=450, frame=(-1.0, 1.0, -0.5, 2.5), z0=3.0,
           key_dir=(-0.55, 0.7, 0.45), key_col=(1.0, 0.96, 0.88), key_i=1.0,
           fill_dir=(0.6, 0.25, 0.55), fill_col=(0.55, 0.62, 0.75), fill_i=0.35,
           rim_dir=(0.35, 0.35, -0.85), rim_col=(1.0, 0.9, 0.75), rim_i=0.5,
           ambient=0.16, bg_top=(38, 34, 30), bg_bot=(14, 12, 10),
           steps=96, eps=1.5e-3, max_t=8.0, aux=None):
    """Orthographic raymarch of the scene into an (h,w,3) uint8 image.

    frame = (x_min, x_max, y_min, y_max) of the view window in scene units.
    Scene convention: y up, x right, camera looks along -z from z0.
    """
    xs = np.linspace(frame[0], frame[1], w, dtype=F)
    ys = np.linspace(frame[3], frame[2], h, dtype=F)  # top→bottom
    gx, gy = np.meshgrid(xs, ys)
    n_pix = w * h
    ro = np.stack([gx.ravel(), gy.ravel(), np.full(n_pix, z0, dtype=F)], axis=1)
    rd = np.array([0.0, 0.0, -1.0], dtype=F)

    t = np.zeros(n_pix, dtype=F)
    alive = np.ones(n_pix, dtype=bool)
    hit = np.zeros(n_pix, dtype=bool)
    for _ in range(steps):
        if not alive.any():
            break
        p = ro[alive] + np.outer(t[alive], rd)
        d = scene.dist(p)
        idx = np.where(alive)[0]
        newly_hit = d < eps
        hit[idx[newly_hit]] = True
        t[idx] += np.maximum(d, eps * 0.5)
        dead = newly_hit | (t[idx] > max_t)
        alive[idx[dead]] = False

    img = np.zeros((n_pix, 3), dtype=F)
    # background: vertical gradient
    fy = np.repeat(np.linspace(0.0, 1.0, h, dtype=F), w)
    top = np.asarray(bg_top, dtype=F) / 255.0
    bot = np.asarray(bg_bot, dtype=F) / 255.0
    img[:] = top[None, :] * (1 - fy)[:, None] + bot[None, :] * fy[:, None]

    if hit.any():
        ph = ro[hit] + np.outer(t[hit], rd)
        d0, albedo, shiny = scene.dist_color(ph)

        # normals via central differences
        e = F(2e-3)
        nrm = np.zeros_like(ph)
        for ax in range(3):
            dp = np.zeros(3, dtype=F)
            dp[ax] = e
            nrm[:, ax] = scene.dist(ph + dp) - scene.dist(ph - dp)
        ln = np.linalg.norm(nrm, axis=1, keepdims=True)
        nrm /= np.maximum(ln, 1e-9)

        # cheap AO: how quickly does the field open up along the normal
        ao = np.zeros(len(ph), dtype=F)
        wsum = 0.0
        for i, dist_out in enumerate((0.02, 0.05, 0.11, 0.22)):
            wgt = 1.0 / (1.6 ** i)
            ao += wgt * np.clip(scene.dist(ph + nrm * F(dist_out)) / dist_out, 0.0, 1.0)
            wsum += wgt
        ao = (ao / wsum) ** 0.9

        def lam(direction):
            return np.clip(nrm @ _n(direction), 0.0, None)

        kd = lam(key_dir)
        fd = lam(fill_dir)
        rd_l = lam(rim_dir) ** 3.0
        light = (F(key_i) * np.outer(kd, np.asarray(key_col, dtype=F))
                 + F(fill_i) * np.outer(fd, np.asarray(fill_col, dtype=F))
                 + F(ambient) * ao[:, None])
        col = albedo * light
        # rim + specular sparkle scaled by material shininess
        col += F(rim_i) * np.outer(rd_l * ao, np.asarray(rim_col, dtype=F))
        spec = (kd ** 24.0) * shiny
        col += spec[:, None] * np.asarray(key_col, dtype=F)[None, :]

        img[hit] = col

    img = np.clip(img, 0.0, 1.0) ** (1 / 2.2)
    img8 = (img.reshape(h, w, 3) * 255).astype(np.uint8)

    if aux is not None:
        # G-buffer for style passes: subject mask, depth, screen-space normals, material id.
        mask = hit.reshape(h, w).astype(np.uint8)
        depth = np.zeros(n_pix, dtype=F)
        depth[hit] = t[hit]
        nrm_full = np.zeros((n_pix, 3), dtype=F)
        mat_full = np.zeros(n_pix, dtype=np.int16)
        if hit.any():
            nrm_full[hit] = nrm
            ds_h = np.stack([sdf(ph) for sdf, _c, _k, _s in scene.parts], axis=0)
            mat_full[hit] = np.argmin(ds_h, axis=0).astype(np.int16)
        np.savez_compressed(
            aux, mask=mask, depth=depth.reshape(h, w),
            normal=nrm_full.reshape(h, w, 3), material=mat_full.reshape(h, w),
        )
    return img8


def save(img, path):
    from PIL import Image
    Image.fromarray(img).save(path)
    return path
