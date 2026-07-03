"""The sculpture library: reusable, posable subject builders for SDF scenes.

The deck-illustration architecture Myk named: carve a few primitives (fox, crow, tree), make
them composable and posable, then illustrate the composed scene in a separate paint pass.

Each builder:
  - adds its parts to a Scene at an origin, with pose parameters (mirror, head_pitch, ...)
  - returns {"span": (i0, i1), "skeleton": [...]} — the part-index range (so pixel→creature
    identity survives into the G-buffer) and a fur/feather FLOW skeleton polyline in scene
    coords (nose→tail: the direction hair lies), for the painter's flow field.
"""

import numpy as np

from sdflib import sd_sphere, sd_ellipsoid, sd_capsule
from sculpt import _P

RUST = (172, 66, 22)
RUST_DEEP = (120, 44, 18)
CREAM = (226, 212, 188)
CHAR = (26, 21, 18)
BLACK = (16, 14, 15)
CROW_SHEEN = (38, 42, 58)
BARK = (34, 27, 22)
CHEESE = (222, 178, 92)




def fox(s, origin=(0.0, 0.0), mirror=False, head_pitch=0.0):
    """A seated fox. Local space: faces +x, haunch near local origin. head_pitch (radians,
    +up) rotates head/muzzle/ears/eye about the neck."""
    P = _P(origin[0], origin[1], mirror)
    piv = (0.42, 1.02)  # neck
    hp = head_pitch
    i0 = len(s.parts)
    s.add(lambda p: sd_ellipsoid(p, P(-0.10, 0.42), (0.42, 0.40, 0.32)), RUST_DEEP, k=0.08)
    s.add(lambda p: sd_capsule(p, P(-0.04, 0.55, 0.02), P(0.38, 0.86, 0.10), 0.28, 0.20), RUST, k=0.09)
    s.add(lambda p: sd_ellipsoid(p, P(0.38, 0.78, 0.16), (0.15, 0.21, 0.13)), CREAM, k=0.07)
    s.add(lambda p: sd_sphere(p, P(0.50, 1.16, 0.10, hp, piv), 0.185), RUST, k=0.05)
    s.add(lambda p: sd_capsule(p, P(0.55, 1.22, 0.14, hp, piv), P(0.72, 1.32, 0.20, hp, piv), 0.085, 0.030), RUST, k=0.04)
    s.add(lambda p: sd_sphere(p, P(0.745, 1.335, 0.21, hp, piv), 0.030), BLACK, k=0.005)
    s.add(lambda p: sd_capsule(p, P(0.38, 1.26, 0.02, hp, piv), P(0.26, 1.50, -0.04, hp, piv), 0.065, 0.010), CHAR, k=0.02)
    s.add(lambda p: sd_capsule(p, P(0.53, 1.30, 0.16, hp, piv), P(0.60, 1.55, 0.18, hp, piv), 0.065, 0.010), CHAR, k=0.02)
    s.add(lambda p: sd_sphere(p, P(0.565, 1.24, 0.245, hp, piv), 0.028), BLACK, k=0.0, shiny=0.9)
    s.add(lambda p: sd_capsule(p, P(0.34, 0.62, 0.14), P(0.36, 0.06, 0.18), 0.058, 0.048), CHAR, k=0.03)
    s.add(lambda p: sd_capsule(p, P(0.22, 0.60, 0.04), P(0.24, 0.06, 0.06), 0.058, 0.048), CHAR, k=0.03)
    s.add(lambda p: sd_capsule(p, P(-0.48, 0.28, -0.02), P(-0.44, 0.13, 0.20), 0.12, 0.15), RUST_DEEP, k=0.06)
    s.add(lambda p: sd_capsule(p, P(-0.44, 0.13, 0.20), P(0.02, 0.11, 0.32), 0.15, 0.11), RUST, k=0.06)
    s.add(lambda p: sd_sphere(p, P(0.10, 0.115, 0.33), 0.075), CREAM, k=0.04)
    i1 = len(s.parts)
    # fur lies nose→tail along this spine, draping downward off it
    skel = [P(0.74, 1.34, 0, hp, piv), P(0.50, 1.24, 0, hp, piv), (P(0.40, 1.00)), P(0.26, 0.86),
            P(0.00, 0.70), P(-0.24, 0.52), P(-0.44, 0.28), P(-0.45, 0.14), P(0.08, 0.115)]
    anchors = {"neck": P(0.42, 1.02), "nose": P(0.745, 1.335, 0, hp, piv),
               "eye": P(0.565, 1.24, 0, hp, piv), "feet": P(0.30, 0.0)}
    return {"span": (i0, i1), "skeleton": [(q[0], q[1]) for q in skel], "droop": 0.7,
            "coherence": 0.72, "anchors": {k: (v[0], v[1]) for k, v in anchors.items()}}


# staging affordances: local gaze geometry so a stager can solve "fox looks at X" before building
fox.neck_local = (0.42, 1.02)
fox.gaze0 = 0.77  # radians: angle of (nose - neck) at head_pitch = 0


