// Three.js scene for AXIOM SIEGE. Renders REACTOR-09 as a Dust II-inspired
// desert town (plaster facades, dusty streets, distant hills) plus skinned
// soldiers, smokes, fires and transient effects. Camera/aim is owned by the
// game loop; this module only draws.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  COLLIDERS, PLANT_ZONES, CELL, COLS, ROWS, SPAWNS,
} from '../../shared/mapdef.ts';
import type { PState } from '../../shared/protocol.ts';
import { makeCharacter, type CharRig } from './models.ts';
import { buildViewModel, type VmHandle } from './vmodel.ts';
import { fitWeapon, getAssets, loadAssets, weaponYaw } from './assets.ts';

interface PlayerDraw {
  group: THREE.Group;
  rig: CharRig;
  tag: THREE.Sprite | null;
  px: number; pz: number;
  phase: number;
  recoil: number;
  visible: boolean;
  alive: number;
  wpn: string;
}

const EYE = 64;
const EYE_DUCK = 46;

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  container: HTMLElement;
  actors = new Map<string, PlayerDraw>();
  private actorRoot = new THREE.Group();
  private smokesById = new Map<string, THREE.Sprite>();
  private fireMats = new Map<string, THREE.Mesh>();
  private glowDiscs: THREE.Mesh[] = [];
  private fx: { obj: THREE.Object3D; life: number; max: number; grow?: number }[] = [];
  private smokeTex: THREE.Texture;
  private hidden = new Set<string>();
  private vm: VmHandle;
  private tGeo: THREE.CylinderGeometry | null = null;
  private rnd = Math.random;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private sun: THREE.DirectionalLight | null = null;
  private texCache = new Map<string, THREE.Texture>();

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(78, container.clientWidth / container.clientHeight, 2, 16000);
    this.camera.rotation.order = 'YXZ';
    this.scene.background = new THREE.Color(0x8aa7c4);
    this.scene.fog = new THREE.Fog(0xc4b896, 2600, 11000);
    this.scene.add(this.camera);

    this.vm = buildViewModel();
    this.vm.root.visible = false;
    this.camera.add(this.vm.root);

    this.buildSky();
    this.buildLights();
    this.scene.add(this.actorRoot);
    this.smokeTex = this.makeSoftTex();

    const w = container.clientWidth, h = container.clientHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.14, 0.38, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
  }

  async ready(): Promise<void> {
    await loadAssets();
    this.camera.remove(this.vm.root);
    this.vm = buildViewModel();
    this.vm.root.visible = false;
    this.camera.add(this.vm.root);
    this.mountMap();
  }

  private mountMap(): void {
    const assets = getAssets();
    const src = assets?.map;
    if (src) {
      this.dressMap(src);
      this.scene.add(src);
    } else {
      const sand = this.loadRepeat('/textures/ground.jpg', 22, 22);
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(COLS * CELL + 8000, ROWS * CELL + 8000),
        new THREE.MeshStandardMaterial({ map: sand, roughness: 0.96, color: 0xd9c48a }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set((COLS * CELL) / 2, -2, (ROWS * CELL) / 2);
      ground.receiveShadow = true;
      this.scene.add(ground);
    }
    this.buildSiteDecals();
    this.buildFloorAccents();
    this.buildGlowDiscs();
  }

  private dressMap(root: THREE.Object3D): void {
    const plaster = this.loadAlbedo('/textures/wall.jpg');
    const sand = this.loadAlbedo('/textures/ground.jpg');
    const roof = this.loadAlbedo('/textures/concrete.jpg');
    const wood = this.loadAlbedo('/textures/wood.jpg');
    const metal = this.loadAlbedo('/textures/metal.jpg');
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      const n = (m.name || m.parent?.name || '').toLowerCase();
      if (n.includes('desert') || n.includes('cliff')) this.paintMesh(m, sand, 0xe2c98a, 0.97, 0.02, false, true, 0);
      else if (n.includes('street')) this.paintMesh(m, sand, 0xc8b98a, 0.95, 0.02, false, true, 0);
      else if (n.includes('curb') || n.includes('crates_stone')) this.paintMesh(m, roof, 0xddd6c8, 0.9, 0.04, true, true, 0);
      else if (n.includes('bldg_tan')) this.paintMesh(m, plaster, 0xc49a62, 0.9, 0.02, true, true, 0);
      else if (n.includes('bldg_cream') || n.includes('landmark')) this.paintMesh(m, plaster, 0xe4d3ad, 0.88, 0.02, true, true, 0);
      else if (n.includes('bldg_white') || n.includes('trim')) this.paintMesh(m, plaster, 0xf0e6d2, 0.86, 0.02, true, true, 0);
      else if (n.includes('roof')) this.paintMesh(m, roof, 0xc8b890, 0.92, 0.04, true, true, 0);
      else if (n.includes('door') || n.includes('crates_wood') || n.includes('palm_trunk') || n.includes('pole')) {
        this.paintMesh(m, wood, 0x8a6232, 0.78, 0.04, true, true, 0);
      } else if (n.includes('crates_metal') || n.includes('sign')) {
        this.paintMesh(m, metal, 0x8a9096, 0.42, 0.55, true, true, 0);
      } else if (n.includes('window')) {
        this.paintMesh(m, null, 0x14181c, 0.18, 0.35, false, false, 0);
      } else if (n.includes('palm_leaf')) {
        this.paintMesh(m, null, 0x3a6a28, 0.78, 0.02, true, false, 0);
      } else if (n.includes('awn')) {
        this.paintMesh(m, null, 0x2a2a2a, 0.72, 0.04, true, false, 0);
      } else {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  }

  private paintMesh(
    mesh: THREE.Mesh,
    map: THREE.Texture | null,
    color: number,
    rough: number,
    metal: number,
    cast: boolean,
    receive: boolean,
    uvScale: number,
  ): void {
    const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const std = (src as THREE.MeshStandardMaterial).clone();
    std.color.setHex(color);
    std.map = map;
    std.roughness = rough;
    std.metalness = metal;
    std.envMapIntensity = 0.55;
    std.needsUpdate = true;
    mesh.material = std;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    if (map && uvScale > 0) this.applyWorldUVs(mesh, uvScale);
  }

  private applyWorldUVs(mesh: THREE.Mesh, scale: number): void {
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    if (!pos) return;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      let u = x, v = z;
      if (nrm) {
        const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
        if (ay >= ax && ay >= az) { u = x; v = z; }
        else if (ax >= az) { u = z; v = y; }
        else { u = x; v = y; }
      }
      uv[i * 2] = u / scale;
      uv[i * 2 + 1] = v / scale;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    mesh.geometry = geo;
  }

  resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- sky & lights ---------------------------------------------------------
  private buildSky(): void {
    const sky = new Sky();
    sky.scale.setScalar(12000);
    const u = sky.material.uniforms;
    u['turbidity'].value = 6.4;
    u['rayleigh'].value = 2.1;
    u['mieCoefficient'].value = 0.0048;
    u['mieDirectionalG'].value = 0.82;
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(78), THREE.MathUtils.degToRad(148));
    u['sunPosition'].value.copy(sunDir);
    this.scene.add(sky);
    const probe = new Sky();
    probe.scale.setScalar(40);
    probe.material.uniforms['turbidity'].value = u['turbidity'].value;
    probe.material.uniforms['rayleigh'].value = u['rayleigh'].value;
    probe.material.uniforms['mieCoefficient'].value = u['mieCoefficient'].value;
    probe.material.uniforms['mieDirectionalG'].value = u['mieDirectionalG'].value;
    probe.material.uniforms['sunPosition'].value.copy(sunDir);
    const tmp = new THREE.Scene();
    tmp.add(probe);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(tmp, 0.04, 0.1, 100).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
  }

  private radialTex(color: number, alpha: number, size: number): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    const col = new THREE.Color(color);
    grd.addColorStop(0, `rgba(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0},${alpha})`);
    grd.addColorStop(1, `rgba(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0},0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xfff3dc, 0x7a6a4c, 0.62);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe2b0, 2.55);
    sun.position.set(2200, 2800, -1800);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.00018;
    sun.shadow.normalBias = 0.8;
    const span = 1200;
    sun.shadow.camera.left = -span;
    sun.shadow.camera.right = span;
    sun.shadow.camera.top = span;
    sun.shadow.camera.bottom = -span;
    sun.shadow.camera.near = 400;
    sun.shadow.camera.far = 7000;
    sun.shadow.camera.updateProjectionMatrix();
    const cx = (COLS * CELL) / 2, cz = (ROWS * CELL) / 2;
    sun.target.position.set(cx, 0, cz);
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    const fill = new THREE.DirectionalLight(0xb7c6d8, 0.28);
    fill.position.set(-1600, 900, 1500);
    this.scene.add(fill);
  }

  private loadAlbedo(url: string): THREE.Texture {
    const hit = this.texCache.get(url);
    if (hit) return hit;
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.texCache.set(url, t);
    return t;
  }

  private loadRepeat(url: string, rx: number, ry: number): THREE.Texture {
    const t = this.loadAlbedo(url).clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    return t;
  }

  // plant site: glowing floor ring + big site letter
  private buildSiteDecals(): void {
    for (const z of PLANT_ZONES) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(z.r - 10, z.r + 4, 56),
        new THREE.MeshBasicMaterial({ color: 0xd9a441, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(z.x, 1.2, z.z);
      this.scene.add(ring);
      const inner = new THREE.Mesh(
        new THREE.CircleGeometry(z.r * 0.62, 40),
        new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
      );
      inner.rotation.x = -Math.PI / 2;
      inner.position.set(z.x, 1.1, z.z);
      this.scene.add(inner);

      const letter = this.letterSprite(z.site === 1 ? 'A' : 'B', 0xffc266);
      letter.position.set(z.x, 3, z.z);
      letter.rotation.x = -Math.PI / 2;
      this.scene.add(letter);
    }
    this.scene.add(this.wallSign(42.2 * CELL, 78, 18.05 * CELL, 0, 'A', 0xc43b2e));
    this.scene.add(this.wallSign(5.8 * CELL, 86, 18.05 * CELL, 0, 'B', 0xc43b2e));
  }

  private wallSign(x: number, y: number, z: number, yaw: number, ch: string, color: number): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#5c6a72';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#d8dde0';
    g.fillRect(8, 8, 240, 112);
    g.fillStyle = '#' + color.toString(16).padStart(6, '0');
    g.font = 'bold 88px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, 188, 68);
    g.fillStyle = '#2a3338';
    g.font = 'bold 22px sans-serif';
    g.fillText(ch === 'A' ? 'SITE A' : 'SITE B', 90, 68);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(56, 28),
      new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }),
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    return mesh;
  }

  private letterSprite(ch: string, color: number): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = '#ffc26622';
    g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill();
    g.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
    g.lineWidth = 8;
    g.beginPath(); g.arc(64, 64, 60, 0, 7); g.stroke();
    g.fillStyle = '#' + color.toString(16).padStart(6, '0');
    g.font = 'bold 90px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.95 }));
    s.scale.set(12, 12, 1);
    return s;
  }

  // soft team-tinted spawn pads so sides read instantly
  private buildFloorAccents(): void {
    const spawnTint = (pts: { x: number; z: number }[], color: number) => {
      if (!pts.length) return;
      let sx = 0, sz = 0;
      for (const p of pts) { sx += p.x; sz += p.z; }
      sx /= pts.length; sz /= pts.length;
      const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(CELL * 8, CELL * 3.4),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }),
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(sx, 0.6, sz);
      this.scene.add(pad);
      const edge = new THREE.Mesh(
        new THREE.PlaneGeometry(CELL * 8.2, 4),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
      );
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(sx, 0.8, sz + (color === 0xff6a3d ? 1 : -1) * CELL * 1.6);
      this.scene.add(edge);
    };
    spawnTint(SPAWNS[1], 0xff6a3d);
    spawnTint(SPAWNS[2], 0x3d9bff);
  }

  // fake light pools (additive) so big rooms don't feel flat
  private buildGlowDiscs(): void {
    const make = (x: number, z: number, r: number, color: number, a: number) => {
      const tex = this.radialTex(color, a, 128);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(r * 2, r * 2),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.7, z);
      this.scene.add(mesh);
      this.glowDiscs.push(mesh);
    };
    make(23.5 * CELL, 21 * CELL, CELL * 4.2, 0xfff4d2, 0.18);
    make(23.5 * CELL, 9 * CELL, CELL * 4.6, 0xfff1c4, 0.2);
    make(PLANT_ZONES[1].x, PLANT_ZONES[1].z, CELL * 3.2, 0xfff6d8, 0.16);
    make(PLANT_ZONES[0].x, PLANT_ZONES[0].z, CELL * 3.2, 0xfff6d8, 0.16);
    make(23.5 * CELL, 36 * CELL, CELL * 3.8, 0xfff4d2, 0.14);
    make(23.5 * CELL, 3.5 * CELL, CELL * 3.8, 0xfff4d2, 0.14);
  }

  // ---- soft decal texture helpers ------------------------------------------
  private makeSoftTex(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    grad.addColorStop(0, 'rgba(240,245,255,1)');
    grad.addColorStop(0.55, 'rgba(205,215,230,0.85)');
    grad.addColorStop(1, 'rgba(180,190,205,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ---- actors ---------------------------------------------------------------
  private actorFor(id: string, team: number, name: string): PlayerDraw {
    let a = this.actors.get(id);
    if (a) return a;
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    const seed = (h % 1000) / 1000;
    const rig = makeCharacter({ team, seed });
    const group = new THREE.Group();
    group.add(rig.group);
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
    this.actorRoot.add(group);
    const tag = this.makeTag(name, team);
    if (tag) {
      tag.position.y = 78;
      rig.group.add(tag);
    }
    a = { group, rig, tag, px: 0, pz: 0, phase: 0, recoil: 0, visible: false, alive: 1, wpn: '' };
    this.actors.set(id, a);
    return a;
  }

  private worldGun(id: string): THREE.Object3D | null {
    const assets = getAssets();
    const tpl = assets?.weapons.get(id);
    if (!tpl) return null;
    const gun = fitWeapon(tpl.scene, 9.5, weaponYaw(id));
    gun.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.castShadow = true;
    });
    return gun;
  }

  private makeTag(name: string, team: number): THREE.Sprite | null {
    if (!name) return null;
    const w = 10 + name.length * 7;
    const c = document.createElement('canvas');
    c.width = Math.max(64, w);
    c.height = 24;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(6,10,16,0.55)';
    g.fillRect(0, 0, c.width, c.height);
    const col = team === 2 ? '#57c8ff' : team === 1 ? '#ff8a4c' : '#9aa7b5';
    g.strokeStyle = col;
    g.lineWidth = 2;
    g.strokeRect(0, 0, c.width, c.height);
    g.fillStyle = '#e8f0ff';
    g.font = 'bold 13px system-ui, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(name, c.width / 2, 13);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
    const s = c.width / 24;
    sp.scale.set(s, s * (24 / c.width), 1);
    return sp;
  }

  removeActor(id: string): void {
    const a = this.actors.get(id);
    if (!a) return;
    this.actorRoot.remove(a.group);
    this.actors.delete(id);
    this.hidden.delete(id);
  }

  reset(): void {
    for (const a of this.actors.values()) this.actorRoot.remove(a.group);
    this.actors.clear();
    this.hidden.clear();
    for (const s of this.smokesById.values()) this.scene.remove(s);
    this.smokesById.clear();
    for (const m of this.fireMats.values()) this.scene.remove(m);
    this.fireMats.clear();
    for (const f of this.fx) this.scene.remove(f.obj);
    this.fx = [];
    for (const d of this.glowDiscs) d.rotation.x = -Math.PI / 2;
  }

  private ensureHidden(id: string): void {
    const a = this.actors.get(id);
    if (!a) return;
    if (!a.visible) {
      a.group.visible = false;
      this.hidden.add(id);
    }
  }

  update(dt: number, players: PState[], selfId: string): void {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === selfId) { seen.add(p.id); continue; } // first-person: self never drawn
      if (!p.alive) {
        const a = this.actors.get(p.id);
        if (a && a.visible) { a.visible = false; a.group.visible = false; this.hidden.add(p.id); }
        seen.add(p.id);
        continue;
      }
      const a = this.actorFor(p.id, p.team, p.name);
      a.alive = 1;
      if (!a.visible) { a.visible = true; a.group.visible = true; }
      // ease position
      const k = 1 - Math.exp(-10 * dt);
      const g = a.group;
      g.position.x += (p.x - g.position.x) * k;
      g.position.y += (p.y - g.position.y) * k;
      g.position.z += (p.z - g.position.z) * k;
      let dy = p.yaw - g.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      g.rotation.y += dy * k;
      // walk cycle phase by real displacement
      const dx = p.x - a.px, dz = p.z - a.pz;
      a.px = p.x; a.pz = p.z;
      const speed = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
      const moving = p.moving > 0.02 && speed > 12;
      const step = Math.min(1, speed / 330);
      if (moving) a.phase += dt * 9.5 * Math.max(0.4, step);
      else a.phase += dt * 1.5;
      a.recoil *= Math.exp(-7 * dt);
      a.rig.update({
        move: moving ? step : 0,
        duck: p.duck ? 1 : 0,
        pitch: p.pitch,
        fire: a.recoil,
        phase: a.phase,
        using: p.using,
      }, dt);
      if (p.curW && p.curW !== a.wpn) {
        a.wpn = p.curW;
        a.rig.setWeapon(this.worldGun(p.curW));
      }
      if (a.tag) a.tag.visible = true;
      seen.add(p.id);
    }
    for (const id of [...this.actors.keys()]) {
      if (!seen.has(id)) this.removeActor(id);
    }
    void dt;
  }

  // ---- camera ---------------------------------------------------------------
  setCam(pos: { x: number; y: number; z: number }, yaw: number, pitch: number, duck: number, zoom = 0): void {
    this.camera.position.set(pos.x, pos.y + (duck ? EYE_DUCK : EYE), pos.z);
    this.camera.rotation.y = yaw;
    this.camera.rotation.x = pitch;
    const fov = 78 - zoom * 36;
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  get eyeY(): number { return EYE; }

  gunMouth(): { x: number; y: number; z: number } {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyEuler(this.camera.rotation);
    return {
      x: this.camera.position.x + dir.x * 34,
      y: this.camera.position.y - 7 + dir.y * 34,
      z: this.camera.position.z + dir.z * 34,
    };
  }

  // ---- fx -------------------------------------------------------------------
  muzzle(id: string, x: number, y: number, z: number, big: boolean): void {
    const a = this.actors.get(id);
    if (a) a.recoil = 1;
    const s = new THREE.Mesh(
      big ? new THREE.SphereGeometry(7, 6, 4) : new THREE.SphereGeometry(4, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xffdca6, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    s.position.set(x, y, z);
    this.scene.add(s);
    this.fx.push({ obj: s, life: big ? 0.09 : 0.05, max: big ? 0.09 : 0.05 });
    // brief light so shots read
    if (this.rnd() < 0.5) {
      const l = new THREE.PointLight(0xffc266, 40, 700, 2);
      l.position.set(x, y, z);
      this.scene.add(l);
      this.fx.push({ obj: l, life: 0.08, max: 0.08 });
    }
  }

  // ---- first-person viewmodel ----------------------------------------------
  vmSet(w: string, team: number): void { this.vm.setWeapon(w, team); }
  vmShow(v: boolean): void { this.vm.root.visible = v; }
  vmUpdate(dt: number, opts: { speed: number; duck: boolean; using: boolean; aim?: number; reload?: number }): void {
    this.vm.update(dt, {
      speed: opts.speed, duck: opts.duck ? 1 : 0, alive: this.vm.root.visible,
      using: opts.using, aim: opts.aim, reload: opts.reload,
    });
  }
  vmKick(power: number): void { this.vm.kick(power); }
  vmReload(dur: number): void { this.vm.reload(dur); }

  // flash at the tip of the held gun (own view) + recoil the viewmodel
  ownMuzzle(x: number, y: number, z: number, big: boolean, power: number): void {
    this.muzzle('', x, y, z, big);
    this.vmKick(power);
  }

  bulletSpark(x: number, y: number, z: number): void {
    const s = new THREE.Mesh(new THREE.SphereGeometry(1.8, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.set(x, y, z);
    this.scene.add(s);
    this.fx.push({ obj: s, life: 0.14, max: 0.14, grow: 6 });
  }

  // bullets are invisible rays; draw them as a short fading tracer beam
  tracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number): void {
    const vx = x1 - x0, vy = y1 - y0, vz = z1 - z0;
    const len = Math.hypot(vx, vy, vz);
    if (len < 6 || len > 3400) return;
    if (!this.tGeo) this.tGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    const m = new THREE.Mesh(
      this.tGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.scale.set(1.15, len, 1.15);
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3(vx, vy, vz).normalize();
    m.quaternion.setFromUnitVectors(up, dir);
    this.scene.add(m);
    this.fx.push({ obj: m, life: 0.07, max: 0.07 });
  }

  // mark where a shot actually hit (impact puff)
  impact(x: number, y: number, z: number): void {
    this.bulletSpark(x, y, z);
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(2, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    s.position.set(x, y, z);
    this.scene.add(s);
    this.fx.push({ obj: s, life: 0.1, max: 0.1, grow: 4 });
  }

  updateSmokes(smokes: { x: number; z: number; r: number; till: number }[], now: number): void {
    const active = new Set<string>();
    for (let i = 0; i < smokes.length; i++) {
      const s = smokes[i];
      const key = i + '_' + s.x.toFixed(0) + s.z.toFixed(0);
      active.add(key);
      let spr = this.smokesById.get(key);
      if (!spr) {
        spr = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.smokeTex, color: 0x9aa6b2, transparent: true, opacity: 0.55,
          depthWrite: false,
        }));
        spr.renderOrder = 2;
        this.smokesById.set(key, spr);
        this.scene.add(spr);
      }
      const age = Math.max(0, Math.min(1, (s.till - now) / 12));
      spr.position.set(s.x, 78, s.z);
      spr.scale.setScalar(s.r * 2.6 * (0.7 + 0.3 * age));
      (spr.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(0.62, age * 0.9));
    }
    for (const [k, spr] of this.smokesById) {
      if (!active.has(k)) {
        this.scene.remove(spr);
        this.smokesById.delete(k);
      }
    }
  }

  updateFires(fires: { x: number; z: number; r: number; till: number }[], now: number): void {
    const active = new Set<string>();
    for (let i = 0; i < fires.length; i++) {
      const f = fires[i];
      const key = 'f' + i + '_' + f.x.toFixed(0) + f.z.toFixed(0);
      active.add(key);
      let m = this.fireMats.get(key);
      if (!m) {
        const geo = new THREE.CircleGeometry(1, 22);
        m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: 0xff6a20, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        m.rotation.x = -Math.PI / 2;
        m.renderOrder = 1;
        this.fireMats.set(key, m);
        this.scene.add(m);
      }
      const age = Math.max(0, Math.min(1, (f.till - now) / 6.5));
      const scale = f.r * 2 * (0.5 + 0.5 * age);
      m.scale.set(scale, scale, scale);
      m.position.set(f.x, 3 + Math.sin(now * 11 + i) * 2, f.z);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.18 + age * 0.65;
    }
    for (const [k, m] of this.fireMats) {
      if (!active.has(k)) {
        this.scene.remove(m);
        this.fireMats.delete(k);
      }
    }
  }

  bombFlash(x: number, y: number, z: number): void {
    const light = new THREE.PointLight(0xffffff, 120, 4200, 1.8);
    light.position.set(x, y, z);
    this.scene.add(light);
    this.fx.push({ obj: light, life: 0.9, max: 0.9 });
    this.muzzle('bomb', x, y + 20, z, true);
  }

  flashBang(x: number, y: number, z: number): void {
    const l = new THREE.PointLight(0xffffff, 60, 1800, 1.8);
    l.position.set(x, y, z);
    this.scene.add(l);
    this.fx.push({ obj: l, life: 0.4, max: 0.4 });
  }

  tickFx(dt: number): void {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      if (f.grow) {
        const m = f.obj as THREE.Mesh;
        const s0 = 1 + (f.max - f.life) / f.max * 3;
        m.scale.setScalar(s0);
      }
      const mat = (f.obj as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (mat && mat.opacity !== undefined) mat.opacity = Math.max(0, f.life / f.max);
      if (f.life <= 0) {
        this.scene.remove(f.obj);
        this.fx.splice(i, 1);
      }
    }
    for (const id of [...this.hidden]) {
      const a = this.actors.get(id);
      if (a && a.alive && !a.visible) {
        // respawned
      } else if (!a) {
        this.hidden.delete(id);
      }
    }
  }

  render(): void {
    if (this.sun) {
      const x = this.camera.position.x, z = this.camera.position.z;
      this.sun.target.position.set(x, 0, z);
      this.sun.position.set(x + 2200, 2800, z - 1800);
      this.sun.target.updateMatrixWorld();
      this.sun.updateMatrixWorld();
    }
    this.composer.render();
  }

  rayBlocked(from: THREE.Vector3, dir: THREE.Vector3): number {
    let best = Infinity;
    for (const c of COLLIDERS) {
      const hit = rayAABB(from, dir, c.x0, c.y0, c.z0, c.x1, c.y1, c.z1);
      if (hit !== null && hit < best) best = hit;
    }
    return best;
  }
}

function rayAABB(
  o: THREE.Vector3, d: THREE.Vector3,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
): number | null {
  let tmin = 0, tmax = Infinity;
  const axes = [
    [d.x, o.x, x0, x1],
    [d.y, o.y, y0, y1],
    [d.z, o.z, z0, z1],
  ] as const;
  for (const [dx, ox, mn, mx] of axes) {
    if (Math.abs(dx) < 1e-9) {
      if (ox < mn || ox > mx) return null;
    } else {
      let t1 = (mn - ox) / dx;
      let t2 = (mx - ox) / dx;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin >= 0 ? tmin : null;
}
