"""Technique B: a human head as sculpture — single-material bust, Loomis proportions.

Faces are the acid test of blind drawing; features live in millimeters. The bet here:
build the head as ADDITIVE clay masses (no incising) in canonical proportions — cranium,
brow, cheekbones, nose wedge, closed eyelids, lip masses, jaw — and let a hard key light
do the work outlines can't. One material (warm stone) sidesteps color-blend smearing
entirely; what's left is form, and form is knowledge, which I have.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2] / "core"))
sys.path.insert(0, str(Path(__file__).parent))
from sdflib import Scene, render, save, sd_sphere, sd_ellipsoid, sd_capsule, sd_plane_y

STONE = (208, 196, 178)

s = Scene()

# cranium + forehead
s.add(lambda p: sd_ellipsoid(p, (0.0, 1.05, -0.04), (0.47, 0.46, 0.50)), STONE, k=0.06)
s.add(lambda p: sd_ellipsoid(p, (0.0, 1.26, 0.20), (0.37, 0.25, 0.27)), STONE, k=0.09)

# temples
s.add(lambda p: sd_ellipsoid(p, (-0.32, 1.10, 0.08), (0.09, 0.13, 0.14)), STONE, k=0.09)
s.add(lambda p: sd_ellipsoid(p, (0.32, 1.10, 0.08), (0.09, 0.13, 0.14)), STONE, k=0.09)

# jaw — two sweeps from below the ears to the chin, fused wide
s.add(lambda p: sd_capsule(p, (-0.36, 0.94, 0.06), (-0.05, 0.58, 0.24), 0.20), STONE, k=0.12)
s.add(lambda p: sd_capsule(p, (0.36, 0.94, 0.06), (0.05, 0.58, 0.24), 0.20), STONE, k=0.12)
s.add(lambda p: sd_sphere(p, (0.0, 0.56, 0.28), 0.12), STONE, k=0.08)  # chin

# cheek masses + cheekbones
s.add(lambda p: sd_ellipsoid(p, (-0.24, 0.90, 0.24), (0.17, 0.15, 0.12)), STONE, k=0.08)
s.add(lambda p: sd_ellipsoid(p, (0.24, 0.90, 0.24), (0.17, 0.15, 0.12)), STONE, k=0.08)
s.add(lambda p: sd_ellipsoid(p, (-0.30, 1.00, 0.20), (0.12, 0.07, 0.10)), STONE, k=0.07)
s.add(lambda p: sd_ellipsoid(p, (0.30, 1.00, 0.20), (0.12, 0.07, 0.10)), STONE, k=0.07)

# brow ridge — one bar, slightly proud, so the sockets read as shadow beneath it
s.add(lambda p: sd_capsule(p, (-0.24, 1.12, 0.34), (0.24, 1.12, 0.34), 0.07), STONE, k=0.04)

# nose — bridge wedge, tip ball, nostril flares
s.add(lambda p: sd_capsule(p, (0.0, 1.10, 0.36), (0.0, 0.85, 0.50), 0.05, 0.07), STONE, k=0.045)
s.add(lambda p: sd_sphere(p, (0.0, 0.84, 0.50), 0.062), STONE, k=0.032)
s.add(lambda p: sd_sphere(p, (-0.065, 0.815, 0.435), 0.032), STONE, k=0.026)
s.add(lambda p: sd_sphere(p, (0.065, 0.815, 0.435), 0.032), STONE, k=0.026)

# closed eyelids — serene; the brow's overhang shades them
s.add(lambda p: sd_ellipsoid(p, (-0.19, 1.01, 0.36), (0.105, 0.055, 0.065)), STONE, k=0.028)
s.add(lambda p: sd_ellipsoid(p, (0.19, 1.01, 0.36), (0.105, 0.055, 0.065)), STONE, k=0.028)

# mouth — two lip masses with a tight blend so the parting line survives as a valley
s.add(lambda p: sd_capsule(p, (-0.12, 0.70, 0.36), (0.12, 0.70, 0.36), 0.036), STONE, k=0.02)
s.add(lambda p: sd_capsule(p, (-0.095, 0.635, 0.36), (0.095, 0.635, 0.36), 0.042), STONE, k=0.02)

# ears
s.add(lambda p: sd_ellipsoid(p, (-0.47, 1.00, -0.02), (0.055, 0.13, 0.09)), STONE, k=0.045)
s.add(lambda p: sd_ellipsoid(p, (0.47, 1.00, -0.02), (0.055, 0.13, 0.09)), STONE, k=0.045)

# neck + bust base
s.add(lambda p: sd_capsule(p, (0.0, 0.80, -0.12), (0.0, 0.10, -0.06), 0.19), STONE, k=0.08)
s.add(lambda p: sd_ellipsoid(p, (0.0, 0.02, 0.0), (0.55, 0.20, 0.30)), STONE, k=0.10)

if __name__ == "__main__":
    out = Path(__file__).parent / "out"
    out.mkdir(exist_ok=True)
    tag = sys.argv[1] if len(sys.argv) > 1 else "v1"
    img = render(
        s, w=300, h=450, frame=(-0.80, 0.80, -0.20, 2.20),
        key_dir=(-0.5, 0.5, 0.68), key_i=1.0,
        fill_dir=(0.7, 0.1, 0.5), fill_i=0.16, fill_col=(0.5, 0.58, 0.72),
        rim_dir=(0.45, 0.3, -0.8), rim_i=0.55,
        ambient=0.12, bg_top=(30, 28, 33), bg_bot=(10, 9, 11),
    )
    print(save(img, out / ("b_head_" + tag + ".png")))
