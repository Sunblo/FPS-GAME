import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AnimationClip, Object3D } from 'three';

const SOLDIER_URL = '/models/soldier.glb';
const SOLDIER_ALBEDO = '/models/vanguard_vanguard_diffuse_tga.jpg';
const SOLDIER_NORMAL = '/models/file2.jpg';

export const WEAPON_FILES: Record<string, string> = {
  knife: '/models/weapons/knife.glb',
  vireo: '/models/weapons/pistol.glb',
  warden: '/models/weapons/pistol.glb',
  talon: '/models/weapons/revolver.glb',
  marauder: '/models/weapons/smg.glb',
  skitter: '/models/weapons/smg.glb',
  breacher: '/models/weapons/shotgun.glb',
  vanguard: '/models/weapons/rifle.glb',
  sentinel: '/models/weapons/rifle.glb',
  sparrow: '/models/weapons/sniper.glb',
  leviathan: '/models/weapons/sniper.glb',
  bulwark: '/models/weapons/rifle.glb',
  flash: '/models/weapons/grenade-a.glb',
  frag: '/models/weapons/grenade-b.glb',
  smoke: '/models/weapons/grenade-a.glb',
  fire: '/models/weapons/grenade-b.glb',
  decoy: '/models/weapons/grenade-a.glb',
};

export interface SoldierTemplate {
  scene: Object3D;
  clips: AnimationClip[];
}

export interface WeaponTemplate {
  scene: Object3D;
  clips: AnimationClip[];
}

export interface AssetLib {
  soldier: SoldierTemplate;
  weapons: Map<string, WeaponTemplate>;
  map: Object3D | null;
}

// Some source models are authored on a different local axis than the game
// expects (barrel along -Z, up +Y). Rotate those back into place here.
export const WEAPON_MODEL_YAW: Record<string, number> = {
  vireo: Math.PI / 2,
  warden: Math.PI / 2,
};

export function weaponYaw(id: string): number {
  return WEAPON_MODEL_YAW[id] ?? 0;
}

let lib: AssetLib | null = null;
let pending: Promise<AssetLib> | null = null;

function loader(): GLTFLoader {
  return new GLTFLoader();
}

function loadGltf(url: string): Promise<{ scene: Object3D; clips: AnimationClip[] }> {
  return new Promise((resolve, reject) => {
    loader().load(
      url,
      (gltf) => {
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = false;
            m.receiveShadow = false;
            m.frustumCulled = false;
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) {
              prepareMaterial(mat as THREE.MeshStandardMaterial);
            }
          }
        });
        resolve({ scene: gltf.scene, clips: gltf.animations ?? [] });
      },
      undefined,
      reject,
    );
  });
}

function prepareMaterial(std: THREE.MeshStandardMaterial): void {
  if (!std) return;
  if (std.map) {
    std.map.colorSpace = THREE.SRGBColorSpace;
    std.map.flipY = false;
    std.map.needsUpdate = true;
  }
  if (std.normalMap) {
    std.normalMap.colorSpace = THREE.NoColorSpace;
    std.normalMap.flipY = false;
    std.normalMap.needsUpdate = true;
  }
  if (std.emissiveMap) {
    std.emissiveMap.colorSpace = THREE.SRGBColorSpace;
    std.emissiveMap.flipY = false;
  }
  std.side = THREE.FrontSide;
}

function loadTexture(url: string, colorSpace: THREE.ColorSpace): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.colorSpace = colorSpace;
        t.flipY = false;
        t.needsUpdate = true;
        resolve(t);
      },
      undefined,
      reject,
    );
  });
}

async function paintSoldier(scene: Object3D): Promise<void> {
  const [albedo, normal] = await Promise.all([
    loadTexture(SOLDIER_ALBEDO, THREE.SRGBColorSpace),
    loadTexture(SOLDIER_NORMAL, THREE.NoColorSpace),
  ]);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of list) {
      const std = mat as THREE.MeshStandardMaterial;
      std.map = albedo;
      std.normalMap = normal;
      std.normalScale.set(1, 1);
      std.color.set(0xffffff);
      std.emissive.set(0x000000);
      std.metalness = 0.12;
      std.roughness = 0.62;
      std.needsUpdate = true;
    }
  });
}

export function cloneObject(src: Object3D): Object3D {
  return cloneSkinned(src);
}

export function wrapWeapon(model: Object3D, length: number, yaw = 0): THREE.Group {
  const wrap = new THREE.Group();
  const inner = new THREE.Group();
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  inner.add(model);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  inner.scale.setScalar(length / longest);
  inner.rotation.y = yaw;
  wrap.add(inner);
  wrap.userData.gunLength = length;
  return wrap;
}

export function fitWeapon(src: Object3D, length: number, yaw = 0): THREE.Group {
  return wrapWeapon(cloneObject(src), length, yaw);
}

export async function loadAssets(): Promise<AssetLib> {
  if (lib) return lib;
  if (pending) return pending;
  pending = (async () => {
    try {
      const soldier = await loadGltf(SOLDIER_URL);
      await paintSoldier(soldier.scene);
      const weapons = new Map<string, WeaponTemplate>();
      const unique = [...new Set(Object.values(WEAPON_FILES))];
      const loaded = await Promise.all(unique.map(async (url) => {
        try {
          const g = await loadGltf(url);
          return [url, { scene: g.scene, clips: g.clips }] as const;
        } catch {
          return null;
        }
      }));
      const byUrl = new Map(loaded.filter((x): x is readonly [string, WeaponTemplate] => x !== null));
      for (const [id, url] of Object.entries(WEAPON_FILES)) {
        const src = byUrl.get(url);
        if (src) weapons.set(id, src);
      }
      let map: Object3D | null = null;
      try {
        const m = await loadGltf('/models/reactor09.glb');
        map = m.scene;
      } catch {
        map = null;
      }
      lib = { soldier: { scene: soldier.scene, clips: soldier.clips }, weapons, map };
      return lib;
    } catch (err) {
      pending = null;
      throw err;
    }
  })();
  return pending;
}

export function getAssets(): AssetLib | null {
  return lib;
}
