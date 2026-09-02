// Procedural rigged characters: a real bone skeleton + SkinnedMesh so players
// read as animated soldiers (walk cycle, crouch, aim lean) instead of capsules.
//
// Scale follows the game's units: an actor is ~80 units tall with eye height 64.
// forward = -Z, up = +Y. Everything is generated at runtime - no external assets.
//
// Skinning notes (three r166, AttachedBindMode): bone matrices passed to the
// shader are bone.matrixWorld * boneInverse, and bindMatrixInverse is re-derived
// from the live mesh.matrixWorld every frame. At rest that product is identity,
// so geometry must be authored in the SAME actor space the bones rest in - the
// bake below emits vertices at their final rest positions and each vertex simply
// follows its owning bone's joint frame when posed.
import * as THREE from 'three';

export interface CharOpts {
  team: number; // 1 = Attack(orange), 2 = Defend(blue)
  seed: number; // 0..1 clothing/shade variation
}

export interface RigPose {
  move: number; // 0..1 how hard the actor is moving
  duck: number; // 0..1
  pitch: number; // view pitch (radians, + = looking up)
  fire: number; // recoil impulse 0..1 decays over time
  phase: number; // walk cycle phase accumulator (radians)
}

export interface CharRig {
  group: THREE.Group;
  skinned: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  torso: THREE.Bone;
  thighL: THREE.Bone;
  thighR: THREE.Bone;
  shinL: THREE.Bone;
  shinR: THREE.Bone;
  update(pose: RigPose): void;
}

// bone rest joint heights (actor space, feet at y=0)
const PELVIS = 32; // hip line
const CHEST = 54; // shoulders line
const HEAD = 66; // eye-ish line
const KNEE = 17;
const HIPX = 7;

const T_ACC = 0xff7a3c; // attack accent (orange)
const D_ACC = 0x57c8ff; // defend accent (cyan)
const UNIFORM_BASE = 0x2b3038;
const BOOT = 0x171a1f;
const SKIN = 0xcfae8a;

// full-crouch shrinks the body enough to drop the eye line 64 -> 46 like the sim
const DUCK_SHRINK = 0.28;

interface Part {
  bone: THREE.Bone;
  center: [number, number, number]; // abs rest (actor space)
  size: [number, number, number];
  color: number;
  kind?: 'box' | 'sphere';
}

