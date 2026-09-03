// First-person viewmodel: the weapon you hold, parented to the camera so it
// never lags behind aim. Procedural low-poly guns per category (pointing down
// -Z in camera space), with recoil kick, gentle idle bob/walk sway and team
// accent paint. Original shapes only - no external assets.
import * as THREE from 'three';
import { catOf, UTILITIES } from '../../shared/weapons.ts';

const BODY = 0x232a33;
const DARK = 0x12161c;
const LIGHT = 0x3a434f;
const GRIP = 0x171c22;

function mat(color: number, emissive = 0x000000): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.42, emissive, emissiveIntensity: 0.9 });
}

function B(
  g: THREE.Group, m: THREE.Material,
  x: number, y: number, z: number,
  sx: number, sy: number, sz: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

function cyl(
  g: THREE.Group, m: THREE.Material,
  x: number, y: number, z: number,
  r: number, len: number,
  seg = 10,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m);
  mesh.rotation.x = Math.PI / 2; // axis along Z
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

interface GunKit {
  group: THREE.Group;
  recoil: number; // z push per kick unit
  flip: number; // rotation.x rise per kick unit
  sway: number; // amplitude factor
  kickDur: number;
}

function blank(): GunKit {
  const group = new THREE.Group();
  return { group, recoil: 2.4, flip: 0.05, sway: 1, kickDur: 1 };
}

// Build a stylized weapon silhouette. All coordinates are local to the gun
// grip (0,0,0); the tip points toward -Z (camera forward).
function build(kind: string, id: string, accent: number): GunKit {
  const k = blank();
  const g = k.group;
  const body = mat(BODY);
  const dark = mat(DARK);
  const light = mat(LIGHT);
  const paint = mat(accent, accent);
  const grip = mat(GRIP);

  switch (kind) {
    case 'melee': {
      k.recoil = 0; k.flip = 0; k.sway = 0.7;
      B(g, dark, 0, 0, -1, 2.4, 3, 8); // handle
      B(g, grip, 0, -0.4, 1.6, 2.6, 3.2, 3);
      const blade = B(g, light, 0, 0, -10, 1.6, 1.6, 19);
      blade.rotation.x = 0;
      B(g, paint, 0, 0.9, -13, 0.8, 0.8, 8); // spine glow
      break;
    }
    case 'pistol': {
      k.recoil = 1.6; k.flip = 0.042; k.sway = 0.85;
      B(g, dark, 0, 0.4, -4, 3.4, 3, 9); // slide
      B(g, body, 0, -0.9, -3, 3.2, 2.6, 8); // frame
      B(g, paint, 0, 0.9, -6, 2, 1, 6); // top accent
      B(g, grip, -0.3, -3.4, 1, 2.8, 5, 3.4); // grip (tilted look via offset)
      B(g, light, -0.3, -1.6, 2.1, 2.2, 2.4, 1.6);
      B(g, dark, 0, 0.4, -9.5, 1.7, 1.8, 2.4); // muzzle block
      break;
    }
    case 'smg': {
      k.recoil = 1.7; k.flip = 0.045; k.sway = 1.1;
      B(g, dark, 0, 0.3, -6, 3.2, 3.6, 12); // receiver
      B(g, body, 0, -1, -4, 3, 2.4, 10); // frame
      B(g, grip, 0, -3.4, -3.4, 2.6, 5.4, 3); // mag grip front
      B(g, dark, 0, -5.2, -4.6, 2.2, 3.4, 2.6); // magazine
      B(g, paint, 0, 1.4, -8, 1.4, 0.9, 8);
      B(g, light, 0, 0.3, -14.4, 2.2, 2.4, 3.6); // barrel shroud
      B(g, grip, 0, -2.2, 1.2, 2.2, 3, 2.2); // rear grip
      B(g, dark, 0, 0.3, -17.6, 1.5, 1.6, 2.6); // tip
      break;
    }
    case 'rifle': {
      k.recoil = 2.3; k.flip = 0.05; k.sway = 0.95;
      B(g, dark, 0, 0, -9, 3.6, 4.2, 14); // receiver
      B(g, light, 0, -0.4, -16, 3.4, 3.6, 10); // handguard
      B(g, dark, 0, 0.2, -28, 2, 2.2, 16); // barrel
      B(g, paint, 0, 0.2, -31, 1.4, 1.5, 3); // muzzle brake
      B(g, body, 0, -2.2, 1.4, 3, 3.2, 6); // stock base
      B(g, dark, 0, -2.6, -0.4, 3.4, 2, 12); // stock
      B(g, grip, 0, -4.2, -3, 2.8, 4.6, 3.2); // pistol grip
      B(g, dark, 0, -6.4, -7, 2.4, 5.4, 3); // magazine
      B(g, paint, 0, -6.4, -7, 1.4, 5, 1.2); // mag accent
      B(g, dark, 0, 0, 2.4, 1, 1.6, 8); // sight rail
      B(g, paint, 0, 0, 3.1, 0.8, 0.8, 5); // sight post
      break;
    }
    case 'sniper': {
      k.recoil = 3.4; k.flip = 0.075; k.sway = 0.7;
      B(g, dark, 0, -0.6, -12, 3.4, 4, 16); // receiver
      B(g, dark, 0, -0.8, -26, 2.2, 2.4, 22); // barrel
      B(g, light, 0, -0.8, -38, 1.9, 2, 6); // muzzle brake
      cyl(g, dark, 0, 1.8, -12, 2.2, 12, 8); // scope tube
      cyl(g, paint, 0, 1.8, -9, 1.2, 5, 8); // scope lens ring
      B(g, body, 0, -2.8, -6, 3.2, 3, 8); // stock body
      B(g, dark, 0, -3.4, 0.6, 3.2, 3, 12); // stock
      B(g, grip, 0, -4.6, -6, 2.8, 4.8, 3.2); // grip
      B(g, dark, 0, -6, -9, 2.2, 4.8, 3); // mag
      B(g, grip, 0, -3, -17, 2.2, 2.6, 5); // front grip under barrel
      break;
    }
    case 'shotgun': {
      k.recoil = 3; k.flip = 0.09; k.sway = 1.0;
      B(g, dark, 0, -0.2, -10, 3.6, 4.4, 12); // receiver
      B(g, body, 0, -0.6, -20, 3.2, 3.6, 16); // tube
      B(g, dark, 0, -0.2, -31, 2.6, 2.8, 8); // barrel tip
      B(g, light, 0, -0.6, -20, 3.4, 4.4, 6); // pump grip
      B(g, grip, 0, -0.6, -20, 2.4, 5.2, 4); // pump middle
      B(g, body, 0, -2.6, -3, 3.2, 3, 6); // stock
      B(g, dark, 0, -3, 0.8, 2.8, 3, 4); // stock end
      B(g, grip, 0, -3.6, -4, 2.8, 4, 3); // pistol grip
      B(g, paint, 0, 0.4, -24, 1, 1, 10); // heat line
      break;
    }
    case 'lmg': {
      k.recoil = 2; k.flip = 0.04; k.sway = 1.25;
      B(g, dark, 0, 0.2, -10, 4, 4.6, 16); // receiver
      B(g, light, 0, -0.4, -20, 3.8, 4, 12); // shroud
      B(g, dark, 0, 0, -33, 2.2, 2.4, 16); // heavy barrel
      B(g, body, 0, -2.6, 0.6, 3.4, 3, 10); // stock
      B(g, grip, 0, -4.4, -6, 3, 5, 3.4); // grip
      B(g, dark, 0, 0, -8.4, 5, 7, 6); // box/drum mag
      B(g, paint, 0, 0, -8.4, 3, 3, 3.4); // drum core
      B(g, dark, 0, 1.6, -1, 1, 3, 5); // side assist
      B(g, paint, 0, 1.4, -14, 1.6, 1, 14); // top rail
      break;
    }
    default: { // utilities - grenades in hand
      k.recoil = 0.4; k.flip = 0.01; k.sway = 1.3;
      const u = UTILITIES[id];
      const col = u?.kind === 'flash' ? 0xdfe7f0
        : u?.kind === 'frag' ? 0x4a5140
        : u?.kind === 'smoke' ? 0x767d85
        : u?.kind === 'fire' ? 0xc2562a
        : 0x2b6a8c;
      const s = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 10), mat(col, col));
      s.position.set(0, 0, -6);
      g.add(s);
      const pin = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 2), mat(accent, accent));
      pin.position.set(0, 2.6, -4);
      g.add(pin);
      B(g, grip, 0, -3, -1, 2.2, 3.4, 3);
      break;
    }
  }
  // long guns read oversized right in front of the eye; pull them in a touch
  const s = kind === 'sniper' ? 0.8
    : kind === 'rifle' || kind === 'lmg' || kind === 'shotgun' ? 0.85
    : kind === 'smg' ? 0.9
    : kind === 'pistol' ? 0.95
    : 1;
  if (s !== 1) g.scale.setScalar(s);
  return k;
}

