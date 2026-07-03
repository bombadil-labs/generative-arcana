"""Byrne cast — figures for the How Music Works majors.

Very different bodies than Dublin's coated walkers: these are DANCERS — articulated limbs
posed per-card, a suit jacket that can flare mid-move, the big-suit silhouette. Same clay
idiom (silhouette-grade, identity through build and posture), new affordances: every limb
takes (angle, length-scale), angle measured from straight-down in the frontal plane, positive
swinging toward +x. Feet at local origin when grounded; `airborne` lifts the whole body.
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core" / "blender"))
from bsculpt import Builder, ClayBuilder  # noqa: E402

SUIT_GREY = (88, 92, 102)
SUIT_PALE = (168, 172, 180)
SKIN = (198, 172, 146)


def _limb(b, ox, oy, ang, ln, r0, r1, color):
    ex = ox + np.sin(ang) * ln
    ey = oy - np.cos(ang) * ln
    b.capsule((ox, oy, 0.0), (ex, ey, 0.0), r0, r1, color)
    return ex, ey


def dancer(name="dancer", suit=SUIT_GREY, skin=SKIN,
           l_arm=(-0.35, 1.0), r_arm=(0.35, 1.0), l_leg=(-0.12, 1.0), r_leg=(0.12, 1.0),
           lean=0.0, head_tilt=0.0, jacket=0.0, big=1.0, airborne=0.0):
    """A figure ~1.0 units tall built for MOVEMENT. Limbs: (angle from down, length scale).
    lean pitches the torso toward +x; jacket 0..1 flares the tails; big widens the suit
    (1.35 = the Big Suit); airborne lifts the feet off local y=0."""
    b = ClayBuilder(name, resolution=0.021)
    ay = airborne

    # legs from the hips
    hx = 0.0
    _limb(b, hx - 0.045, 0.46 + ay, l_leg[0], 0.44 * l_leg[1], 0.058, 0.046, suit)
    _limb(b, hx + 0.045, 0.46 + ay, r_leg[0], 0.44 * r_leg[1], 0.058, 0.046, suit)

    # torso, leaned; shoulders follow
    tx = 0.36 * np.sin(lean)
    ty = 0.80 + ay - 0.06 * abs(np.sin(lean))
    b.capsule((0.0, 0.44 + ay, 0.0), (tx, ty, 0.0), 0.105 * big, 0.088 * big, suit)
    b.sphere((tx * 1.05, ty + 0.055, 0.0), 0.06, suit)                       # collar

    # jacket: wider chest mass + two flying tails
    if jacket > 0.01 or big > 1.15:
        b.capsule((tx * 0.3, 0.52 + ay, 0.0), (tx, ty - 0.02, 0.0),
                  0.118 * big, 0.1 * big, suit)
        # the flare is ONE center-back flap — cloth left behind by the motion. (v1 used
        # paired side tails: at silhouette grade a capsule out of the hip is an extra
        # limb — the six-limbed dancer. Anything that forks in pairs reads as anatomy.)
        if jacket > 0.15:
            back = -0.10 - jacket * 0.12 - 0.10 * np.sin(lean)
            b.capsule((tx * 0.3 - 0.02, 0.53 + ay, 0.0),
                      (tx * 0.3 + back, 0.53 + ay - 0.10 - jacket * 0.08, 0.0),
                      0.095, 0.05, suit)

    # arms from the shoulders
    sx, sy = tx, ty - 0.035
    la = _limb(b, sx - 0.10 * big, sy, l_arm[0], 0.40 * l_arm[1], 0.044, 0.036, suit)
    ra = _limb(b, sx + 0.10 * big, sy, r_arm[0], 0.40 * r_arm[1], 0.044, 0.036, suit)
    b.sphere((la[0], la[1], 0.0), 0.03, skin, )                              # hands
    b.sphere((ra[0], ra[1], 0.0), 0.03, skin)

    # head, tilted
    hx2 = tx * 1.1 + 0.05 * np.sin(head_tilt)
    hy2 = ty + 0.135 - 0.02 * abs(np.sin(head_tilt))
    b.sphere((hx2, hy2, 0.0), 0.072, skin)

    b.anchor("feet", (0.0, ay))
    b.anchor("head", (hx2, hy2 + 0.02))
    b.anchor("chest", (tx * 0.6, 0.68 + ay))
    b.anchor("l_hand", (la[0], la[1]))
    b.anchor("r_hand", (ra[0], ra[1]))
    skel = [(hx2, hy2 + 0.05), (tx * 0.5, 0.62 + ay), (0.0, 0.05 + ay)]
    return b.finish(skeleton=skel, droop=0.85, coherence=0.8)


def bigsuit(name="bigsuit", suit=SUIT_GREY, skin=SKIN, shirt=(228, 226, 220),
            l_arm=((-1.9, 0.5), (-2.8, 0.45)), r_arm=((1.7, 0.5), (0.9, 0.45)),
            l_leg=(-0.35, 1.0), r_leg=(0.4, 0.9), head_tilt=0.0, sway=0.0, airborne=0.0):
    """THE Big Suit — tailoring as architecture, so it is built from architecture: hard
    mesh blocks for the suit (cloth under tension drapes in planes, not blobs), clay-smooth
    spheres only for head and hands. Proportions are the caricature: shoulder slab ~4 heads
    wide, the head deliberately small, pencil legs. Arms are TWO-SEGMENT (shoulder→elbow→
    hand, each (angle-from-down, length)) — Byrne's dance is stiff puppet joints, and an
    elbow is where that stiffness lives. `sway` rocks the whole suit like the wobble."""
    b = Builder(name)
    ay = airborne

    # pencil legs + flat shoes
    for (ang, ln), off in ((l_leg, -0.055), (r_leg, 0.055)):
        ex = off + np.sin(ang) * 0.46 * ln
        ey = 0.48 + ay - np.cos(ang) * 0.46 * ln
        b.capsule((off, 0.48 + ay, 0.0), (ex, ey, 0.0), 0.030, 0.026, (40, 42, 48))
        b.block((ex + 0.025, ey - 0.012, 0.0), (0.11, 0.035, 0.055), (30, 30, 34))

    # THE SUIT: one rigid A-line — the whole thing sways as a single tailored slab
    # (per-block sway read as stacked crates; Byrne's suit moves as ONE)
    b.block((0.0, 0.585 + ay, 0.0), (0.50, 0.19, 0.21), suit, rot_z=sway)          # skirt
    b.block((0.0, 0.75 + ay, 0.0), (0.45, 0.18, 0.19), suit, rot_z=sway)           # chest
    b.block((0.0, 0.88 + ay, 0.0), (0.56, 0.11, 0.21), suit, rot_z=sway)           # shoulders
    b.block((0.0, 0.81 + ay, 0.10), (0.09, 0.14, 0.012), shirt, rot_z=sway)        # shirt V
    b.block((0.0, 0.80 + ay, 0.108), (0.026, 0.12, 0.008), (60, 30, 30), rot_z=sway)  # tie

    # two-segment arms from the shoulder CORNERS — the puppet joints
    for (seg, sx) in ((l_arm, -0.26), (r_arm, 0.26)):
        (a1, l1), (a2, l2) = seg
        ox, oy = sx, 0.875 + ay
        ex = ox + np.sin(a1) * 0.4 * l1
        ey = oy - np.cos(a1) * 0.4 * l1
        b.capsule((ox, oy, 0.0), (ex, ey, 0.0), 0.045, 0.038, suit)                # sleeve
        hx = ex + np.sin(a2) * 0.4 * l2
        hy = ey - np.cos(a2) * 0.4 * l2
        b.capsule((ex, ey, 0.0), (hx, hy, 0.0), 0.036, 0.028, suit)                # forearm
        b.sphere((hx, hy, 0.0), 0.033, skin)                                       # hand

    # the deliberately small head on a sliver of neck
    hx2 = 0.05 * np.sin(head_tilt) + 0.04 * np.sin(sway)
    b.capsule((0.02 * np.sin(sway), 0.925 + ay, 0.0), (hx2, 0.965 + ay, 0.0), 0.028, 0.026, skin)
    b.sphere((hx2, 1.015 + ay, 0.0), 0.062, skin)
    b.block((hx2, 1.062 + ay, 0.0), (0.092, 0.026, 0.072), (34, 32, 34))           # the flat hair

    b.anchor("feet", (0.0, ay))
    b.anchor("head", (hx2, 1.03 + ay))
    b.anchor("chest", (0.0, 0.78 + ay))
    skel = [(hx2, 1.05 + ay), (0.0, 0.7 + ay), (0.0, 0.05 + ay)]
    return b.finish(skeleton=skel, grains=[], droop=0.0, coherence=0.92)


def _chain(b, ox, oy, segs, r0, taper, color, joint_r=0.0, joint_color=None):
    """A limb as an angle chain: segs = [(angle-from-down, length), ...]. Returns joint
    points. Joint spheres articulate the silhouette — knees and elbows are landmarks."""
    pts = [(ox, oy)]
    r = r0
    for (ang, ln) in segs:
        nx = pts[-1][0] + np.sin(ang) * ln
        ny = pts[-1][1] - np.cos(ang) * ln
        b.capsule((pts[-1][0], pts[-1][1], 0.0), (nx, ny, 0.0), r, r * taper, color)
        if joint_r > 0:
            b.sphere((nx, ny, 0.0), joint_r, joint_color or color)
        pts.append((nx, ny))
        r *= taper
    return pts


def mannequin(name="mannequin", body=(150, 148, 144), skin=SKIN, head_scale=1.0,
              l_arm=((-0.4, 0.21), (-0.5, 0.20)), r_arm=((0.4, 0.21), (0.5, 0.20)),
              l_leg=((-0.1, 0.24), (-0.05, 0.24)), r_leg=((0.1, 0.24), (0.05, 0.24)),
              lean=0.0, head_tilt=0.0, airborne=0.0, suit_slabs=None):
    """The artist's mannequin, ~7.5 heads tall at unit height: ribcage and pelvis as
    SEPARATE masses with a waist between, clavicle slope (not box corners), two-segment
    limbs with joint spheres. A wooden mannequin reads as human with zero surface detail —
    proportion and landmarks are the whole signal; this builder is those landmarks.
    `suit_slabs=(color, width)` replaces the torso masses with the hard tailored A-line
    (the Big Suit variant) while keeping mannequin limbs and their joints."""
    b = Builder(name)
    ay = airborne

    # legs: pelvis → knee → ankle (two segments each), then feet
    for (seg, off) in ((l_leg, -0.065), (r_leg, 0.065)):
        pts = _chain(b, off, 0.50 + ay, seg, 0.042, 0.82, body, joint_r=0.034)
        ax_, ayy = pts[-1]
        heel = 0.02 + np.sin(seg[-1][0]) * 0.02
        b.block((ax_ + 0.035 + heel, ayy - 0.008, 0.0), (0.115, 0.032, 0.05), (36, 36, 40))

    # pelvis, waist, ribcage — three distinct masses; the waist is the point
    tx = 0.30 * np.sin(lean)
    b.capsule((-0.055, 0.52 + ay, 0.0), (0.055, 0.52 + ay, 0.0), 0.062, 0.062, body)   # pelvis
    b.capsule((tx * 0.25, 0.58 + ay, 0.0), (tx * 0.6, 0.66 + ay, 0.0), 0.045, 0.05, body)  # waist
    rc0 = (tx * 0.6, 0.66 + ay)
    rc1 = (tx, 0.84 + ay)
    if suit_slabs is None:
        b.capsule((rc0[0], rc0[1], 0.0), (rc1[0], rc1[1], 0.0), 0.075, 0.088, body)    # ribcage
        sh_y = 0.845 + ay
        sh_w = 0.115
        # clavicles SLOPE from the neck to the shoulder balls
        for sgn in (-1, 1):
            b.capsule((tx, sh_y + 0.02, 0.0), (tx + sgn * sh_w, sh_y, 0.0), 0.024, 0.03, body)
            b.sphere((tx + sgn * sh_w, sh_y, 0.0), 0.042, body)
    else:
        suit, sw = suit_slabs
        b.block((tx * 0.4, 0.60 + ay, 0.0), (sw * 0.98, 0.17, 0.20), suit, rot_z=lean * 0.4)
        b.block((tx * 0.7, 0.75 + ay, 0.0), (sw * 0.94, 0.16, 0.20), suit, rot_z=lean * 0.4)
        b.block((tx, 0.86 + ay, 0.0), (sw, 0.10, 0.21), suit, rot_z=lean * 0.4)
        sh_y = 0.865 + ay
        sh_w = sw * 0.46
    arm_r = 0.036

    # arms: shoulder → elbow → wrist, hands as small spheres
    for (seg, sgn) in ((l_arm, -1), (r_arm, 1)):
        pts = _chain(b, tx + sgn * sh_w, sh_y, seg, arm_r, 0.8,
                     body if suit_slabs is None else suit_slabs[0], joint_r=0.028)
        b.sphere((pts[-1][0], pts[-1][1], 0.0), 0.03, skin)

    # neck + head (head_scale < 1 = the caricature)
    hs = head_scale
    hx2 = tx * 1.1 + 0.05 * np.sin(head_tilt)
    b.capsule((tx, sh_y + 0.01, 0.0), (hx2 * 0.9 + tx * 0.1, sh_y + 0.06, 0.0), 0.026, 0.024, skin)
    hy2 = sh_y + 0.06 + 0.062 * hs
    b.sphere((hx2, hy2, 0.0), 0.065 * hs, skin)
    b.block((hx2, hy2 + 0.048 * hs, 0.0), (0.09 * hs, 0.026, 0.07), (34, 32, 34))

    b.anchor("feet", (0.0, ay))
    b.anchor("head", (hx2, hy2))
    b.anchor("chest", (tx * 0.7, 0.76 + ay))
    skel = [(hx2, hy2 + 0.04), (tx * 0.5, 0.64 + ay), (0.0, 0.05 + ay)]
    return b.finish(skeleton=skel, grains=[], droop=0.0, coherence=0.92)


def _skin_mesh(name, joints, edges, radii, root_i=0):
    """A body from a stick skeleton via Blender's Skin modifier + subdivision — smooth
    organic mass from pure code, no metaball beading, no capsule stacking. joints are
    atelier-space (x, y, z); radii per joint."""
    import bpy
    from bsculpt import S2B
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([S2B(*j) for j in joints], edges, [])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.modifiers.new("skin", "SKIN")
    for i, r in enumerate(radii):
        sv = obj.data.skin_vertices[0].data[i]
        sv.radius = (r, r)
        sv.use_root = (i == root_i)
    sub = obj.modifiers.new("sub", "SUBSURF")
    sub.levels = 2
    sub.render_levels = 2
    # bake the modifier stack to a real mesh so it registers like any primitive
    dg = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    out = bpy.data.objects.new(name, baked)
    bpy.data.objects.remove(obj, do_unlink=True)
    return out


def _loft(name, rings, n=48, k=0.72, wrinkle=0.0):
    """A garment as a lofted surface: rings = [(y, half_w, half_d, x_off), ...] hem→collar,
    superellipse cross-sections (exponent k: 1=ellipse, →0 boxier). Open at the hem like a
    real jacket. `wrinkle` displaces the surface with noise — cloth without simulation."""
    import bpy
    from bsculpt import S2B
    verts, faces = [], []
    ts = np.linspace(0, 2 * np.pi, n, endpoint=False)
    for (y, hw, hd, xo) in rings:
        for t in ts:
            c, s = np.cos(t), np.sin(t)
            x = xo + hw * np.sign(c) * abs(c) ** k
            z = hd * np.sign(s) * abs(s) ** k
            verts.append(S2B(x, y, z))
    nr = len(rings)
    for j in range(nr - 1):
        for i in range(n):
            a = j * n + i
            b_ = j * n + (i + 1) % n
            faces.append((a, b_, b_ + n, a + n))
    faces.append(tuple(range((nr - 1) * n, nr * n)))       # collar cap
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    if wrinkle > 0:
        tex = bpy.data.textures.new(name + "_wr", "CLOUDS")
        tex.noise_scale = 0.10
        mod = obj.modifiers.new("disp", "DISPLACE")
        mod.texture = tex
        mod.strength = wrinkle
        mod.mid_level = 0.5
        sub = obj.modifiers.new("sub", "SUBSURF")
        sub.levels = 2
        sub.render_levels = 2
        import bpy as _b
        dg = _b.context.evaluated_depsgraph_get()
        baked = _b.data.meshes.new_from_object(obj.evaluated_get(dg))
        out = _b.data.objects.new(name, baked)
        _b.data.objects.remove(obj, do_unlink=True)
        return out
    return obj


def suit_man(name="suit_man", suit=(172, 176, 180), skin=SKIN, hair=(38, 34, 36),
             shirt=(232, 230, 224), head_scale=0.82,
             l_arm=((-0.4, 0.20), (-0.5, 0.20)), r_arm=((0.4, 0.20), (0.5, 0.20)),
             l_leg=((-0.1, 0.24), (-0.05, 0.24)), r_leg=((0.1, 0.24), (0.05, 0.24)),
             lean=0.0, head_tilt=0.0, airborne=0.0, oversize=1.0):
    """The man in the suit that is too big — built the way the photograph is built:
    a smooth skin-modifier BODY (legs, trousers), a lofted GARMENT with sloped soft
    shoulders, A-line drape and displacement wrinkles (cloth, not architecture), fat
    hanging sleeves, small head under floppy dark hair. `oversize` scales only the
    garment: 1.0 a suit, 1.3 THE suit."""
    b = Builder(name)
    ay = airborne
    tx = 0.26 * np.sin(lean)

    # trousered legs: one skin mesh — pelvis down through knees to ankles
    joints = [(0.0, 0.56 + ay, 0.0)]
    edges, radii = [], [0.075]
    for (seg, off) in ((l_leg, -0.06), (r_leg, 0.06)):
        hip = (off, 0.52 + ay, 0.0)
        joints.append(hip)
        edges.append((0, len(joints) - 1))
        radii.append(0.062)
        px, py = hip[0], hip[1]
        for si, (ang, ln) in enumerate(seg):
            px += np.sin(ang) * ln
            py -= np.cos(ang) * ln
            joints.append((px, py, 0.0))
            edges.append((len(joints) - 2, len(joints) - 1))
            radii.append(0.048 if si == 0 else 0.034)
        b.block((px + 0.035, py - 0.01, 0.0), (0.115, 0.034, 0.052), (32, 32, 36))  # shoe
    legs = _skin_mesh(name + "_legs", joints, edges, radii)
    b.custom(legs, (56, 60, 68), roughness=0.9)

    # THE GARMENT: hem swings wide, waist barely narrows, shoulders SLOPE into the collar
    ov = oversize
    rings = [
        (0.50 + ay, 0.225 * ov, 0.145 * ov, tx * 0.30),        # hem, swinging
        (0.60 + ay, 0.215 * ov, 0.138 * ov, tx * 0.45),
        (0.72 + ay, 0.208 * ov, 0.130 * ov, tx * 0.70),
        (0.83 + ay, 0.215 * ov, 0.132 * ov, tx * 0.90),        # chest
        (0.88 + ay, 0.222 * ov, 0.130 * ov, tx),               # the shoulder LINE (square)
        (0.90 + ay, 0.20 * ov, 0.115 * ov, tx),                # quick slope
        (0.918 + ay, 0.062, 0.055, tx),                        # collar
    ]
    jacket = _loft(name + "_jacket", rings, k=0.62, wrinkle=0.010)
    b.custom(jacket, suit, roughness=0.92)
    # shirt V + buttons down the front
    b.block((tx + 0.0, 0.86 + ay, 0.137 * ov), (0.055, 0.09, 0.012), shirt)
    for by in (0.62, 0.71, 0.80):
        b.sphere((tx * (by - 0.5) / 0.4, by + ay, 0.138 * ov), 0.012, (210, 206, 196))

    # SLEEVES hang from the garment's shoulder-line ends (that's what sleeves are) —
    # but cloth HANGS: the upper-arm angle is clamped toward vertical, and the ELBOW does
    # the expressive work. This keeps arms visible OUTSIDE the silhouette from every
    # angle (the study showed the garment swallowing anatomically-attached arms).
    sh_y = 0.875 + ay
    for (seg, sgn) in ((l_arm, -1), (r_arm, 1)):
        ox, oy = tx + sgn * 0.205 * ov, sh_y
        r = 0.052 * ov
        for si, (ang, ln) in enumerate(seg):
            if si == 0:
                ang = float(np.clip(ang, -1.05, 1.05))         # the hang constraint
            ex = ox + np.sin(ang) * ln
            ey = oy - np.cos(ang) * ln
            b.capsule((ox, oy, 0.0), (ex, ey, 0.0), r, r * 0.85, suit, roughness=0.92)
            ox, oy = ex, ey
            r *= 0.85
        b.sphere((ox, oy - 0.015, 0.0), 0.028, skin)

    # the small head under floppy dark hair; a sliver of neck
    hs = head_scale
    hx2 = tx + 0.05 * np.sin(head_tilt)
    b.capsule((tx, 0.918 + ay, 0.0), (hx2 * 0.8 + tx * 0.2, 0.962 + ay, 0.0), 0.03, 0.027, skin)
    hy2 = 0.962 + ay + 0.06 * hs
    b.sphere((hx2, hy2, 0.0), 0.064 * hs, skin)
    b.ellipsoid((hx2 - 0.008, hy2 + 0.030 * hs, -0.006), (0.066 * hs, 0.050 * hs, 0.068 * hs), hair)

    b.anchor("feet", (0.0, ay))
    b.anchor("head", (hx2, hy2))
    b.anchor("chest", (tx * 0.8, 0.80 + ay))
    skel = [(hx2, hy2 + 0.04), (tx * 0.6, 0.72 + ay), (0.0, 0.05 + ay)]
    return b.finish(skeleton=skel, grains=[], droop=0.0, coherence=0.9)


def water_pool(size=(30.0, 18.0), color=(30, 38, 44)):
    """Still water: a thin near-mirror slab at y≈0 — Cycles gives the reflection for real."""
    b = Builder("water")
    b.block((0.0, 0.015, 0.0), (size[0], 0.03, size[1]), color, roughness=0.06)
    b.anchor("surface", (0.0, 0.03))
    b.anchor("base", (0.0, 0.0))
    return b.finish(skeleton=None, grains=[], droop=0.0, coherence=0.95)


def highway(length=900.0, width=7.4):
    """A dead-straight road receding to the vanishing point, dashed centerline and all."""
    b = Builder("highway")
    b.block((length / 2 - 12, 0.02, 0.0), (length, 0.05, width), (58, 57, 60), roughness=0.9)
    for sgn in (-1, 1):                                        # soft shoulders
        b.block((length / 2 - 12, 0.015, sgn * (width / 2 + 0.55)),
                (length, 0.03, 1.1), (112, 100, 78), roughness=0.95)
    x = 2.0
    while x < length - 14:                                     # the dashes
        b.block((x, 0.05, 0.0), (2.6, 0.02, 0.16), (214, 210, 196), roughness=0.8)
        x += 7.5
    b.anchor("base", (0.0, 0.05))
    return b.finish(skeleton=None, grains=[], droop=0.0, coherence=0.95)
