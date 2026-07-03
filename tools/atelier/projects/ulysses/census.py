"""Census: build the set headless and count mesh objects per landmark. No render.
A/B against the R13 fabric OCC check via env FABRIC_OCC_CHECK=0|1.

  <blender> -b --factory-startup --python projects/ulysses/census.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy  # noqa: E402
from bstage import BStage  # noqa: E402
import dublin_set as D  # noqa: E402

st = BStage(ground_color=(52, 66, 62), ground_size=3500)
city = {}
city["land"] = D.place_terrain(st)
for name in ("pillar", "gpo", "custom_house", "four_courts", "st_georges", "trinity",
             "sw_spires", "transport", "industry", "fabric", "churches", "institutions",
             "eccles", "furniture", "bridges", "quays", "loop_line", "wellington",
             "tenements", "infill", "martello", "kingstown", "south_wall", "dock",
             "warehouses"):
    city[name] = st.place(D.LANDMARKS[name])

print(f"CENSUS check={D.FABRIC_OCC_CHECK}")
for name, info in city.items():
    root = info.get("root")
    if root is None:
        continue
    n = len([o for o in root.children_recursive if o.type == "MESH"])
    print(f"CENSUS {name}={n}")
occ_pct = 100.0 * D.OCC.grid.mean()
print(f"CENSUS occ_pct={occ_pct:.1f}")
