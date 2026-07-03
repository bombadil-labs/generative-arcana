"""Blender-side sculptor: mesh-primitive builders implementing the atelier contract.

Runs INSIDE Blender (bpy). Same info-dict contract as the numpy sculptor (CONTROL_PLANE.md §1),
adapted to 3D: each creature is a family of mesh parts parented to a ROOT EMPTY (so the whole
creature poses/scales/mirrors as a unit), anchors are child empties, spans are pass_index
ranges, skeletons/grains are 3D polylines the stager later projects through the camera.

Coordinate convention: builders author in atelier scene space (x right, y up, z toward camera);
`S2B` maps to Blender (x, -z, y). One unit = one atelier unit.
"""

import bpy
import numpy as np


def S2B(x, y, z=0.0):
    return (x, -z, y)


_COUNTER = [0]


def _facade_group():
    """Shared window-grid shader group: Object coords → bay/floor cells → window + sill mix."""
    if "FacadeGrid" in bpy.data.node_groups:
        return bpy.data.node_groups["FacadeGrid"]
    g = bpy.data.node_groups.new("FacadeGrid", "ShaderNodeTree")
    g.interface.new_socket("Base", in_out="INPUT", socket_type="NodeSocketColor")
    g.interface.new_socket("Bays", in_out="INPUT", socket_type="NodeSocketFloat")
    g.interface.new_socket("Floors", in_out="INPUT", socket_type="NodeSocketFloat")
    g.interface.new_socket("Color", in_out="OUTPUT", socket_type="NodeSocketColor")
    n_in = g.nodes.new("NodeGroupInput")
    n_out = g.nodes.new("NodeGroupOutput")
    tc = g.nodes.new("ShaderNodeTexCoord")
    sep = g.nodes.new("ShaderNodeSeparateXYZ")
    g.links.new(tc.outputs["Object"], sep.inputs[0])

    def math(op, a=None, b=None, v0=None, v1=None):
        m = g.nodes.new("ShaderNodeMath")
        m.operation = op
        if a is not None:
            g.links.new(a, m.inputs[0])
        if v0 is not None:
            m.inputs[0].default_value = v0
        if b is not None:
            g.links.new(b, m.inputs[1])
        if v1 is not None:
            m.inputs[1].default_value = v1
        return m

    # fx = fract((x + 0.5) * Bays); fz = fract((z + 0.5) * Floors)
    xs = math("ADD", a=sep.outputs["X"], v1=0.5)
    xm = math("MULTIPLY", a=xs.outputs[0])
    g.links.new(n_in.outputs["Bays"], xm.inputs[1])
    fx = math("FRACT", a=xm.outputs[0])
    zs = math("ADD", a=sep.outputs["Z"], v1=0.5)
    zm = math("MULTIPLY", a=zs.outputs[0])
    g.links.new(n_in.outputs["Floors"], zm.inputs[1])
    fz = math("FRACT", a=zm.outputs[0])

    def band(f, lo, hi):
        a = math("GREATER_THAN", a=f.outputs[0], v1=lo)
        b = math("LESS_THAN", a=f.outputs[0], v1=hi)
        return math("MULTIPLY", a=a.outputs[0], b=b.outputs[0])

    win = math("MULTIPLY", a=band(fx, 0.30, 0.70).outputs[0], b=band(fz, 0.30, 0.78).outputs[0])
    sill = math("MULTIPLY", a=band(fx, 0.24, 0.76).outputs[0], b=band(fz, 0.22, 0.29).outputs[0])

    mix1 = g.nodes.new("ShaderNodeMix")
    mix1.data_type = "RGBA"
    g.links.new(win.outputs[0], mix1.inputs["Factor"])
    g.links.new(n_in.outputs["Base"], mix1.inputs["A"])
    mix1.inputs["B"].default_value = (0.055, 0.062, 0.075, 1.0)      # dark sash glass
    mix2 = g.nodes.new("ShaderNodeMix")
    mix2.data_type = "RGBA"
    g.links.new(sill.outputs[0], mix2.inputs["Factor"])
    g.links.new(mix1.outputs["Result"], mix2.inputs["A"])
    mix2.inputs["B"].default_value = (0.52, 0.50, 0.46, 1.0)         # granite sill band
    g.links.new(mix2.outputs["Result"], n_out.inputs["Color"])
    return g


