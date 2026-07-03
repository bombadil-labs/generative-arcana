"""Byrne major-8 — ROAD TO NOWHERE (station: club).

Canon: "Acceptance of aimlessness, joy in not knowing. An open highway disappearing into
light, travelers dancing as they walk, movement without destination but with purpose."

The dead-straight road runs to a bright vanishing point; four figures at staggered depths
dance their way down it — each mid-move, none marching.

  python core/blender/runner.py projects/byrne/road_to_nowhere.py projects/byrne/out/nowhere
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bstage import BStage  # noqa: E402
from models import highway  # noqa: E402
from mpfb_body import mpfb_figure  # noqa: E402

st = BStage(ground_color=(84, 104, 66), ground_size=1200)     # rolling green plain

road = st.place(highway, at=(0.0, 0.0), z=0.0)

# travelers dancing as they walk — real bodies at staggered depths, each mid-move
walkers = [
    st.place(mpfb_figure, at=(4.2, 0.0), z=1.2, rot_z=0.15,
             clothes=[("male_casualsuit01", (122, 128, 138))], hair=("short02", (42, 38, 40)),
             l_arm=(0.6, 0.9), r_arm=(0.95, 2.3), l_leg=(-0.5, -0.2), r_leg=(0.55, 0.15),
             spine=0.1, head_tilt=0.25, airborne=0.08),
    st.place(mpfb_figure, at=(13.0, 0.0), z=-1.1, rot_z=-0.2,
             clothes=[("female_casualsuit01", (140, 108, 96))], hair=("bob01", (60, 44, 36)),
             macro={"gender": 0.1, "age": 0.45, "muscle": 0.4, "weight": 0.5, "height": 0.5,
                    "proportions": 0.6, "race": {"asian": 0.33, "caucasian": 0.34, "african": 0.33}},
             l_arm=(0.8, 1.3), r_arm=(0.35, 0.5), l_leg=(0.4, 0.1), r_leg=(-0.3, -0.1),
             spine=-0.08, head_tilt=-0.3),
    st.place(mpfb_figure, at=(24.0, 0.0), z=0.6, rot_z=0.3,
             clothes=[("male_casualsuit01", (96, 88, 100))], hair=("short04", (30, 28, 30)),
             l_arm=(1.2, 1.7), r_arm=(1.2, 1.7), l_leg=(-0.25, 0.0), r_leg=(0.45, 0.2),
             head_tilt=0.4, airborne=0.05),
]

st.emphasize(walkers[0])
st.attend(st.anchor_world(walkers[0], "chest"), polarity=1)
st.moon = (0.5, 0.30)                                          # the light at the road's end

st.sky_cfg = dict(
    top=(96, 138, 190), mid=(214, 222, 214),
    orb=dict(pos=(0.5, 0.31), r=0.05, color=(250, 246, 226), halo=0.75),
    horizon=None,
    grade=(1.0, 1.0, 0.98),
    mist_color=(200, 204, 196),
    aerial=dict(start=60.0, end=760.0, strength=0.6, color=(212, 216, 206)),
)
st.mist_cfg = dict(rise=0.75, peak=0.97, strength=0.3, cap=0.14)

st.sun((-0.25, -0.6, 0.35), color=(1.0, 0.96, 0.86), energy=3.0, angle=0.6)  # high bright day
st.sun((0.5, 0.3, -0.5), color=(0.6, 0.66, 0.76), energy=0.4, angle=0.9)
st.world_light((0.16, 0.17, 0.17), 1.1)

# low on the centerline, staring straight down the road into the light
st.camera(pos=(-4.5, 1.1, 0.0), target=(60.0, 2.6, 0.0), kind="PERSP", focal=34)

out_dir = sys.argv[sys.argv.index("--") + 1]
st.render(out_dir, w=340, h=510)
