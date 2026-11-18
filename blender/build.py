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


# ---------------------------------------------------------------- set v2 helpers

def glow_mat(name, color, strength):
    return mat(name, "#000000", 0.0, 0.4, emit=color, strength=strength)


def veil(name, color, emit, strength, alpha):
    """A see-through, double-sided material (gate field, steam plume)."""
    m = MATS.get(name)
    if m:
        return m
    m = mat(name, color, 0.0, 0.9, emit=emit, strength=strength)
    m.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = alpha
    m.surface_render_method = "BLENDED"
    m.use_backface_culling = False
    return m


def strut(a, b, r, m, verts=6, r2=None, bevel=0.0):
    """A cylinder (or cone, with r2) from point a to point b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    rot = d.to_track_quat("Z", "Y").to_euler()
    return cyl(r, d.length, tuple((a + b) / 2), m, verts=verts, rot=tuple(rot), bevel=bevel, r2=r2)


def poly(verts, faces, m, name="poly"):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(m)
    return o


def blob(r, loc, m, scale=(1, 1, 1), sub=1, rot=(0, 0, 0)):
    """Low-poly organic lump (icosphere), for fauna."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(o, m, 0)


def spinning(o, name):
    """For a part the game spins with rotation.z (Repair Pad ring): bake the mesh
    upright and tip the node flat, so the node's local Z is the ring's axis."""
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    o.rotation_euler = (-math.pi / 2, 0, 0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    o.rotation_euler = (math.pi / 2, 0, 0)
    o.name = name
    return o


def wheels(xs, ys, r, w, z, M, verts=10):
    return [cyl(r, w, (x, y, z), M["black"], verts=verts, rot=(0, math.pi / 2, 0), bevel=0.03) for x in xs for y in ys] + \
           [cyl(r * 0.5, w + 0.04, (x, y, z), M["hull2"], verts=6, rot=(0, math.pi / 2, 0), bevel=0) for x in xs for y in ys]


def tracks(sx_list, length, z, M, width=0.5, height=0.6, wheels_n=4, xoff=1.0):
    parts = []
    for sx in sx_list:
        x = sx * xoff
        parts.append(box((width, length, height), (x, 0, z), M["black"], bevel=0.14))
        for k in range(wheels_n):
            y = -length / 2 + 0.45 + k * (length - 0.9) / (wheels_n - 1)
            parts.append(cyl(0.2, width + 0.06, (x, y, z - 0.08), M["dark"], verts=8, rot=(0, math.pi / 2, 0), bevel=0))
        parts.append(box((width + 0.1, length - 0.1, 0.1), (x, 0, z + height / 2 + 0.05), M["hull2"], bevel=0.03))
    return parts


# ---------------------------------------------------------------- set v2: buildings

def cannon(M):
    parts, head = [], []
    orange = glow_mat("orange", "#ff9a3d", 3.0)
    parts.append(cyl(3.5, 1.4, (0, 0, 0.7), M["dark"], verts=8, r2=3.0, bevel=0.12))
    ring(8, 3.05, 0, lambda i, a, x, y, z: parts.append(box((0.9, 0.5, 1.3), (x, y, 0.85), M["hull2"], rot=(0, 0, a + math.pi / 2))))
    parts.append(cyl(2.3, 0.9, (0, 0, 1.85), M["hull2"], verts=10, r2=2.1))
    parts.append(cyl(1.9, 0.3, (0, 0, 2.4), M["dark"], verts=10))
    # head on its pivot; front is −Y, barrel raised 0.22 rad
    P, T = 3.0, 0.22
    head.append(box((2.6, 3.2, 1.6), (0, 0.3, P), M["hull"], bevel=0.16))
    head.append(box((2.3, 0.9, 1.0), (0, -1.45, P + 0.15), M["hull2"], bevel=0.14, rot=(-0.5, 0, 0)))   # sloped glacis
    head.append(box((2.0, 1.8, 0.5), (0, 0.7, P + 1.0), M["hull2"], bevel=0.1))
    for sx in (-1, 1):
        head.append(box((0.5, 2.0, 1.0), (sx * 1.5, 0.6, P - 0.1), M["dark"], bevel=0.08))    # ammo boxes
    axis = Vector((0, -math.cos(T), math.sin(T)))
    root = Vector((0, -1.2, P + 0.35))
    rot = (math.pi / 2 - T, 0, 0)
    head.append(cyl(0.55, 1.4, tuple(root + axis * 0.6), M["dark"], verts=10, rot=rot))      # mantlet sleeve
    head.append(cyl(0.3, 4.4, tuple(root + axis * 3.0), M["dark"], verts=10, rot=rot, r2=0.26))
    head.append(cyl(0.38, 0.35, tuple(root + axis * 2.6), M["hull2"], verts=10, rot=rot))   # bore evacuator
    head.append(cyl(0.46, 0.65, tuple(root + axis * 5.3), M["black"], verts=8, rot=rot))    # muzzle brake
    head.append(box((1.8, 0.1, 0.18), (0, -1.36, P + 0.62), orange, bevel=0))
    head.append(box((0.3, 0.3, 0.9), (-0.8, 1.2, P + 1.6), M["dark"]))   # sensor mast
    head.append(sphere(0.13, (-0.8, 1.2, P + 2.1), orange, seg=6, rings=4))
    export("cannon", [join(parts, "body"), join(head, "head", pivot=(0, 0, P))])


def pointdefense(M):
    parts, head = [], []
    yellow = glow_mat("yellow", "#fff07a", 3.0)
    parts.append(cyl(2.2, 1.0, (0, 0, 0.5), M["dark"], verts=6, r2=1.8, bevel=0.1))
    ring(6, 1.35, 0, lambda i, a, x, y, z: parts.append(box((0.3, 0.55, 0.1), (x, y, 1.03), M["hull2"], rot=(0, 0, a))))
    parts.append(cyl(0.7, 1.4, (0, 0, 1.7), M["hull"], verts=6, r2=0.5))
    parts.append(cyl(0.75, 0.2, (0, 0, 2.15), M["dark"], verts=8))
    P = 2.6
    head.append(sphere(0.9, (0, 0.1, P), M["hull"], seg=10, rings=7, scale=(1, 1.1, 0.8)))
    head.append(box((1.4, 0.6, 0.35), (0, 0.6, P + 0.55), M["hull2"], bevel=0.08))
    for sx in (-1, 1):
        head.append(cyl(0.38, 0.5, (sx * 0.95, 0.15, P - 0.05), M["dark"], verts=8, rot=(0, math.pi / 2, 0)))   # ammo drums
        x = sx * 0.35
        head.append(cyl(0.19, 0.6, (x, -0.85, P - 0.05), M["hull2"], verts=8, rot=(math.pi / 2, 0, 0)))
        head.append(cyl(0.1, 1.5, (x, -1.75, P - 0.05), M["dark"], verts=6, rot=(math.pi / 2, 0, 0), bevel=0))
        head.append(cyl(0.14, 0.25, (x, -2.45, P - 0.05), M["black"], verts=6, rot=(math.pi / 2, 0, 0), bevel=0))
    head.append(box((0.9, 0.08, 0.14), (0, -0.86, P + 0.38), yellow, bevel=0))
    head.append(sphere(0.18, (0, 0.2, P + 0.85), M["glass"], seg=8, rings=4))
    export("pointdefense", [join(parts, "body"), join(head, "head", pivot=(0, 0, P))])


def repairpad(M):
    parts, rng = [], []
    green = glow_mat("green", "#5bff9a", 2.5)
    green_soft = glow_mat("green_soft", "#5bff9a", 1.2)
    parts.append(cyl(4.8, 0.4, (0, 0, 0.2), M["dark"], verts=8, r2=4.6, bevel=0.1, rot=(0, 0, math.pi / 8)))
    parts.append(cyl(3.8, 0.12, (0, 0, 0.46), M["hull"], verts=8, bevel=0.03, rot=(0, 0, math.pi / 8)))
    parts.append(cyl(1.2, 0.06, (0, 0, 0.53), M["hull2"], verts=8, bevel=0, rot=(0, 0, math.pi / 8)))
    for r in (0, math.pi / 2):
        parts.append(box((2.2, 0.5, 0.06), (0, 0, 0.56), green_soft, bevel=0, rot=(0, 0, r)))
    # hazard chevrons on the rim and four masts with emitter arms
    ring(16, 4.2, 0, lambda i, a, x, y, z: parts.append(box((0.5, 0.25, 0.05), (x, y, 0.42), M["accent"] if i % 2 else M["black"], bevel=0, rot=(0, 0, a + math.pi / 2))))
    for i in range(4):
        a = math.pi / 4 + i / 4 * math.tau
        c, s = math.cos(a), math.sin(a)
        parts.append(box((0.45, 0.45, 0.5), (c * 4.1, s * 4.1, 0.6), M["hull2"], rot=(0, 0, a)))
        parts.append(box((0.35, 0.35, 3.2), (c * 4.1, s * 4.1, 1.6), M["dark"], rot=(0, 0, a)))
        parts.append(strut((c * 4.1, s * 4.1, 2.9), (c * 3.3, s * 3.3, 2.5), 0.12, M["hull2"], verts=6))
        parts.append(cyl(0.18, 0.3, (c * 3.2, s * 3.2, 2.42), M["black"], verts=6, bevel=0))
        parts.append(sphere(0.3, (c * 4.1, s * 4.1, 3.4), green, seg=6, rings=4))
    # the ring (spins while repairing): glow band with dark clamps so the turn reads
    bpy.ops.mesh.primitive_torus_add(major_radius=2.8, minor_radius=0.12, major_segments=24, minor_segments=4, location=(0, 0, 0.62))
    rng.append(_finish(bpy.context.active_object, green_soft, 0))
    ring(6, 2.8, 0, lambda i, a, x, y, z: rng.append(box((0.5, 0.36, 0.22), (x, y, 0.64), M["dark"], bevel=0.04, rot=(0, 0, a + math.pi / 2))))
    export("repairpad", [join(parts, "body"), spinning(join(rng, "ring_tmp", pivot=(0, 0, 0.62)), "ring")])


def gate(M):
    parts, field = [], []
    amber_field = veil("amber_field", "#000000", "#ffb547", 0.9, 0.28)
    # runs along Y, like the wall; posts at both ends
    parts.append(box((1.4, 6.2, 0.15), (0, 0, 0.08), M["dark"], bevel=0.03))
    for sy in (-1, 1):
        y = sy * 3.6
        parts.append(box((2.4, 1.6, 0.4), (0, y, 0.2), M["dark"], bevel=0.08))
        parts.append(box((2.0, 1.2, 3.4), (0, y, 1.9), M["dark"], bevel=0.12))
        parts.append(box((2.1, 1.0, 0.8), (0, y, 1.3), M["hull2"], bevel=0.08))
        parts.append(box((1.6, 1.3, 0.25), (0, y, 3.65), M["hull2"], bevel=0.06))
        parts.append(box((0.5, 0.06, 2.4), (0, y - sy * 0.63, 1.5), M["amber"], bevel=0))   # emitter strip, inner face
        parts.append(sphere(0.35, (0, y, 4.05), M["amber"], seg=6, rings=4))
    parts.append(box((0.8, 6.2, 0.5), (0, 0, 2.9), M["hull"], bevel=0.08))
    for k in range(7):
        parts.append(box((0.84, 0.35, 0.52), (0, -2.6 + k * 0.87, 2.9), M["accent"] if k % 2 else M["black"], bevel=0))
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 1.45), rotation=(0, math.pi / 2, 0))
    f = bpy.context.active_object
    f.scale = (2.5, 6.0, 1)
    field.append(_finish(f, amber_field, 0))
    export("gate", [join(parts, "body"), join(field, "field", pivot=(0, 0, 1.45))])


