"""The Fox and the Crow — parity scene for the Blender backend. Runs inside Blender:

  python core/blender/runner.py projects/fable/blender_scene.py projects/fable/out/blender

Same geometry as creatures.py, rebuilt with bsculpt mesh primitives; ortho camera matching the
numpy backend's frame so the painted result can be compared like-for-like.
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
from bstage import BStage  # noqa: E402
from bsculpt import Builder, ClayBuilder, smooth_all  # noqa: E402

RUST = (172, 66, 22)
RUST_DEEP = (120, 44, 18)
CREAM = (226, 212, 188)
CHAR = (26, 21, 18)
BLACK = (16, 14, 15)
CROW_SHEEN = (38, 42, 58)
BARK = (34, 27, 22)
CHEESE = (222, 178, 92)

NECK = (0.42, 1.02)


def _pitch(x, y, hp):
    dx, dy = x - NECK[0], y - NECK[1]
    c, s = np.cos(hp), np.sin(hp)
    return (NECK[0] + dx * c - dy * s, NECK[1] + dx * s + dy * c)


def fox(head_pitch=0.0):
    hp = head_pitch
    b = ClayBuilder("fox")

    def P(x, y, z=0.0):
        px, py = _pitch(x, y, hp)
        return (px, py, z)

    b.ellipsoid((-0.10, 0.42, 0.0), (0.42, 0.40, 0.32), RUST_DEEP)
    b.capsule((-0.04, 0.55, 0.02), (0.38, 0.86, 0.10), 0.28, 0.20, RUST)
    b.ellipsoid((0.38, 0.78, 0.16), (0.15, 0.21, 0.13), CREAM)
    b.sphere(P(0.50, 1.16, 0.10), 0.185, RUST)
    b.capsule(P(0.55, 1.22, 0.14), P(0.72, 1.32, 0.20), 0.085, 0.030, RUST)
    b.sphere(P(0.745, 1.335, 0.21), 0.030, BLACK, hard=True)
    b.capsule(P(0.38, 1.26, 0.02), P(0.26, 1.50, -0.04), 0.065, 0.010, CHAR)
    b.capsule(P(0.53, 1.30, 0.16), P(0.60, 1.55, 0.18), 0.065, 0.010, CHAR)
    b.sphere(P(0.565, 1.24, 0.245), 0.028, BLACK, roughness=0.15, hard=True)
    b.capsule((0.34, 0.62, 0.14), (0.36, 0.06, 0.18), 0.058, 0.048, CHAR)
    b.capsule((0.22, 0.60, 0.04), (0.24, 0.06, 0.06), 0.058, 0.048, CHAR)
    b.capsule((-0.48, 0.28, -0.02), (-0.44, 0.13, 0.20), 0.12, 0.15, RUST_DEEP)
    b.capsule((-0.44, 0.13, 0.20), (0.02, 0.11, 0.32), 0.15, 0.11, RUST)
    b.sphere((0.10, 0.115, 0.33), 0.075, CREAM)
    b.anchor("neck", NECK)
    b.anchor("nose", P(0.745, 1.335, 0.21))
    b.anchor("feet", (0.30, 0.0))
    skel = [P(0.74, 1.34), P(0.50, 1.24), (0.40, 1.00), (0.26, 0.86), (0.00, 0.70),
            (-0.24, 0.52), (-0.44, 0.28), (-0.45, 0.14), (0.08, 0.115)]
    info = b.finish(skeleton=skel, droop=0.7, coherence=0.72)
    return info


def crow():
    b = ClayBuilder("crow")
    b.ellipsoid((0.08, 0.155, 0.0), (0.175, 0.12, 0.10), BLACK)
    b.sphere((-0.08, 0.24, 0.01), 0.078, BLACK)
    b.capsule((-0.125, 0.22, 0.015), (-0.26, 0.155, 0.03), 0.030, 0.006, CHAR)
    b.ellipsoid((-0.265, 0.145, 0.035), (0.045, 0.032, 0.030), CHEESE, roughness=0.5, hard=True)
    b.capsule((0.22, 0.12, 0.0), (0.45, -0.01, 0.01), 0.05, 0.012, BLACK)
    b.ellipsoid((0.07, 0.135, 0.062), (0.14, 0.09, 0.05), CROW_SHEEN)
    b.capsule((0.0, 0.065, 0.0), (-0.005, -0.005, 0.0), 0.016, 0.016, CHAR)
    b.capsule((0.10, 0.065, 0.0), (0.10, -0.005, 0.0), 0.016, 0.016, CHAR)
    b.sphere((-0.115, 0.265, 0.072), 0.018, BLACK, roughness=0.1, hard=True)
    b.anchor("feet", (0.05, -0.005))
    b.anchor("head", (-0.08, 0.24))
    b.anchor("cheese", (-0.265, 0.145))
    skel = [(-0.24, 0.16), (-0.08, 0.24), (0.05, 0.19), (0.22, 0.12), (0.44, 0.0)]
    info = b.finish(skeleton=skel, droop=0.35, coherence=0.85)
    return info


def bare_tree():
    b = ClayBuilder("tree")
    grains = []

    def limb(a, bb, ra, rb):
        i_before = Builder._next_index[0]
        b.capsule(a, bb, ra, rb, BARK)
        for i in range(i_before, Builder._next_index[0]):
            grains.append((i, (a[0], a[1]), (bb[0], bb[1])))

    limb((0.04, -0.05, -0.10), (-0.06, 1.95, -0.08), 0.17, 0.085)
    limb((-0.05, 1.70, -0.08), (-0.32, 2.02, -0.02), 0.075, 0.05)
    limb((-0.32, 2.02, -0.02), (-0.60, 2.16, 0.0), 0.05, 0.030)
    limb((-0.04, 1.42, -0.08), (0.24, 1.62, -0.05), 0.05, 0.032)
    limb((0.24, 1.62, -0.05), (0.44, 1.92, -0.03), 0.032, 0.014)
    limb((-0.065, 2.86, -0.08), (0.18, 2.48, -0.02), 0.030, 0.012)
    limb((-0.065, 1.95, -0.08), (-0.12, 2.9, -0.06), 0.06, 0.022)
    b.anchor("base", (0.04, -0.05))
    b.anchor("branch_end", (-0.58, 2.18))
    b.anchor("top", (-0.12, 2.90))
    info = b.finish(skeleton=None, grains=grains, droop=0.0, coherence=0.9, aged=True)
    return info


st = BStage(ground_color=(40, 36, 34))
fox_i = st.place(fox, at=(-0.62, 0.0), head_pitch=0.20)
tree_i = st.place(bare_tree, at=(0.62, 0.0))
crow_i = st.place(crow, at=(0.0, 0.0))
st.perch(crow_i, st.anchor_world(tree_i, "branch_end"))

st.attend(st.anchor_world(crow_i, "head"), polarity=-1)
st.stars((0.66, 0.07), (0.88, 0.16), (0.94, 0.40), (0.06, 0.46), (0.32, 0.05))

# moonlight rig (directions are travel vectors: negated sdflib "toward light" dirs)
st.sun((0.5, -0.75, -0.45), color=(0.82, 0.86, 1.0), energy=2.6)                 # key
st.sun((-0.4, 0.2, -0.7), color=(0.9, 0.65, 0.45), energy=0.35)                  # warm fill
st.sun((0.45, -0.4, 0.75), color=(0.85, 0.9, 1.0), energy=1.4)                   # rim
st.world_light((0.02, 0.022, 0.032), 1.0)

# the framer: ortho, matching the numpy frame (-1.35..1.15 x, -0.10..3.65 y)
st.camera(pos=(-0.10, 1.775, 8.0), target=(-0.10, 1.775, 0.0), kind="ORTHO", ortho_scale=3.75)

out_dir = sys.argv[sys.argv.index("--") + 1]
st.render(out_dir, w=340, h=510)
