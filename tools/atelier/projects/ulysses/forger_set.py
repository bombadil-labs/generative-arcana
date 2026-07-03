"""FORGER staged on the Dublin Set — Stephen on a North Wall dock, the city upriver.

Camera looks west along the Liffey corridor from behind Stephen (back three-quarters, facing
the water south-east). Frame-right: the north-bank skyline in TRUE positions — Custom House
dome (620 m off), Nelson's Pillar behind it, declining into haze. Frame-left: the open water
sheet. The set is geographically honest; the composition comes from the framer.

  python core/blender/runner.py projects/ulysses/forger_set.py projects/ulysses/out/forger4
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bstage import BStage  # noqa: E402
from dublin_blender import stephen  # noqa: E402
import dublin_set as D  # noqa: E402

st = BStage(ground_color=(52, 66, 62), ground_size=3500)   # the water is the stage

# the FULL living set: terrain, landmarks, fabric, furniture — the city behind the dock
city = {}
city["land"] = D.place_terrain(st)
for name in ("pillar", "custom_house", "four_courts", "st_georges", "trinity", "south_wall",
             "dock", "warehouses", "gpo", "fabric", "churches", "institutions", "eccles",
             "furniture", "bridges", "quays"):
    city[name] = st.place(D.LANDMARKS[name])
# the threemaster, homing upstream, mid-river off the dock
ship_i = st.place(D.LANDMARKS["threemaster"], at=(440.0, 0.0), z=2.0)

# Stephen at the dock edge, facing the water to the south-east, book under arm
steph_i = st.place(stephen, at=(612.0, 2.0), z=-17.6, rot_z=-0.9, book=True)

# the field's rivals, both visible: the Custom House dome (the city that summons) vs the
# threemaster's masthead (the sea-road that beckons) — Stephen between them
st.attend(st.anchor_world(city["custom_house"], "dome_top"), polarity=-1)
st.attend(st.anchor_world(ship_i, "masthead"), polarity=1)
st.emphasize(ship_i, city["custom_house"], steph_i)

st.sky_cfg = dict(
    top=(88, 98, 92), mid=(150, 156, 140),
    orb=None, horizon=None,
    grade=(0.99, 1.01, 0.97),
    mist_color=(146, 150, 142),
    aerial=dict(start=40.0, end=750.0, strength=0.82, color=(150, 156, 140)),
)
st.mist_cfg = dict(rise=0.62, peak=0.86, strength=0.6, cap=0.22)

st.sun((-0.35, -0.85, -0.4), color=(0.94, 0.97, 0.92), energy=2.4, angle=0.5)
st.sun((0.5, 0.3, 0.6), color=(0.8, 0.78, 0.7), energy=0.5, angle=0.8)
st.world_light((0.14, 0.15, 0.14), 1.0)

# the framer: on the quay behind Stephen, looking west up the river corridor
st.camera(pos=(631.0, 3.1, -16.0), target=(478.0, 6.0, -29.5), kind="PERSP", focal=40)

out_dir = sys.argv[sys.argv.index("--") + 1]
st.render(out_dir, w=340, h=510)