export function makeCharacter(opts: CharOpts): CharRig {
  const accent = opts.team === 2 ? D_ACC : T_ACC;
  // subtle shade variation so teammates don't all look identical
  const tint = (base: number, amt: number): number => {
    const c = new THREE.Color(base);
    const j = new THREE.Color().setHSL(opts.seed, 0.28, 0.5);
    c.lerp(j, amt * 0.22);
    return c.getHex();
  };
  const navy = tint(UNIFORM_BASE, opts.seed);

  // ---- skeleton -----------------------------------------------------------
  // Joints live at real actor-space joints (hip, shoulder, knee). Each bone's
  // frame origin is the joint it pivots around, so weighted geometry swings
  // around the correct place when posed.
  const pelvis = bone(PELVIS);
  const torso = bone(CHEST);
  torso.position.y = CHEST - PELVIS;
  const head = bone(HEAD);
  head.position.y = HEAD - CHEST;

  const thighL = bone(PELVIS);
  thighL.position.set(-HIPX, 0, 0);
  const thighR = bone(PELVIS);
  thighR.position.set(HIPX, 0, 0);
  // knees are directly below the hip joints; children hang straight down
  const shinL = bone(KNEE);
  shinL.position.set(0, KNEE - PELVIS, 0);
  const shinR = bone(KNEE);
  shinR.position.set(0, KNEE - PELVIS, 0);

  torso.add(head);
  pelvis.add(torso);
  pelvis.add(thighL);
  pelvis.add(thighR);
  thighL.add(shinL);
  thighR.add(shinR);
  const allBones = [pelvis, torso, head, thighL, shinL, thighR, shinR];

  // ---- geometry ------------------------------------------------------------
  const B = (name: THREE.Bone) => name;
  const parts: Part[] = [
    // legs (navy uniform + dark boots)
    { bone: B(thighL), center: [-HIPX, (PELVIS + KNEE) / 2, 0], size: [7.2, PELVIS - KNEE, 7.8], color: navy },
    { bone: B(thighR), center: [HIPX, (PELVIS + KNEE) / 2, 0], size: [7.2, PELVIS - KNEE, 7.8], color: navy },
    { bone: B(shinL), center: [-HIPX, KNEE / 2 - 0.5, 0], size: [6, KNEE - 2, 6.6], color: navy },
    { bone: B(shinR), center: [HIPX, KNEE / 2 - 0.5, 0], size: [6, KNEE - 2, 6.6], color: navy },
    { bone: B(shinL), center: [-HIPX, 2, -1.4], size: [5.6, 4, 8.6], color: BOOT },
    { bone: B(shinR), center: [HIPX, 2, -1.4], size: [5.6, 4, 8.6], color: BOOT },
    // knee pads accent
    { bone: B(shinL), center: [-HIPX, 4, 1.5], size: [6.4, 3, 2], color: accent },
    { bone: B(shinR), center: [HIPX, 4, 1.5], size: [6.4, 3, 2], color: accent },
    // pelvis / belt
    { bone: B(pelvis), center: [0, PELVIS, 0], size: [12.6, 8, 9.6], color: navy },
    { bone: B(pelvis), center: [0, PELVIS - 1, -4.2], size: [13.4, 2.4, 1], color: accent },
    // torso (uniform + armor plates)
    { bone: B(torso), center: [0, (PELVIS + CHEST) / 2 + 0.5, 0], size: [15.4, CHEST - PELVIS - 1, 10.2], color: navy },
    { bone: B(torso), center: [0, (PELVIS + CHEST) / 2 + 2.5, -3.4], size: [16.4, 16, 3.6], color: accent },
    // shoulder pads (accent)
    { bone: B(torso), center: [-11.6, CHEST + 0.5, -1], size: [4.6, 3.6, 10], color: accent },
    { bone: B(torso), center: [11.6, CHEST + 0.5, -1], size: [4.6, 3.6, 10], color: accent },
    // arms held forward at "ready" (weighted to torso)
    { bone: B(torso), center: [-11.6, CHEST - 0.5, -8], size: [4.6, 5.4, 16], color: navy },
    { bone: B(torso), center: [11.6, CHEST - 0.5, -8], size: [4.6, 5.4, 16], color: navy },
    { bone: B(torso), center: [-9, CHEST - 1, -20], size: [4.4, 5, 8], color: BOOT },
    { bone: B(torso), center: [8, CHEST - 1, -21], size: [4.4, 5, 8], color: BOOT },
    // head + helmet (front = -Z)
    { bone: B(head), center: [0, 63, 0], size: [7.2, 5, 7.6], color: SKIN, kind: 'sphere' },
    { bone: B(head), center: [0, 68.6, 0], size: [9.4, 6.8, 9.6], color: tint(0x38414d, 0.25), kind: 'sphere' },
    { bone: B(head), center: [0, 72.8, 0], size: [8.8, 2.4, 9], color: navy },
    { bone: B(head), center: [0, 68.2, -4.8], size: [8.8, 7.4, 1.6], color: accent }, // faceplate
    { bone: B(head), center: [0, 64.6, -5.9], size: [6.8, 1.9, 0.8], color: 0x9fe2ff }, // visor slit
    { bone: B(head), center: [0, 70.9, -4.6], size: [9.2, 1.6, 2], color: accent }, // brow band
    { bone: B(head), center: [0, 72.4, 0], size: [4.2, 2.6, 4.2], color: 0x1a1e24 }, // sensor dome
    // radio pack on the back (+Z)
    { bone: B(torso), center: [0, (PELVIS + CHEST) / 2 + 0.5, 5.8], size: [9, 12, 2.6], color: tint(UNIFORM_BASE, 0.35) },
    // rifle in both hands at low-ready, straight ahead (-Z)
    { bone: B(torso), center: [1.6, CHEST - 2.5, -25], size: [3.8, 6.6, 30], color: 0x23272d },
    { bone: B(torso), center: [1.6, CHEST - 2.2, -42], size: [2.6, 3.2, 10], color: 0x3a414b },
    { bone: B(torso), center: [1.6, CHEST - 6.8, -24], size: [3, 7, 3.6], color: BOOT },
  ];

  const { positions, normals, colors, skinIdx } = bakeParts(parts, allBones);
  const verts = positions.length / 3;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // shader reads vec4 skinIndex / skinWeight; single bone per vertex
  const skinIndex = new Float32Array(verts * 4);
  const skinWeight = new Float32Array(verts * 4);
  for (let i = 0; i < verts; i++) {
    skinIndex[i * 4] = skinIdx[i];
    skinWeight[i * 4] = 1;
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.12,
  });
  const mesh = new THREE.SkinnedMesh(geo, mat);

  const group = new THREE.Group();
  group.add(pelvis);
  group.add(mesh);

  // Bake rest-pose bone matrices, then compute bind inverses from them.
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(allBones);
  mesh.bind(skeleton);

  // ---- per-frame posing ----------------------------------------------------
  const update = (pose: RigPose): void => {
    const crouch = THREE.MathUtils.clamp(pose.duck, 0, 1);
    group.scale.y = 1 - crouch * DUCK_SHRINK;

    const speed = THREE.MathUtils.clamp(pose.move, 0, 1);
    const swing = speed * (0.55 + crouch * 0.18);
    const ph = pose.phase;
    const sin = Math.sin(ph);
    const bob = speed * Math.sin(ph * 2) * 0.045;

    // walk cycle: legs swing opposite phases, knees tuck on the back-swing
    thighL.rotation.x = sin * swing + crouch * 0.3;
    thighR.rotation.x = -sin * swing + crouch * 0.3;
    shinL.rotation.x = -Math.max(0, sin) * 0.5 * speed - crouch * 0.55;
    shinR.rotation.x = -Math.max(0, -sin) * 0.5 * speed - crouch * 0.55;

    // aim lean + walk bob + idle breathing on the torso bone (drives the gun too)
    const aimLean = THREE.MathUtils.clamp(pose.pitch, -0.7, 0.7) * 0.45;
    const breathe = speed < 0.04 ? Math.sin(pose.phase * 0.9) * 0.02 : 0;
    torso.rotation.x = aimLean - bob + breathe;

    // recoil kick: brief push on the weapon hand
    const rec = THREE.MathUtils.clamp(pose.fire, 0, 1);
    torso.rotation.x += rec * 0.07;
    torso.position.z = rec * 1.6;
  };

  return { group, skinned: mesh, bones: allBones, torso, thighL, thighR, shinL, shinR, update };
}

