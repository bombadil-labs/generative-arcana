"""Probe: can MPFB build us a parametric human, headless, outside the extension system?

  <blender> -b --factory-startup --python projects/byrne/mpfb_probe.py -- <out.png>
"""

import math
import sys
from pathlib import Path

import bpy

VENDOR = Path(__file__).resolve().parents[3] / "vendor"
SCRIPTS = VENDOR / "mpfb_scripts"

argv = sys.argv[sys.argv.index("--") + 1:]
out_png = argv[0]

bpy.ops.wm.read_factory_settings(use_empty=True)      # clear the default cube scene

# MPFB is written as a Blender extension; used as a LIBRARY its one hard dependency on
# the extension system is bpy.utils.extension_path_user (its writable home). Point that
# at a vendored dir and the rest of the addon registers cleanly headless.
_orig_epu = bpy.utils.extension_path_user


def _epu(package, path="", create=False):
    if "mpfb" in str(package):
        p = VENDOR / "mpfb_userhome" / path
        if create:
            p.mkdir(parents=True, exist_ok=True)
        return str(p)
    return _orig_epu(package, path=path, create=create)


bpy.utils.extension_path_user = _epu

# register the vendored scripts dir and enable MPFB through the real addon system —
# get_preference() and friends need the addon present in bpy.context.preferences.addons
sd = bpy.context.preferences.filepaths.script_directories.new()
sd.name = "mpfb_vendor"
sd.directory = str(SCRIPTS)
sys.path.insert(0, str(SCRIPTS / "addons"))
bpy.utils.refresh_script_paths()
import addon_utils  # noqa: E402

addon_utils.modules_refresh()
# default_set=True is what pre-creates the preferences.addons entry that MPFB's own
# services read DURING registration (headless prefs are never saved, so it's harmless)
addon_utils.enable("mpfb", default_set=True)

from mpfb.services.humanservice import HumanService  # noqa: E402

human = HumanService.create_human(
    mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True,
    feet_on_ground=True, scale=0.1,
)
print(f"MPFB_HUMAN name={human.name} verts={len(human.data.vertices)} "
      f"dims={tuple(round(v, 3) for v in human.dimensions)}")
for m in human.modifiers:
    print(f"MPFB_MOD {m.type} {m.name} viewport={m.show_viewport} render={m.show_render}")
for o in bpy.data.objects:
    print(f"MPFB_OBJ {o.name} type={o.type} dims={tuple(round(v, 2) for v in o.dimensions)}")

# quick look: grey clay render, frontal
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE_NEXT"
sc.render.resolution_x, sc.render.resolution_y = 320, 480
sc.render.filepath = out_png

mat = bpy.data.materials.new("clay")
mat.use_nodes = True
mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.6, 0.55, 0.5, 1)
human.data.materials.clear()
human.data.materials.append(mat)

h = human.dimensions.z
cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
sc.collection.objects.link(cam)
cam.location = (0.0, -3.2 * h, h * 0.55)
cam.rotation_euler = (math.pi / 2 - 0.05, 0.0, 0.0)
sc.camera = cam

sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 3.5
sun = bpy.data.objects.new("sun", sun_data)
sc.collection.objects.link(sun)
sun.rotation_euler = (0.9, 0.3, 0.6)
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
sc.world = world

bpy.ops.render.render(write_still=True)
print(f"MPFB_PROBE_DONE {out_png}")
