import * as THREE from 'three';
import { cloneObject, getAssets, type SoldierTemplate } from './assets.ts';

export interface CharOpts {
  team: number;
  seed: number;
}

export interface RigPose {
  move: number;
  duck: number;
  pitch: number;
  fire: number;
  phase: number;
  using?: number;
}

export interface CharRig {
  group: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  update(pose: RigPose, dt: number): void;
  setWeapon(obj: THREE.Object3D | null): void;
}

const TARGET_HEIGHT = 72;

function findClip(clips: THREE.AnimationClip[], names: string[]): THREE.AnimationClip | null {
  const lower = clips.map((c) => ({ c, n: c.name.toLowerCase() }));
  for (const want of names) {
    const hit = lower.find((x) => x.n === want || x.n.includes(want));
    if (hit) return hit.c;
  }
  return clips[0] ?? null;
}

function findBone(root: THREE.Object3D, names: string[]): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (found) return;
    const n = o.name.toLowerCase();
    for (const want of names) {
      if (n === want || n.endsWith(want)) { found = o; return; }
    }
  });
  return found;
}

function tintTeam(root: THREE.Object3D, team: number, seed: number): void {
  const accent = new THREE.Color(team === 2 ? 0x57c8ff : 0xff7a3c);
  const shade = 0.96 + seed * 0.06;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material;
    const list = Array.isArray(src) ? src : [src];
    const cloned = list.map((m) => {
      const c = (m as THREE.Material).clone() as THREE.MeshStandardMaterial;
      if (c.color) c.color.multiplyScalar(shade);
      if (c.emissive) {
        c.emissive.copy(accent);
        c.emissiveIntensity = 0.08;
      }
      if (c.map) {
        c.map.colorSpace = THREE.SRGBColorSpace;
        c.map.flipY = false;
      }
      if (c.normalMap) {
        c.normalMap.colorSpace = THREE.NoColorSpace;
        c.normalMap.flipY = false;
      }
      c.side = THREE.FrontSide;
      c.needsUpdate = true;
      return c;
    });
    mesh.material = Array.isArray(src) ? cloned : cloned[0];
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const sk = o as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh) sk.frustumCulled = false;
  });
}

export function makeCharacter(opts: CharOpts): CharRig {
  const assets = getAssets();
  const group = new THREE.Group();
  if (!assets) return emptyRig(group);

  const tpl: SoldierTemplate = assets.soldier;
  const model = cloneObject(tpl.scene);
  model.updateMatrixWorld(true);
  tintTeam(model, opts.team, opts.seed);

  const wrap = new THREE.Group();
  wrap.add(model);
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrap);
  const size = box.getSize(new THREE.Vector3());
  const h = size.y || 1.8;
  const s = TARGET_HEIGHT / h;
  wrap.scale.setScalar(s);
  wrap.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(wrap);
  wrap.position.y -= box2.min.y;
  group.add(wrap);

  const mixer = new THREE.AnimationMixer(model);
  const idleClip = findClip(tpl.clips, ['idle']);
  const walkClip = findClip(tpl.clips, ['walk']);
  const runClip = findClip(tpl.clips, ['run']);
  const idle = idleClip ? mixer.clipAction(idleClip) : null;
  const walk = walkClip ? mixer.clipAction(walkClip) : null;
  const run = runClip ? mixer.clipAction(runClip) : null;
  for (const a of [idle, walk, run]) {
    if (!a) continue;
    a.enabled = true;
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.play();
    a.setEffectiveWeight(0);
  }
  if (idle) idle.setEffectiveWeight(1);

  const rightHand = findBone(model, ['mixamorig:righthand', 'righthand', 'hand_r']);
  const weaponHold = new THREE.Group();
  const parentS = s * Math.abs(model.scale.x || 0.01);
  weaponHold.scale.setScalar(1 / Math.max(parentS, 1e-6));
  if (rightHand) {
    rightHand.add(weaponHold);
    weaponHold.rotation.set(Math.PI / 2, 0, 0);
    weaponHold.position.set(0, 6, 2);
  } else {
    wrap.add(weaponHold);
    weaponHold.position.set(10, 48, -16);
  }

  let currentGun: THREE.Object3D | null = null;
  let wIdle = 1, wWalk = 0, wRun = 0;

  const update = (pose: RigPose, dt: number): void => {
    mixer.update(dt);
    const moving = THREE.MathUtils.clamp(pose.move, 0, 1);
    const wantIdle = moving < 0.12 ? 1 : 0;
    const wantRun = moving > 0.72 ? 1 : 0;
    const wantWalk = 1 - wantIdle - wantRun;
    const k = 1 - Math.exp(-10 * dt);
    wIdle += (wantIdle - wIdle) * k;
    wWalk += (wantWalk - wWalk) * k;
    wRun += (wantRun - wRun) * k;
    if (idle) idle.setEffectiveWeight(wIdle);
    if (walk) { walk.setEffectiveWeight(wWalk); walk.timeScale = 0.85 + moving * 0.4; }
    if (run) { run.setEffectiveWeight(wRun); run.timeScale = 0.9 + moving * 0.35; }
    group.scale.y = 1 - THREE.MathUtils.clamp(pose.duck, 0, 1) * 0.18;
  };

  const setWeapon = (obj: THREE.Object3D | null): void => {
    if (currentGun) weaponHold.remove(currentGun);
    currentGun = obj;
    if (obj) weaponHold.add(obj);
  };

  return { group, mixer, update, setWeapon };
}

function emptyRig(group: THREE.Group): CharRig {
  const geo = new THREE.CapsuleGeometry(10, 40, 4, 8);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x444444 }));
  mesh.position.y = 30;
  group.add(mesh);
  return {
    group,
    mixer: null,
    update() { /* placeholder until assets load */ },
    setWeapon() { /* noop */ },
  };
}
