"""MPFB integration for the atelier — real parametric bodies as sculptor output.

ensure_mpfb() vendors-in the addon (once per Blender session); mpfb_figure() creates a
body, poses it through the game_engine rig with world-plane FK deltas, bakes the deformed
mesh, and registers it into a Builder span like any other sculpt. The figure's source
changed; the sculptor contract didn't.
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
from bsculpt import Builder  # noqa: E402

VENDOR = Path(__file__).resolve().parents[3] / "vendor"
SCRIPTS = VENDOR / "mpfb_scripts"
_MPFB_READY = [False]


def ensure_mpfb():
    if _MPFB_READY[0]:
        return
    import bpy

    _orig = bpy.utils.extension_path_user

    def _epu(package, path="", create=False):
        if "mpfb" in str(package):
            p = VENDOR / "mpfb_userhome" / path
            if create:
                p.mkdir(parents=True, exist_ok=True)
            return str(p)
        return _orig(package, path=path, create=create)

    bpy.utils.extension_path_user = _epu
    sd = bpy.context.preferences.filepaths.script_directories.new()
    sd.name = "mpfb_vendor"
    sd.directory = str(SCRIPTS)
    sys.path.insert(0, str(SCRIPTS / "addons"))
    bpy.utils.refresh_script_paths()
    import addon_utils
    addon_utils.modules_refresh()
    addon_utils.enable("mpfb", default_set=True)
    _MPFB_READY[0] = True


def _angle_from_down(v, out_sign):
    """Angle of a bone direction from straight-down, in the lateral (X) / up (Z) plane,
    positive = outward for this side."""
    return float(np.arctan2(out_sign * v.x, -v.z))


def _rotate_world(arm, bone, axis, angle):
    import bpy
    import mathutils
    pb = arm.pose.bones[bone]
    M = arm.matrix_world @ pb.matrix
    head = M.to_translation()
    R = (mathutils.Matrix.Translation(head)
         @ mathutils.Matrix.Rotation(angle, 4, axis)
         @ mathutils.Matrix.Translation(-head))
    pb.matrix = arm.matrix_world.inverted() @ (R @ M)
    bpy.context.view_layer.update()


ASSETS = VENDOR / "mh_assets"


def mpfb_figure(name="figure", body_color=(120, 124, 132), skin=(202, 176, 150),
                macro=None, l_arm=(-0.5, -0.6), r_arm=(0.5, 0.6),
                l_leg=(-0.25, 0.0), r_leg=(0.25, 0.0),
                spine=0.0, head_tilt=0.0, airborne=0.0,
                clothes=None, hair=None, fit_macro=None):
    """A posed parametric human, unit height, facing +x (atelier convention).
    Limb params are (upper, lower) ABSOLUTE angles-from-down in the card plane,
    positive = outward for that side. clothes = [(pack-name-or-mhclo-path, color)];
    hair likewise. `fit_macro` is the BIG SUIT mechanism: garments are fitted while the
    body temporarily wears these macro overrides (e.g. weight/muscle high), then the body
    slims back underneath — the garment keeps its big cut, the cuffs stay at the wrists,
    and the same rig drives everything. The pose is applied as world-plane FK deltas —
    self-correcting against the rig's rest pose."""
    import bpy
    import mathutils
    ensure_mpfb()
    from mpfb.services.humanservice import HumanService
    from mpfb.services.clothesservice import ClothesService
    from mpfb.services.targetservice import TargetService
    from mpfb.entities.objectproperties import HumanObjectProperties

    human = HumanService.create_human(
        mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True,
        feet_on_ground=True, scale=0.1, macro_detail_dict=macro,
    )

    def _set_macros(overrides):
        for k, v in overrides.items():
            HumanObjectProperties.set_value(k, v, entity_reference=human)
        TargetService.reapply_macro_details(human)

    # the wardrobe fits the body AS IT IS at load time — so for the Big Suit we fatten
    # the fit body first, dress it, then slim the man back down inside his suit
    saved = None
    if fit_macro:
        saved = {k: HumanObjectProperties.get_value(k, entity_reference=human)
                 for k in fit_macro}
        _set_macros(fit_macro)

    garments = []          # (object, color, mhclo)

    def _wear(spec, color, atype):
        path = spec
        if not str(spec).endswith(".mhclo"):
            sub = "hair" if atype == "Hair" else "clothes"
            path = ASSETS / sub / str(spec) / (str(spec) + ".mhclo")
        bpy.context.view_layer.objects.active = human
        before = set(bpy.data.objects)
        HumanService.add_mhclo_asset(str(path), human, asset_type=atype,
                                     set_up_rigging=False)
        for o in bpy.data.objects:
            if o not in before and o.type == "MESH":
                garments.append((o, color, str(path)))

    for (spec, color) in (clothes or []):
        _wear(spec, color, "Clothes")

    if saved is not None:
        _set_macros(saved)                       # the man slims back inside his suit
    if hair is not None:
        _wear(hair[0], hair[1], "Hair")          # hair fits the TRUE head

    arm = HumanService.add_builtin_rig(human, "game_engine")
    # add_mhclo_asset returns the clothes OBJECT, not the entity — reload the entity
    # (basename + fitting table) for weight interpolation, no mesh import needed
    from mpfb.entities.clothes.mhclo import Mhclo
    for (g, _, mhclo_path) in garments:
        ent = Mhclo()
        ent.load(mhclo_path)
        ClothesService.set_up_rigging(human, g, arm, ent)

    # skin above the neck plane, body color below
    H = human.dimensions.z
    mat_body = bpy.data.materials.new("mh_body")
    mat_body.use_nodes = True
    mat_body.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
        *(c / 255 for c in body_color), 1.0)
    mat_body.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    mat_skin = bpy.data.materials.new("mh_skin")
    mat_skin.use_nodes = True
    mat_skin.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
        *(c / 255 for c in skin), 1.0)
    mat_skin.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.75
    human.data.materials.clear()
    human.data.materials.append(mat_body)
    human.data.materials.append(mat_skin)
    neck_z = 0.845 * H
    for poly in human.data.polygons:
        if all(human.data.vertices[v].co.z > neck_z for v in poly.vertices):
            poly.material_index = 1

    # pose: world-plane FK — measure each bone's angle-from-down, rotate by the delta.
    # Native facing is -Y; the card plane is X(lateral)-Z(up); rotations are about Y.
    Y = mathutils.Vector((0, 1, 0))

    def set_chain(side_sign, upper_name, lower_name, upper_target, lower_target):
        for bone_name, target in ((upper_name, upper_target), (lower_name, lower_target)):
            pb = arm.pose.bones[bone_name]
            d = (arm.matrix_world @ pb.matrix @ mathutils.Vector((0, 1, 0, 0))).to_3d()
            cur = _angle_from_down(d.normalized(), side_sign)
            _rotate_world(arm, bone_name, Y, -side_sign * (target - cur))

    # the torso guard: upper arms may not swing meaningfully INWARD (negative =
    # toward the body; FK has no collision sense and the ribs are not consulted).
    # This bug shipped twice on pose dicts — now the builder refuses it.
    l_arm = (max(l_arm[0], -0.12), l_arm[1])
    r_arm = (max(r_arm[0], -0.12), r_arm[1])
    set_chain(+1, "upperarm_l", "lowerarm_l", l_arm[0], l_arm[1])
    set_chain(-1, "upperarm_r", "lowerarm_r", r_arm[0], r_arm[1])
    set_chain(+1, "thigh_l", "calf_l", l_leg[0], l_leg[1])
    set_chain(-1, "thigh_r", "calf_r", r_leg[0], r_leg[1])
    if abs(spine) > 1e-3:
        for sb in ("spine_01", "spine_02", "spine_03"):
            _rotate_world(arm, sb, Y, spine / 3)
    if abs(head_tilt) > 1e-3:
        _rotate_world(arm, "head", Y, head_tilt)

    # bake every deformed mesh (body + garments), unit height, facing +x, feet at
    # origin (+airborne); register each into the span with its own part identity
    dg = bpy.context.evaluated_depsgraph_get()
    s = 1.0 / H

    def _bake(src_obj):
        m = bpy.data.meshes.new_from_object(src_obj.evaluated_get(dg))
        m.transform(src_obj.matrix_world)
        m.transform(mathutils.Matrix.Rotation(np.radians(90), 4, "Z"))
        m.transform(mathutils.Matrix.Diagonal((s, s, s, 1.0)))
        m.transform(mathutils.Matrix.Translation((0, 0, airborne)))
        # detach from MPFB's material lifecycle (it reuses/replaces same-named MAKESKIN
        # materials across loads — a second figure invalidates the first's references)
        # and matte the copies: illumination, not reflection
        for i, mat in enumerate(m.materials):
            if not mat:
                continue
            mc = mat.copy()
            m.materials[i] = mc
            if mc.use_nodes and "Principled BSDF" in mc.node_tree.nodes:
                bsdf = mc.node_tree.nodes["Principled BSDF"]
                bsdf.inputs["Roughness"].default_value = 0.92
                if "Specular IOR Level" in bsdf.inputs:
                    bsdf.inputs["Specular IOR Level"].default_value = 0.15
        return m

    b = Builder(name)
    baked = _bake(human)
    obj = bpy.data.objects.new(name, baked)
    b.custom(obj, body_color)          # color overridden below: keep the two-slot materials
    obj.data.materials.clear()
    obj.data.materials.append(mat_body)
    obj.data.materials.append(mat_skin)
    for (g, color, _) in garments:
        gm = _bake(g)
        gobj = bpy.data.objects.new(g.name + "_baked", gm)
        b.custom(gobj, color or (150, 150, 150))
    for (g, _, _) in garments:
        bpy.data.objects.remove(g, do_unlink=True)
    bpy.data.objects.remove(human, do_unlink=True)
    for o in list(bpy.data.objects):
        if o.type == "ARMATURE":
            bpy.data.objects.remove(o, do_unlink=True)

    b.anchor("feet", (0.0, airborne))
    b.anchor("head", (0.0, 0.94 + airborne))
    b.anchor("chest", (0.0, 0.72 + airborne))
    skel = [(0.0, 0.95 + airborne), (0.0, 0.6 + airborne), (0.0, 0.05 + airborne)]
    return b.finish(skeleton=skel, grains=[], droop=0.0, coherence=0.9)
