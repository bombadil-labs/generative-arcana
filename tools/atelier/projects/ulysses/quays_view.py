"""The Professor's return-visit frame: standing on O'Connell Bridge, looking west up the
river — quay walls, bridge line, the Four Courts' broad copper dome, smoke over the city.

  python core/blender/runner.py projects/ulysses/quays_view.py projects/ulysses/out/quays_west
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bstage import BStage  # noqa: E402
from dublin_blender import person  # noqa: E402
import dublin_set as D  # noqa: E402

st = BStage(ground_color=(52, 66, 62), ground_size=3500)
city = {}
city["land"] = D.place_terrain(st)
for name in ("pillar", "gpo", "custom_house", "four_courts", "st_georges", "trinity",
             "sw_spires", "transport", "industry", "fabric", "churches", "institutions",
             "eccles", "furniture", "bridges", "quays", "loop_line", "wellington",
             "tenements", "infill", "smoke"):
    city[name] = st.place(D.LANDMARKS[name])

# figures on the bridge
for (x, z, rot) in ((6.0, -30.0, 2.9), (-4.0, -12.0, 0.3), (2.0, -38.0, -0.6)):
    st.place(person, at=(x, 2.1), z=z, rot_z=rot)

st.attend(st.anchor_world(city["four_courts"], "dome_top"), polarity=1)

st.sky_cfg = dict(
    top=(112, 124, 134), mid=(178, 168, 148),
    orb=None, horizon=None,
    grade=(1.03, 1.0, 0.95),
    mist_color=(152, 146, 134),
    aerial=dict(start=80.0, end=1100.0, strength=0.5, color=(158, 150, 134)),
)
st.mist_cfg = dict(rise=0.8, peak=0.97, strength=0.35, cap=0.14)
st.sun((-0.5, -0.55, 0.35), color=(1.0, 0.9, 0.76), energy=2.8, angle=0.35)
st.world_light((0.15, 0.16, 0.17), 1.0)

# on the bridge deck, eye height, looking WEST up the river to the dome
st.camera(pos=(12.0, 3.9, -20.0), target=(-400.0, 14.0, -22.0), kind="PERSP", focal=38)

out_dir = sys.argv[sys.argv.index("--") + 1]
st.render(out_dir, w=340, h=510)
