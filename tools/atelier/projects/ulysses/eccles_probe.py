"""Probe: the front door of No. 7 Eccles Street, 8 am — Calypso's opening shot.

  python core/blender/runner.py projects/ulysses/eccles_probe.py projects/ulysses/out/probe_eccles
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bstage import BStage  # noqa: E402
from dublin_blender import person  # noqa: E402
import dublin_set as D  # noqa: E402

st = BStage(ground_color=(58, 60, 54), ground_size=3500)

city = {}
city["land"] = D.place_terrain(st)
for name in ("st_georges", "fabric", "churches", "eccles", "furniture"):
    city[name] = st.place(D.LANDMARKS[name])

# Bloom at his own door
door_b = st.anchor_world(city["eccles"], "bloom_door")
door = (door_b[0], door_b[2], -door_b[1])         # blender → atelier (x, y, z)
st.place(person, at=(door[0] + 1.2, D.terrain_height(door[0] + 1.2, door[2] + 2.0)),
         z=door[2] + 2.0, rot_z=2.4, arms="down")

st.attend(door_b, polarity=1)

st.sky_cfg = dict(
    top=(128, 138, 144), mid=(172, 172, 160),
    orb=None, horizon=None,
    grade=(1.03, 1.0, 0.95),
    mist_color=(152, 154, 148),
    aerial=dict(start=70.0, end=700.0, strength=0.5, color=(162, 164, 154)),
)
st.mist_cfg = dict(rise=0.8, peak=0.98, strength=0.3, cap=0.12)

st.sun((-0.72, -0.45, 0.35), color=(1.0, 0.9, 0.72), energy=2.6, angle=0.35)
st.sun((0.5, 0.4, -0.5), color=(0.66, 0.7, 0.8), energy=0.5, angle=0.9)
st.world_light((0.16, 0.17, 0.18), 1.0)

# across the street from the door: step along the street NORMAL (door faces -n), eye height
UX, UZ = 0.906, -0.423          # street direction (a->c)
NX, NZ = 0.423, 0.906           # street normal; the door sits on the +n row, facing -n
cx = door[0] - NX * 11.0 + UX * 7.0
cz = door[2] - NZ * 11.0 + UZ * 7.0
st.camera(pos=(cx, D.terrain_height(cx, cz) + 1.65, cz),
          target=(door[0], door[1] + 1.2, door[2]), kind="PERSP", focal=28)

out_dir = sys.argv[sys.argv.index("--") + 1]
st.render(out_dir, w=340, h=510)
