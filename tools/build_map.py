# Headless Blender bake of REACTOR-09 as a Dust II-style desert town GLB.
import json
import math
import os
import bpy
import bmesh
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GRID = json.load(open(os.path.join(ROOT, "tools", "grid.json")))
OUT = os.path.join(ROOT, "client", "public", "models", "reactor09.glb")

COLS = GRID["COLS"]
ROWS = GRID["ROWS"]
CELL = GRID["CELL"]
floor_rows = GRID["floor"]
crates = GRID["crates"]


def is_floor(c, r):
    if c < 0 or r < 0 or c >= COLS or r >= ROWS:
        return False
    return floor_rows[r][c] == "1"


def mat(name, color, rough=0.86, metal=0.02):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*color, 1)
    return m


bpy.ops.wm.read_factory_settings(use_empty=True)

M_WHITE = mat("plaster_white", (0.90, 0.86, 0.78), 0.88)
M_TAN = mat("plaster_tan", (0.70, 0.55, 0.36), 0.90)
M_CREAM = mat("plaster_cream", (0.82, 0.74, 0.58), 0.89)
M_ROOF = mat("roof", (0.76, 0.70, 0.56), 0.92)
M_STREET = mat("street", (0.70, 0.66, 0.56), 0.94)
M_SAND = mat("sand", (0.78, 0.66, 0.42), 0.96)
M_WOOD = mat("wood", (0.42, 0.30, 0.16), 0.78)
M_METAL = mat("metal", (0.38, 0.40, 0.42), 0.42, 0.55)
M_DARK = mat("dark", (0.10, 0.13, 0.16), 0.22, 0.18)
M_LEAF = mat("leaf", (0.22, 0.40, 0.16), 0.80)
M_TRUNK = mat("trunk", (0.32, 0.22, 0.11), 0.85)
M_CURB = mat("curb", (0.88, 0.86, 0.80), 0.90)
M_RUST = mat("rust", (0.55, 0.22, 0.14), 0.62, 0.2)
M_AWN = mat("awn", (0.18, 0.18, 0.18), 0.70)
M_TRIM = mat("trim", (0.62, 0.48, 0.32), 0.84)


def P(x, y, z):
    return Vector((x, -z, y))


def project_uvs(bm, scale=80.0):
    uv = bm.loops.layers.uv.new("UVMap") if not bm.loops.layers.uv else bm.loops.layers.uv.active
    for face in bm.faces:
        n = face.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for loop in face.loops:
            p = loop.vert.co
            if az >= ax and az >= ay:
                u, v = p.x, p.y
            elif ax >= ay:
                u, v = p.y, p.z
            else:
                u, v = p.x, p.z
            loop[uv].uv = (u / scale, v / scale)


def add_mesh(name, material, build_fn, uv_scale=80.0):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    build_fn(bm)
    if bm.verts:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        project_uvs(bm, uv_scale)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    ob = bpy.data.objects.new(name, mesh)
    ob.data.materials.append(material)
    bpy.context.collection.objects.link(ob)
    return ob


def xform(bm, verts, mx):
    if verts:
        bmesh.ops.transform(bm, matrix=mx, verts=verts)


def box(bm, cx, cy, cz, sx, sy, sz, rot_z=0.0):
    n0 = len(bm.verts)
    geom = bmesh.ops.create_cube(bm, size=1.0)
    created = geom.get("verts") or list(bm.verts)[n0:]
    mx = Matrix.Translation(P(cx, cy, cz))
    mx @= Matrix.Rotation(-rot_z, 4, "Z")
    mx @= Matrix.Diagonal((sx, sz, sy, 1.0))
    xform(bm, created, mx)


def cyl(bm, cx, cy, cz, r0, r1, h, segs=10):
    n0 = len(bm.verts)
    geom = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segs,
        radius1=r0,
        radius2=r1,
        depth=h,
        matrix=Matrix.Identity(4),
    )
    created = geom.get("verts") or list(bm.verts)[n0:]
    xform(bm, created, Matrix.Translation(P(cx, cy, cz)))


def sphere(bm, cx, cy, cz, radius, segs=12, rings=8, scale_z=1.0):
    n0 = len(bm.verts)
    geom = bmesh.ops.create_uvsphere(
        bm,
        u_segments=segs,
        v_segments=rings,
        radius=radius,
        matrix=Matrix.Identity(4),
    )
    created = geom.get("verts") or list(bm.verts)[n0:]
    mx = Matrix.Translation(P(cx, cy, cz))
    mx @= Matrix.Diagonal((1.0, 1.0, scale_z, 1.0))
    xform(bm, created, mx)