def geothermal(M):
    parts, plume = [], []
    magma = glow_mat("magma", "#ff7a3d", 2.4)
    steam = veil("steam", "#dfe8ee", "#dfe8ee", 0.15, 0.22)
    parts.append(cyl(3.8, 0.8, (0, 0, 0.4), M["dark"], verts=8, r2=3.4, bevel=0.1))
    parts.append(cyl(2.0, 3.0, (0, 0, 2.3), M["rust"], verts=8, r2=1.6, bevel=0.08))
    for z in (1.2, 3.55):
        parts.append(cyl(2.05 - (z - 0.8) * 0.13, 0.22, (0, 0, z), M["dark"], verts=8))
    parts.append(cyl(1.68, 0.3, (0, 0, 2.9), magma, verts=8, bevel=0))
    parts.append(cyl(1.0, 0.4, (0, 0, 3.9), M["hull2"], verts=8))
    parts.append(cyl(0.9, 3.0, (0, 0, 5.2), M["dark"], verts=8, r2=0.7))
    parts.append(cyl(0.85, 0.3, (0, 0, 6.6), M["hull2"], verts=8))
    for a in (0.4, 2.5, 4.4):
        c, s = math.cos(a), -math.sin(a)
        parts.append(strut((c * 1.5, s * 1.5, 1.2), (c * 3.7, s * 3.7, 1.2), 0.3, M["dark"], verts=8))
        parts.append(cyl(0.42, 0.18, (c * 2.6, s * 2.6, 1.2), M["hull2"], verts=8, rot=(0, math.pi / 2, -a), bevel=0))
        parts.append(box((0.5, 0.5, 0.9), (c * 3.6, s * 3.6, 0.9), M["hull2"], rot=(0, 0, -a)))
        parts.append(cyl(0.22, 0.1, (c * 2.6, s * 2.6, 1.65), M["accent"], verts=8, bevel=0))      # valve wheel
    # gauge cabinet and a lamp
    parts.append(box((1.0, 0.6, 1.2), (0, 2.4, 1.4), M["hull2"], bevel=0.06))
    parts.append(box((0.5, 0.06, 0.3), (0, 2.08, 1.6), magma, bevel=0))
    # steam plume (game sways it, hides it when unpowered)
    P = 9.2
    for r1, r2, d in ((0.6, 1.6, 5.0), (0.4, 1.1, 3.6)):
        bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=r1, radius2=r2, depth=d, end_fill_type="NOTHING", location=(0, 0, P - (5.0 - d) / 2))
        plume.append(_finish(bpy.context.active_object, steam, 0))
    export("geothermal", [join(parts, "body"), join(plume, "plume", pivot=(0, 0, P))])


# ---------------------------------------------------------------- set v2: units (front is −Y)

def artillery(M):
    parts = tracks((-1, 1), 2.8, 0.42, M, width=0.45, height=0.55)
    parts.append(box((1.8, 2.6, 0.6), (0, 0, 0.75), M["hull"], bevel=0.1))
    parts.append(box((1.3, 1.2, 0.8), (0, 0.45, 1.4), M["hull2"], bevel=0.1))      # cab, rear
    parts.append(box((1.0, 0.06, 0.25), (0, -0.16, 1.55), M["glass"], bevel=0, rot=(-0.4, 0, 0)))
    parts.append(box((0.8, 0.9, 0.6), (0, -0.4, 1.4), M["dark"], bevel=0.08))     # breech
    T = 0.55
    axis = Vector((0, -math.cos(T), math.sin(T)))
    root = Vector((0, -0.4, 1.55))
    rot = (math.pi / 2 - T, 0, 0)
    parts.append(cyl(0.26, 0.9, tuple(root + axis * 0.5), M["hull2"], verts=8, rot=rot))
    parts.append(cyl(0.16, 2.8, tuple(root + axis * 1.9), M["dark"], verts=8, rot=rot, r2=0.14))
    parts.append(cyl(0.22, 0.35, tuple(root + axis * 3.3), M["black"], verts=8, rot=rot))
    for sx in (-1, 1):
        parts.append(strut((sx * 0.75, 1.2, 0.9), (sx * 0.85, 1.75, 0.08), 0.1, M["dark"], verts=6))   # stabilisers
        parts.append(box((0.4, 0.4, 0.08), (sx * 0.85, 1.78, 0.06), M["dark"], bevel=0))
    parts.append(box((1.35, 0.06, 0.1), (0, -0.16, 1.82), M["cyan"], bevel=0))
    parts.append(box((1.85, 0.08, 0.08), (0, 1.32, 0.9), M["red"], bevel=0))
    export("artillery", [join(parts, "body")])


def arc(M):
    parts = wheels((-0.8, 0.8), (-0.8, 0, 0.8), 0.3, 0.26, 0.35, M)
    parts.append(box((1.4, 2.2, 0.55), (0, 0, 0.75), M["hull"], bevel=0.1))
    parts.append(box((1.0, 1.0, 0.45), (0, 0.4, 1.2), M["hull2"], bevel=0.1))
    parts.append(box((0.85, 0.06, 0.25), (0, -0.12, 1.22), M["glass"], bevel=0, rot=(-0.5, 0, 0)))
    for sx in (-1, 1):
        parts.append(cyl(0.2, 0.9, (sx * 0.5, 0.65, 1.55), M["dark"], verts=8, rot=(math.pi / 2, 0, 0)))   # capacitors
    # coil mast with copper windings and the emitter ball
    parts.append(cyl(0.3, 0.3, (0, -0.45, 1.15), M["dark"], verts=8))
    parts.append(cyl(0.28, 1.4, (0, -0.45, 1.7), M["dark"], verts=8, r2=0.18))
    for z in (1.3, 1.65, 2.0):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.36 - (z - 1.3) * 0.12, minor_radius=0.08, major_segments=10, minor_segments=4, location=(0, -0.45, z))
        parts.append(_finish(bpy.context.active_object, M["accent"], 0))
    parts.append(sphere(0.42, (0, -0.45, 2.55), M["cyan"], seg=8, rings=5))
    parts.append(box((1.05, 0.06, 0.08), (0, -1.12, 0.88), M["cyan"], bevel=0))
    export("arc", [join(parts, "body")])


def engineer(M):
    green = glow_mat("green", "#5bff9a", 2.5)
    parts = wheels((-0.78, 0.78), (-0.85, 0.75), 0.34, 0.26, 0.36, M)
    parts.append(box((1.4, 2.2, 0.9), (0, 0.1, 1.0), M["hull"], bevel=0.12))
    parts.append(box((1.3, 0.8, 0.6), (0, -1.25, 0.85), M["hull2"], bevel=0.12))
    parts.append(box((1.2, 0.06, 0.45), (0, -0.98, 1.3), M["glass"], bevel=0, rot=(-0.35, 0, 0)))
    parts.append(box((1.5, 0.12, 0.3), (0, -1.68, 0.65), M["dark"], bevel=0.04))         # bumper
    for sx in (-1, 1):
        parts.append(box((0.08, 1.4, 0.5), (sx * 0.72, 0.4, 0.95), M["dark"], bevel=0.02))  # tool lockers
    parts.append(box((0.08, 0.4, 0.4), (-0.75, 0.0, 1.05), green, bevel=0))
    # crane: turret on the roof, boom up and forward, repair head
    parts.append(cyl(0.3, 0.25, (0.35, 0.7, 1.55), M["dark"], verts=8))
    parts.append(strut((0.35, 0.7, 1.65), (0.35, -0.2, 2.45), 0.11, M["accent"], verts=6))
    parts.append(strut((0.35, -0.2, 2.45), (0.35, -0.95, 2.15), 0.09, M["accent"], verts=6))
    parts.append(box((0.3, 0.3, 0.28), (0.35, -1.0, 2.0), M["dark"], bevel=0.05))
    parts.append(box((0.24, 0.1, 0.1), (0.35, -1.0, 1.82), green, bevel=0))
    parts.append(box((1.42, 0.06, 0.1), (0, 1.22, 1.35), M["cyan"], bevel=0))
    parts.append(cyl(0.08, 0.15, (-0.45, 0.8, 1.52), M["amber"], verts=6, bevel=0))      # beacon
    export("engineer", [join(parts, "body")])


def scout(M):
    parts = []
    # arrowhead hull: nose at −Y, keel below, a raised spine
    v = [(0, -1.35, 1.0), (-1.0, 1.05, 0.95), (1.0, 1.05, 0.95), (0, 0.9, 1.22), (0, 0.6, 0.78), (-0.35, -0.2, 1.12), (0.35, -0.2, 1.12)]
    f = [(0, 5, 1), (0, 2, 6), (5, 3, 1), (6, 2, 3), (5, 6, 3), (0, 6, 5), (0, 1, 4), (0, 4, 2), (1, 3, 4), (2, 4, 3)]
    parts.append(poly(v, f, M["hull"], "hull"))
    parts.append(box((0.5, 0.8, 0.3), (0, 0.35, 1.25), M["glass"], bevel=0.12))         # canopy
    parts.append(box((1.8, 0.5, 0.08), (0, 0.75, 0.95), M["hull2"], bevel=0.03))         # rear wing
    parts.append(box((0.08, 0.4, 0.5), (0, 0.9, 1.4), M["dark"], bevel=0.02))            # fin
    for sx in (-1, 1):
        parts.append(cyl(0.2, 0.7, (sx * 0.75, 0.55, 0.85), M["dark"], verts=8, rot=(math.pi / 2, 0, 0)))   # hover pods
        parts.append(cyl(0.16, 0.06, (sx * 0.75, 0.55, 0.72), M["cyan"], verts=8, bevel=0))
    parts.append(box((1.4, 0.1, 0.06), (0, 0.6, 0.75), M["cyan"], bevel=0))
    parts.append(box((0.3, 0.3, 0.1), (0, 0.2, 1.42), M["cyan"], bevel=0))
    export("scout", [join(parts, "body")])


