"""Technique A test subject: a sitting red fox, sculpted from smooth-blended primitives.

Anatomy notes driving the build (knowledge-first, then eyes-on refinement):
sitting fox = large haunch mass, upright tapering chest, small head (~1/5 body), tall ears
(~2/3 head height), brush tail as long as the body curled around the paws, cream bib and
tail tip, charcoal stockings and ear backs.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2] / "core"))
sys.path.insert(0, str(Path(__file__).parent))
from sdflib import Scene, render, save, sd_sphere, sd_ellipsoid, sd_capsule, sd_plane_y

RUST = (188, 74, 24)
RUST_DEEP = (138, 50, 20)
CREAM = (240, 228, 205)
CHAR = (30, 24, 21)
NOSE = (18, 15, 13)
GROUND = (58, 48, 40)

s = Scene()

# ground (hard min — the world shouldn't goo into the fox)
s.add(lambda p: sd_plane_y(p, 0.0), GROUND, k=0.0)

# body mass
s.add(lambda p: sd_ellipsoid(p, (0.28, 0.42, 0.0), (0.44, 0.42, 0.34)), RUST_DEEP, k=0.08)   # haunch
s.add(lambda p: sd_capsule(p, (0.20, 0.55, 0.02), (-0.26, 0.82, 0.12), 0.30, 0.22), RUST, k=0.09)  # torso rising to chest
s.add(lambda p: sd_ellipsoid(p, (-0.27, 0.72, 0.20), (0.17, 0.24, 0.15)), CREAM, k=0.07)     # bib

# head + muzzle
s.add(lambda p: sd_sphere(p, (-0.42, 1.12, 0.16), 0.21), RUST, k=0.05)
s.add(lambda p: sd_capsule(p, (-0.46, 1.08, 0.22), (-0.70, 0.99, 0.32), 0.10, 0.035), RUST, k=0.04)  # muzzle
s.add(lambda p: sd_capsule(p, (-0.48, 1.03, 0.24), (-0.66, 0.97, 0.32), 0.06, 0.03), CREAM, k=0.03)  # chin/underjaw
s.add(lambda p: sd_sphere(p, (-0.715, 0.99, 0.335), 0.035), NOSE, k=0.005)

# ears — tapered cones off the skull
s.add(lambda p: sd_capsule(p, (-0.50, 1.26, 0.08), (-0.58, 1.55, 0.02), 0.075, 0.012), CHAR, k=0.02)
s.add(lambda p: sd_capsule(p, (-0.31, 1.28, 0.20), (-0.27, 1.58, 0.18), 0.075, 0.012), CHAR, k=0.02)

# eyes — small, dark, proud of the fur so the material blend can't bleach them
s.add(lambda p: sd_sphere(p, (-0.53, 1.15, 0.345), 0.034), NOSE, k=0.0, shiny=0.9)
s.add(lambda p: sd_sphere(p, (-0.34, 1.17, 0.365), 0.034), NOSE, k=0.0, shiny=0.9)

# inner ears
s.add(lambda p: sd_capsule(p, (-0.50, 1.27, 0.11), (-0.56, 1.47, 0.06), 0.038, 0.008), CREAM, k=0.005)
s.add(lambda p: sd_capsule(p, (-0.31, 1.29, 0.23), (-0.28, 1.50, 0.21), 0.038, 0.008), CREAM, k=0.005)

# forelegs — straight, close together, charcoal stockings
s.add(lambda p: sd_capsule(p, (-0.28, 0.62, 0.16), (-0.31, 0.07, 0.22), 0.062, 0.05), CHAR, k=0.03)
s.add(lambda p: sd_capsule(p, (-0.16, 0.60, 0.06), (-0.18, 0.07, 0.09), 0.062, 0.05), CHAR, k=0.03)
s.add(lambda p: sd_sphere(p, (-0.32, 0.06, 0.24), 0.06), CHAR, k=0.02)
s.add(lambda p: sd_sphere(p, (-0.19, 0.06, 0.10), 0.06), CHAR, k=0.02)

# the brush — a curled tail wrapping the ground line, cream tip
s.add(lambda p: sd_capsule(p, (0.64, 0.32, -0.02), (0.56, 0.14, 0.22), 0.14, 0.17), RUST_DEEP, k=0.06)
s.add(lambda p: sd_capsule(p, (0.56, 0.14, 0.22), (0.06, 0.12, 0.36), 0.17, 0.13), RUST, k=0.06)
s.add(lambda p: sd_capsule(p, (0.06, 0.12, 0.36), (-0.22, 0.13, 0.31), 0.13, 0.08), RUST, k=0.05)
s.add(lambda p: sd_sphere(p, (-0.29, 0.13, 0.31), 0.07), CREAM, k=0.03)

if __name__ == "__main__":
    out = Path(__file__).parent / "out"
    out.mkdir(exist_ok=True)
    img = render(s, w=300, h=450, frame=(-1.05, 0.65, -0.05, 2.50),
                 key_i=1.05, fill_i=0.24, ambient=0.14,
                 bg_top=(96, 66, 52), bg_bot=(22, 16, 14),
                 aux=str(out / "a_fox_aux.npz"))
    print(save(img, out / ("a_fox_" + (sys.argv[1] if len(sys.argv) > 1 else "v2") + ".png")))
