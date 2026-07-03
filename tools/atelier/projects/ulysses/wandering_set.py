"""Ulysses Major 10 — WANDERING ROCKS on the living Dublin Set.

Canon: "Dublin as if from above, a map come to life. Streets radiate out like a labyrinth,
the Liffey bisecting. Multiple vignettes occur simultaneously..." The one card with NO
attention center: no vortices, men register, flat mid-afternoon light. The walkers — including
the viceregal cavalcade in file down Sackville — are EMPHASIZED so they survive as legible
specks: simultaneous lives, viewed with God's indifferent altitude.

  python core/blender/runner.py projects/ulysses/wandering_set.py projects/ulysses/out/wandering2
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
             "sw_spires", "fabric", "churches", "institutions", "eccles", "furniture",
             "bridges", "quays"):
    city[name] = st.place(D.LANDMARKS[name])

# the simultaneous vignettes: walkers scattered on real streets, no one central
h = D.terrain_height
walkers = []
spots = [(8, -60, 0.2), (6, -300, 2.9), (-120, -50, 1.2), (-260, -190, -0.7),
         (55, 120, 0.4), (48, 250, 2.2), (-380, -120, 1.6), (-200, 230, -0.3),
         (150, -140, 0.9), (-40, -520, 2.5), (300, -100, -1.2), (-560, 180, 0.6),
         (220, 380, 1.9), (-320, -450, 0.1)]
for (x, z, rot) in spots:
    walkers.append(st.place(person, at=(x, h(x, z)), z=z, rot_z=rot))
# the viceregal cavalcade: five in file down Sackville, processing toward the bridge
for k in range(5):
    z = -330 + k * 14
    walkers.append(st.place(person, at=(4.5, h(4.5, z)), z=z, rot_z=-1.57, arms="down"))

st.emphasize(*walkers, strength=1.0)
# NO attend() calls: the episode has no center.
st.include_orb_vortex = False

st.sky_cfg = dict(
    top=(140, 146, 144), mid=(168, 168, 158),
    orb=None, horizon=None,
    grade=(1.0, 1.0, 0.99),
    mist_color=(154, 156, 150),
    aerial=dict(start=250.0, end=1600.0, strength=0.45, color=(160, 162, 154)),
)
st.mist_cfg = dict(rise=0.92, peak=0.995, strength=0.15, cap=0.06)

# 3 pm, thin overcast: high soft sun, shadowless-ish
st.sun((-0.25, -0.92, 0.2), color=(0.96, 0.96, 0.93), energy=2.4, angle=0.9)
st.world_light((0.17, 0.18, 0.18), 1.0)

# the indifferent altitude: oblique over the core, the Liffey bisecting the frame
st.camera(pos=(330.0, 200.0, 420.0), target=(-140.0, 0.0, -190.0), kind="PERSP", focal=38)

out_dir = sys.argv[sys.argv.index("--") + 1]
st.render(out_dir, w=340, h=510)