function kindOf(w: string): string {
  const c = catOf(w);
  if (c === 'utility') return 'util';
  return c;
}

export interface VmHandle {
  root: THREE.Group;
  setWeapon(w: string, team: number): void;
  current(): string;
  update(dt: number, opts: { speed: number; duck: number; alive: boolean; using: boolean }): void;
  kick(power: number): void;
}

const PX = 5.4, PY = -6.6, PZ = -13;

export function buildViewModel(): VmHandle {
  const root = new THREE.Group();
  root.position.set(PX, PY, PZ);
  const anim = new THREE.Group();
  root.add(anim);

  const cache = new Map<string, GunKit>();
  let cur = '';
  let team = 1;
  let kickT = 0; // normalized remaining kick energy
  let phase = 0;
  let swayT = 0;

  const accent = () => (team === 2 ? 0x57c8ff : 0xff7a3c);

  function setWeapon(w: string, t: number): void {
    if (w === cur && t === team) return;
    team = t;
    cur = w;
    for (const kit of cache.values()) kit.group.visible = false;
    let kit = cache.get(w);
    if (!kit) {
      const kind = kindOf(w);
      kit = build(kind, w, accent());
      cache.set(w, kit);
      anim.add(kit.group);
    }
    kit.group.visible = true;
  }

  function current(): string { return cur; }

  function kick(power: number): void {
    kickT = Math.min(1.4, kickT + power);
  }

  function update(dt: number, o: { speed: number; duck: number; alive: boolean; using: boolean }): void {
    const k = cache.get(cur);
    if (!k) return;
    if (!o.alive || o.using) {
      anim.visible = false;
      return;
    }
    anim.visible = true;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    // walk/idle sway phase
    const moving = clamp01(o.speed / 230);
    phase += dt * (moving > 0.04 ? 3 + moving * 7 : 1.2);
    swayT += dt;
    // recoil decays fast then trails
    const kick = kickT;
    kickT *= Math.exp(-9 * dt);
    if (kickT < 0.002) kickT = 0;

    const bobAmp = moving > 0.04 ? 0.55 * moving : 0.1;
    const bobY = Math.sin(phase * 2.1) * bobAmp;
    const bobX = Math.sin(phase) * 0.32 * moving;
    const bobR = Math.sin(phase * 2.1) * 0.012 * moving;
    // subtle breathing/look sway
    const s = Math.sin(swayT * 1.4) * 0.02;
    const s2 = Math.sin(swayT * 0.9 + 1.3) * 0.018;

    const upDown = o.duck ? -1.1 : 0; // weapon sits lower when crouched
    const kickZ = kick * k.recoil;
    const kickR = kick * k.flip;

    anim.position.set(bobX + s2, bobY + upDown + s, kickZ);
    anim.rotation.set(bobR - 0.02 + kickR, s2 * 0.4, -0.012 + Math.sin(phase) * 0.006);
  }

  return { root, setWeapon, current, update, kick };
}
