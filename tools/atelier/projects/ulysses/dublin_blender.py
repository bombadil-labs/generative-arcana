"""Dublin cast for the Blender backend — the recurring figures of the Ulysses majors.

Factored on the reuse scan: Stephen appears in ~7 majors, Bloom in ~10, anonymous coated men
throughout. All silhouette-grade (presences, not portraits): clay bodies, identity through
build and posture — Stephen thin and angular in black, Bloom fuller with hat and coat mass.

Each builder follows the sculptor contract and is placed/posed by the stager (root transforms
give position/scale/facing; pose params give arms/lean/props).
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
from bsculpt import Builder, ClayBuilder  # noqa: E402

BLACK_COAT = (24, 23, 26)
BOOK = (96, 62, 44)
ASH = (110, 96, 78)


def person(name="figure", coat=BLACK_COAT, slim=1.0, arms="down", lean=0.0,
           book=False, stick=False, head_bare=(58, 48, 42)):
    """A standing figure ~0.98 units tall, feet at local origin, facing +x.
    slim < 1 narrows the body (Stephen ≈ 0.8); arms: down | akimbo | raised."""
    b = ClayBuilder(name, resolution=0.03)
    s = slim
    lx = 0.30 * np.sin(lean)

    b.capsule((-0.045 * s, 0.03, 0.0), (-0.05 * s, 0.44, 0.0), 0.05, 0.055, coat)
    b.capsule((0.045 * s, 0.03, 0.0), (0.05 * s, 0.44, 0.0), 0.05, 0.055, coat)
    b.capsule((0.0, 0.42, 0.0), (lx * 0.5, 0.80, 0.0), 0.105 * s, 0.09 * s, coat)      # torso
    b.sphere((lx * 0.55, 0.855, 0.0), 0.062, coat)                                      # collar/neck
    if arms == "raised":
        b.capsule((lx * 0.5 - 0.09 * s, 0.78, 0.0), (lx * 0.5 - 0.17 * s, 1.02, 0.0), 0.036, 0.030, coat)
        b.capsule((lx * 0.5 + 0.09 * s, 0.78, 0.0), (lx * 0.5 + 0.17 * s, 1.02, 0.0), 0.036, 0.030, coat)
    elif arms == "akimbo":
        b.capsule((lx * 0.5 - 0.095 * s, 0.76, 0.0), (lx * 0.5 - 0.13 * s, 0.58, 0.0), 0.034, 0.028, coat)
        b.capsule((lx * 0.5 + 0.095 * s, 0.76, 0.0), (lx * 0.5 + 0.13 * s, 0.58, 0.0), 0.034, 0.028, coat)
    else:
        b.capsule((lx * 0.5 - 0.095 * s, 0.76, 0.0), (lx * 0.5 - 0.105 * s, 0.48, 0.0), 0.034, 0.028, coat)
        b.capsule((lx * 0.5 + 0.095 * s, 0.76, 0.0), (lx * 0.5 + 0.105 * s, 0.48, 0.0), 0.034, 0.028, coat)
    b.sphere((lx * 0.6, 0.92, 0.0), 0.075, head_bare)                                    # head (clay)

    if book:
        b.block((lx * 0.5 + 0.115 * s, 0.55, 0.02), (0.035, 0.10, 0.075), BOOK, roughness=0.6)
    if stick:
        b.capsule((lx * 0.5 - 0.13 * s, 0.02, 0.06), (lx * 0.5 - 0.15 * s, 0.62, 0.05),
                  0.008, 0.008, ASH, hard=True)

    b.anchor("feet", (0.0, 0.0))
    b.anchor("head", (lx * 0.6, 0.93))
    b.anchor("chest", (lx * 0.5, 0.70))
    skel = [(lx * 0.6, 0.99), (lx * 0.5, 0.60), (0.0, 0.03)]
    return b.finish(skeleton=skel, droop=0.9, coherence=0.82)


def stephen(arms="down", lean=0.0, book=True, stick=False):
    """Thin, angular, dressed in black; usually carrying the book."""
    return person("stephen", coat=BLACK_COAT, slim=0.8, arms=arms, lean=lean,
                  book=book, stick=stick)


def bloom(arms="down", lean=0.0):
    """Fuller build; bowler-hatted. (Hat = a hard disc + dome above the clay head.)"""
    info_builder = ClayBuilder("bloom", resolution=0.03)
    # placeholder: full Bloom lands with the first Bloom card (Calypso/Hades)
    raise NotImplementedError("Bloom arrives with his first card")
