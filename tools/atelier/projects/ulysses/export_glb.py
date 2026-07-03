"""Export test: the full Dublin set → glTF (.glb) — the road to a game engine.

  python core/blender/runner-style invocation:
  <blender> -b --factory-startup --python projects/ulysses/export_glb.py -- <out.glb>
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy  # noqa: E402
from bstage import BStage  # noqa: E402
import dublin_set as D  # noqa: E402

out_path = sys.argv[sys.argv.index("--") + 1]

st = BStage(ground_color=(52, 66, 62), ground_size=3500)
city = {}
city["land"] = D.place_terrain(st)
for name in ("pillar", "gpo", "custom_house", "four_courts", "st_georges", "trinity",
             "sw_spires", "transport", "fabric", "churches", "institutions", "eccles",
             "furniture", "bridges", "quays", "loop_line", "wellington", "tenements",
             "infill", "martello", "kingstown", "south_wall", "dock", "warehouses"):
    city[name] = st.place(D.LANDMARKS[name])

# Export flattening: the FacadeGrid procedural shader cannot cross the glTF boundary
# (no bake step yet), so collapse each facade material to its palette's flat brick color.
# Real window/door geometry is unaffected; only shader-painted grids on distant infill are lost.
n_flat = 0
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        continue
    base = bsdf.inputs["Base Color"]
    if not base.is_linked:
        continue
    grp = next((n for n in nt.nodes if n.type == "GROUP" and n.node_tree
                and n.node_tree.name == "FacadeGrid"), None)
    if grp is not None:
        col = tuple(grp.inputs["Base"].default_value)
        for link in list(base.links):
            nt.links.remove(link)
        base.default_value = col
        n_flat += 1
print(f"EXPORT_FLATTEN facades={n_flat}")

# Vertex-color materials (terrain, clay) use a generic Attribute node, which the glTF
# exporter does not recognize — swap in the dedicated Color Attribute node it does.
n_vc = 0
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        continue
    base = bsdf.inputs["Base Color"]
    if not base.is_linked:
        continue
    src = base.links[0].from_node
    if src.type == "ATTRIBUTE" and src.attribute_name == "part_color":
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "part_color"
        for link in list(base.links):
            nt.links.remove(link)
        nt.links.new(vc.outputs["Color"], base)
        n_vc += 1
print(f"EXPORT_VCOLOR fixed={n_vc}")

# Join-by-material: 20k separate meshes = 20k draw calls. Merge everything sharing a
# material into one object; world placement is preserved by join().
groups = {}
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    key = o.data.materials[0].name if o.data.materials else "_none"
    groups.setdefault(key, []).append(o)
for key, objs in groups.items():
    if len(objs) < 2:
        continue
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs,
                                   selected_objects=objs):
        bpy.ops.object.join()

n_obj = len([o for o in bpy.data.objects if o.type == "MESH"])
n_tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
print(f"EXPORT_STATS objects={n_obj} polys~={n_tris}")

bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_apply=True,
                          export_yup=True)
print(f"EXPORT_DONE {out_path}")

# Collision sidecar: the OCC occupancy grid as row-RLE JSON, engine-agnostic.
import json
runs = []
for j in range(D.OCC.nz):
    row = D.OCC.grid[j]
    edges = np.flatnonzero(np.diff(np.concatenate(([0], row.view(np.int8), [0]))))
    for i0, i1 in zip(edges[::2], edges[1::2]):
        runs.append([int(j), int(i0), int(i1)])
coll_path = out_path.rsplit(".", 1)[0] + "_collision.json"
with open(coll_path, "w") as f:
    json.dump({"unit_m": 1.75, "cell": D.OCC.cell, "origin_xz": [D.OCC.x0, D.OCC.z0],
               "nx": D.OCC.nx, "nz": D.OCC.nz,
               "note": "set coords: x east, z south; glTF y-up via (x,-z,y); "
                       "run [j,i0,i1] = cells i0..i1-1 of row j occupied",
               "runs": runs}, f)
print(f"EXPORT_COLLISION {coll_path} runs={len(runs)}")