def solve_fox_pitch(origin, target, mirror=False):
    """head_pitch so the fox's gaze line (neck→nose) points at a scene-space target."""
    nx = origin[0] + (-fox.neck_local[0] if mirror else fox.neck_local[0])
    ny = origin[1] + fox.neck_local[1]
    ang = np.arctan2(target[1] - ny, (target[0] - nx) * (-1 if mirror else 1))
    return float(np.clip(ang - fox.gaze0, -0.35, 0.35))


def _fox_solve_pose(origin, target, mirror=False):
    return {"head_pitch": solve_fox_pitch(origin, target, mirror)}


fox.solve_pose = _fox_solve_pose


def crow(s, origin=(0.0, 0.0), mirror=False):
    """A perched crow, head tipped down-forward. Local space: faces -x (beak at -x), feet at
    local origin. Returns span + feather-flow skeleton (beak→tail)."""
    P = _P(origin[0], origin[1], mirror)
    i0 = len(s.parts)
    s.add(lambda p: sd_ellipsoid(p, P(0.08, 0.155), (0.175, 0.12, 0.10)), BLACK, k=0.03)
    s.add(lambda p: sd_sphere(p, P(-0.08, 0.24, 0.01), 0.078), BLACK, k=0.025)
    s.add(lambda p: sd_capsule(p, P(-0.125, 0.22, 0.015), P(-0.26, 0.155, 0.03), 0.030, 0.006), CHAR, k=0.012)
    s.add(lambda p: sd_ellipsoid(p, P(-0.265, 0.145, 0.035), (0.045, 0.032, 0.030)), CHEESE, k=0.004)
    s.add(lambda p: sd_capsule(p, P(0.22, 0.12), P(0.45, -0.01, 0.01), 0.05, 0.012), BLACK, k=0.02)
    s.add(lambda p: sd_ellipsoid(p, P(0.07, 0.135, 0.062), (0.14, 0.09, 0.05)), CROW_SHEEN, k=0.03)
    s.add(lambda p: sd_capsule(p, P(0.0, 0.065), P(-0.005, -0.005), 0.016), CHAR, k=0.008)
    s.add(lambda p: sd_capsule(p, P(0.10, 0.065), P(0.10, -0.005), 0.016), CHAR, k=0.008)
    s.add(lambda p: sd_sphere(p, P(-0.115, 0.265, 0.072), 0.018), BLACK, k=0.0, shiny=0.95)
    i1 = len(s.parts)
    skel = [P(-0.24, 0.16), P(-0.08, 0.24), P(0.05, 0.19), P(0.22, 0.12), P(0.44, 0.0)]
    anchors = {"feet": P(0.05, -0.005), "head": P(-0.08, 0.24), "cheese": P(-0.265, 0.145)}
    return {"span": (i0, i1), "skeleton": [(q[0], q[1]) for q in skel], "droop": 0.35,
            "coherence": 0.85, "anchors": {k: (v[0], v[1]) for k, v in anchors.items()}}


crow.feet_local = (0.05, -0.005)


def bare_tree(s, origin=(0.0, 0.0), mirror=False):
    """A bare tree with a perch branch reaching -x. Local origin at the trunk's base.
    Bark grain is PER PART: each limb's strokes follow that limb's own axis."""
    P = _P(origin[0], origin[1], mirror)
    i0 = len(s.parts)
    grains = []

    def limb(a, b, ra, rb):
        idx = len(s.parts)
        s.add(lambda p: sd_capsule(p, a, b, ra, rb), BARK, k=0.03 if ra < 0.1 else 0.04)
        grains.append((idx, (a[0], a[1]), (b[0], b[1])))

    limb(P(0.04, -0.05, -0.10), P(-0.06, 1.95, -0.08), 0.17, 0.085)   # trunk
    limb(P(-0.05, 1.70, -0.08), P(-0.32, 2.02, -0.02), 0.075, 0.05)   # perch branch (elbow)
    limb(P(-0.32, 2.02, -0.02), P(-0.60, 2.16, 0.0), 0.05, 0.030)
    limb(P(-0.04, 1.42, -0.08), P(0.24, 1.62, -0.05), 0.05, 0.032)    # right branch
    limb(P(0.24, 1.62, -0.05), P(0.44, 1.92, -0.03), 0.032, 0.014)
    limb(P(-0.065, 2.86, -0.08), P(0.18, 2.48, -0.02), 0.030, 0.012)  # broken top, angling down
    limb(P(-0.065, 1.95, -0.08), P(-0.12, 2.9, -0.06), 0.06, 0.022)   # upper trunk
    i1 = len(s.parts)
    anchors = {"base": P(0.04, -0.05), "branch_end": P(-0.58, 2.18), "top": P(-0.12, 2.90)}
    return {"span": (i0, i1), "skeleton": None, "grains": grains, "droop": 0.0,
            "coherence": 0.9, "aged": True, "anchors": {k: (v[0], v[1]) for k, v in anchors.items()}}