def street_faces(c, r):
    faces = []
    if is_floor(c, r - 1):
        faces.append("n")
    if is_floor(c, r + 1):
        faces.append("s")
    if is_floor(c - 1, r):
        faces.append("w")
    if is_floor(c + 1, r):
        faces.append("e")
    return faces


def build_desert(bm):
    gx = COLS * CELL * 0.5
    gz = ROWS * CELL * 0.5
    box(bm, gx, -6, gz, COLS * CELL + 7000, 12, ROWS * CELL + 7000)
    for hx, hz, rad, hy in [
        (gx - 4200, gz - 2600, 1800, 720),
        (gx + 4000, gz - 3000, 1600, 640),
        (gx - 900, gz - 4800, 2200, 880),
        (gx + 2400, gz + 4600, 1900, 700),
        (gx - 5000, gz + 600, 1700, 760),
        (gx + 5200, gz + 200, 1500, 620),
    ]:
        sphere(bm, hx, hy * 0.22, hz, rad, 12, 7, hy / rad)


add_mesh("desert", M_SAND, build_desert, 280)


def build_street(bm):
    for r in range(ROWS):
        c = 0
        while c < COLS:
            if not is_floor(c, r):
                c += 1
                continue
            c0 = c
            while c < COLS and is_floor(c, r):
                c += 1
            w = c - c0
            box(bm, (c0 + w * 0.5) * CELL, 0.4, (r + 0.5) * CELL, w * CELL, 0.8, CELL)


add_mesh("street", M_STREET, build_street, 140)


def build_curbs(bm):
    for r in range(ROWS):
        for c in range(COLS):
            if not is_floor(c, r):
                continue
            x = (c + 0.5) * CELL
            z = (r + 0.5) * CELL
            if not is_floor(c, r - 1):
                box(bm, x, 2.4, r * CELL + 2.5, CELL * 0.92, 4.8, 5)
            if not is_floor(c, r + 1):
                box(bm, x, 2.4, (r + 1) * CELL - 2.5, CELL * 0.92, 4.8, 5)
            if not is_floor(c - 1, r):
                box(bm, c * CELL + 2.5, 2.4, z, 5, 4.8, CELL * 0.92)
            if not is_floor(c + 1, r):
                box(bm, (c + 1) * CELL - 2.5, 2.4, z, 5, 4.8, CELL * 0.92)


add_mesh("curbs", M_CURB, build_curbs, 48)

visited = set()
lots = []
for r in range(ROWS):
    for c in range(COLS):
        if (c, r) in visited or is_floor(c, r):
            continue
        if not street_faces(c, r):
            continue
        max_w = 2 if (c + r) % 3 else 3
        max_h = 2 if (c * 2 + r) % 3 else 3
        w = 1
        h = 1
        while (
            c + w < COLS
            and w < max_w
            and all((not is_floor(c + w, r + i) and (c + w, r + i) not in visited) for i in range(h))
            and any(street_faces(c + w, r + i) for i in range(h))
        ):
            w += 1
        grow = True
        while grow and r + h < ROWS and h < max_h:
            if all((not is_floor(c + i, r + h) and (c + i, r + h) not in visited) for i in range(w)) and any(
                street_faces(c + i, r + h) for i in range(w)
            ):
                h += 1
            else:
                grow = False
        for i in range(w):
            for j in range(h):
                visited.add((c + i, r + j))
        lots.append((c, r, w, h))


def build_cliffs(bm):
    for r in range(ROWS):
        for c in range(COLS):
            if is_floor(c, r) or (c, r) in visited:
                continue
            x = (c + 0.5) * CELL
            z = (r + 0.5) * CELL
            h = 38 + ((c * 5 + r * 3) % 5) * 12
            box(bm, x, h * 0.5, z, CELL + 6, h, CELL + 6)


add_mesh("cliffs", M_SAND, build_cliffs, 180)


def lot_faces(c0, r0, w, h):
    faces = []
    for i in range(w):
        if is_floor(c0 + i, r0 - 1):
            faces.append(("n", c0 + i, r0))
        if is_floor(c0 + i, r0 + h):
            faces.append(("s", c0 + i, r0 + h - 1))
    for j in range(h):
        if is_floor(c0 - 1, r0 + j):
            faces.append(("w", c0, r0 + j))
        if is_floor(c0 + w, r0 + j):
            faces.append(("e", c0 + w - 1, r0 + j))
    return faces


def lot_height(c0, r0, w, h):
    hgt = 132 + ((c0 * 11 + r0 * 19 + w * 3 + h * 5) % 6) * 22
    if w * h >= 6:
        hgt += 24
    return hgt