function bone(y: number): THREE.Bone {
  const b = new THREE.Bone();
  b.position.set(0, y, 0);
  return b;
}

// ---- geometry baking ----------------------------------------------------------
// Vertices are emitted at their final rest position in actor space (feet at
// y=0). Each triangle is flat-shaded via a real cross product and tagged with
// the bone index that drives it. Only 1 of 4 skin weights is nonzero, so a
// vertex moves rigidly with its joint frame when posed.
function bakeParts(parts: Part[], bones: THREE.Bone[]) {
  const boneOf = (b: THREE.Bone) => bones.indexOf(b);
  const posAll: number[] = [];
  const nrmAll: number[] = [];
  const colAll: number[] = [];
  const skinIdx: number[] = [];

  const cross = (a: number[], b: number[], c: number[]): [number, number, number] => {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };

  const pushTri = (boneIdx: number, color: number, v0: number[], v1: number[], v2: number[]) => {
    const n = cross(v0, v1, v2);
    const c = new THREE.Color(color);
    for (const v of [v0, v1, v2]) {
      posAll.push(v[0], v[1], v[2]);
      nrmAll.push(n[0], n[1], n[2]);
      skinIdx.push(boneIdx);
      colAll.push(c.r, c.g, c.b);
    }
  };

  const boxTris = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): [number[], number[], number[]][] => {
    const X = sx / 2, Y = sy / 2, Z = sz / 2;
    const p = (dx: number, dy: number, dz: number) => [cx + dx, cy + dy, cz + dz];
    const quad = (a: number[], b: number[], cc: number[], d: number[]) => [[a, b, cc], [a, cc, d]] as [number[], number[], number[]][];
    const faces: [number[], number[], number[]][] = [];
    faces.push(...quad(p(X, -Y, -Z), p(X, Y, -Z), p(X, Y, Z), p(X, -Y, Z)));
    faces.push(...quad(p(-X, -Y, Z), p(-X, Y, Z), p(-X, Y, -Z), p(-X, -Y, -Z)));
    faces.push(...quad(p(-X, Y, -Z), p(X, Y, -Z), p(X, Y, Z), p(-X, Y, Z)));
    faces.push(...quad(p(-X, -Y, Z), p(X, -Y, Z), p(X, -Y, -Z), p(-X, -Y, -Z)));
    faces.push(...quad(p(X, -Y, Z), p(X, Y, Z), p(-X, Y, Z), p(-X, -Y, Z)));
    faces.push(...quad(p(-X, -Y, -Z), p(-X, Y, -Z), p(X, Y, -Z), p(X, -Y, -Z)));
    return faces;
  };

  for (const part of parts) {
    const boneIdx = boneOf(part.bone);
    const [cx, cy, cz] = part.center;
    const rx = part.size[0] / 2, ry = part.size[1] / 2, rz = part.size[2] / 2;

    if (part.kind === 'sphere') {
      const seg = 10;
      for (let i = 0; i < seg; i++) {
        const th0 = (i / seg) * Math.PI, th1 = ((i + 1) / seg) * Math.PI;
        for (let j = 0; j < seg; j++) {
          const ph0 = (j / seg) * Math.PI * 2, ph1 = ((j + 1) / seg) * Math.PI * 2;
          const P = (th: number, ph: number) => [
            cx + rx * Math.sin(th) * Math.cos(ph),
            cy + ry * Math.cos(th),
            cz + rz * Math.sin(th) * Math.sin(ph),
          ];
          const p00 = P(th0, ph0), p01 = P(th0, ph1), p10 = P(th1, ph0), p11 = P(th1, ph1);
          pushTri(boneIdx, part.color, p00, p10, p11);
          pushTri(boneIdx, part.color, p00, p11, p01);
        }
      }
      continue;
    }

    const tris = boxTris(cx, cy, cz, part.size[0], part.size[1], part.size[2]);
    for (const tri of tris) pushTri(boneIdx, part.color, tri[0], tri[1], tri[2]);
  }
  return {
    positions: new Float32Array(posAll),
    normals: new Float32Array(nrmAll),
    colors: new Float32Array(colAll),
    skinIdx,
  };
}
