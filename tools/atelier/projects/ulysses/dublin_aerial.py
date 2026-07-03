"""Aerial survey of the Dublin Set — oblique bird's-eye from the south-east.

Doubles as the first study for WANDERING ROCKS ("Dublin as if from above, a map come to life").

  python core/blender/runner.py projects/ulysses/dublin_aerial.py projects/ulysses/out/aerial
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from bstage import BStage  # noqa: E402
import dublin_set as D  # noqa: E402

st = BStage(ground_color=(46, 60, 56), ground_size=3500)

# canonical placement order (the OCC contract: markers before checkers, once each)
city = {}
city["land"] = D.place_terrain(st)
for name in ("pillar", "gpo", "custom_house", "four_courts", "st_georges", "trinity",
             "sw_spires", "transport", "industry", "fabric", "churches", "institutions",
             "eccles", "furniture", "bridges", "quays", "loop_line", "wellington",
             "tenements", "infill", "martello", "kingstown", "south_wall", "dock",
             "warehouses", "smoke"):
    city[name] = st.place(D.LANDMARKS[name])
city["threemaster"] = st.place(D.LANDMARKS["threemaster"], at=(440.0, 0.0), z=2.0)
city["terraces"] = st.place(lambda: D.terrace_fill(precincts=("docklands_north", "docklands_south")))

st.sky_cfg = dict(
    top=(96, 104, 98), mid=(150, 156, 142),
    orb=None, horizon=None,
    grade=(1.0, 1.0, 0.98),
    mist_color=(148, 152, 144),
    aerial=dict(start=500.0, end=3800.0, strength=0.2, color=(150, 156, 142)),
)
st.mist_cfg = dict(rise=0.9, peak=0.99, strength=0.2, cap=0.08)

st.sun((-0.55, -0.55, -0.35), color=(1.0, 0.94, 0.82), energy=3.0, angle=0.25)  # mid-morning sun
st.sun((0.6, 0.3, 0.5), color=(0.7, 0.74, 0.8), energy=0.3, angle=0.8)
st.world_light((0.13, 0.14, 0.14), 1.0)

# lower oblique from the south-east: city fills the frame, smoke drifting NE, bay at right
st.camera(pos=(1050.0, 850.0, 1450.0), target=(-380.0, 0.0, -160.0), kind="PERSP", focal=42)

out_dir = sys.argv[sys.argv.index("--") + 1]
st.render(out_dir, w=680, h=440)
