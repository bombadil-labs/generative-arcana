"""Ulysses Major 1 — TELEMACHUS on the living Dublin Set.

The Martello tower on its rise at Sandycove (real terrain, real coast), Buck Mulligan aloft on
the gun platform — stately, plump, arms raised with the bowl — Stephen below and apart on the
seaward rocks. 8 am: the sun low over the bay mouth, Kingstown's granite arms on the horizon.

  python core/blender/runner.py projects/ulysses/telemachus_set.py projects/ulysses/out/telemachus2
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bstage import BStage  # noqa: E402
from dublin_blender import person  # noqa: E402
import dublin_set as D  # noqa: E402

st = BStage(ground_color=(48, 64, 60), ground_size=3500)

city = {}
city["land"] = D.place_terrain(st)
for name in ("martello", "kingstown", "south_wall"):
    city[name] = st.place(D.LANDMARKS[name])

h = D.terrain_height

# Mulligan aloft — perched on the gun platform, mock-priestly, arms raised
mulligan = st.place(person, at=(0.0, 0.0), arms="raised")
st.perch(mulligan, st.anchor_world(city["martello"], "gun_platform"))
# Stephen below on the seaward rocks, apart, facing the water
stephen_i = st.place(person, at=(6215.0, h(6215.0, 3862.0)), z=3862.0, rot_z=0.35, lean=0.05)

st.emphasize(city["martello"], mulligan, stephen_i)
st.attend(st.anchor_world(mulligan, "head"), polarity=-1)          # the usurper commands
st.moon = (0.44, 0.26)                                             # the dawn sun's frame spot

st.sky_cfg = dict(
    top=(58, 70, 100), mid=(196, 152, 116),
    orb=dict(pos=None, r=0.052, color=(248, 214, 150), halo=0.85),
    horizon=None,
    grade=(1.06, 1.0, 0.92),
    mist_color=(150, 148, 142),
    aerial=dict(start=300.0, end=6000.0, strength=0.5, color=(178, 158, 134)),
)
st.mist_cfg = dict(rise=0.75, peak=0.96, strength=0.4, cap=0.16)

# dawn: warm sun low from the east-north-east; cool fill from the land
st.sun((-0.85, -0.28, 0.22), color=(1.0, 0.84, 0.62), energy=3.0, angle=0.3)
st.sun((0.6, 0.3, -0.4), color=(0.55, 0.62, 0.78), energy=0.45, angle=0.9)
st.world_light((0.12, 0.13, 0.15), 1.0)

# from the landward slope looking ENE past the tower to the open bay mouth
cam_x, cam_z = 6096.0, 3952.0
st.camera(pos=(cam_x, h(cam_x, cam_z) + 2.2, cam_z),
          target=(6230.0, h(6150.0, 3900.0) + 8.5, 3838.0), kind="PERSP", focal=34)

out_dir = sys.argv[sys.argv.index("--") + 1]
st.render(out_dir, w=340, h=510)