# ---------------------------------------------------------------- set v2: fauna (front is −Y)

def fauna_mats(skin, emit, plate, eye):
    return {
        "skin": mat("skin", skin, 0.0, 0.8, emit=emit, strength=0.6),
        "plate": mat("plate", plate, 0.1, 0.6),
        "claw": mat("claw", "#1e1a18", 0.1, 0.5),
        "eye": glow_mat("eye", eye, 3.0),
    }


def legs(F, xs_ys, hip_z, foot_out, knee_up=0.4, r=0.08):
    """Arachnid legs: thigh up and out to a high knee, shin down to a dark claw tip."""
    parts = []
    for x, y in xs_ys:
        sx = 1 if x > 0 else -1
        splay = 0.12 if y > 0.1 else -0.12 if y < -0.1 else 0
        hip = Vector((x, y, hip_z))
        knee = Vector((x + sx * foot_out * 0.5, y + splay, hip_z + knee_up))
        ankle = Vector((x + sx * foot_out * 0.9, y + splay * 2, 0.25))
        foot = Vector((x + sx * foot_out, y + splay * 2.3, 0.0))
        parts.append(strut(hip, knee, r, F["skin"], verts=5, r2=r * 0.8))
        parts.append(strut(knee, ankle, r * 0.8, F["skin"], verts=5, r2=r * 0.55))
        parts.append(strut(ankle, foot, r * 0.55, F["claw"], verts=4, r2=0.01))
    return parts


def swarmer(M):
    F = fauna_mats("#c0563a", "#5a1408", "#7a2e1c", "#ffd23a")
    parts = [blob(0.7, (0, 0.05, 1.0), F["skin"], scale=(0.85, 1.4, 0.6))]
    for k in range(3):
        parts.append(blob(0.42, (0, 0.55 - k * 0.45, 1.33 - abs(k - 1) * 0.05), F["plate"], scale=(1.3, 0.8, 0.45), sub=1))
    parts.append(blob(0.34, (0, -1.0, 1.05), F["skin"], scale=(1, 1.2, 0.85)))
    for sx in (-1, 1):
        parts.append(strut((sx * 0.15, -1.25, 1.0), (sx * 0.08, -1.65, 0.85), 0.07, F["claw"], verts=4, r2=0.01))   # mandibles
        parts.append(sphere(0.07, (sx * 0.16, -1.25, 1.18), F["eye"], seg=6, rings=4))
    parts.append(strut((0, 0.9, 1.0), (0, 1.5, 0.75), 0.18, F["skin"], verts=5, r2=0.04))      # tail
    parts += legs(F, [(sx * 0.4, y) for sx in (-1, 1) for y in (-0.55, 0.0, 0.55)], 0.85, 0.75)
    export("swarmer", [join(parts, "body")])


def brute(M):
    F = fauna_mats("#8a3550", "#3a0a1c", "#4a1a2a", "#ff6a4d")
    parts = [blob(0.7, (0, 0.05, 1.0), F["skin"], scale=(0.95, 1.4, 0.7))]
    parts.append(blob(0.55, (0, -0.5, 1.25), F["skin"], scale=(1.1, 0.9, 0.8)))           # shoulder hump
    for k in range(3):
        parts.append(blob(0.45, (0, 0.5 - k * 0.5, 1.45), F["plate"], scale=(1.3, 0.85, 0.45)))
        parts.append(strut((0, 0.5 - k * 0.5, 1.5), (0, 0.6 - k * 0.5, 2.15), 0.16, F["plate"], verts=4, r2=0.01))   # spikes
    parts.append(blob(0.38, (0, -1.1, 1.0), F["skin"], scale=(1.05, 1.1, 0.9)))
    for sx in (-1, 1):
        parts.append(strut((sx * 0.25, -1.3, 1.1), (sx * 0.4, -1.6, 1.4), 0.09, F["claw"], verts=4, r2=0.01))   # tusks
        parts.append(sphere(0.07, (sx * 0.2, -1.38, 1.2), F["eye"], seg=6, rings=4))
    parts += legs(F, [(sx * 0.45, y) for sx in (-1, 1) for y in (-0.6, 0.0, 0.6)], 0.85, 0.8, r=0.11)
    export("brute", [join(parts, "body")])


def spitter(M):
    F = fauna_mats("#6f8a2e", "#2a4008", "#3e5218", "#d8ff5a")
    sac = glow_mat("venom", "#b6ff3a", 1.4)
    parts = [blob(0.7, (0, 0.1, 1.0), F["skin"], scale=(0.8, 1.1, 0.6))]
    parts.append(blob(0.62, (0, 0.9, 1.35), sac, scale=(1, 1.1, 0.95), sub=2))              # venom sac
    for k in range(3):
        a = k / 3 * math.tau
        parts.append(strut((math.cos(a) * 0.5, 0.9 + math.sin(a) * 0.5, 1.2), (math.cos(a) * 0.62, 0.9 + math.sin(a) * 0.6, 1.6), 0.05, F["plate"], verts=4))
    parts.append(strut((0, -0.4, 1.2), (0, -0.9, 1.9), 0.17, F["skin"], verts=6, r2=0.12))   # neck
    parts.append(blob(0.3, (0, -1.05, 1.95), F["skin"], scale=(0.9, 1.3, 0.8)))
    parts.append(strut((0, -1.3, 1.95), (0, -1.55, 1.8), 0.12, F["plate"], verts=6, r2=0.06))  # spout
    for sx in (-1, 1):
        parts.append(sphere(0.06, (sx * 0.15, -1.2, 2.08), F["eye"], seg=6, rings=4))
    parts += legs(F, [(sx * 0.42, y) for sx in (-1, 1) for y in (-0.4, 0.5)], 0.85, 0.7)
    export("spitter", [join(parts, "body")])


def burrower(M):
    F = fauna_mats("#7a5a3a", "#2e1a08", "#4a3420", "#ff8a3a")
    parts = []
    for i in range(5):
        r = 0.62 - abs(i - 1.5) * 0.08
        y, z = 1.6 - i * 0.75, 0.62 + math.sin(i * 0.9) * 0.12
        parts.append(blob(r, (0, y, z), F["skin"], scale=(1, 1.1, 0.85)))
        parts.append(blob(r * 1.02, (0, y + 0.08, z + r * 0.25), F["plate"], scale=(1.05, 0.55, 0.7)))   # ring plate
        for sx in (-1, 1):
            parts.append(strut((sx * r * 0.8, y, z - r * 0.4), (sx * r * 1.15, y - 0.1, 0.02), 0.04, F["claw"], verts=4, r2=0.01))
    # drill head: a cone of grinding teeth
    parts.append(cyl(0.5, 1.2, (0, -2.0, 0.7), F["plate"], verts=6, rot=(math.pi / 2, 0, 0), r2=0.08, bevel=0))
    for k in range(3):   # spiral grinding ridges
        parts.append(cyl(0.48 - k * 0.13, 0.12, (0, -1.6 - k * 0.35, 0.7), F["claw"], verts=6, rot=(math.pi / 2, 0, k * 0.5), bevel=0))
    parts.append(strut((0, -2.5, 0.7), (0, -2.75, 0.7), 0.08, F["claw"], verts=4, r2=0.01))
    for a in (0, 2.1, 4.2):
        parts.append(strut((math.sin(a) * 0.45, -1.45, 0.7 + math.cos(a) * 0.45), (math.sin(a) * 0.62, -2.0, 0.7 + math.cos(a) * 0.62), 0.12, F["claw"], verts=3, r2=0.01))
    for a in (1.05, 3.15, 5.25):
        parts.append(sphere(0.06, (math.sin(a) * 0.42, -1.45, 0.7 + math.cos(a) * 0.42), F["eye"], seg=6, rings=4))
    export("burrower", [join(parts, "body")])


# ---------------------------------------------------------------- set v3: people buildings

def half_below(o, keep_above=-0.05):
    """Delete the vertices of `o` whose local y is below `keep_above` (a cylinder or torus
    rotated about X keeps its upper half: local y is world z)."""
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for v in o.data.vertices:
        v.select = v.co.y < keep_above
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")
    return o


