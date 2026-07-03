"""Technique C: the cameo — a profile portrait as 2.5D relief.

The frontal 3D face hit additive-clay's ceiling (features are cuts, not bumps). The classical
answer is the PROFILE: in a cameo, the entire likeness lives in one silhouette line — and a 2D
outline is exactly the thing an eyes-on loop can judge and tune point by point. Pipeline:

  profile polygon (authored, iterable) → signed distance field → smooth relief height
  + feature bumps/dips (cheek, eyelid, ear, nostril) → normals from the height gradient
  → lit as shell-on-sardonyx, with cavity shading from the height Laplacian.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image

F = np.float32
W, H = 360, 540
# canvas space: x in [0, 2.4], y in [0, 3.6], y up
XMAX, YMAX = 2.4, 3.6


def grid():
    xs = np.linspace(0, XMAX, W, dtype=F)
    ys = np.linspace(YMAX, 0, H, dtype=F)
    gx, gy = np.meshgrid(xs, ys)
    return gx.ravel(), gy.ravel()


def chaikin(pts, rounds=3):
    """Corner-cutting subdivision — turns an authored polyline into an organic curve."""
    v = [tuple(q) for q in pts]
    for _ in range(rounds):
        out = []
        n = len(v)
        for i in range(n):
            a, b = v[i], v[(i + 1) % n]
            out.append((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]))
            out.append((0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))
        v = out
    return v


def blur(h, rounds=2):
    for _ in range(rounds):
        h = (h + np.roll(h, 1, 0) + np.roll(h, -1, 0) + np.roll(h, 1, 1) + np.roll(h, -1, 1)) / 5.0
    return h


def sd_polygon(px, py, pts):
    """Signed distance to polygon (negative inside). pts: list of (x, y)."""
    v = np.asarray(pts, dtype=F)
    n = len(v)
    p = np.stack([px, py], axis=1)
    d = np.full(len(p), np.inf, dtype=F)
    sign = np.ones(len(p), dtype=F)
    j = n - 1
    for i in range(n):
        a, b = v[j], v[i]
        e = b - a
        w = p - a
        denom = float(e @ e) or 1e-12
        t = np.clip((w @ e) / denom, 0.0, 1.0)
        proj = a + np.outer(t, e)
        d = np.minimum(d, np.linalg.norm(p - proj, axis=1))
        # winding parity (crossing test)
        cond1 = (a[1] <= py) & (b[1] > py)
        cond2 = (b[1] <= py) & (a[1] > py)
        xint = a[0] + (py - a[1]) / (e[1] if abs(e[1]) > 1e-12 else 1e-12) * e[0]
        crosses = (cond1 | cond2) & (px < xint)
        sign = np.where(crosses, -sign, sign)
        j = i
    return d * sign


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def gauss(px, py, cx, cy, sx, sy, theta=0.0):
    ct, st = np.cos(theta), np.sin(theta)
    dx = (px - cx) * ct + (py - cy) * st
    dy = -(px - cx) * st + (py - cy) * ct
    return np.exp(-(dx * dx) / (2 * sx * sx) - (dy * dy) / (2 * sy * sy))


# ── the profile: authored, and meant to be edited by eye ─────────────────────
# Right-facing head, from crown clockwise down the face, around the bust, up the back.
FACE = [
    (1.00, 3.34),   # crown
    (1.30, 3.22),   # upper forehead (hair sweep)
    (1.42, 2.98),   # forehead
    (1.47, 2.80),   # brow
    (1.43, 2.73),   # brow notch (root of nose)
    (1.62, 2.52),   # nose bridge → tip
    (1.60, 2.465),  # nose tip underside
    (1.47, 2.42),   # nostril base
    (1.46, 2.35),   # philtrum
    (1.53, 2.29),   # upper lip
    (1.49, 2.255),  # lip parting
    (1.525, 2.19),  # lower lip
    (1.47, 2.13),   # lip–chin crease
    (1.52, 2.02),   # chin
    (1.44, 1.92),   # under-chin
    (1.10, 1.83),   # jaw → throat
    (1.00, 1.62),   # neck front
    (1.04, 1.40),   # neck base front
    (1.38, 1.22),   # collar swell
    (1.32, 0.95),   # bust lower front
    (0.34, 0.90),   # bust bottom front
    (0.24, 1.02),   # bust bottom back
    (0.46, 1.42),   # shoulder back
    (0.55, 1.70),   # neck back
    (0.42, 1.95),   # under the bun
    (0.28, 2.12),   # bun (low)
    (0.30, 2.38),   # bun (full)
    (0.46, 2.50),   # bun meets skull
    (0.44, 2.72),   # back of skull
    (0.56, 3.02),   # back of skull (high)
    (0.74, 3.24),   # crown back
]


def build(tag="v1"):
    px, py = grid()

    d_face = sd_polygon(px, py, chaikin(FACE))

    # relief heights: smooth rise from the edge inward, capped — classic shallow cameo
    h_face = smoothstep(0.0, 0.16, -d_face) * 0.55 + smoothstep(0.0, 0.5, -d_face) * 0.10

    # facial feature modeling (bumps and dips on the face layer)
    feat = (
        + 0.14 * gauss(px, py, 1.12, 2.42, 0.20, 0.24)          # cheek dome
        + 0.07 * gauss(px, py, 1.30, 2.72, 0.13, 0.05, 0.1)     # brow bump
        - 0.07 * gauss(px, py, 1.27, 2.63, 0.11, 0.05, -0.1)    # eye socket dip
        + 0.05 * gauss(px, py, 1.30, 2.585, 0.085, 0.032, -0.15)   # closed eyelid
        - 0.028 * gauss(px, py, 1.315, 2.555, 0.075, 0.012, -0.18) # lash line (a cut)
        - 0.025 * gauss(px, py, 1.42, 2.44, 0.05, 0.03)         # nostril shadow
        + 0.06 * gauss(px, py, 0.88, 2.38, 0.09, 0.13)          # ear
        - 0.035 * gauss(px, py, 0.88, 2.38, 0.038, 0.06)        # ear hollow
        + 0.05 * gauss(px, py, 1.06, 1.62, 0.10, 0.26, 0.15)    # sternomastoid
        - 0.05 * gauss(px, py, 1.18, 2.06, 0.16, 0.05, 0.25)    # jaw/under-chin shadow line
        + 0.16 * gauss(px, py, 0.72, 2.85, 0.30, 0.38)          # hair mass dome (crown)
        + 0.10 * gauss(px, py, 0.38, 2.24, 0.14, 0.16)          # the bun
        - 0.03 * gauss(px, py, 1.05, 2.95, 0.30, 0.035, -0.35)  # hairline shadow
    )
    inside = (d_face < -0.02).astype(F)
    h = h_face + feat * inside

    h = blur(h.reshape(H, W), rounds=3)

    # ── shade: normals from gradient, cavity from laplacian ──
    gy_, gx_ = np.gradient(h)
    scale = 60.0
    nx, ny = -gx_ * scale, gy_ * scale
    nz = np.ones_like(h) * 1.0
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / ln, ny / ln, nz / ln

    L = np.array([-0.55, 0.60, 0.60], dtype=F)
    L /= np.linalg.norm(L)
    lam = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, None)
    L2 = np.array([0.6, -0.1, 0.5], dtype=F)
    L2 /= np.linalg.norm(L2)
    lam2 = np.clip(nx * L2[0] + ny * L2[1] + nz * L2[2], 0, None)

    lap = (np.roll(h, 1, 0) + np.roll(h, -1, 0) + np.roll(h, 1, 1) + np.roll(h, -1, 1) - 4 * h)
    cavity = np.clip(1.0 + lap * 90.0, 0.55, 1.25)

    relief_mask = (h > 0.012).astype(F)
    # soft drop shadow of the whole relief onto the ground, offset down-right
    sh = np.roll(np.roll(relief_mask, 10, axis=0), 6, axis=1)
    for _ in range(3):
        sh = (sh + np.roll(sh, 3, 0) + np.roll(sh, -3, 0) + np.roll(sh, 3, 1) + np.roll(sh, -3, 1)) / 5.0

    shell = np.array([246, 240, 228], dtype=F) / 255
    shell_deep = np.array([216, 198, 172], dtype=F) / 255
    ground_top = np.array([64, 42, 34], dtype=F) / 255
    ground_bot = np.array([38, 22, 18], dtype=F) / 255

    fy = np.linspace(0, 1, H, dtype=F)[:, None]
    ground = ground_top * (1 - fy)[..., None] + ground_bot * fy[..., None]
    ground = ground * (1 - 0.55 * sh[..., None] * (1 - relief_mask[..., None]))

    # shell tone: thin relief shows the dark ground through (classic cameo translucency)
    thin = np.clip(h / 0.5, 0, 1) ** 0.7
    albedo = shell_deep[None, None] * (1 - thin[..., None]) + shell[None, None] * thin[..., None]
    lit = albedo * (0.30 + 0.85 * lam[..., None] + 0.18 * lam2[..., None]) * cavity[..., None]
    spec = (lam ** 30.0) * 0.18
    lit += spec[..., None]

    img = ground * (1 - relief_mask[..., None]) + lit * relief_mask[..., None]

    # oval bezel: gold ring, lit top-left
    exx = (np.linspace(0, XMAX, W, dtype=F)[None, :] - 1.16) / 1.02
    eyy = (np.linspace(YMAX, 0, H, dtype=F)[:, None] - 2.02) / 1.52
    er = np.sqrt(exx * exx + eyy * eyy)
    ring = np.clip(1 - np.abs(er - 1.0) / 0.045, 0, 1) ** 1.5
    ang = (-exx * 0.7 + eyy * 0.7)
    gold = np.array([182, 148, 82], dtype=F) / 255
    gold_hi = np.array([243, 224, 168], dtype=F) / 255
    ring_col = gold[None, None] * (0.55 + 0.45 * np.clip(ang, 0, 1))[..., None] + gold_hi[None, None] * (np.clip(ang, 0, 1) ** 3)[..., None] * 0.8
    img = img * (1 - ring[..., None]) + ring_col * ring[..., None]
    # darken outside the oval
    outside = smoothstep(1.02, 1.25, er)
    img *= (1 - 0.5 * outside)[..., None]
    img = np.clip(img, 0, 1) ** (1 / 2.2)
    out = Path(__file__).parent / "out"
    out.mkdir(exist_ok=True)
    path = out / f"c_cameo_{tag}.png"
    Image.fromarray((img * 255).astype(np.uint8)).save(path)
    print(path)


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else "v1")