def build_plaster(target):
    def fn(bm):
        for c0, r0, w, h in lots:
            plaster = (c0 * 7 + r0 * 13 + w) % 3
            if plaster != target:
                continue
            height = lot_height(c0, r0, w, h)
            cx = (c0 + w * 0.5) * CELL
            cz = (r0 + h * 0.5) * CELL
            sx = w * CELL - 10
            sz = h * CELL - 10
            box(bm, cx, height * 0.5, cz, sx, height, sz)
            box(bm, cx, 8, cz, sx + 6, 16, sz + 6)
            if ((c0 + r0) % 4 == 0) and w >= 2 and h >= 2:
                box(bm, cx + 8, height + 22, cz - 8, min(sx * 0.38, 56), 36, min(sz * 0.38, 56))
    return fn


add_mesh("bldg_white", M_WHITE, build_plaster(0), 72)
add_mesh("bldg_tan", M_TAN, build_plaster(1), 72)
add_mesh("bldg_cream", M_CREAM, build_plaster(2), 72)


def build_roofs(bm):
    for c0, r0, w, h in lots:
        height = lot_height(c0, r0, w, h)
        cx = (c0 + w * 0.5) * CELL
        cz = (r0 + h * 0.5) * CELL
        sx = w * CELL - 10
        sz = h * CELL - 10
        box(bm, cx, height + 3, cz, sx + 10, 6, sz + 10)
        box(bm, cx, height + 12, cz - sz * 0.5 + 2, sx + 4, 10, 5)
        box(bm, cx, height + 12, cz + sz * 0.5 - 2, sx + 4, 10, 5)
        box(bm, cx - sx * 0.5 + 2, height + 12, cz, 5, 10, sz + 4)
        box(bm, cx + sx * 0.5 - 2, height + 12, cz, 5, 10, sz + 4)


add_mesh("roofs", M_ROOF, build_roofs, 96)


def build_trim(bm):
    for c0, r0, w, h in lots:
        height = lot_height(c0, r0, w, h)
        cx = (c0 + w * 0.5) * CELL
        cz = (r0 + h * 0.5) * CELL
        sx = w * CELL - 10
        sz = h * CELL - 10
        box(bm, cx, 42, cz, sx + 2, 6, sz + 2)
        box(bm, cx, height - 18, cz, sx + 2, 5, sz + 2)


add_mesh("trim", M_TRIM, build_trim, 64)


def build_windows(bm):
    for c0, r0, w, h in lots:
        height = lot_height(c0, r0, w, h)
        for n, fc, fr in lot_faces(c0, r0, w, h):
            kind = (fc * 17 + fr * 29) % 5
            if kind == 1:
                continue
            fx = (fc + 0.5) * CELL
            fz = (fr + 0.5) * CELL
            floors = 1 if height < 160 else 2
            for k in range(floors):
                wy = 78 + k * 56
                if n == "n":
                    box(bm, fx, wy, fr * CELL + 1.6, 16, 22, 4)
                elif n == "s":
                    box(bm, fx, wy, (fr + 1) * CELL - 1.6, 16, 22, 4)
                elif n == "w":
                    box(bm, fc * CELL + 1.6, wy, fz, 4, 22, 16)
                else:
                    box(bm, (fc + 1) * CELL - 1.6, wy, fz, 4, 22, 16)


add_mesh("windows", M_DARK, build_windows, 32)


def build_doors(bm):
    for c0, r0, w, h in lots:
        faces = lot_faces(c0, r0, w, h)
        if not faces:
            continue
        n, fc, fr = faces[(c0 + r0) % len(faces)]
        fx = (fc + 0.5) * CELL
        fz = (fr + 0.5) * CELL
        if n == "n":
            box(bm, fx, 24, fr * CELL + 2, 18, 48, 5)
        elif n == "s":
            box(bm, fx, 24, (fr + 1) * CELL - 2, 18, 48, 5)
        elif n == "w":
            box(bm, fc * CELL + 2, 24, fz, 5, 48, 18)
        else:
            box(bm, (fc + 1) * CELL - 2, 24, fz, 5, 48, 18)


add_mesh("doors", M_WOOD, build_doors, 36)


def build_awns(bm):
    for c0, r0, w, h in lots:
        for n, fc, fr in lot_faces(c0, r0, w, h):
            if (fc * 17 + fr * 29) % 5 != 2:
                continue
            fx = (fc + 0.5) * CELL
            fz = (fr + 0.5) * CELL
            if n == "n":
                box(bm, fx, 70, fr * CELL - 8, 30, 3.5, 18)
            elif n == "s":
                box(bm, fx, 70, (fr + 1) * CELL + 8, 30, 3.5, 18)
            elif n == "w":
                box(bm, fc * CELL - 8, 70, fz, 18, 3.5, 30)
            else:
                box(bm, (fc + 1) * CELL + 8, 70, fz, 18, 3.5, 30)


