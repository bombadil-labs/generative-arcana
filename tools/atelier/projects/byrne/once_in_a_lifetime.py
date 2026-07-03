"""Byrne major-7 — ONCE IN A LIFETIME (station: headphones).

Canon: "The recognition moment. A figure looking at their reflection in water, surprised
expression, the world familiar but strange, questioning gesture."

A pale-suited figure at the edge of still water, bent toward his own reflection, one arm
raised in the famous questioning chop. The water answers with the real mirrored figure
(Cycles does the reflection). Headphones station: intimate, the world muted to a horizon.

  python core/blender/runner.py projects/byrne/once_in_a_lifetime.py projects/byrne/out/lifetime
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bstage import BStage  # noqa: E402
from models import water_pool  # noqa: E402
from mpfb_body import mpfb_figure  # noqa: E402

st = BStage(ground_color=(52, 50, 46), ground_size=400)

pool = st.place(water_pool, at=(6.0, 0.0), z=0.0)

# the man: bent toward his reflection, right arm raised bent (the chop), left arm back
fig = st.place(mpfb_figure, at=(1.4, 0.0), z=0.0, rot_z=0.0,
               body_color=(150, 152, 156),
               clothes=[("male_casualsuit01", (176, 178, 182))],
               hair=("short02", (42, 38, 40)),
               spine=0.8, head_tilt=-0.5,
               r_arm=(0.95, 2.4), l_arm=(0.3, 0.55),
               l_leg=(-0.12, -0.05), r_leg=(0.22, 0.08))

st.emphasize(fig)
st.attend(st.anchor_world(fig, "head"), polarity=-1)      # the question sinks INTO him
st.moon = (0.5, 0.16)

st.sky_cfg = dict(
    top=(70, 86, 104), mid=(196, 176, 144),
    orb=dict(pos=None, r=0.05, color=(246, 224, 170), halo=0.8),
    horizon=None,
    grade=(1.02, 1.0, 0.96),
    mist_color=(150, 150, 146),
    aerial=dict(start=30.0, end=320.0, strength=0.45, color=(160, 156, 144)),
)
st.mist_cfg = dict(rise=0.7, peak=0.96, strength=0.25, cap=0.1)

# low warm light from beyond the water; cool fill from behind the figure
st.sun((-0.75, -0.35, 0.25), color=(1.0, 0.88, 0.7), energy=2.6, angle=0.5)
st.sun((0.55, 0.35, -0.4), color=(0.5, 0.58, 0.72), energy=0.5, angle=0.9)
st.world_light((0.13, 0.14, 0.16), 1.0)

# from across the water, low — the figure AND his reflection in one frame
st.camera(pos=(6.5, 0.75, 3.4), target=(1.2, 0.75, -0.4), kind="PERSP", focal=42)

out_dir = sys.argv[sys.argv.index("--") + 1]
st.render(out_dir, w=340, h=510)
