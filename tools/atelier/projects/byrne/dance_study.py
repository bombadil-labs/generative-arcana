"""Pose × angle study for I DANCE LIKE THIS — one card, many bodies-in-motion.

Four poses from the actual Byrne movement vocabulary (never invented gymnastics: these are
the run-in-place, the wobble, the chop, the marionette) × three cameras (frontal like the
photographs, three-quarter, profile). Natural arm grammar: upper arms stay under ~90° of
lift; the ELBOW does the expressive work.

  python core/blender/runner.py projects/byrne/dance_study.py <out_dir> <pose> <camera>
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bstage import BStage  # noqa: E402
from models import suit_man  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:]
out_dir, pose_name, cam_name = args[0], args[1], args[2]

POSES = {
    # the run-in-place: elbows pump at 90, one knee high, torso upright — grounded
    "run": dict(l_arm=((-0.45, 0.20), (0.95, 0.19)), r_arm=((0.5, 0.20), (-0.6, 0.19)),
                l_leg=((-0.05, 0.24), (0.0, 0.24)), r_leg=((1.25, 0.22), (0.2, 0.24)),
                lean=0.1, head_tilt=0.2, airborne=0.0),
    # the wobble: leaned back, arms hanging a little out, legs planted wide
    "wobble": dict(l_arm=((-0.6, 0.20), (-0.35, 0.19)), r_arm=((0.6, 0.20), (0.35, 0.19)),
                   l_leg=((-0.45, 0.24), (-0.1, 0.24)), r_leg=((0.45, 0.24), (0.1, 0.24)),
                   lean=-0.16, head_tilt=-0.35, airborne=0.0),
    # the chop: one arm bent up across the body, the other thrown down-back, mid-stride
    "chop": dict(l_arm=((0.85, 0.20), (2.25, 0.19)), r_arm=((-0.8, 0.20), (-0.45, 0.19)),
                 l_leg=((0.55, 0.24), (0.05, 0.24)), r_leg=((-0.35, 0.24), (-0.65, 0.24)),
                 lean=0.12, head_tilt=-0.4, airborne=0.08),
    # the marionette: arms out-down with dangling forearms, knees pigeoned in
    "marionette": dict(l_arm=((-0.95, 0.20), (-0.1, 0.19)), r_arm=((0.95, 0.20), (0.1, 0.19)),
                       l_leg=((0.2, 0.24), (-0.18, 0.24)), r_leg=((-0.2, 0.24), (0.18, 0.24)),
                       lean=0.05, head_tilt=0.55, airborne=0.04),
}

CAMS = {
    # frontal and low — how the photographs are shot
    "front": dict(pos=(3.9, 0.85, 0.0), target=(0.0, 0.9, 0.0), focal=50),
    "three_q": dict(pos=(3.2, 1.15, 1.9), target=(0.0, 0.85, 0.0), focal=46),
    "profile": dict(pos=(0.3, 0.9, 3.7), target=(0.0, 0.88, 0.0), focal=48),
}

st = BStage(ground_color=(16, 16, 18), ground_size=300)
fig = st.place(suit_man, at=(0.0, 0.0), z=0.0, rot_z=0.0,
               suit=(174, 178, 184), oversize=1.3, head_scale=0.8, **POSES[pose_name])

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
st.sun((-0.7, -0.6, 0.35), color=(1.0, 0.9, 0.72), energy=4.2, angle=0.15)
st.sun((0.75, -0.15, -0.4), color=(0.5, 0.62, 0.85), energy=1.6, angle=0.3)
st.world_light((0.05, 0.05, 0.07), 0.8)

cam = CAMS[cam_name]
st.camera(pos=cam["pos"], target=cam["target"], kind="PERSP", focal=cam["focal"])
st.render(out_dir, w=260, h=390)