add_mesh("awns", M_AWN, build_awns, 40)


def build_landmarks(bm):
    sphere(bm, 5.2 * CELL, 210, 16.5 * CELL, 58, 14, 9, 0.78)
    cyl(bm, 5.2 * CELL, 168, 16.5 * CELL, 44, 44, 36, 12)
    cyl(bm, 3.6 * CELL, 150, 15.2 * CELL, 10, 8, 280, 10)
    sphere(bm, 3.6 * CELL, 300, 15.2 * CELL, 14, 10, 8)
    ax, az = 41.5 * CELL, 17.2 * CELL
    box(bm, ax - 36, 64, az, 16, 128, 24)
    box(bm, ax + 36, 64, az, 16, 128, 24)
    box(bm, ax, 136, az, 88, 18, 28)
    box(bm, 23.5 * CELL, 96, 21 * CELL, 22, 192, 22)


add_mesh("landmarks", M_WHITE, build_landmarks, 80)


def build_palms(bm):
    for c, r in [(38, 16), (42, 27), (6, 16), (10, 27), (22, 7), (26, 34), (40, 10), (8, 10)]:
        x, z = c * CELL, r * CELL
        cyl(bm, x, 64, z, 6, 4.2, 128, 8)


add_mesh("palm_trunks", M_TRUNK, build_palms, 36)


def build_leaves(bm):
    for c, r in [(38, 16), (42, 27), (6, 16), (10, 27), (22, 7), (26, 34), (40, 10), (8, 10)]:
        x, z = c * CELL, r * CELL
        for i in range(7):
            ang = i / 7 * math.pi * 2
            box(bm, x + math.cos(ang) * 16, 132, z + math.sin(ang) * 16, 8, 3.5, 44, ang)


add_mesh("palm_leaves", M_LEAF, build_leaves, 24)


def build_poles(bm):
    for c, r in [(23.5, 8), (23.5, 21), (39.5, 18), (8.5, 18), (41, 31), (7, 31), (12, 10), (36, 10)]:
        x, z = c * CELL, r * CELL
        cyl(bm, x, 100, z, 3.0, 2.6, 200, 8)
        box(bm, x, 196, z, 40, 3.5, 5)


add_mesh("poles", M_WOOD, build_poles, 36)


def build_wood_props(bm):
    for o in crates:
        if o["mat"] != 0:
            continue
        x = (o["c"] + 0.5) * CELL
        z = (o["r"] + 0.5) * CELL
        h = o["h"]
        s = CELL - 10
        box(bm, x, h * 0.5, z, s, h, s)
        box(bm, x, h * 0.72, z, s + 3, 6, s + 3)


add_mesh("crates_wood", M_WOOD, build_wood_props, 36)


def build_metal_props(bm):
    for o in crates:
        x = (o["c"] + 0.5) * CELL
        z = (o["r"] + 0.5) * CELL
        h = o["h"]
        s = CELL - 10
        if o["mat"] == 2:
            cyl(bm, x, (h - 4) * 0.5, z, CELL * 0.28, CELL * 0.3, h - 4, 12)
        elif o["mat"] == 1:
            box(bm, x, h * 0.5, z, s, h, s)


add_mesh("crates_metal", M_METAL, build_metal_props, 32)


def build_stone_props(bm):
    for o in crates:
        if o["mat"] != 3:
            continue
        x = (o["c"] + 0.5) * CELL
        z = (o["r"] + 0.5) * CELL
        h = o["h"]
        s = CELL - 10
        box(bm, x, h * 0.5, z, s, h, s)


add_mesh("crates_stone", M_CURB, build_stone_props, 48)


def build_signs(bm):
    box(bm, 42.4 * CELL, 86, 18.08 * CELL, 36, 36, 4)
    box(bm, 5.6 * CELL, 86, 18.08 * CELL, 36, 36, 4)
    box(bm, 42.4 * CELL, 86, 18.12 * CELL, 20, 20, 3)
    box(bm, 5.6 * CELL, 86, 18.12 * CELL, 20, 20, 3)


add_mesh("signs", M_RUST, build_signs, 32)

LIMIT = 22000
for ob in bpy.data.objects:
    if ob.type != "MESH" or not ob.data.vertices:
        continue
    xs = [v.co.x for v in ob.data.vertices]
    ys = [v.co.y for v in ob.data.vertices]
    zs = [v.co.z for v in ob.data.vertices]
    span = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    if max(span) > LIMIT:
        raise RuntimeError("mesh %s exploded: span=%s min=(%s,%s,%s) max=(%s,%s,%s)" % (
            ob.name, span, min(xs), min(ys), min(zs), max(xs), max(ys), max(zs),
        ))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
)