_FACADE_CACHE = {}
_MAT_CACHE = {}


def _alive(m):
    """Cached bpy references can die under us (asset addons purge materials between
    loads); a dead StructRNA raises on any attribute access."""
    try:
        _ = m.name
        return True
    except ReferenceError:
        return False


def _mat_facade(color, bays, floors, roughness=0.85):
    key = (tuple(color), int(bays), int(floors))
    if key in _FACADE_CACHE and _alive(_FACADE_CACHE[key]):
        return _FACADE_CACHE[key]
    m = bpy.data.materials.new(f"facade{_COUNTER[0]}")
    _COUNTER[0] += 1
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = roughness
    grp = nt.nodes.new("ShaderNodeGroup")
    grp.node_tree = _facade_group()
    c = [q / 255.0 for q in color]
    grp.inputs["Base"].default_value = (*c, 1.0)
    grp.inputs["Bays"].default_value = float(bays)
    grp.inputs["Floors"].default_value = float(floors)
    nt.links.new(grp.outputs["Color"], bsdf.inputs["Base Color"])
    _FACADE_CACHE[key] = m
    return m


def _mat(color, roughness=0.8, name=None):
    key = (tuple(color), round(roughness, 2))
    if name is None and key in _MAT_CACHE and _alive(_MAT_CACHE[key]):
        return _MAT_CACHE[key]
    m = bpy.data.materials.new(name or f"mat{_COUNTER[0]}")
    _COUNTER[0] += 1
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    c = [q / 255.0 for q in color]
    bsdf.inputs["Base Color"].default_value = (*c, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    if name is None:
        _MAT_CACHE[key] = m
    return m


class Part:
    """One primitive part: records its object + atelier-space grain axis if rigid."""

    def __init__(self, obj, index):
        self.obj, self.index = obj, index


class Builder:
    """Collects parts for one creature under a root empty; assigns pass indices."""

    _next_index = [2]  # pass_index 1 reserved for ground; creatures start at 2

    def __init__(self, name, collection=None):
        self.name = name
        self.root = bpy.data.objects.new(f"{name}_root", None)
        bpy.context.scene.collection.objects.link(self.root)
        self.parts = []
        self.anchors = {}
        self.i0 = Builder._next_index[0]

    def _register(self, obj, color, roughness):
        obj.data.materials.append(_mat(color, roughness))
        obj.pass_index = Builder._next_index[0]
        Builder._next_index[0] += 1
        obj.parent = self.root
        bpy.context.scene.collection.objects.link(obj)
        self.parts.append(Part(obj, obj.pass_index))
        return obj

    def sphere(self, center, r, color, roughness=0.8, subdiv=3):
        mesh = bpy.data.meshes.new("sph")
        import bmesh
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new("sph", mesh)
        obj.location = S2B(*center) if len(center) == 3 else S2B(center[0], center[1])
        for poly in mesh.polygons:
            poly.use_smooth = True
        return self._register(obj, color, roughness)

    def ellipsoid(self, center, radii, color, roughness=0.8):
        obj = Builder.sphere(self, center, 1.0, color, roughness)
        obj.scale = (radii[0], radii[2] if len(radii) > 2 else radii[0], radii[1])  # x, z→y, y→z
        return obj

    def capsule(self, a, b, ra, rb=None, color=(200, 200, 200), roughness=0.8, segs=24):
        """Tapered capsule from a to b (atelier coords) as a cone with spherical caps."""
        rb = ra if rb is None else rb
        av = np.array(S2B(*a) if len(a) == 3 else S2B(a[0], a[1]), dtype=np.float64)
        bv = np.array(S2B(*b) if len(b) == 3 else S2B(b[0], b[1]), dtype=np.float64)
        d = bv - av
        L = float(np.linalg.norm(d)) or 1e-9
        mesh = bpy.data.meshes.new("cap")
        import bmesh
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=ra, radius2=rb, depth=L)
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new("cap", mesh)
        for poly in mesh.polygons:
            poly.use_smooth = True
        # orient +Z of the cone along d
        import mathutils
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = mathutils.Vector(d / L).to_track_quat("Z", "Y")
        obj.location = tuple((av + bv) / 2)
        self._register(obj, color, roughness)
        # spherical caps
        for c_at, r_at in ((a, ra), (b, rb)):
            self.sphere(c_at, r_at, color, roughness, subdiv=2)
        return obj

    def block(self, center, dims, color, roughness=0.85, rot_z=0.0, facade=None):
        """A rigid box. facade=(bays, floors) applies the procedural window-grid material."""
        mesh = bpy.data.meshes.new("blk")
        import bmesh
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new("blk", mesh)
        obj.location = S2B(*center) if len(center) == 3 else S2B(center[0], center[1])
        obj.scale = (dims[0], dims[2] if len(dims) > 2 else dims[0], dims[1])
        obj.rotation_euler = (0.0, 0.0, rot_z)
        if facade is not None:
            obj.data.materials.append(_mat_facade(color, facade[0], facade[1]))
            obj.pass_index = Builder._next_index[0]
            Builder._next_index[0] += 1
            obj.parent = self.root
            bpy.context.scene.collection.objects.link(obj)
            self.parts.append(Part(obj, obj.pass_index))
            return obj
        return self._register(obj, color, roughness)

    def custom(self, obj, color, roughness=0.8, smooth=True):
        """Register an externally-built mesh object (lofts, skin-modifier bodies, sims)
        into this creature's span — same material/identity treatment as primitives."""
        if smooth:
            for poly in obj.data.polygons:
                poly.use_smooth = True
        return self._register(obj, color, roughness)

    def anchor(self, name, pt):
        e = bpy.data.objects.new(f"{self.name}_{name}", None)
        e.empty_display_size = 0.05
        e.location = S2B(*pt) if len(pt) == 3 else S2B(pt[0], pt[1])
        e.parent = self.root
        bpy.context.scene.collection.objects.link(e)
        self.anchors[name] = e
        return e

    def finish(self, skeleton=None, grains=None, droop=0.7, coherence=0.7, aged=False):
        """Close the span; return the info dict (3D skeleton pts in atelier coords)."""
        i1 = Builder._next_index[0]
        return {
            "name": self.name, "root": self.root, "span": (self.i0, i1),
            "anchors": self.anchors, "skeleton": skeleton, "grains": grains or [],
            "droop": droop, "coherence": coherence, "aged": aged,
        }