def civic(M):
    """Civilian Center: domed habitat, airlock at the front (−Y = game +Z), two growth pods
    at the back (+Y = game −Z) as separate nodes `gpod_a` / `gpod_b`, each with its own
    material (the game lights each one while a child grows inside, red when it's failing)."""
    parts, pods = [], []
    warm = glow_mat("warm", "#ffe2a8", 1.6)
    # plinth and habitat drum
    parts.append(cyl(6.8, 0.8, (0, 0, 0.4), M["dark"], verts=10, r2=6.4, bevel=0.12))
    parts.append(cyl(5.6, 2.6, (0, 0, 2.1), M["hull"], verts=10, r2=5.4, bevel=0.08))
    parts.append(cyl(5.7, 0.25, (0, 0, 0.92), M["hull2"], verts=10, bevel=0.04))
    # window band: ten warm panes between dark mullions
    ring(10, 5.52, 0, lambda i, a, x, y, z: parts.append(
        box((2.4, 0.1, 0.45), (x, y, 2.55), warm, bevel=0, rot=(0, 0, a + math.pi / 2))))
    ring(10, 5.58, 0, lambda i, a, x, y, z: parts.append(
        box((0.22, 0.14, 0.7), (math.cos(a + math.pi / 10) * 5.58, math.sin(a + math.pi / 10) * 5.58, 2.55), M["dark"],
            bevel=0, rot=(0, 0, a + math.pi / 10 + math.pi / 2))))
    # dome with ribs, a skylight and a comms mast
    parts.append(sphere(5.4, (0, 0, 3.4), M["hull"], seg=20, rings=10, scale=(1, 1, 0.62)))
    for k in range(5):
        bpy.ops.mesh.primitive_torus_add(major_radius=5.45, minor_radius=0.1, major_segments=24, minor_segments=4,
                                         location=(0, 0, 3.4), rotation=(math.pi / 2, 0, k / 5 * math.pi))
        t = bpy.context.active_object
        t.scale = (1, 0.62, 1)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        parts.append(_finish(half_below(t), M["hull2"], 0))
    parts.append(cyl(1.3, 0.35, (0, 0, 6.72), M["dark"], verts=10, bevel=0.04))
    parts.append(cyl(1.1, 0.12, (0, 0, 6.95), warm, verts=10, bevel=0))
    parts.append(cyl(0.12, 2.2, (2.2, 1.2, 6.6), M["dark"], verts=6, bevel=0))
    parts.append(sphere(0.2, (2.2, 1.2, 7.75), M["red"], seg=6, rings=4))
    # airlock vestibule at the front, door lights, medical cross
    parts.append(box((2.8, 2.4, 2.6), (0, -5.6, 1.7), M["hull2"], bevel=0.12))
    parts.append(box((3.0, 2.6, 0.3), (0, -5.6, 3.1), M["dark"], bevel=0.06))
    parts.append(box((1.5, 0.1, 2.0), (0, -6.82, 1.4), M["dark"], bevel=0.02))
    parts.append(box((1.6, 0.1, 0.12), (0, -6.84, 2.55), M["amber"], bevel=0))
    for sx in (-1, 1):
        parts.append(box((0.12, 0.1, 1.6), (sx * 1.2, -6.84, 1.4), M["cyan"], bevel=0))
    parts.append(box((0.9, 0.06, 0.3), (0, -6.83, 2.95), M["red"], bevel=0))
    parts.append(box((0.3, 0.06, 0.9), (0, -6.83, 2.95), M["red"], bevel=0))
    # side utility pods: air scrubbers
    for sx in (-1, 1):
        parts.append(box((1.6, 2.4, 1.6), (sx * 5.7, 0.8, 1.4), M["hull2"], bevel=0.1, rot=(0, 0, sx * 0.15)))
        for k in range(3):
            parts.append(box((0.08, 1.8, 0.12), (sx * 6.52, 0.8 + sx * 0.12, 0.95 + k * 0.4), M["black"], bevel=0, rot=(0, 0, sx * 0.15)))
    # growth pod bay at the back: deck, cradles, struts, hoses back into the hull
    parts.append(box((6.4, 2.6, 0.5), (0, 6.1, 0.55), M["dark"], bevel=0.1))
    for i, x in enumerate((-1.9, 1.9)):
        parts.append(box((1.7, 1.7, 0.6), (x, 6.1, 1.1), M["hull2"], bevel=0.08))
        parts.append(cyl(0.9, 0.3, (x, 6.1, 1.5), M["dark"], verts=12, bevel=0.03))
        parts.append(cyl(0.75, 0.25, (x, 6.1, 3.85), M["dark"], verts=12, bevel=0.03))
        for a in (0.5, 2.6, 4.7):
            parts.append(strut((x + math.cos(a) * 0.78, 6.1 + math.sin(a) * 0.78, 1.6),
                               (x + math.cos(a) * 0.68, 6.1 + math.sin(a) * 0.68, 3.75), 0.07, M["hull"], verts=6))
        parts.append(strut((x, 6.1, 4.0), (x * 0.6, 4.6, 4.6), 0.13, M["hull2"], verts=6))
        parts.append(strut((x * 1.25, 5.3, 1.3), (x * 1.1, 4.9, 2.2), 0.12, M["black"], verts=6))
        n = f"gpod_{'ab'[i]}"
        pods.append((n, sphere(0.62, (x, 6.1, 2.65), mat(n, "#1b3a44", 0.1, 0.15, emit="#7ff7ff", strength=0.25),
                               seg=12, rings=8, scale=(1, 1, 1.75))))
    export("civic", [join(parts, "body")] + [join([o], n, pivot=(o.location.x, 6.1, 2.65)) for n, o in pods])


def hydroponics(M):
    """Hydroponics: three glass tunnels over glowing crop beds, magenta grow lights,
    a nutrient tank and pumps. No animated parts (it's batched)."""
    parts = []
    crop = glow_mat("crop", "#5bff7a", 0.9)
    grow = glow_mat("grow", "#ff7ad9", 2.0)
    glass = veil("tunnel_glass", "#bfefff", "#000000", 0.0, 0.3)
    parts.append(box((8.6, 7.4, 0.4), (0, 0, 0.2), M["dark"], bevel=0.1))
    for x in (-2.75, 0, 2.75):
        # low stem wall, the bed, crop rows
        parts.append(box((2.6, 6.8, 0.35), (x, 0, 0.57), M["hull2"], bevel=0.05))
        parts.append(box((2.0, 6.3, 0.2), (x, 0, 0.82), M["black"], bevel=0))
        for k in range(3):
            parts.append(box((0.42, 6.0, 0.32), (x - 0.6 + k * 0.6, 0, 1.0), crop, bevel=0.06))
        # glass half-pipe and its ribs
        bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=1.25, depth=6.6, location=(x, 0, 0.75),
                                            rotation=(math.pi / 2, 0, 0), end_fill_type="NOTHING")
        parts.append(_finish(half_below(bpy.context.active_object), glass, 0))
        for k in range(5):
            bpy.ops.mesh.primitive_torus_add(major_radius=1.28, minor_radius=0.07, major_segments=14, minor_segments=4,
                                             location=(x, -3.2 + k * 1.6, 0.75), rotation=(math.pi / 2, 0, 0))
            parts.append(_finish(half_below(bpy.context.active_object), M["dark"], 0))
        # grow-light strip along the crown, end caps, a hatch at the front end
        parts.append(box((0.16, 6.2, 0.06), (x, 0, 1.9), grow, bevel=0))
        for sy in (-1, 1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=1.25, depth=0.12, location=(x, sy * 3.33, 0.75),
                                                rotation=(math.pi / 2, 0, 0))
            parts.append(_finish(half_below(bpy.context.active_object), M["hull"], 0))
        parts.append(box((0.7, 0.08, 0.9), (x, -3.4, 1.05), M["dark"], bevel=0))
    # nutrient tank, pump housing and feed pipe along the back
    parts.append(cyl(0.8, 2.4, (3.6, 3.0, 1.6), M["hull"], verts=10, bevel=0.05))
    parts.append(cyl(0.85, 0.2, (3.6, 3.0, 2.85), M["dark"], verts=10))
    parts.append(box((0.4, 0.06, 1.4), (3.6, 2.18, 1.6), crop, bevel=0))
    parts.append(box((1.0, 0.9, 0.9), (-3.6, 3.15, 0.85), M["hull2"], bevel=0.08))
    parts.append(box((0.5, 0.06, 0.18), (-3.6, 2.68, 1.0), M["cyan"], bevel=0))
    parts.append(cyl(0.12, 7.0, (0, 3.55, 0.6), M["accent"], verts=6, rot=(0, math.pi / 2, 0), bevel=0))
    for x in (-2.75, 0, 2.75):
        parts.append(strut((x, 3.55, 0.6), (x, 3.2, 0.75), 0.09, M["accent"], verts=6))
    export("hydroponics", [join(parts, "body")])


# ---------------------------------------------------------------- set v4: inhabitants (STORY.md §5)

def vell_mats():
    return {
        "hide": mat("hide", "#8a6a4a", 0.0, 0.85),
        "cloth": mat("cloth", "#4c4466", 0.0, 0.9),
        "sash": mat("sash", "#a8553a", 0.0, 0.85),
        "skin": mat("vskin", "#9c7a66", 0.0, 0.7),
        "bone": mat("bone", "#d8ccb0", 0.0, 0.6),
        "wood": mat("wood", "#5e4430", 0.0, 0.8),
        "stone": mat("stone", "#6f6a62", 0.0, 0.9),
        "dark": mat("vdark", "#2a2420", 0.0, 0.9),
        "ember": glow_mat("ember", "#ffb547", 2.6),
        "star": glow_mat("star", "#8fd8ff", 1.8),
        "eye": glow_mat("veye", "#1a1410", 0.0),
    }


def vell_body(V, h=1.0, cloak="hide"):
    """A Vell standing, front −Y: long legs, narrow robed body, hood. `h` scales the height
    (1 = about 4.2 u, taller than a colonist's 3.2)."""
    parts = []
    for sx in (-1, 1):  # long legs, wrapped shins, bare feet
        parts.append(strut((sx * 0.17, 0, 1.75 * h), (sx * 0.2, 0.02, 0.08), 0.11, V["cloth"], verts=6, r2=0.08))
        parts.append(strut((sx * 0.2, 0.02, 0.75 * h), (sx * 0.2, 0.02, 0.15), 0.1, V["sash"], verts=6))
        parts.append(box((0.18, 0.4, 0.12), (sx * 0.2, -0.1, 0.06), V["skin"], bevel=0.03))
    parts.append(cyl(0.34, 1.5 * h, (0, 0, 2.35 * h), V[cloak], verts=8, r2=0.22, bevel=0.03))   # torso
    parts.append(cyl(0.62, 1.9 * h, (0, 0.08, 1.75 * h), V[cloak], verts=8, r2=0.3, bevel=0.03))  # long cloak
    parts.append(box((0.5, 0.42, 0.14), (0, 0, 1.75 * h), V["sash"], bevel=0.03))                 # belt
    parts.append(cyl(0.12, 0.3, (0, 0, 3.2 * h), V["skin"], verts=6, bevel=0))                     # neck
    parts.append(sphere(0.25, (0, -0.02, 3.55 * h), V["skin"], seg=8, rings=6, scale=(0.85, 0.95, 1.25)))  # long face
    for sx in (-1, 1):
        parts.append(sphere(0.06, (sx * 0.09, -0.22, 3.6 * h), V["eye"], seg=6, rings=4, scale=(1.3, 0.5, 0.8)))  # dark eyes
    parts.append(cyl(0.36, 0.75, (0, 0.06, 3.62 * h), V["cloth"], verts=8, r2=0.12, bevel=0.03))  # hood
    return parts


