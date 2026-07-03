"""Technique D: painterly stroke pass over a modeled underpainting.

The SDF renders are TRUE but smooth — they read as CG. This pass repaints them with a few
thousand short directional brushstrokes that follow the image's own flow field (strokes run
along iso-luminance lines, i.e. perpendicular to the gradient), with jittered color and length
inversely scaled by local detail. Coordinate imprecision becomes style: the model supplies
correct form and light, the strokes supply hand.

Usage: python d_painterly.py <input.png> <output.png> [seed]
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def paint(src_path, dst_path, seed=7, scale=2):
    rng = np.random.default_rng(seed)
    im = Image.open(src_path).convert("RGB")
    w0, h0 = im.size
    W, H = w0 * scale, h0 * scale
    big = im.resize((W, H), Image.LANCZOS)
    arr = np.asarray(big, dtype=np.float32) / 255.0

    lum = arr @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    gy, gx = np.gradient(lum)
    mag = np.sqrt(gx * gx + gy * gy)
    # flow = perpendicular to the gradient → strokes follow form contours
    ang = np.arctan2(gy, gx) + np.pi / 2

    canvas = big.filter(ImageFilter.GaussianBlur(6))  # muted underpainting
    draw = ImageDraw.Draw(canvas, "RGBA")

    n_strokes = 5200
    xs = rng.integers(0, W, n_strokes)
    ys = rng.integers(0, H, n_strokes)
    order = np.argsort(-mag[ys, xs] + rng.normal(0, 0.02, n_strokes))  # flat areas first, edges last
    for i in order:
        x, y = int(xs[i]), int(ys[i])
        m = float(mag[y, x])
        a = float(ang[y, x]) + rng.normal(0, 0.12)
        # long lazy strokes in flat areas, short careful ones at edges
        length = float(np.clip(26.0 / (1.0 + m * 40.0), 5, 26)) * (0.8 + 0.4 * rng.random())
        width = int(np.clip(7.0 / (1.0 + m * 30.0), 2, 7))
        c = arr[y, x] + rng.normal(0, 0.035, 3)
        c = tuple(int(v) for v in np.clip(c * 255, 0, 255)) + (210,)
        dx, dy = np.cos(a) * length / 2, np.sin(a) * length / 2
        draw.line([(x - dx, y - dy), (x + dx, y + dy)], fill=c, width=width)

    # a faint canvas-grain overlay
    grain = (rng.normal(0, 1, (H, W, 1)) * 5.5).astype(np.float32)
    outa = np.asarray(canvas, dtype=np.float32) + grain
    out = Image.fromarray(np.clip(outa, 0, 255).astype(np.uint8))
    out = out.resize((w0, h0), Image.LANCZOS)
    out.save(dst_path)
    print(dst_path)


if __name__ == "__main__":
    src = sys.argv[1]
    dst = sys.argv[2]
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else 7
    paint(src, dst, seed)
