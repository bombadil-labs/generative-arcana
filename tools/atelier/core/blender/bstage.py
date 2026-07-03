"""Blender-side stager + framer + pass exporter. Runs INSIDE Blender (bpy).

Owns: placement (root-empty transforms → scale/mirror/rotate affordances), relations,
lights, the CAMERA (the framer — ortho for parity, perspective for depth), and the render.
Exports for the host adapter (core/blender/runner.py):
  raw.npz    — mask, depth, normal_world, position_world, material (from IndexOB)
  combined.png (film-transparent render)
  meta.json  — per-placement: projected 2D skeletons/anchors, px-per-unit, grains (projected
               per-part angles), coherence/droop/aged; directives (projected attention);
               camera rotation; sky/mist config passthrough.
The host bakes flow/coherence/age/mist + composites the environment; the painter is unchanged.
"""

import json
import sys
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from bsculpt import S2B  # noqa: E402


class BStage:
    def __init__(self, ground_color=(40, 36, 34), ground_size=60):
        # wipe default scene
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.scene = bpy.context.scene
        self.scene.render.engine = "CYCLES"
        self.scene.cycles.samples = 48
        self.scene.cycles.use_denoising = True
        self.scene.render.film_transparent = True
        self.placements = []
        self.attention = []
        self.star_pts = []
        self.emphasis = []
        self.sky_cfg = {}
        self.mist_cfg = {}
        self.cam = None

        # ground: a thick box (top face at z=0) — a thin plane is invisible edge-on to a
        # horizontal camera, and tilted cameras need a real top surface for shadows
        import bmesh
        mesh = bpy.data.meshes.new("ground")
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bm.to_mesh(mesh)
        bm.free()
        g = bpy.data.objects.new("ground", mesh)
        g.scale = (ground_size * 2, ground_size * 2, 10)
        g.location = (0, 0, -5.0)
        self.scene.collection.objects.link(g)
        from bsculpt import _mat
        g.data.materials.append(_mat(ground_color, 0.95, "ground"))
        g.pass_index = 1

    # ── placement ────────────────────────────────────────────────────────────
    def place(self, builder, at=(0.0, 0.0), z=0.0, scale=1.0, mirror=False, rot_z=0.0, **pose):
        info = builder(**pose)
        root = info["root"]
        root.location = S2B(at[0], at[1], z)
        root.scale = (-scale if mirror else scale, scale, scale)
        root.rotation_euler = (0.0, 0.0, rot_z)
        self.placements.append(info)
        return info

    def perch(self, info, target_world):
        """Move a placed creature so its 'feet' anchor lands on target (world Blender coords)."""
        bpy.context.view_layer.update()
        feet = info["anchors"]["feet"].matrix_world.translation
        root = info["root"]
        root.location = root.location + (Vector(target_world) - feet)

    def anchor_world(self, info, name):
        bpy.context.view_layer.update()
        return tuple(info["anchors"][name].matrix_world.translation)

    def attend(self, world_pt, polarity=-1):
        self.attention.append((tuple(world_pt), polarity))

    def stars(self, *frac_points):
        self.star_pts.extend(frac_points)

    def emphasize(self, *infos, strength=1.0):
        """Declare artifacts whose legibility the painter must protect."""
        for info in infos:
            self.emphasis.append((list(info["span"]), float(strength)))

    # ── the framer ───────────────────────────────────────────────────────────
    def camera(self, pos, target, kind="ORTHO", ortho_scale=3.75, focal=50):
        camd = bpy.data.cameras.new("cam")
        camd.type = kind
        camd.ortho_scale = ortho_scale
        camd.lens = focal
        camd.sensor_fit = "VERTICAL"
        camd.clip_end = 20000
        cam = bpy.data.objects.new("cam", camd)
        cam.location = S2B(*pos)
        self.scene.collection.objects.link(cam)
        tgt = bpy.data.objects.new("cam_target", None)
        tgt.location = S2B(*target)
        self.scene.collection.objects.link(tgt)
        tr = cam.constraints.new("TRACK_TO")
        tr.target = tgt
        tr.track_axis = "TRACK_NEGATIVE_Z"
        tr.up_axis = "UP_Y"
        self.scene.camera = cam
        self.cam = cam

    # ── lights ───────────────────────────────────────────────────────────────
    def sun(self, direction, color=(1.0, 1.0, 1.0), energy=3.0, angle=0.09):
        """direction: atelier-space vector the light TRAVELS (from light toward scene)."""
        d = Vector(S2B(*direction)).normalized()
        ld = bpy.data.lights.new("sun", "SUN")
        ld.energy = energy
        ld.color = color
        ld.angle = angle
        lo = bpy.data.objects.new("sun", ld)
        lo.rotation_mode = "QUATERNION"
        lo.rotation_quaternion = (-d).to_track_quat("Z", "Y")
        self.scene.collection.objects.link(lo)
        return lo

    def world_light(self, color=(0.05, 0.05, 0.06), strength=1.0):
        w = bpy.data.worlds.new("world")
        w.use_nodes = True
        bg = w.node_tree.nodes["Background"]
        bg.inputs[0].default_value = (*color, 1.0)
        bg.inputs[1].default_value = strength
        self.scene.world = w

    # ── projection helpers ───────────────────────────────────────────────────
    def _proj(self, world_pt):
        dg = bpy.context.evaluated_depsgraph_get()
        cam_ev = self.cam.evaluated_get(dg)
        co = world_to_camera_view(self.scene, cam_ev, Vector(world_pt))
        return (float(co.x), float(1.0 - co.y))  # image y down

    def _proj_atelier(self, pt):
        return self._proj(S2B(*pt) if len(pt) == 3 else S2B(pt[0], pt[1]))

    # ── render + export ──────────────────────────────────────────────────────
    def render(self, out_dir, w=340, h=510, samples=None):
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        sc = self.scene
        if samples:
            sc.cycles.samples = samples
        sc.render.resolution_x = w
        sc.render.resolution_y = h
        vl = bpy.context.view_layer
        vl.use_pass_z = True
        vl.use_pass_normal = True
        vl.use_pass_position = True
        vl.use_pass_object_index = True
        if not any(a.name == "pidx" for a in vl.aovs):
            aov = vl.aovs.add()
            aov.name = "pidx"
            aov.type = "VALUE"

        # compositor: dump passes as float EXRs
        sc.use_nodes = True
        tree = sc.node_tree
        tree.nodes.clear()
        rl = tree.nodes.new("CompositorNodeRLayers")
        fo = tree.nodes.new("CompositorNodeOutputFile")
        fo.base_path = str(out / "passes")
        fo.format.file_format = "OPEN_EXR"
        fo.format.color_depth = "32"
        wanted = (("depth", "Depth"), ("normal", "Normal"),
                  ("position", "Position"), ("index", "IndexOB"), ("pidx", "pidx"))
        fo.file_slots[0].path = wanted[0][0]          # reuse the default slot
        for name, _out in wanted[1:]:
            fo.file_slots.new(name)
        for i, (name, output) in enumerate(wanted):
            tree.links.new(rl.outputs[output], fo.inputs[i])

        sc.render.filepath = str(out / "combined.png")
        sc.render.image_settings.file_format = "PNG"
        sc.render.image_settings.color_mode = "RGBA"
        bpy.ops.render.render(write_still=True)

        # reload the EXRs and assemble raw.npz
        def load_exr(stem, channels):
            path = out / "passes" / f"{stem}0001.exr"
            img = bpy.data.images.load(str(path))
            px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
            bpy.data.images.remove(img)
            return np.flipud(px[..., :channels]).copy()  # Blender rows are bottom-up

        depth = load_exr("depth", 1)[..., 0]
        normal = load_exr("normal", 3)
        position = load_exr("position", 3)
        index = np.rint(load_exr("index", 1)[..., 0]).astype(np.int16)
        pidx = np.rint(load_exr("pidx", 1)[..., 0]).astype(np.int16)
        index = np.where(pidx > 0, pidx, index)   # clay skins report identity via the AOV
        material = index - 1                 # ground(pass 1)→0; creatures→their part index
        mask = (index > 0).astype(np.uint8)
        np.savez_compressed(out / "raw.npz", mask=mask, depth=depth,
                            normal=normal, position=position, material=material)

        # metadata for the host bake
        bpy.context.view_layer.update()
        placements = []
        for info in self.placements:
            root = info["root"]
            m = root.matrix_world
            def loc2d(pt):  # atelier local pt (x,y[,z]) through the root transform, projected
                v = m @ Vector(S2B(*pt) if len(pt) == 3 else S2B(pt[0], pt[1]))
                return self._proj(tuple(v))
            skel2d = [loc2d(p) for p in info["skeleton"]] if info.get("skeleton") else None
            # local px-per-unit at this creature's depth (for falloff constants)
            a0 = m @ Vector(S2B(0, 0)); a1 = m @ Vector(S2B(0, 1))
            p0, p1 = self._proj(tuple(a0)), self._proj(tuple(a1))
            ppu = float(np.hypot((p1[0] - p0[0]) * w, (p1[1] - p0[1]) * h))
            grains2d = {}
            for (idx, a, b) in info.get("grains", []):
                pa, pb = loc2d(a), loc2d(b)
                grains2d[str(idx)] = float(np.arctan2((pb[1] - pa[1]) * h, (pb[0] - pa[0]) * w))
            anchors2d = {k: self._proj(tuple(e.matrix_world.translation))
                         for k, e in info["anchors"].items()}
            anchors_h = {k: float(e.matrix_world.translation.z)
                         for k, e in info["anchors"].items()}
            placements.append(dict(
                name=info["name"], span=list(info["span"]), skeleton2d=skel2d,
                grains2d=grains2d, droop=info.get("droop", 0.7),
                coherence=info.get("coherence", 0.7), aged=info.get("aged", False),
                px_per_unit=ppu, anchors2d=anchors2d, anchors_height=anchors_h,
            ))
        rot = self.cam.matrix_world.to_3x3().transposed()
        sky = dict(self.sky_cfg)
        if isinstance(sky.get("orb"), dict) and sky["orb"].get("pos") is None:
            sky["orb"] = dict(sky["orb"], pos=list(self.moon))
        self.sky_cfg = sky
        meta = dict(
            w=w, h=h,
            placements=placements,
            attention=[[list(self._proj(p)), pol] for p, pol in self.attention],
            cam_rot=[list(r) for r in rot],
            sky_cfg=self.sky_cfg, mist_cfg=self.mist_cfg, stars=[list(p) for p in self.star_pts],
            emphasis=self.emphasis,
        )
        (out / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
        print(f"BSTAGE_DONE {out}")
