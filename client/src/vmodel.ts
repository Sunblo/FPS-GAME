import * as THREE from 'three';
import { catOf } from '../../shared/weapons.ts';
import { cloneObject, getAssets, WEAPON_FILES, weaponYaw, wrapWeapon } from './assets.ts';

interface GunKit {
  group: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  fire: THREE.AnimationAction | null;
  reloadAct: THREE.AnimationAction | null;
  recoil: number;
  flip: number;
}

export interface VmHandle {
  root: THREE.Group;
  setWeapon(w: string, team: number): void;
  current(): string;
  update(dt: number, opts: { speed: number; duck: number; alive: boolean; using: boolean; aim?: number; reload?: number }): void;
  kick(power: number): void;
  reload(dur: number): void;
}

const PX = 4.6, PY = -3.5, PZ = -9.4;

function vmLength(kind: string): number {
  if (kind === 'melee') return 3.2;
  if (kind === 'pistol') return 3.6;
  if (kind === 'utility') return 1.8;
  if (kind === 'smg') return 4.8;
  if (kind === 'shotgun') return 5.6;
  if (kind === 'sniper' || kind === 'lmg') return 6.4;
  return 5.4;
}

function clipFor(clips: THREE.AnimationClip[], tag: string): THREE.AnimationClip | null {
  return clips.find((c) => c.name.toLowerCase().includes(tag)) ?? null;
}

function kitFor(id: string): GunKit {
  const assets = getAssets();
  const kind = catOf(id);
  const fallback = Object.keys(WEAPON_FILES)[0];
  const tpl = assets?.weapons.get(id) ?? assets?.weapons.get(fallback);

  let group: THREE.Group;
  let mixer: THREE.AnimationMixer | null = null;
  let fire: THREE.AnimationAction | null = null;
  let reloadAct: THREE.AnimationAction | null = null;

  if (tpl) {
    const model = cloneObject(tpl.scene);
    group = wrapWeapon(model, vmLength(kind), weaponYaw(id));
    if (kind === 'utility') {
      group.rotation.x = 0.28;
      group.position.y -= 0.6;
    }
    const fireClip = clipFor(tpl.clips, 'fire');
    const reloadClip = clipFor(tpl.clips, 'reload');
    if (fireClip || reloadClip) {
      mixer = new THREE.AnimationMixer(model);
      if (fireClip) {
        fire = mixer.clipAction(fireClip);
        fire.setLoop(THREE.LoopOnce, 1);
        fire.clampWhenFinished = true;
      }
      if (reloadClip) {
        reloadAct = mixer.clipAction(reloadClip);
        reloadAct.setLoop(THREE.LoopOnce, 1);
        reloadAct.clampWhenFinished = true;
      }
    }
  } else {
    group = new THREE.Group();
  }

  // procedural recoil is dialled back when the model supplies its own fire clip
  const hasFire = fire !== null;
  const recoil = (kind === 'shotgun' || kind === 'sniper' ? 3.2
    : kind === 'rifle' ? 2.2
    : kind === 'pistol' ? 1.5
    : kind === 'melee' ? 0.4
    : 1.8) * (hasFire ? 0.45 : 1);
  const flip = (kind === 'shotgun' || kind === 'sniper' ? 0.08 : 0.045) * (hasFire ? 0.5 : 1);
  return { group, mixer, fire, reloadAct, recoil, flip };
}

export function buildViewModel(): VmHandle {
  const root = new THREE.Group();
  root.position.set(PX, PY, PZ);
  const anim = new THREE.Group();
  root.add(anim);

  const cache = new Map<string, GunKit>();
  let cur = '';
  let team = 1;
  let kickT = 0;
  let phase = 0;
  let swayT = 0;

  function setWeapon(w: string, t: number): void {
    if (w === cur && t === team) return;
    team = t;
    cur = w;
    for (const kit of cache.values()) kit.group.visible = false;
    let kit = cache.get(w);
    if (!kit) {
      kit = kitFor(w);
      cache.set(w, kit);
      anim.add(kit.group);
    }
    kit.group.visible = true;
  }

  function current(): string { return cur; }

  function kick(power: number): void {
    kickT = Math.min(1.4, kickT + power);
    const k = cache.get(cur);
    if (k?.fire) {
      k.fire.reset();
      k.fire.setEffectiveWeight(1);
      k.fire.play();
    }
  }

  function reload(dur: number): void {
    const k = cache.get(cur);
    if (k?.reloadAct) {
      const clip = k.reloadAct.getClip();
      k.reloadAct.reset();
      k.reloadAct.timeScale = clip.duration / Math.max(dur, 0.05);
      k.reloadAct.setEffectiveWeight(1);
      k.reloadAct.play();
    }
  }

  function update(dt: number, o: { speed: number; duck: number; alive: boolean; using: boolean; aim?: number; reload?: number }): void {
    const k = cache.get(cur);
    if (!k) return;
    if (!o.alive || o.using) {
      anim.visible = false;
      return;
    }
    anim.visible = true;
    if (k.mixer) k.mixer.update(dt);

    const moving = Math.max(0, Math.min(1, o.speed / 230));
    phase += dt * (moving > 0.04 ? 3 + moving * 7 : 1.2);
    swayT += dt;
    const kick = kickT;
    kickT *= Math.exp(-9 * dt);
    if (kickT < 0.002) kickT = 0;

    // aim: 0 = hip fire (gun low-right), 1 = sights up / scope centered
    const aim = Math.max(0, Math.min(1, o.aim ?? 0));
    const hipK = 1 - aim;
    // procedural reload pose only stands in when the model has no reload clip
    const rl = k.reloadAct ? 0 : Math.max(0, Math.min(1, o.reload ?? 0));

    const bobAmp = (moving > 0.04 ? 0.55 * moving : 0.1) * hipK;
    const bobY = Math.sin(phase * 2.1) * bobAmp;
    const bobX = Math.sin(phase) * 0.32 * moving * hipK;
    const bobR = Math.sin(phase * 2.1) * 0.012 * moving * hipK;
    const s = Math.sin(swayT * 1.4) * 0.02 * hipK;
    const s2 = Math.sin(swayT * 0.9 + 1.3) * 0.018 * hipK;
    const upDown = o.duck ? -1.1 : 0;

    // pull the weapon toward the centre of the screen when aiming down sights
    const adsX = -PX * aim;
    const adsY = 1.5 * aim;
    const adsZ = -2.4 * aim;

    anim.position.set(
      bobX + s2 + adsX,
      bobY + (upDown + s) * hipK + adsY - rl * 1.7,
      kick * k.recoil * hipK + adsZ + rl * 1.1,
    );
    anim.rotation.set(
      bobR - 0.02 * hipK + kick * k.flip * hipK - rl * 0.55,
      s2 * 0.4,
      (-0.012 + Math.sin(phase) * 0.006) * hipK + rl * 0.4,
    );
  }

  return { root, setWeapon, current, update, kick, reload };
}
