"""Street-level probe: standing in Sackville Street, 1904, looking north at Nelson's Pillar.

THE test of the fabric: eye-height camera in the street canyon — row-houses both sides, the
Pillar rising ahead, GPO portico left, walkers on the pavement. If this reads as a street,
Phase 3 passes.

  python core/blender/runner.py projects/ulysses/sackville_probe.py projects/ulysses/out/probe_sackville
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
for name in ("pillar", "custom_house", "st_georges", "trinity", "transport", "fabric",
             "churches", "institutions", "eccles", "furniture", "gpo", "loop_line",
             "wellington"):
    city[name] = st.place(D.LANDMARKS[name])

# walkers on the morning street (person scale ≈ 1.0; feet on terrain)
h = D.terrain_height
for (x, z, rot, arms) in ((4.0, -95.0, 2.8, "down"), (12.5, -150.0, -0.4, "down"),
                          (2.0, -175.0, 0.2, "akimbo"), (11.0, -70.0, 3.0, "down")):
    st.place(person, at=(x, h(x, z)), z=z, rot_z=rot, arms=arms)

st.attend(st.anchor_world(city["pillar"], "top"), polarity=1)

st.sky_cfg = dict(
    top=(120, 132, 138), mid=(168, 170, 158),
    orb=None, horizon=None,
    grade=(1.02, 1.0, 0.96),
    mist_color=(150, 152, 146),
    aerial=dict(start=90.0, end=900.0, strength=0.55, color=(160, 162, 152)),
)
st.mist_cfg = dict(rise=0.75, peak=0.97, strength=0.35, cap=0.14)

# 8:30 am, sun from the east-southeast raking across the street
st.sun((-0.72, -0.42, 0.4), color=(1.0, 0.9, 0.74), energy=2.8, angle=0.3)
st.sun((0.5, 0.4, -0.5), color=(0.65, 0.7, 0.8), energy=0.5, angle=0.9)
st.world_light((0.15, 0.16, 0.17), 1.0)

# eye height in the middle of Sackville Street, looking north to the Pillar
cam_x, cam_z = 8.0, -108.0
st.camera(pos=(cam_x, D.terrain_height(cam_x, cam_z) + 1.7, cam_z),
          target=(4.0, D.terrain_height(0, -200) + 16.0, -200.0), kind="PERSP", focal=32)

out_dir = sys.argv[sys.argv.index("--") + 1]
st.render(out_dir, w=340, h=510)
