"""Diagnostic: build the sackville_probe scene and ray-cast from the camera to find
what object blocks the view north.

  <blender> -b --factory-startup --python projects/ulysses/whodunit.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
from bstage import BStage  # noqa: E402
from bsculpt import S2B  # noqa: E402
import dublin_set as D  # noqa: E402

st = BStage(ground_color=(52, 66, 62), ground_size=3500)
city = {}
city["land"] = D.place_terrain(st)
for name in ("pillar", "custom_house", "st_georges", "trinity", "transport", "fabric",
             "churches", "institutions", "eccles", "furniture", "gpo", "loop_line",
             "wellington"):
    city[name] = st.place(D.LANDMARKS[name])

dg = bpy.context.evaluated_depsgraph_get()
origin = Vector(S2B(8.0, D.terrain_height(8.0, -108.0) + 1.7, -108.0))
target = Vector(S2B(4.0, D.terrain_height(0, -200) + 16.0, -200.0))
direction = (target - origin).normalized()
hit, loc, nrm, idx, obj, mat = bpy.context.scene.ray_cast(dg, origin, direction)
if hit:
    dist = (loc - origin).length
    par = obj.parent.name if obj.parent else "-"
    print(f"WHODUNIT hit={obj.name} parent={par} dist={dist:.1f} at=({loc.x:.1f},{loc.y:.1f},{loc.z:.1f})")
else:
    print("WHODUNIT no hit")
