"""Round-trip proof: import dublin_1904.glb into a FRESH scene and render what a game
engine would actually receive. Camera = the Sackville probe viewpoint.

  <blender> -b --factory-startup --python projects/ulysses/roundtrip_glb.py -- <in.glb> <out.png>
"""

import math
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
glb_path, out_png = argv[0], argv[1]

# empty scene — nothing from the set's build code exists here
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb_path)
n = len([o for o in bpy.data.objects if o.type == "MESH"])
print(f"REIMPORT meshes={n}")

sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE_NEXT"
sc.render.resolution_x, sc.render.resolution_y = 640, 400
sc.render.filepath = out_png

# Sackville looking north toward the Pillar: set coords (x, y-up, z-south) -> Blender (x, -z, y)
# street level near D'Olier corner: set (0, 2, -40) looking at (0, 25, -260)
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 32
cam_data.clip_end = 20000
cam = bpy.data.objects.new("cam", cam_data)
sc.collection.objects.link(cam)
cam.location = (0.0, 40.0, 4.0)
tx, ty, tz = 0.0, 260.0, 25.0
d = cam.location
dx, dy, dz = tx - d[0], ty - d[1], tz - d[2]
dist = math.hypot(dx, dy)
cam.rotation_euler = (math.atan2(dist, -dz) , 0.0, math.atan2(dy, dx) - math.pi / 2 + math.pi)
sc.camera = cam

sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 3.0
sun = bpy.data.objects.new("sun", sun_data)
sc.collection.objects.link(sun)
sun.rotation_euler = (0.9, 0.2, 1.9)
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.38, 0.42, 1.0)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
sc.world = world

bpy.ops.render.render(write_still=True)
print(f"ROUNDTRIP_DONE {out_png}")