def vell(M):
    """The drifted (Vell) walker: tall, thin, wrapped in hide, staff with an ember tip."""
    V = vell_mats()
    parts = vell_body(V)
    # arms: right holds the staff out front, left hangs
    parts.append(strut((0.36, 0, 3.0), (0.55, -0.35, 2.3), 0.09, V["cloth"], verts=6, r2=0.07))
    parts.append(strut((0.55, -0.35, 2.3), (0.6, -0.55, 2.55), 0.07, V["skin"], verts=6, r2=0.05))
    parts.append(strut((-0.36, 0, 3.0), (-0.48, 0.05, 1.9), 0.09, V["cloth"], verts=6, r2=0.06))
    # staff, taller than its bearer, bone rings and an ember in a cage of prongs
    parts.append(strut((0.62, -0.6, 0.0), (0.62, -0.6, 4.6), 0.07, V["wood"], verts=6))
    for z in (2.9, 3.6):
        parts.append(cyl(0.11, 0.12, (0.62, -0.6, z), V["bone"], verts=6, bevel=0))
    parts.append(sphere(0.16, (0.62, -0.6, 4.75), V["ember"], seg=6, rings=4))
    for k in range(3):
        a = k / 3 * math.tau
        parts.append(strut((0.62, -0.6, 4.55), (0.62 + math.cos(a) * 0.2, -0.6 + math.sin(a) * 0.2, 4.95), 0.025, V["bone"], verts=4, r2=0.01))
    # bundle on the back
    parts.append(blob(0.32, (0, 0.5, 2.6), V["hide"], scale=(1.1, 0.7, 1.3)))
    parts.append(strut((-0.3, 0.3, 3.1), (0.3, 0.3, 2.2), 0.04, V["sash"], verts=4))
    export("vell", [join(parts, "body")])


def vellkeeper(M):
    """Vell song-keeper: a robed elder with a ring of glowing chimes on a crooked pole."""
    V = vell_mats()
    parts = vell_body(V, h=0.95, cloak="cloth")
    parts.append(cyl(0.7, 0.35, (0, 0.05, 3.0), V["hide"], verts=8, r2=0.4, bevel=0.03))   # shawl
    for k in range(6):  # bone beads on the shawl
        a = (k / 6 - 0.5) * 1.6 - math.pi / 2
        parts.append(sphere(0.06, (math.cos(a) * 0.6, math.sin(a) * 0.6, 2.85), V["bone"], seg=6, rings=4))
    parts.append(strut((0.36, 0, 2.85), (0.62, -0.3, 2.35), 0.09, V["cloth"], verts=6, r2=0.07))
    parts.append(strut((-0.36, 0, 2.85), (-0.55, -0.4, 2.5), 0.09, V["cloth"], verts=6, r2=0.07))
    # crooked pole with a hoop of chimes
    parts.append(strut((0.66, -0.35, 0.0), (0.7, -0.4, 3.9), 0.07, V["wood"], verts=6))
    parts.append(strut((0.7, -0.4, 3.9), (0.25, -0.55, 4.6), 0.06, V["wood"], verts=6))
    hub = Vector((0.0, -0.6, 4.55))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.45, minor_radius=0.035, major_segments=12, minor_segments=4, location=tuple(hub))
    parts.append(_finish(bpy.context.active_object, V["bone"], 0))
    for k in range(7):
        a = k / 7 * math.tau
        x, y = hub.x + math.cos(a) * 0.45, hub.y + math.sin(a) * 0.45
        ln = 0.35 + 0.15 * (k % 3)
        parts.append(strut((x, y, hub.z), (x, y, hub.z - 0.15), 0.01, V["dark"], verts=3))
        parts.append(cyl(0.035, ln, (x, y, hub.z - 0.15 - ln / 2), V["star"], verts=5, bevel=0))
    export("vellkeeper", [join(parts, "body")])


def vellhut(M):
    """Vell stilt hut: a round platform on stilts, a hide cone roof on bent poles, a ladder
    at the front, an ember lantern under the eaves. About 8 u across."""
    V = vell_mats()
    parts = []
    H = 2.2  # floor height
    ring(6, 2.6, 0, lambda i, a, x, y, z: parts.append(strut((x * 1.08, y * 1.08, 0.0), (x, y, H + 0.1), 0.18, V["wood"], verts=6)))
    ring(6, 2.6, 0, lambda i, a, x, y, z: parts.append(cyl(0.32, 0.25, (x * 1.08, y * 1.08, 0.12), V["stone"], verts=6, bevel=0.05)))
    parts.append(cyl(3.0, 0.3, (0, 0, H + 0.15), V["wood"], verts=10, bevel=0.06))       # floor
    parts.append(cyl(2.55, 1.5, (0, 0, H + 1.05), V["hide"], verts=10, r2=2.45, bevel=0.04))  # wall
    parts.append(box((0.9, 0.2, 1.25), (0, -2.45, H + 0.95), V["dark"], bevel=0.04))      # door
    parts.append(cyl(3.3, 2.8, (0, 0, H + 3.2), V["hide"], verts=10, r2=0.25, bevel=0.04))  # roof cone
    ring(10, 3.25, 0, lambda i, a, x, y, z: parts.append(strut((x * 0.08, y * 0.08, H + 4.9), (x * 1.06, y * 1.06, H + 1.65), 0.06, V["wood"], verts=4)))
    parts.append(cyl(0.35, 0.6, (0, 0, H + 4.8), V["bone"], verts=6, bevel=0.03))        # smoke hole cap
    for sx in (-1, 1):  # ladder
        parts.append(strut((sx * 0.4, -3.9, 0.0), (sx * 0.4, -2.85, H + 0.3), 0.07, V["wood"], verts=4))
    for k in range(5):
        t = (k + 0.7) / 6
        parts.append(box((0.8, 0.09, 0.09), (0, -3.9 + 1.05 * t, (H + 0.3) * t), V["wood"], bevel=0))
    parts.append(strut((1.2, -2.95, H + 1.75), (1.2, -3.25, H + 1.4), 0.03, V["dark"], verts=3))
    parts.append(sphere(0.2, (1.2, -3.3, H + 1.2), V["ember"], seg=6, rings=4))
    for k in range(4):  # hanging hide strips
        a = -math.pi / 2 + (k - 1.5) * 0.5
        parts.append(box((0.35, 0.05, 0.8), (math.cos(a) * 3.2, math.sin(a) * 3.2, H + 1.3), V["sash"], bevel=0, rot=(0, 0, a + math.pi / 2)))
    export("vellhut", [join(parts, "body")])


def vellstones(M):
    """Vell fire circle: a ring of stones round glowing embers, and three standing story-stones
    carved with glowing star patterns. The camp's centre, about 9 u across."""
    V = vell_mats()
    parts = []
    ring(9, 1.3, 0, lambda i, a, x, y, z: parts.append(blob(0.32, (x, y, 0.18), V["stone"], scale=(1.2, 0.9, 0.7), rot=(0, 0, a))))
    parts.append(cyl(1.05, 0.12, (0, 0, 0.06), V["dark"], verts=10, bevel=0))
    for k in range(5):
        a = k / 5 * math.tau
        parts.append(blob(0.22, (math.cos(a) * 0.4, math.sin(a) * 0.4, 0.2), V["ember"], scale=(1.3, 0.7, 0.6), rot=(0, 0, a)))
    for k in range(4):  # a tripod of sticks over the fire
        a = k / 4 * math.tau + 0.3
        parts.append(strut((math.cos(a) * 0.7, math.sin(a) * 0.7, 0.1), (math.cos(a) * 0.15, math.sin(a) * 0.15, 0.7), 0.05, V["wood"], verts=4))
    for k, (a, hgt) in enumerate(((math.pi / 2 + 0.6, 3.4), (math.pi / 2, 4.2), (math.pi / 2 - 0.6, 3.0))):
        x, y = math.cos(a) * 3.6, math.sin(a) * 3.6   # behind the fire (+Y), facing it
        yaw = a + math.pi / 2
        parts.append(box((1.2, 0.5, hgt), (x, y, hgt / 2), V["stone"], bevel=0.12, rot=(0, 0.05 * (k - 1), yaw)))
        parts.append(blob(0.62, (x, y, hgt), V["stone"], scale=(1.0, 0.45, 0.35), rot=(0, 0, yaw)))
        # star pattern: dots and short strokes on the face toward the fire
        fx, fy = -math.cos(a) * 0.27, -math.sin(a) * 0.27
        rnd = [(0.3, 0.75), (-0.25, 0.6), (0.05, 0.45), (-0.35, 0.3), (0.3, 0.2), (0.0, 0.85)]
        for j, (u, v) in enumerate(rnd[: 4 + k]):
            px = x + fx + math.cos(yaw) * u
            py = y + fy + math.sin(yaw) * u
            parts.append(sphere(0.07 if j % 2 else 0.1, (px, py, hgt * v), V["star"], seg=6, rings=4))
        parts.append(box((0.04, 0.06, hgt * 0.5), (x + fx, y + fy, hgt * 0.52), V["star"], bevel=0, rot=(0, 0.4, yaw)))
    for k in range(3):  # sitting logs
        a = -math.pi / 2 + (k - 1) * 0.9
        parts.append(cyl(0.22, 1.4, (math.cos(a) * 2.2, math.sin(a) * 2.2, 0.22), V["wood"], verts=6, rot=(0, math.pi / 2, a + math.pi / 2), bevel=0.03))
    export("vellstones", [join(parts, "body")])


def choir_mats():
    return {
        "rust": mat("crust", "#7a5440", 0.55, 0.75),
        "verd": mat("verd", "#4f8a7a", 0.5, 0.6),
        "iron": mat("iron", "#3a3836", 0.7, 0.55),
        "pale": mat("pale", "#a9a39a", 0.6, 0.6),
        "glow": glow_mat("cglow", "#9dffc8", 2.2),
        "dim": glow_mat("cdim", "#4fbf8a", 0.8),
    }


