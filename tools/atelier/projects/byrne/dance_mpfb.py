"""I DANCE LIKE THIS with the MPFB parametric body — the new-body experiment.

Same card, same wobble pose grammar, same stage light, same painter; only the figure's
source changed: a real anatomical body under the lofted oversized jacket.

  python core/blender/runner.py projects/byrne/dance_mpfb.py <out_dir> [pose]
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bstage import BStage  # noqa: E402
from models import _loft  # noqa: E402
from mpfb_body import mpfb_figure  # noqa: E402
from bsculpt import Builder  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:]
out_dir = args[0]
pose = args[1] if len(args) > 1 else "wobble"

POSES = {
    # (upper, lower) absolute angle-from-down, positive = OUTWARD per side
    # arm signs: POSITIVE = outward per side (negative sends the forearm through
    # the torso — FK has no collision sense; the wobble learned this the hard way)
    "wobble": dict(l_arm=(0.5, 0.68), r_arm=(0.75, 1.05),
                   l_leg=(-0.38, -0.15), r_leg=(0.42, 0.18),
                   spine=-0.14, head_tilt=0.35, airborne=0.0),
    "chop": dict(l_arm=(0.7, 2.2), r_arm=(0.7, 0.35),
                 l_leg=(-0.45, -0.2), r_leg=(0.5, 0.1),
                 spine=0.1, head_tilt=-0.35, airborne=0.06),
    # the 1984 lurch: contained stance, arms hanging slightly out, the SUIT does the talking
    "bigsuit": dict(l_arm=(0.4, 0.6), r_arm=(0.55, 0.8),
                    l_leg=(-0.3, -0.1), r_leg=(0.35, 0.12),
                    spine=0.08, head_tilt=0.25, airborne=0.0),
}

# the Big Suit is a FIT: garments fitted while the body wears heavyweight macros,
# then the man slims back down inside his suit. Lapels via the elegant-suit garment
# (MHCLO fits any body — that is the point of the format).
if pose == "bigsuit":
    COSTUME = dict(clothes=[("male_casualsuit01", (168, 170, 176))],
                   fit_macro={"weight": 0.95, "muscle": 0.8})
else:
    COSTUME = dict(clothes=[("male_casualsuit01", (122, 128, 138))], fit_macro=None)

st = BStage(ground_color=(16, 16, 18), ground_size=300)

# American Utopia: the fitted grey suit, barefoot — real MHCLO garments that fit the
# body and deform with the rig (the Big Suit is 1984; this card is the Utopia stage)
fig = st.place(mpfb_figure, at=(0.0, 0.0), z=0.0, rot_z=0.0,
               body_color=(112, 118, 128),
               hair=("short02", (42, 38, 40)),
               **COSTUME, **POSES[pose])

# (the lofted marshmallow jacket retired: the MHCLO suit is a real garment)

st.emphasize(fig)
st.attend(st.anchor_world(fig, "chest"), polarity=1)
st.moon = (0.24, 0.2)

st.sky_cfg = dict(
    top=(10, 10, 12), mid=(22, 22, 26),
    orb=None, horizon=None,
    grade=(1.0, 1.0, 1.04),
    mist_color=(40, 40, 46),
    aerial=dict(start=40.0, end=280.0, strength=0.3, color=(24, 24, 28)),
)
st.mist_cfg = dict(rise=0.5, peak=0.9, strength=0.12, cap=0.06)
# illumination, not reflection: softer key, tamed rim, real ambient wrap
st.sun((-0.7, -0.6, 0.35), color=(1.0, 0.9, 0.74), energy=3.0, angle=0.4)
st.sun((0.75, -0.15, -0.4), color=(0.5, 0.62, 0.85), energy=0.8, angle=0.6)
st.world_light((0.10, 0.10, 0.12), 1.0)

# the hero angle from the study: three-quarter, slightly high
st.camera(pos=(3.2, 1.15, 1.9), target=(0.0, 0.85, 0.0), kind="PERSP", focal=46)

st.render(out_dir, w=340, h=510)