def smooth_all(info, levels=2):
    """Subdivision-smooth every mesh part of a creature (the poor man's clay)."""
    for child in info["root"].children_recursive:
        if child.type == "MESH":
            mod = child.modifiers.new("subsurf", "SUBSURF")
            mod.levels = levels
            mod.render_levels = levels
            for poly in child.data.polygons:
                poly.use_smooth = True


# ── Clay v2: metaball skins with baked part identity ─────────────────────────
# The rigid-primitive Builder reads as stacked balloons. ClayBuilder restores the numpy
# backend's smooth-min clay: all soft parts become metaball elements in ONE family (they melt
# together), tapered capsules become chains of lerped balls (no end-cap knuckles, smooth
# branch crotches), and after conversion to mesh, per-vertex color + part-index attributes are
# baked by nearest-part lookup (the analog of sdflib's Gaussian material blend). Hard parts
# (eyes, nose, props) stay rigid mesh primitives — beads sitting ON the clay, exactly like the
# k=0 parts in the numpy sculptor.

class ClayBuilder(Builder):
    def __init__(self, name, resolution=0.045):
        super().__init__(name)
        self.mb = bpy.data.metaballs.new(name + "_clay")
        self.mb.resolution = resolution
        self.mb.render_resolution = resolution
        self.mb.threshold = 0.45
        self.mb_obj = bpy.data.objects.new(name + "_clay", self.mb)
        bpy.context.scene.collection.objects.link(self.mb_obj)
        self.records = []        # (part_index, color, seg_a(3), seg_b(3), r)

    def _pidx(self):
        i = Builder._next_index[0]
        Builder._next_index[0] += 1
        return i

    def _el(self, co, r):
        e = self.mb.elements.new(type="BALL")
        e.co = co
        e.radius = r
        e.stiffness = 2.0
        return e

    def sphere(self, center, r, color, roughness=0.8, hard=False, subdiv=3):
        if hard:
            return super().sphere(center, r, color, roughness, subdiv)
        co = S2B(*center) if len(center) == 3 else S2B(center[0], center[1])
        self._el(co, r)
        self.records.append((self._pidx(), color, co, co, r))

    def ellipsoid(self, center, radii, color, roughness=0.8, hard=False):
        if hard:
            return super().ellipsoid(center, radii, color, roughness)
        # ELLIPSOID elements surface unreliably; approximate with a cluster of balls along the
        # longest axis — the way actual clay does it
        co = np.array(S2B(*center) if len(center) == 3 else S2B(center[0], center[1]))
        r3 = np.array([radii[0], radii[2] if len(radii) > 2 else radii[0], radii[1]], dtype=float)
        ax = int(np.argmax(r3))
        others = [r3[i] for i in range(3) if i != ax]
        br = float(np.mean(others)) * 0.92
        half = float(r3[ax]) - br
        n = max(1, int(np.ceil(half / (br * 0.45))))
        for i in range(-n, n + 1):
            off = np.zeros(3)
            off[ax] = half * (i / n) if n else 0.0
            self._el(tuple(co + off), br)
        self.records.append((self._pidx(), color, tuple(co - np.eye(3)[ax] * half),
                             tuple(co + np.eye(3)[ax] * half), br))

    def capsule(self, a, b, ra, rb=None, color=(200, 200, 200), roughness=0.8, hard=False, segs=24):
        if hard:
            return super().capsule(a, b, ra, rb, color, roughness, segs)
        rb = ra if rb is None else rb
        av = np.array(S2B(*a) if len(a) == 3 else S2B(a[0], a[1]))
        bv = np.array(S2B(*b) if len(b) == 3 else S2B(b[0], b[1]))
        L = float(np.linalg.norm(bv - av))
        n = max(3, int(np.ceil(L / (max(min(ra, rb), 0.02) * 0.7))))
        for i in range(n + 1):
            t = i / n
            self._el(tuple(av + (bv - av) * t), ra + (rb - ra) * t)
        self.records.append((self._pidx(), color, tuple(av), tuple(bv), (ra + rb) / 2))

    def finish(self, skeleton=None, grains=None, droop=0.7, coherence=0.7, aged=False):
        dg = bpy.context.evaluated_depsgraph_get()
        ev = self.mb_obj.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, depsgraph=dg)
        skin = bpy.data.objects.new(self.name + "_skin", me)
        bpy.context.scene.collection.objects.link(skin)
        skin.parent = self.root
        for poly in me.polygons:
            poly.use_smooth = True
        self.mb_obj.hide_render = True
        self.mb_obj.hide_viewport = True

        verts = np.array([v.co[:] for v in me.vertices], dtype=np.float64)
        best_d = np.full(len(verts), np.inf)
        best_i = np.zeros(len(verts), dtype=np.int32)
        best_c = np.zeros((len(verts), 3))
        for (pidx, color, a, b, r) in self.records:
            av, bv = np.array(a), np.array(b)
            ab = bv - av
            L2 = float(ab @ ab) or 1e-12
            t = np.clip(((verts - av) @ ab) / L2, 0, 1)
            d = np.linalg.norm(verts - (av + t[:, None] * ab), axis=1) - r
            upd = d < best_d
            best_d[upd] = d[upd]
            best_i[upd] = pidx
            best_c[upd] = np.array(color) / 255.0

        col_attr = me.color_attributes.new(name="part_color", type="FLOAT_COLOR", domain="POINT")
        for i in range(len(verts)):
            col_attr.data[i].color = (best_c[i][0], best_c[i][1], best_c[i][2], 1.0)
        idx_attr = me.attributes.new(name="pidx", type="FLOAT", domain="POINT")
        idx_attr.data.foreach_set("value", best_i.astype(np.float32))

        m = bpy.data.materials.new(self.name + "_claymat")
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Roughness"].default_value = 0.8
        attr_c = nt.nodes.new("ShaderNodeAttribute")
        attr_c.attribute_name = "part_color"
        nt.links.new(attr_c.outputs["Color"], bsdf.inputs["Base Color"])
        attr_i = nt.nodes.new("ShaderNodeAttribute")
        attr_i.attribute_name = "pidx"
        aov = nt.nodes.new("ShaderNodeOutputAOV")
        aov.aov_name = "pidx"
        nt.links.new(attr_i.outputs["Fac"], aov.inputs["Value"])
        me.materials.append(m)

        return super().finish(skeleton=skeleton, grains=grains, droop=droop,
                              coherence=coherence, aged=aged)