def cantor(M):
    """Choir cantor: a tall rusted tripod carrying a bundle of organ pipes and one dim,
    slow eye. Moves like a heron. About 7 u tall."""
    C = choir_mats()
    parts = []
    hip = Vector((0, 0, 4.4))
    for k in range(3):
        a = k / 3 * math.tau + math.pi / 2
        knee = Vector((math.cos(a) * 1.3, math.sin(a) * 1.3, 2.9))
        foot = Vector((math.cos(a) * 1.9, math.sin(a) * 1.9, 0.0))
        parts.append(strut(hip, knee, 0.16, C["rust"], verts=6, r2=0.12))
        parts.append(sphere(0.2, tuple(knee), C["iron"], seg=6, rings=4))
        parts.append(strut(knee, foot, 0.12, C["rust"], verts=6, r2=0.08))
        parts.append(cyl(0.3, 0.15, (foot.x, foot.y, 0.07), C["iron"], verts=6, bevel=0.03))
    parts.append(cyl(0.75, 0.6, (0, 0, 4.55), C["iron"], verts=8, bevel=0.06))        # hip drum
    parts.append(cyl(0.6, 0.5, (0, 0, 5.05), C["verd"], verts=8, r2=0.7, bevel=0.04))
    # the pipe bundle: different heights, a few broken short, some verdigris
    pipes = [(0, 0.15, 2.6), (0.38, 0.1, 2.1), (-0.38, 0.1, 2.3), (0.2, 0.42, 1.7), (-0.2, 0.42, 1.9), (0.55, 0.38, 1.3), (-0.55, 0.38, 1.1)]
    for j, (x, y, ln) in enumerate(pipes):
        m = C["verd"] if j % 3 == 1 else C["pale"] if j % 3 == 2 else C["rust"]
        parts.append(cyl(0.15, ln, (x, y, 5.3 + ln / 2), m, verts=8, bevel=0.02))
        parts.append(cyl(0.18, 0.12, (x, y, 5.3 + ln), C["iron"], verts=8, bevel=0))
        parts.append(box((0.12, 0.05, 0.22), (x, y - 0.15, 5.3 + ln * 0.35), C["iron"], bevel=0))  # mouth
    # the eye: a ring on a short neck at the front
    parts.append(strut((0, -0.4, 5.1), (0, -1.0, 5.6), 0.1, C["iron"], verts=6))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.4, minor_radius=0.09, major_segments=10, minor_segments=4, location=(0, -1.1, 5.7), rotation=(math.pi / 2, 0, 0))
    parts.append(_finish(bpy.context.active_object, C["pale"], 0))
    parts.append(sphere(0.24, (0, -1.08, 5.7), C["dim"], seg=8, rings=6, scale=(1, 0.5, 1)))
    # cables hanging from the drum
    for sx in (-1, 1):
        parts.append(strut((sx * 0.6, 0.2, 4.4), (sx * 0.9, 0.5, 3.4), 0.04, C["iron"], verts=4))
    export("cantor", [join(parts, "body")])


def tender(M):
    """Choir tender: a small machine on two treads with one arm and a welding glow,
    forever mending dead machines. About 2.5 u long."""
    C = choir_mats()
    parts = []
    parts.append(box((1.4, 2.2, 0.7), (0, 0, 0.9), C["rust"], bevel=0.18))
    parts.append(box((1.1, 1.4, 0.35), (0, 0.15, 1.38), C["verd"], bevel=0.1))
    parts.append(box((0.9, 0.5, 0.5), (0, -1.2, 0.95), C["iron"], bevel=0.1))              # head
    for sx in (-1, 1):
        parts.append(sphere(0.09, (sx * 0.25, -1.47, 1.05), C["glow"], seg=6, rings=4))
    # on treads, not legs, so it never reads as a predator
    for sx in (-1, 1):
        parts.append(box((0.42, 2.3, 0.55), (sx * 0.88, 0.0, 0.3), C["iron"], bevel=0.16))
        for y in (-0.75, 0.0, 0.75):
            parts.append(cyl(0.2, 0.46, (sx * 0.88, y, 0.3), C["pale"], verts=8, rot=(0, math.pi / 2, 0), bevel=0))
    # arm reaching forward and down, a hot tip
    sh = Vector((0.35, -0.9, 1.4))
    el = Vector((0.45, -1.7, 1.9))
    tip = Vector((0.4, -2.3, 1.1))
    parts.append(strut(sh, el, 0.09, C["pale"], verts=6))
    parts.append(sphere(0.12, tuple(el), C["iron"], seg=6, rings=4))
    parts.append(strut(el, tip, 0.07, C["pale"], verts=6, r2=0.04))
    parts.append(sphere(0.1, tuple(tip), C["glow"], seg=6, rings=4))
    parts.append(cyl(0.18, 0.5, (-0.35, 0.6, 1.75), C["iron"], verts=6, bevel=0.03))       # tank
    export("tender", [join(parts, "body")])


def pylon(M):
    """Choir pylon: a dead tower, tapered and ribbed, its top broken off, a band of glow
    still pulsing round its middle. The glow band is `charge` (the game dims it). About 14 u."""
    C = choir_mats()
    parts, band = [], []
    parts.append(cyl(3.0, 0.6, (0, 0, 0.3), C["iron"], verts=6, bevel=0.1))
    parts.append(cyl(2.2, 0.8, (0, 0, 1.0), C["rust"], verts=6, r2=1.9, bevel=0.08))
    parts.append(cyl(1.7, 9.5, (0, 0, 6.15), C["rust"], verts=6, r2=0.9, bevel=0.06))
    for k in range(6):  # ribs
        a = k / 6 * math.tau + math.pi / 6
        parts.append(strut((math.cos(a) * 2.0, math.sin(a) * 2.0, 1.2), (math.cos(a) * 0.95, math.sin(a) * 0.95, 10.6), 0.16, C["verd"] if k % 2 else C["pale"], verts=4))
    # broken crown: two jagged shards and a bent antenna
    parts.append(strut((0.3, 0.1, 10.8), (0.6, -0.2, 12.6), 0.35, C["rust"], verts=4, r2=0.05))
    parts.append(strut((-0.4, 0.2, 10.8), (-0.5, 0.3, 11.9), 0.3, C["iron"], verts=4, r2=0.05))
    parts.append(strut((0.0, -0.3, 10.9), (0.4, -1.2, 13.4), 0.06, C["pale"], verts=4))
    parts.append(strut((0.4, -1.2, 13.4), (1.3, -1.4, 13.0), 0.05, C["pale"], verts=4))
    for z in (2.0, 9.0):
        parts.append(cyl(1.95 - (z - 2) * 0.1, 0.25, (0, 0, z), C["iron"], verts=6, bevel=0.03))
    # the glow band and three glyph panels
    band.append(cyl(1.55, 0.35, (0, 0, 5.2), C["glow"], verts=6, bevel=0))
    for k in range(3):
        a = k / 3 * math.tau - math.pi / 2
        band.append(box((0.5, 0.06, 1.2), (math.cos(a) * 1.42, math.sin(a) * 1.42, 7.0), C["glow"], bevel=0, rot=(0, 0, a + math.pi / 2)))
    # rubble round the foot
    for k in range(5):
        a = k / 5 * math.tau + 0.4
        parts.append(blob(0.45, (math.cos(a) * 3.4, math.sin(a) * 3.4, 0.2), C["rust"], scale=(1.3, 0.9, 0.6), rot=(0, 0, a)))
    export("pylon", [join(parts, "body"), join(band, "charge")])


# ---------------------------------------------------------------- set v5: roster batch A (2026-11-18)

def lancer(M):
    """Lancer: a long, low tracked chassis carrying one rail lance along its spine. Coils
    glow cyan down the barrel; capacitor drums at the back. ~1.1 u body radius."""
    parts = tracks((-1, 1), 3.2, 0.42, M, width=0.5, height=0.62, wheels_n=5, xoff=1.05)
    parts.append(box((1.6, 3.0, 0.6), (0, 0.1, 0.85), M["hull"], bevel=0.12))
    parts.append(box((1.4, 0.7, 0.35), (0, -1.45, 0.8), M["hull2"], bevel=0.08, rot=(0.45, 0, 0)))
    # capacitor drums behind the cab
    for x in (-0.45, 0.45):
        parts.append(cyl(0.32, 1.1, (x, 1.05, 1.35), M["dark"], verts=10, rot=(math.pi / 2, 0, 0), bevel=0.04))
        parts.append(cyl(0.34, 0.08, (x, 0.55, 1.35), M["cyan"], verts=10, rot=(math.pi / 2, 0, 0), bevel=0))
    # the lance: a squared rail pair running the whole length and past the nose
    parts.append(box((0.8, 1.0, 0.5), (0, -0.1, 1.45), M["hull2"], bevel=0.08))
    for x in (-0.16, 0.16):
        parts.append(box((0.12, 3.6, 0.2), (x, -1.9, 1.5), M["dark"], bevel=0.02))
    parts.append(box((0.5, 0.25, 0.42), (0, -3.6, 1.5), M["black"], bevel=0.04))
    for k in range(5):
        parts.append(box((0.5, 0.12, 0.42), (0, -0.85 - k * 0.6, 1.5), M["hull"], bevel=0.02))
        parts.append(box((0.08, 0.14, 0.08), (0, -1.15 - k * 0.6, 1.5), M["cyan"], bevel=0))
    parts.append(box((0.6, 0.6, 0.35), (0.55, 0.0, 1.85), M["dark"], bevel=0.05))   # sight
    parts.append(box((0.4, 0.06, 0.16), (0.55, -0.31, 1.88), M["cyan"], bevel=0))
    parts.append(box((1.7, 0.08, 0.08), (0, 1.62, 1.1), M["red"], bevel=0))
    export("lancer", [join(parts, "body")])


def sensor(M):
    """Sensor Mast: a slim tripod with a camera head and a blinking top light. ~6 u tall."""
    parts, head = [], []
    parts.append(cyl(1.3, 0.3, (0, 0, 0.15), M["dark"], verts=6, bevel=0.06))
    for k in range(3):
        a = k / 3 * math.tau
        parts.append(strut((math.cos(a) * 1.15, math.sin(a) * 1.15, 0.2), (0, 0, 4.2), 0.08, M["hull2"], verts=5))
    parts.append(cyl(0.16, 4.6, (0, 0, 2.6), M["hull"], verts=8))
    parts.append(box((0.5, 0.5, 0.7), (0, 0.35, 1.2), M["dark"], bevel=0.05))      # battery box
    parts.append(box((0.3, 0.04, 0.1), (0, 0.11, 1.35), M["cyan"], bevel=0))
    P = 5.0
    head.append(cyl(0.45, 0.3, (0, 0, P - 0.2), M["dark"], verts=8))
    head.append(box((0.8, 0.9, 0.5), (0, 0, P + 0.2), M["hull"], bevel=0.1))
    for x in (-0.22, 0.22):
        head.append(cyl(0.16, 0.25, (x, -0.5, P + 0.2), M["black"], verts=10, rot=(math.pi / 2, 0, 0), bevel=0.02))
        head.append(cyl(0.1, 0.05, (x, -0.64, P + 0.2), M["cyan"], verts=10, rot=(math.pi / 2, 0, 0), bevel=0))
    head.append(cyl(0.03, 0.8, (0.3, 0.3, P + 0.8), M["dark"], verts=4, bevel=0))
    head.append(sphere(0.1, (0.3, 0.3, P + 1.22), M["red"], seg=6, rings=4))
    export("sensor", [join(parts, "body"), join(head, "dish", pivot=(0, 0, P))])


