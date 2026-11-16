"""Builds Exo Genesis model assets in Blender (headless):

    blender -b --factory-startup -P blender/build.py -- [--only solar,turret,...]

Writes public/media/model/exo-<id>.glb. The matching records live in
content/assets/exo-<id>.json (scale 1, yaw 0, lift 0: these are built to size).

Conventions: 1 Blender metre = 1 world unit (≈ 10 m in fiction). Blender Z is
up; the glTF exporter turns Blender −Y into the game's +Z, which is "front"
(units drive that way; a wall runs along it; the Vehicle Bay's door faces the
other way, Blender +Y). Parts the game animates are separate objects with
the names it looks for: turret `head` (pivot at its origin, rest facing front),
radar `dish`, bay `door` and battery `charge` (single material each, their
emissive is dimmed when unpowered). Flat shading with chamfered edges, to sit
next to the built-in low-poly style but with more detail.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

OUT = Path("public/media/model")


# ---------------------------------------------------------------- setup

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()


def srgb(h):
    """Hex sRGB → linear RGBA (Blender colours and glTF factors are linear)."""
    h = h.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


MATS = {}


def mat(name, color, metal=0.45, rough=0.55, emit=None, strength=0.0):
    m = MATS.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = srgb(color)
    p.inputs["Metallic"].default_value = metal
    p.inputs["Roughness"].default_value = rough
    if emit:
        p.inputs["Emission Color"].default_value = srgb(emit)
        p.inputs["Emission Strength"].default_value = strength
    MATS[name] = m
    return m


def palette():
    return {
        "hull": mat("hull", "#b4bcc3", 0.45, 0.5),
        "hull2": mat("hull2", "#8f989f", 0.45, 0.55),
        "dark": mat("dark", "#363c44", 0.5, 0.6),
        "black": mat("black", "#1c2026", 0.3, 0.7),
        "accent": mat("accent", "#c98a3a", 0.35, 0.5),
        "rust": mat("rust", "#a3927a", 0.35, 0.6),
        "cell": mat("cell", "#16294f", 0.7, 0.22, emit="#0c2a55", strength=0.6),
        "cyan": mat("cyan", "#000000", 0.0, 0.4, emit="#5ff3ff", strength=2.2),
        "amber": mat("amber", "#000000", 0.0, 0.4, emit="#ffb547", strength=2.6),
        "red": mat("red", "#000000", 0.0, 0.4, emit="#ff6a4d", strength=3.0),
        "glass": mat("glass", "#2a4a5a", 0.2, 0.15),
    }


# ---------------------------------------------------------------- primitives

def _finish(o, m, bevel, segs=1):
    o.data.materials.append(m)
    if bevel > 0:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = segs
        b.limit_method = "ANGLE"
    return o


def box(size, loc, m, bevel=0.06, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(o, m, bevel)


def cyl(r, depth, loc, m, verts=12, rot=(0, 0, 0), bevel=0.04, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    return _finish(bpy.context.active_object, m, bevel)


def sphere(r, loc, m, seg=10, rings=6, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(o, m, 0)


def join(objs, name, pivot=(0, 0, 0)):
    """Apply modifiers, merge into one object named `name` whose origin is `pivot`."""
    for o in objs:
        bpy.context.view_layer.objects.active = o
        for md in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=md.name)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    bpy.context.scene.cursor.location = Vector(pivot)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.context.scene.cursor.location = Vector((0, 0, 0))
    for poly in o.data.polygons:
        poly.use_smooth = False
    return o


def export(model_id, objs):
    root = bpy.data.objects.new(model_id, None)
    bpy.context.scene.collection.objects.link(root)
    for o in objs:
        o.parent = root
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for o in objs:
        o.select_set(True)
    path = OUT / f"exo-{model_id}.glb"
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
        export_normals=True, export_texcoords=False, export_materials="EXPORT", export_animations=False,
    )
    tris = sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
    print(f"  exo-{model_id}.glb  {path.stat().st_size // 1024} KB  {tris} tris")


def ring(n, r, z, fn):
    for i in range(n):
        a = i / n * math.tau
        fn(i, a, math.cos(a) * r, math.sin(a) * r, z)


# ---------------------------------------------------------------- models

def solar(M):
    parts = []
    parts.append(cyl(2.0, 0.4, (0, 0, 0.2), M["dark"], verts=6, bevel=0.08))
    parts.append(cyl(1.4, 0.25, (0, 0, 0.52), M["hull2"], verts=6))
    parts.append(cyl(0.28, 2.1, (0, 0, 1.6), M["hull"], verts=8))
    parts.append(box((4.6, 0.5, 0.5), (0, 0, 2.6), M["dark"]))           # yoke
    parts.append(box((0.9, 0.7, 0.6), (0, 0.9, 0.85), M["hull2"]))        # inverter box
    parts.append(box((0.5, 0.06, 0.12), (0, 0.53, 0.95), M["cyan"], bevel=0))
    tilt = 0.35
    for sx in (-1, 1):
        cx = sx * 2.35
        frame = box((4.1, 3.3, 0.14), (cx, 0, 2.95), M["dark"], rot=(tilt, 0, 0))
        parts.append(frame)
        # 3 × 4 cells, slightly proud of the frame
        for i in range(4):
            for j in range(3):
                x = cx - 1.5 + i * 1.0
                y = -1.05 + j * 1.05
                z = 2.95 + 0.09 + y * math.sin(tilt)
                yy = y * math.cos(tilt)
                parts.append(box((0.9, 0.95, 0.05), (x, yy, z), M["cell"], bevel=0.02, rot=(tilt, 0, 0)))
        # glowing edge on the high side
        parts.append(box((4.1, 0.08, 0.1), (cx, 1.65 * math.cos(tilt), 2.95 + 1.65 * math.sin(tilt) + 0.05), M["cyan"], bevel=0, rot=(tilt, 0, 0)))
    export("solar", [join(parts, "body")])


def depot(M):
    parts = []
    parts.append(box((7.2, 6.2, 0.6), (0, 0, 0.3), M["dark"], bevel=0.12))
    # hopper: tapered hexagonal bin on legs
    parts.append(cyl(1.9, 2.6, (-1.7, -0.5, 3.0), M["rust"], verts=6, r2=1.1))
    parts.append(cyl(1.95, 0.25, (-1.7, -0.5, 4.3), M["dark"], verts=6))
    ring(4, 1.2, 0, lambda i, a, x, y, z: parts.append(box((0.25, 0.25, 1.8), (-1.7 + x, -0.5 + y, 1.4), M["dark"])))
    # processing shed with a ribbed roof and a roll door
    parts.append(box((3.4, 3.6, 2.8), (1.75, 0.6, 2.0), M["rust"], bevel=0.1))
    for k in range(5):
        parts.append(box((3.6, 0.18, 0.18), (1.75, -0.9 + k * 0.75, 3.45), M["dark"]))
    parts.append(box((2.2, 0.08, 1.8), (1.75, -1.22, 1.5), M["hull2"], bevel=0.03))
    parts.append(box((3.5, 0.1, 0.16), (1.75, -1.25, 2.85), M["amber"], bevel=0))
    # conveyor from hopper to shed
    parts.append(box((2.4, 0.7, 0.3), (0.1, -0.5, 2.0), M["dark"], rot=(0, -0.35, 0)))
    for k in range(4):
        parts.append(cyl(0.12, 0.75, (-0.8 + k * 0.6, -0.5, 1.82 + k * 0.21), M["hull2"], verts=6, rot=(math.pi / 2, 0, 0), bevel=0))
    # crane mast, boom and work lamp
    parts.append(box((0.45, 0.45, 5.0), (2.9, 2.0, 3.5), M["dark"]))
    parts.append(box((0.32, 5.2, 0.32), (2.9, -0.4, 5.9), M["dark"]))
    parts.append(box((0.2, 0.2, 1.4), (2.9, -2.8, 5.1), M["hull2"]))
    parts.append(sphere(0.32, (2.9, 2.0, 6.25), M["amber"], seg=6, rings=4))
    # pipes
    parts.append(cyl(0.18, 3.0, (-3.2, 1.6, 0.9), M["hull2"], verts=8, rot=(0, math.pi / 2, 0.4)))
    export("depot", [join(parts, "body")])


def battery(M):
    parts, bands = [], []
    parts.append(box((5.2, 3.8, 0.5), (0, 0, 0.25), M["dark"], bevel=0.1))
    parts.append(box((5.0, 0.5, 0.35), (0, 1.55, 0.65), M["hull2"]))     # bus bar housing
    for x in (-1.55, 0, 1.55):
        parts.append(cyl(0.66, 2.7, (x, -0.1, 1.85), M["hull"], verts=12))
        parts.append(cyl(0.72, 0.22, (x, -0.1, 3.25), M["dark"], verts=12))
        parts.append(cyl(0.25, 0.25, (x, -0.1, 3.45), M["hull2"], verts=8))
        parts.append(box((0.18, 1.2, 0.18), (x, 0.7, 3.25), M["dark"], bevel=0.02))
        bands.append(cyl(0.7, 0.26, (x, -0.1, 2.2), M["cyan"], verts=12, bevel=0))
        bands.append(cyl(0.7, 0.12, (x, -0.1, 1.2), M["cyan"], verts=12, bevel=0))
    export("battery", [join(parts, "body"), join(bands, "charge")])


def turret(M):
    parts, head = [], []
    parts.append(cyl(2.5, 0.7, (0, 0, 0.35), M["dark"], verts=8, bevel=0.1))
    parts.append(cyl(2.0, 0.6, (0, 0, 0.95), M["hull2"], verts=8, r2=1.6))
    ring(8, 2.15, 0, lambda i, a, x, y, z: parts.append(box((0.5, 0.25, 0.9), (x, y, 0.7), M["hull"], rot=(0, 0, a))))
    parts.append(cyl(0.95, 1.2, (0, 0, 1.8), M["dark"], verts=10))
    parts.append(cyl(1.25, 0.25, (0, 0, 2.45), M["hull2"], verts=10))
    # head, built around its pivot at z = 3.1; front is −Y
    P = 3.1
    head.append(box((2.2, 2.5, 1.1), (0, 0.15, P), M["hull"], bevel=0.14))
    head.append(box((1.8, 1.2, 0.5), (0, 0.4, P + 0.7), M["hull2"], bevel=0.1))
    head.append(box((2.4, 0.5, 0.35), (0, 1.35, P - 0.1), M["dark"]))     # counterweight
    for x in (-0.5, 0.5):
        head.append(cyl(0.17, 2.6, (x, -2.1, P - 0.1), M["dark"], verts=8, rot=(math.pi / 2, 0, 0)))
        head.append(cyl(0.24, 0.45, (x, -3.3, P - 0.1), M["black"], verts=8, rot=(math.pi / 2, 0, 0)))
        head.append(cyl(0.26, 0.5, (x, -0.95, P - 0.1), M["hull2"], verts=8, rot=(math.pi / 2, 0, 0)))
    head.append(box((1.3, 0.1, 0.22), (0, -1.1, P + 0.25), M["red"], bevel=0))
    head.append(box((0.35, 0.35, 0.6), (0.85, 0.6, P + 0.95), M["dark"]))  # sensor mast
    head.append(sphere(0.12, (0.85, 0.6, P + 1.3), M["red"], seg=6, rings=4))
    export("turret", [join(parts, "body"), join(head, "head", pivot=(0, 0, P))])


def radar(M):
    parts, dish = [], []
    parts.append(cyl(1.9, 0.4, (0, 0, 0.2), M["dark"], verts=6))
    for i in range(3):
        a = i / 3 * math.tau
        x, y = math.cos(a) * 1.45, math.sin(a) * 1.45
        parts.append(box((0.32, 0.32, 6.2), (x * 0.82, y * 0.82, 3.1), M["dark"], rot=(-math.sin(a) * 0.2, math.cos(a) * 0.2, 0)))
        parts.append(box((0.16, 0.16, 2.6), (x * 0.6, y * 0.6, 2.2), M["hull2"], rot=(-math.sin(a + 1) * 0.6, math.cos(a + 1) * 0.6, 0)))
    parts.append(cyl(0.9, 0.7, (0, 0, 6.3), M["hull2"], verts=8))
    parts.append(cyl(0.45, 0.4, (0, 0, 6.8), M["dark"], verts=8))
    # dish on its pivot (spins about z)
    P = 7.0
    # a shallow bowl: the bottom cap of a sphere (opening up), tipped forward toward −Y
    R0, T = 2.7, 0.55
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=R0, location=(0, 0, 0))
    bowl = bpy.context.active_object
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for v in bowl.data.vertices:
        v.select = v.co.z > -1.85  # drop everything but the bottom cap
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")
    sol = bowl.modifiers.new("solid", "SOLIDIFY")
    sol.thickness = 0.12
    bowl.data.materials.append(M["hull"])
    # after tipping by T about X, the cap's lowest point (0, 0, −R0) lands at (0, R0 sin T, −R0 cos T)
    base = Vector((0, 0.3, P + 0.5))
    bowl.rotation_euler = (T, 0, 0)
    bowl.location = (0, base.y - R0 * math.sin(T), base.z + R0 * math.cos(T))
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
    dish.append(bowl)
    up = Vector((0, -math.sin(T), math.cos(T)))  # where the dish looks
    arm_mid, feed = base + up * 0.9, base + up * 1.8
    dish.append(box((0.12, 0.12, 1.8), tuple(arm_mid), M["dark"], rot=(T, 0, 0)))
    dish.append(sphere(0.28, tuple(feed), M["cyan"], seg=6, rings=4))
    dish.append(box((0.9, 0.6, 0.6), (0, 0.9, P + 0.1), M["dark"]))
    dish.append(cyl(0.3, 0.6, (0, 0, P), M["hull2"], verts=8))
    export("radar", [join(parts, "body"), join(dish, "dish", pivot=(0, 0, P))])


def bay(M):
    parts, door = [], []
    parts.append(box((10.4, 9.4, 0.5), (0, 0, 0.25), M["dark"], bevel=0.12))
    # ribbed half-pipe hangar running along Y (door at +Y)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=3.7, depth=8.0, location=(0, 0, 0.5), rotation=(math.pi / 2, 0, 0))
    shell = bpy.context.active_object
    # drop the lower half (local y is world z after the rotation)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for v in shell.data.vertices:
        v.select = v.co.y < -0.05
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")
    _finish(shell, M["hull"], 0)
    sol = shell.modifiers.new("solid", "SOLIDIFY")
    sol.thickness = 0.2
    parts.append(shell)
    for k in range(5):
        y = -3.6 + k * 1.8
        bpy.ops.mesh.primitive_torus_add(major_radius=3.8, minor_radius=0.14, major_segments=16, minor_segments=4, location=(0, y, 0.5), rotation=(math.pi / 2, 0, 0))
        t = bpy.context.active_object
        _finish(t, M["dark"], 0)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.object.mode_set(mode="OBJECT")
        for v in t.data.vertices:
            v.select = v.co.y < -0.05
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.delete(type="VERT")
        bpy.ops.object.mode_set(mode="OBJECT")
        parts.append(t)
    # back wall (−Y) and front frame (+Y)
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=3.7, depth=0.3, location=(0, -4.0, 0.5), rotation=(math.pi / 2, 0, 0))
    back = bpy.context.active_object
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for v in back.data.vertices:
        v.select = v.co.y < -0.05
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")
    parts.append(_finish(back, M["hull2"], 0))
    parts.append(box((0.5, 0.5, 3.6), (-2.75, 4.1, 2.3), M["dark"]))
    parts.append(box((0.5, 0.5, 3.6), (2.75, 4.1, 2.3), M["dark"]))
    parts.append(box((6.0, 0.5, 0.5), (0, 4.1, 4.0), M["dark"]))
    parts.append(box((5.0, 0.12, 0.14), (0, 4.36, 4.0), M["amber"], bevel=0))
    # ramp, side vents, roof beacon
    parts.append(box((5.2, 2.4, 0.22), (0, 5.3, 0.3), M["dark"], rot=(-0.12, 0, 0)))
    for sx in (-1, 1):
        parts.append(box((0.8, 6.0, 2.2), (sx * 4.55, 0, 1.3), M["hull2"], bevel=0.08))
        for k in range(4):
            parts.append(box((0.1, 0.9, 0.14), (sx * 4.98, -2.0 + k * 1.3, 1.6), M["black"], bevel=0))
    parts.append(cyl(0.3, 0.4, (0, -2.4, 4.35), M["dark"], verts=8))
    parts.append(sphere(0.22, (0, -2.4, 4.65), M["amber"], seg=6, rings=4))
    # the door: one emissive panel, facing +Y
    door.append(box((4.8, 0.08, 3.0), (0, 3.95, 2.0), M["amber"], bevel=0))
    export("bay", [join(parts, "body"), join(door, "door")])


def wall(M):
    parts = []
    # runs along Y, 4.1 long; post at the −Y (game +Z) end
    parts.append(box((1.4, 4.12, 0.4), (0, 0, 0.2), M["dark"], bevel=0.06))
    parts.append(box((1.2, 4.12, 2.0), (0, 0, 1.3), M["hull2"], bevel=0.12))
    parts.append(box((1.5, 4.12, 0.3), (0, 0, 2.45), M["dark"], bevel=0.06))
    for k in (-1, 1):
        parts.append(box((1.26, 1.5, 0.9), (0, k * 1.0, 1.15), M["hull"], bevel=0.08))
    parts.append(box((1.8, 0.75, 3.0), (0, -2.0, 1.5), M["dark"], bevel=0.1))
    parts.append(box((1.24, 3.2, 0.1), (0, 0.2, 1.85), M["cyan"], bevel=0))
    export("wall", [join(parts, "body")])


def rover(M):
    parts = []
    # front is −Y
    parts.append(box((1.35, 2.1, 0.45), (0, 0, 0.72), M["hull"], bevel=0.1))
    parts.append(box((1.1, 1.0, 0.5), (0, 0.25, 1.15), M["hull2"], bevel=0.1))
    parts.append(box((0.95, 0.06, 0.3), (0, -0.27, 1.2), M["glass"], bevel=0, rot=(-0.5, 0, 0)))
    for x in (-0.78, 0.78):
        for y in (-0.7, 0.0, 0.7):
            parts.append(cyl(0.34, 0.28, (x, y, 0.36), M["black"], verts=10, rot=(0, math.pi / 2, 0), bevel=0.03))
    parts.append(box((0.14, 0.95, 0.14), (0, -0.45, 1.5), M["dark"]))     # gun
    parts.append(box((0.35, 0.4, 0.25), (0, 0.05, 1.5), M["dark"]))
    parts.append(box((0.04, 0.04, 0.8), (0.45, 0.6, 1.75), M["dark"], bevel=0))  # antenna
    parts.append(box((1.0, 0.06, 0.08), (0, -0.25, 1.4), M["cyan"], bevel=0))
    export("rover", [join(parts, "body")])


def tank(M):
    parts = []
    parts.append(box((2.0, 2.9, 0.7), (0, 0, 0.8), M["hull"], bevel=0.12))
    parts.append(box((1.8, 0.6, 0.4), (0, -1.5, 0.75), M["hull2"], bevel=0.1, rot=(0.5, 0, 0)))
    for sx in (-1, 1):
        parts.append(box((0.55, 3.1, 0.65), (sx * 1.15, 0, 0.42), M["black"], bevel=0.14))
        for k in range(4):
            parts.append(cyl(0.22, 0.3, (sx * 1.15, -1.05 + k * 0.7, 0.32), M["dark"], verts=8, rot=(0, math.pi / 2, 0), bevel=0))
        parts.append(box((0.65, 3.0, 0.1), (sx * 1.15, 0, 0.8), M["hull2"], bevel=0.03))   # track guard
    parts.append(cyl(0.78, 0.55, (0, 0.15, 1.4), M["hull2"], verts=8, bevel=0.08))         # turret
    parts.append(box((1.1, 0.9, 0.45), (0, 0.4, 1.45), M["hull"], bevel=0.1))
    parts.append(cyl(0.13, 1.9, (0, -1.15, 1.45), M["dark"], verts=8, rot=(math.pi / 2, 0, 0)))
    parts.append(cyl(0.2, 0.35, (0, -2.05, 1.45), M["black"], verts=8, rot=(math.pi / 2, 0, 0)))
    parts.append(box((1.2, 0.06, 0.1), (0, -0.33, 1.6), M["cyan"], bevel=0))
    parts.append(box((2.05, 0.08, 0.08), (0, 1.48, 1.1), M["red"], bevel=0))
    export("tank", [join(parts, "body")])


MODELS = {"solar": solar, "depot": depot, "battery": battery, "turret": turret, "radar": radar, "bay": bay, "wall": wall, "rover": rover, "tank": tank}

if __name__ == "__main__":
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = set(a[a.index("--only") + 1].split(",")) if "--only" in a else set(MODELS)
    for name, fn in MODELS.items():
        if name in only:
            reset()
            fn(palette())
