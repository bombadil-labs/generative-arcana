"""Byrne major-19 — I DANCE LIKE THIS (station: civic square).

Canon: "Embodied declaration, authenticity found. A body mid-dance, suit jacket flying,
feet off ground, face unselfconscious, the choreography of being yourself."

One grey-suited figure airborne on a bare stage — the American Utopia frame: hard key from
the wings, black void behind, nothing on stage but the body and what it declares.

  python core/blender/runner.py projects/byrne/i_dance_like_this.py projects/byrne/out/dance
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bstage import BStage  # noqa: E402
from models import suit_man  # noqa: E402

st = BStage(ground_color=(16, 16, 18), ground_size=300)       # the bare stage

# ASYMMETRIC mid-move: right arm the chop — raised, bent hard at the elbow; left arm
# thrown down-back; right leg kicked forward bent, left leg trailing; head tipped away.
# The suit is CLOTH at the wrong scale (oversize=1.3), not architecture.
fig = st.place(suit_man, at=(0.0, 0.0), z=0.0, rot_z=0.0,
               suit=(174, 178, 184), oversize=1.3, head_scale=0.8,
               r_arm=((2.4, 0.20), (1.1, 0.19)),
               l_arm=((-0.95, 0.21), (-0.45, 0.19)),
               r_leg=((0.8, 0.24), (0.05, 0.24)),
               l_leg=((-0.3, 0.24), (-0.7, 0.24)),
               lean=0.16, head_tilt=-0.5, airborne=0.12)

st.emphasize(fig)
st.attend(st.anchor_world(fig, "chest"), polarity=1)
st.moon = (0.24, 0.2)                                          # the followspot's frame spot

st.sky_cfg = dict(
    top=(10, 10, 12), mid=(22, 22, 26),                        # the void
    orb=None, horizon=None,
    grade=(1.0, 1.0, 1.04),
    mist_color=(40, 40, 46),
    aerial=dict(start=40.0, end=280.0, strength=0.3, color=(24, 24, 28)),
)
st.mist_cfg = dict(rise=0.5, peak=0.9, strength=0.12, cap=0.06)

# concert light: hard warm key from high left, steel rim from right, faint floor bounce
st.sun((-0.7, -0.6, 0.35), color=(1.0, 0.9, 0.72), energy=4.2, angle=0.15)
st.sun((0.75, -0.15, -0.4), color=(0.5, 0.62, 0.85), energy=1.6, angle=0.3)
st.world_light((0.05, 0.05, 0.07), 0.8)

# frontal, slightly low: the heroic declaration
st.camera(pos=(3.6, 0.95, 2.3), target=(0.0, 0.95, -0.1), kind="PERSP", focal=48)

out_dir = sys.argv[sys.argv.index("--") + 1]
st.render(out_dir, w=340, h=510)