def habitat(M):
    """Habitat Block: three stacked living modules on a deck, staggered, with warm window
    strips, a stair tower and an airlock at the front (−Y). ~10 u footprint."""
    warm = glow_mat("warm", "#ffe2a8", 1.6)
    parts = []
    parts.append(box((9.0, 8.0, 0.5), (0, 0, 0.25), M["dark"], bevel=0.12))
    mods = [((7.0, 3.0, 2.4), (0, -1.8, 1.7), 0.0), ((7.0, 3.0, 2.4), (0, 1.6, 1.7), 0.0), ((6.0, 3.0, 2.2), (-0.4, 0.0, 4.0), 0.18)]
    for size, loc, yaw in mods:
        parts.append(box(size, loc, M["hull"], bevel=0.25, rot=(0, 0, yaw)))
        x0, y0, z0 = loc
        for side in (-1, 1):
            # a window strip along each long side, mullions over it
            c, s = math.cos(yaw), math.sin(yaw)
            off = side * (size[1] / 2 + 0.02)
            parts.append(box((size[0] - 1.0, 0.08, 0.4), (x0 - s * off, y0 + c * off, z0 + 0.25), warm, bevel=0, rot=(0, 0, yaw)))
            for k in range(5):
                t = (k - 2) * (size[0] - 1.2) / 4
                parts.append(box((0.14, 0.12, 0.6), (x0 + c * t - s * off, y0 + s * t + c * off, z0 + 0.25), M["dark"], bevel=0, rot=(0, 0, yaw)))
        # ribbed end caps
        for ex in (-1, 1):
            parts.append(box((0.25, size[1] + 0.15, size[2] + 0.1), (x0 + ex * (size[0] / 2) * math.cos(yaw), y0 + ex * (size[0] / 2) * math.sin(yaw), z0), M["hull2"], bevel=0.06, rot=(0, 0, yaw)))
    # stair tower and the airlock at the front
    parts.append(box((1.6, 1.6, 5.6), (3.9, -1.0, 2.9), M["hull2"], bevel=0.12))
    parts.append(box((0.1, 0.9, 4.6), (4.72, -1.0, 2.9), M["glass"], bevel=0))
    parts.append(box((1.8, 1.4, 2.2), (-1.5, -3.9, 1.6), M["hull2"], bevel=0.1))
    parts.append(box((1.1, 0.1, 1.7), (-1.5, -4.62, 1.35), M["dark"], bevel=0))
    parts.append(box((1.2, 0.1, 0.1), (-1.5, -4.64, 2.35), M["amber"], bevel=0))
    # rooftop: a water tank, a dish and a beacon
    parts.append(cyl(0.7, 1.2, (1.6, 0.2, 5.7), M["hull2"], verts=10, bevel=0.06))
    parts.append(cyl(0.08, 1.2, (-2.6, 0.6, 5.6), M["dark"], verts=6, bevel=0))
    parts.append(sphere(0.18, (-2.6, 0.6, 6.25), M["red"], seg=6, rings=4))
    parts.append(cyl(0.6, 0.15, (-1.2, -0.5, 5.25), M["hull"], verts=10, rot=(0.6, 0, 0), bevel=0))
    export("habitat", [join(parts, "body")])


def relay(M):
    """Relay Tower: a tall lattice mast with dish and antenna array, guy wires to anchor
    blocks and a cyan beacon band near the top (`charge`). ~16 u tall."""
    parts, band = [], []
    parts.append(cyl(2.4, 0.5, (0, 0, 0.25), M["dark"], verts=6, bevel=0.08))
    parts.append(cyl(1.4, 1.2, (0, 0, 1.1), M["hull2"], verts=6, r2=1.1, bevel=0.06))
    H = 14.0
    legs3 = [(math.cos(k / 3 * math.tau) * 1.0, math.sin(k / 3 * math.tau) * 1.0) for k in range(3)]
    for (x, y) in legs3:
        parts.append(strut((x, y, 1.6), (x * 0.35, y * 0.35, H), 0.1, M["hull"], verts=5))
    for z0 in range(2, int(H) - 1, 2):
        f0, f1 = 1 - (z0 - 1.6) / (H - 1.6) * 0.65, 1 - (z0 + 2 - 1.6) / (H - 1.6) * 0.65
        for k in range(3):
            (ax, ay), (bx, by) = legs3[k], legs3[(k + 1) % 3]
            parts.append(strut((ax * f0, ay * f0, z0), (bx * f1, by * f1, z0 + 2), 0.04, M["hull2"], verts=4))
    parts.append(cyl(0.5, 0.6, (0, 0, H + 0.3), M["dark"], verts=8))
    parts.append(cyl(0.05, 2.6, (0, 0, H + 1.9), M["dark"], verts=4, bevel=0))
    parts.append(sphere(0.18, (0, 0, H + 3.25), M["red"], seg=6, rings=4))
    for k in range(3):   # antenna panels
        a = k / 3 * math.tau + 0.5
        parts.append(box((0.9, 0.12, 1.8), (math.cos(a) * 0.65, math.sin(a) * 0.65, H - 1.4), M["hull"], bevel=0.03, rot=(0, 0, a + math.pi / 2)))
    # a small dish on an arm, looking out
    parts.append(strut((0, 0, H - 4), (1.3, -0.4, H - 4), 0.07, M["dark"], verts=5))
    parts.append(cyl(0.75, 0.15, (1.4, -0.45, H - 4), M["hull"], verts=12, r2=0.55, rot=(0, math.pi / 2 - 0.3, -0.3), bevel=0))
    # guy wires to three anchor blocks
    for k in range(3):
        a = k / 3 * math.tau + math.pi / 3
        ax, ay = math.cos(a) * 3.2, math.sin(a) * 3.2
        parts.append(box((0.6, 0.6, 0.4), (ax, ay, 0.2), M["dark"], bevel=0.05))
        parts.append(strut((ax, ay, 0.35), (math.cos(a) * 0.5, math.sin(a) * 0.5, H * 0.72), 0.02, M["black"], verts=3))
    band.append(cyl(0.62, 0.25, (0, 0, H - 2.7), M["cyan"], verts=8, bevel=0))
    band.append(cyl(0.45, 0.2, (0, 0, H + 0.7), M["cyan"], verts=8, bevel=0))
    export("relay", [join(parts, "body"), join(band, "charge")])



# ---------------------------------------------------------------- set v6: nests and wrecks (2026-11-18)

def nest(M):
    """Nest: a low mound of chewed rock and resin, ~7 u across, ringed with curved spines,
    three dark burrow mouths with a sickly glow deep inside, egg sacs clustered on top."""
    F = fauna_mats("#8a5048", "#3a1410", "#6a4436", "#ff8a4d")
    resin = mat("resin", "#8a5a2a", 0.1, 0.35, emit="#3a1a06", strength=0.5)
    parts = [blob(3.2, (0, 0, 0.3), F["plate"], scale=(1, 1, 0.42), sub=2)]
    parts.append(blob(1.9, (0.5, -0.3, 1.2), F["skin"], scale=(1, 0.9, 0.7), sub=2))
    parts.append(blob(1.2, (-1.3, 0.9, 1.0), F["skin"], scale=(1.1, 0.9, 0.6), sub=1))
    for k in range(3):   # burrow mouths: dark rims, a glow in the throat
        a = k / 3 * math.tau + 0.4
        x, y = math.cos(a) * 2.5, math.sin(a) * 2.5
        bpy.ops.mesh.primitive_torus_add(major_radius=0.75, minor_radius=0.28, major_segments=10, minor_segments=5,
                                         location=(x, y, 0.55), rotation=(0.9, 0, a + math.pi / 2))
        parts.append(_finish(bpy.context.active_object, F["claw"], 0))
        parts.append(sphere(0.45, (x * 0.93, y * 0.93, 0.5), F["eye"], seg=8, rings=5))
    for k in range(9):   # spines curling inward
        a = k / 9 * math.tau
        r0 = 2.9 + (k % 2) * 0.4
        base = (math.cos(a) * r0, math.sin(a) * r0, 0.2)
        tip = (math.cos(a) * (r0 - 1.0), math.sin(a) * (r0 - 1.0), 2.4 + (k % 3) * 0.5)
        parts.append(strut(base, tip, 0.22, F["claw"], verts=4, r2=0.02))
    for k in range(6):   # egg sacs
        a = k / 6 * math.tau + 0.3
        parts.append(blob(0.38, (0.5 + math.cos(a) * 0.9, -0.3 + math.sin(a) * 0.8, 2.15 + (k % 2) * 0.2), resin, scale=(1, 1, 1.25)))
    export("nest", [join(parts, "body")])


def wreck(M):
    """Wreck: an Accord-pattern lander from an earlier run, broken in two and half sunk,
    hull scorched, one landing leg up, the cyan trim long dead. ~10 u long."""
    burnt = mat("burnt", "#3a332e", 0.4, 0.8)
    parts = []
    # aft section: the pod's flared base, tilted and sunk
    aft = [cyl(2.6, 3.2, (0, 1.8, 0.6), M["hull2"], verts=8, r2=1.8, bevel=0.08)]
    aft.append(cyl(2.7, 0.35, (0, 1.8, -0.9), M["dark"], verts=8, bevel=0.05))
    aft.append(box((1.2, 0.2, 1.4), (1.9, 1.2, 0.6), burnt, bevel=0.04, rot=(0, 0.3, 0.6)))
    for k in range(4):
        a = k / 4 * math.tau + 0.4
        aft.append(box((0.5, 0.3, 1.0), (math.cos(a) * 2.2, 1.8 + math.sin(a) * 2.2, 1.3), M["hull"], rot=(0, 0, a)))
    for o in aft:
        o.rotation_euler = (0.35, -0.2, 0)
    parts += aft
    # fore section: the nose cone, snapped off and lying on its side
    parts.append(cyl(1.8, 3.6, (0.6, -3.2, 0.9), M["hull"], verts=8, r2=0.5, rot=(math.pi / 2 + 0.25, 0, 0.15), bevel=0.06))
    parts.append(box((1.0, 0.1, 0.12), (0.5, -2.2, 2.25), M["dark"], bevel=0, rot=(0.25, 0, 0.15)))
    parts.append(box((1.6, 1.0, 1.4), (-0.4, -0.9, 0.3), burnt, bevel=0.1, rot=(0.4, 0.5, 0.2)))   # torn frame
    # struts and a landing leg pointing at the sky
    parts.append(strut((-1.6, 2.4, 0.4), (-2.6, 3.5, 3.4), 0.14, M["dark"], verts=5))
    parts.append(box((0.9, 0.9, 0.2), (-2.65, 3.55, 3.5), M["dark"], bevel=0.04, rot=(0.4, -0.3, 0)))
    for k in range(5):
        parts.append(strut((-0.2 + k * 0.3, -0.4, 0.4), (0.2 + k * 0.35, -1.8 - (k % 2) * 0.4, 1.3 + (k % 3) * 0.3), 0.05, M["hull2"], verts=4))
    # scattered panels and the dead trim
    for k, (x, y, r) in enumerate([(3.4, -1.0, 0.4), (-3.0, -2.6, 1.3), (2.6, 3.8, 2.2), (-3.6, 0.6, 3.0)]):
        parts.append(box((1.2, 0.8, 0.1), (x, y, 0.1), M["hull"] if k % 2 else burnt, bevel=0.02, rot=(0.1, 0.05, r)))
    parts.append(box((2.4, 0.08, 0.1), (0, 0.15, 1.9), mat("deadtrim", "#1d3a40", 0.3, 0.5), bevel=0, rot=(0.35, -0.2, 0)))
    export("wreck", [join(parts, "body")])



# ---------------------------------------------------------------- set v7: Tech Lab, Deep-Core Mine, Fusion Cell (2026-11-18)

def lab(M):
    """Tech Lab: a low two-wing lab block around a glass-domed core, a sensor spire and an
    instrument dish on the roof, cyan window bands. ~11 u footprint."""
    parts = []
    parts.append(box((10.0, 8.0, 0.5), (0, 0, 0.25), M["dark"], bevel=0.12))
    for sx in (-1, 1):
        parts.append(box((3.6, 6.4, 2.4), (sx * 3.0, 0, 1.7), M["hull"], bevel=0.18))
        parts.append(box((0.08, 5.4, 0.35), (sx * 4.82, 0, 2.0), M["cyan"], bevel=0))
        parts.append(box((3.8, 6.6, 0.25), (sx * 3.0, 0, 3.0), M["hull2"], bevel=0.05))
        for k in range(3):
            parts.append(box((0.9, 0.9, 0.5), (sx * 3.0 + (k - 1) * 1.1, 2.2, 3.35), M["dark"], bevel=0.05))   # roof units
    parts.append(cyl(2.4, 3.0, (0, 0, 2.0), M["hull2"], verts=12, bevel=0.08))
    parts.append(sphere(2.3, (0, 0, 3.5), M["glass"], seg=16, rings=8, scale=(1, 1, 0.75)))
    parts.append(cyl(2.45, 0.25, (0, 0, 3.5), M["dark"], verts=12, bevel=0))
    parts.append(sphere(0.7, (0, 0, 4.0), M["cyan"], seg=10, rings=6))              # the experiment inside
    parts.append(cyl(0.12, 4.0, (2.6, -2.4, 5.0), M["dark"], verts=6, bevel=0))     # spire
    parts.append(cyl(0.35, 0.6, (2.6, -2.4, 7.0), M["hull"], verts=8, r2=0.05, bevel=0))
    parts.append(sphere(0.14, (2.6, -2.4, 7.4), M["red"], seg=6, rings=4))
    parts.append(cyl(0.9, 0.12, (-3.0, -2.0, 3.6), M["hull"], verts=12, r2=0.6, rot=(0.6, 0, 0.4), bevel=0))
    parts.append(box((2.0, 1.4, 2.0), (0, -4.4, 1.3), M["hull2"], bevel=0.1))       # entrance
    parts.append(box((1.2, 0.1, 1.5), (0, -5.12, 1.1), M["dark"], bevel=0))
    parts.append(box((1.3, 0.1, 0.1), (0, -5.14, 2.0), M["cyan"], bevel=0))
    export("lab", [join(parts, "body")])


def deepmine(M):
    """Deep-Core Mine: a derrick over a bore casing, drill string and turntable, a pump
    house, isotope canisters glowing violet on a rack. ~8 u footprint, ~12 u tall."""
    violet = glow_mat("violet", "#9b7bff", 2.4)
    parts = []
    parts.append(cyl(4.0, 0.5, (0, 0, 0.25), M["dark"], verts=8, bevel=0.1))
    parts.append(cyl(1.4, 1.2, (0, 0, 1.0), M["hull2"], verts=10, bevel=0.06))       # casing head
    parts.append(cyl(2.0, 0.35, (0, 0, 1.75), M["hull"], verts=12, bevel=0.04))      # turntable
    parts.append(cyl(0.3, 9.0, (0, 0, 5.8), M["dark"], verts=8, bevel=0))            # drill string
    legs4 = [(sx * 2.6, sy * 2.6) for sx in (-1, 1) for sy in (-1, 1)]
    for (x, y) in legs4:
        parts.append(strut((x, y, 0.5), (x * 0.25, y * 0.25, 11.0), 0.13, M["hull"], verts=5))
    for z0 in (3.0, 6.0, 9.0):
        f = 1 - (z0 - 0.5) / 10.5 * 0.75
        for (ax, ay), (bx, by) in (((-2.6, -2.6), (2.6, -2.6)), ((2.6, -2.6), (2.6, 2.6)), ((2.6, 2.6), (-2.6, 2.6)), ((-2.6, 2.6), (-2.6, -2.6))):
            parts.append(strut((ax * f, ay * f, z0), (bx * f, by * f, z0), 0.06, M["hull2"], verts=4))
    parts.append(box((1.8, 1.8, 0.6), (0, 0, 11.2), M["dark"], bevel=0.06))           # crown block
    parts.append(sphere(0.18, (0, 0, 11.65), M["red"], seg=6, rings=4))
    parts.append(box((2.8, 2.2, 2.2), (2.6, -2.8, 1.6), M["hull2"], bevel=0.12))      # pump house
    parts.append(cyl(0.3, 2.2, (2.6, -2.8, 3.6), M["dark"], verts=8, bevel=0))
    parts.append(box((1.4, 0.1, 0.2), (2.6, -3.92, 2.1), M["amber"], bevel=0))
    parts.append(box((2.6, 1.0, 0.25), (-2.8, 2.6, 0.7), M["dark"], bevel=0.04))      # canister rack
    for k in range(4):
        x = -3.8 + k * 0.66
        parts.append(cyl(0.25, 1.0, (x, 2.6, 1.35), M["hull"], verts=8, bevel=0.02))
        parts.append(cyl(0.27, 0.3, (x, 2.6, 1.35), violet, verts=8, bevel=0))
    parts.append(cyl(1.5, 0.2, (0, 0, 0.55), violet, verts=12, bevel=0))               # glow round the bore
    export("deepmine", [join(parts, "body")])


def fusion(M):
    """Fusion Cell: a squat torus reactor on a plinth, coolant towers each side, a glowing
    core ring (`charge`) and isotope feed lines. ~9 u footprint."""
    parts, band = [], []
    parts.append(cyl(4.4, 0.6, (0, 0, 0.3), M["dark"], verts=10, bevel=0.1))
    bpy.ops.mesh.primitive_torus_add(major_radius=2.6, minor_radius=1.0, major_segments=18, minor_segments=8, location=(0, 0, 1.8))
    parts.append(_finish(bpy.context.active_object, M["hull"], 0))
    for k in range(8):   # field coils round the torus
        a = k / 8 * math.tau
        bpy.ops.mesh.primitive_torus_add(major_radius=1.15, minor_radius=0.14, major_segments=10, minor_segments=4,
                                         location=(math.cos(a) * 2.6, math.sin(a) * 2.6, 1.8), rotation=(math.pi / 2, 0, a + math.pi / 2))
        parts.append(_finish(bpy.context.active_object, M["dark"], 0))
    parts.append(cyl(1.0, 2.8, (0, 0, 2.1), M["hull2"], verts=10, bevel=0.06))       # central column
    parts.append(cyl(1.3, 0.3, (0, 0, 3.6), M["dark"], verts=10, bevel=0.04))
    for sx in (-1, 1):   # coolant towers
        parts.append(cyl(0.9, 4.2, (sx * 3.6, 2.4, 2.4), M["hull2"], verts=10, r2=0.7, bevel=0.06))
        parts.append(cyl(0.95, 0.2, (sx * 3.6, 2.4, 4.55), M["dark"], verts=10, bevel=0))
        parts.append(strut((sx * 3.6, 2.4, 1.2), (sx * 1.9, 1.0, 1.4), 0.18, M["dark"], verts=6))
    parts.append(box((1.6, 1.2, 1.4), (0, -3.6, 1.0), M["hull"], bevel=0.08))         # feed station
    parts.append(strut((0, -3.0, 1.2), (0, -1.6, 1.6), 0.15, M["dark"], verts=6))
    band.append(cyl(2.62, 0.18, (0, 0, 1.8), M["cyan"], verts=18, bevel=0))
    band.append(cyl(1.05, 0.3, (0, 0, 3.3), M["cyan"], verts=10, bevel=0))
    export("fusion", [join(parts, "body"), join(band, "charge")])


MODELS = {"solar": solar, "depot": depot, "battery": battery, "turret": turret, "radar": radar, "bay": bay, "wall": wall, "rover": rover, "tank": tank,
          "cannon": cannon, "pointdefense": pointdefense, "repairpad": repairpad, "gate": gate, "geothermal": geothermal,
          "artillery": artillery, "arc": arc, "engineer": engineer, "scout": scout,
          "swarmer": swarmer, "brute": brute, "spitter": spitter, "burrower": burrower,
          "civic": civic, "hydroponics": hydroponics,
          "vell": vell, "vellkeeper": vellkeeper, "vellhut": vellhut, "vellstones": vellstones,
          "cantor": cantor, "tender": tender, "pylon": pylon,
          "lancer": lancer, "sensor": sensor, "habitat": habitat, "relay": relay,
          "nest": nest, "wreck": wreck,
          "lab": lab, "deepmine": deepmine, "fusion": fusion}
V2 = ["cannon", "pointdefense", "repairpad", "gate", "geothermal", "artillery", "arc", "engineer", "scout", "swarmer", "brute", "spitter", "burrower"]

if __name__ == "__main__":
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = set(a[a.index("--only") + 1].split(",")) if "--only" in a else set(MODELS)
    for name, fn in MODELS.items():
        if name in only:
            reset()
            fn(palette())
