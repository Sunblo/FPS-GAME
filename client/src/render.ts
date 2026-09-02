// Three.js scene for AXIOM SIEGE. Renders the REACTOR-09 geometry from
// shared/mapdef.ts (rebuilt for looks: merged industrial walls, textured
// ground, crates/barrels, site decals, sky dome, accent lighting) plus skinned
// rigged soldiers, smokes, fires and transient effects. Camera/aim is owned by
// the game loop; this module only draws.
import * as THREE from 'three';
import {
  COLLIDERS, CRATE_BOXES, CRATES, PLANT_ZONES, CELL, COLS, ROWS, WALL_H,
  floorCells, cellSolid, SPAWNS,
} from '../../shared/mapdef.ts';
import type { PState } from '../../shared/protocol.ts';
import { makeCharacter, type CharRig } from './models.ts';

interface PlayerDraw {
  group: THREE.Group;
  rig: CharRig;
  tag: THREE.Sprite | null;
  px: number; pz: number;
  phase: number;
  recoil: number;
  visible: boolean;
  alive: number;
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
  private rnd = Math.random;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(78, container.clientWidth / container.clientHeight, 4, 6000);
    this.camera.rotation.order = 'YXZ';

    this.buildSky();
    this.buildLights();
    this.buildMap();
    this.scene.add(this.actorRoot);
    this.smokeTex = this.makeSoftTex();

    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- sky & lights ---------------------------------------------------------
  private buildSky(): void {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#04070c');
    grad.addColorStop(0.42, '#0a1422');
    grad.addColorStop(0.72, '#16263a');
    grad.addColorStop(1, '#32445c');
    g.fillStyle = grad;
    g.fillRect(0, 0, 8, 256);
    const tex = new THREE.CanvasTexture(c);
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(4600, 24, 12),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }),
    );
    sky.position.y = -600;
    this.scene.add(sky);

    // faint moon glow for silhouette separation
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.radialTex(0x9db8d8, 0.5, 128), transparent: true, fog: false,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    moon.scale.setScalar(1400);
    moon.position.set(1500, 3200, -2800);
    this.scene.add(moon);
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
    const hemi = new THREE.HemisphereLight(0xc8d8ee, 0x161a20, 0.75);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffe2bb, 1.1);
    key.position.set(900, 2400, -700);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x6f9fff, 0.5);
    fill.position.set(-900, 1600, 1500);
    this.scene.add(fill);
    // site accents (static, cheap)
    const siteA = new THREE.PointLight(0xff9a4a, 60, 2600, 2);
    siteA.position.set(27.5 * CELL, 180, 17 * CELL);
    this.scene.add(siteA);
    const siteB = new THREE.PointLight(0x57c8ff, 60, 2600, 2);
    siteB.position.set(5.5 * CELL, 180, 17 * CELL);
    this.scene.add(siteB);
  }

  // ---- map -------------------------------------------------------------------
  private buildMap(): void {
    const groundTex = this.groundTex();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(COLS * CELL + 4000, ROWS * CELL + 4000),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.93, metalness: 0.05 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1;
    this.scene.add(ground);

    this.buildWallShell();
    this.buildProps();
    this.buildSiteDecals();
    this.buildFloorAccents();
    this.buildGlowDiscs();
  }

  // industrial concrete floor: panel seams + noise per 64-unit cell
  private groundTex(): THREE.Texture {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    g.fillStyle = '#232a32';
    g.fillRect(0, 0, S, S);
    // sub-panels
    g.fillStyle = '#20272e';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      if ((i + j) % 2 === 0) g.fillRect(i * 64, j * 64, 64, 64);
    }
    // seams
    g.strokeStyle = '#151a20';
    g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, S); g.stroke();
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(S, i * 64); g.stroke();
    }
    // rivets at corners + grime
    g.fillStyle = '#2c343d';
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      g.beginPath(); g.arc(i * 64, j * 64, 3, 0, 7); g.fill();
    }
    const rnd = this.rnd;
    for (let i = 0; i < 900; i++) {
      const a = rnd();
      g.fillStyle = a > 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.03)';
      g.fillRect(rnd() * S, rnd() * S, 2, 2);
    }
    // dirt along center seams
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, S / 2); g.lineTo(S, S / 2); g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(COLS, ROWS);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private concreteWallTex(): THREE.Texture {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    g.fillStyle = '#222a34';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#262f3b';
    g.fillRect(8, 8, 120, 120); g.fillRect(136, 128, 112, 120);
    g.strokeStyle = '#1a2129';
    g.lineWidth = 4;
    g.strokeRect(4, 4, S - 8, S - 8);
    // hazard bolt panel along bottom
    g.save();
    g.fillStyle = '#3a424d';
    for (let x = 0; x < S; x += 32) {
      g.beginPath();
      g.moveTo(x, S); g.lineTo(x + 16, S); g.lineTo(x + 32, S - 16); g.lineTo(x + 16, S - 16);
      g.closePath(); g.fill();
    }
    g.restore();
    g.fillStyle = '#4a3426';
    g.fillRect(0, S - 6, S, 6);
    const rnd = this.rnd;
    for (let i = 0; i < 500; i++) {
      g.fillStyle = rnd() > 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(200,215,235,0.03)';
      g.fillRect(rnd() * S, rnd() * S, 2, 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // Merge only the visible wall boundary quads (solid cell faces next to floor)
  // into one geometry with a shared tiling texture.
  private buildWallShell(): void {
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const quads: { p: number[]; n: number[]; u: number[] }[] = [];

    const H = WALL_H;
    const addFace = (a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number], n: [number, number, number]) => {
      const u0 = a[0] / CELL, v0 = a[1] / CELL;
      const u1 = d[0] / CELL, v1 = d[1] / CELL;
      const q = { p: [...a, ...b, ...c, ...a, ...c, ...d], n, u: [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1] };
      quads.push(q);
    };

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (floorCells[r * COLS + c]) continue; // not a wall cell
        const x0 = c * CELL, x1 = (c + 1) * CELL;
        const z0 = r * CELL, z1 = (r + 1) * CELL;
        // north face (toward -z neighbor)
        if (r > 0 && floorCells[(r - 1) * COLS + c]) {
          addFace([x0, 0, z0], [x0, H, z0], [x1, H, z0], [x1, 0, z0], [0, 0, 1]);
        }
        // south face (+z)
        if (r < ROWS - 1 && floorCells[(r + 1) * COLS + c]) {
          addFace([x1, 0, z1], [x1, H, z1], [x0, H, z1], [x0, 0, z1], [0, 0, -1]);
        }
        // west face (-x)
        if (c > 0 && floorCells[r * COLS + (c - 1)]) {
          addFace([x0, 0, z1], [x0, H, z1], [x0, H, z0], [x0, 0, z0], [-1, 0, 0]);
        }
        // east face (+x)
        if (c < COLS - 1 && floorCells[r * COLS + (c + 1)]) {
          addFace([x1, 0, z0], [x1, H, z0], [x1, H, z1], [x1, 0, z1], [1, 0, 0]);
        }
      }
    }

    for (const q of quads) {
      pos.push(...q.p);
      nrm.push(...q.n, ...q.n, ...q.n, ...q.n, ...q.n, ...q.n);
      uv.push(...q.u);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    const mat = new THREE.MeshStandardMaterial({ map: this.concreteWallTex(), roughness: 0.88, metalness: 0.1 });
    const walls = new THREE.Mesh(geo, mat);
    this.scene.add(walls);
  }

  // crates / barrels / sandbags / containers from CRATES
  private buildProps(): void {
    const crateTex = this.crateTex();
    for (const o of CRATES) {
      const x = (o.c + 0.5) * CELL, z = (o.r + 0.5) * CELL;
      const h = o.h;
      const s = CELL - 6;
      let mesh: THREE.Mesh;
      if (o.mat === 2) {
        // barrel
        mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(CELL * 0.3, CELL * 0.32, h - 4, 14),
          new THREE.MeshStandardMaterial({ color: 0x6b6f5a, roughness: 0.55, metalness: 0.4 }),
        );
        mesh.position.set(x, (h - 4) / 2, z);
        const stripe = new THREE.Mesh(
          new THREE.CylinderGeometry(CELL * 0.305, CELL * 0.305, h * 0.4, 14),
          new THREE.MeshStandardMaterial({ color: 0xc94f3d, roughness: 0.6 }),
        );
        stripe.position.set(x, h * 0.28, z);
        this.scene.add(stripe);
      } else if (o.mat === 1) {
        // metal container (tall), with ribbed sides
        mesh = new THREE.Mesh(new THREE.BoxGeometry(s, h, s), new THREE.MeshStandardMaterial({ color: 0x4b5a6b, roughness: 0.5, metalness: 0.55 }));
        mesh.position.set(x, h / 2, z);
        const rib = new THREE.Mesh(new THREE.BoxGeometry(s + 2, h, 3), new THREE.MeshStandardMaterial({ color: 0x39434f, roughness: 0.5, metalness: 0.4 }));
        rib.position.set(x, h / 2, z - s / 2 + 1.5);
        this.scene.add(rib);
      } else if (o.mat === 3) {
        // sandbag/low stack
        mesh = new THREE.Mesh(new THREE.BoxGeometry(s, h, s), new THREE.MeshStandardMaterial({ color: 0x6b6b52, roughness: 0.95 }));
        mesh.position.set(x, h / 2, z);
      } else {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(s, h, s), new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.75 }));
        mesh.position.set(x, h / 2, z);
        // strap lines on wooden crates
        const band = new THREE.Mesh(new THREE.BoxGeometry(s + 3, Math.min(h, 10), s + 3), new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.6, metalness: 0.2 }));
        band.position.set(x, h * 0.72, z);
        this.scene.add(band);
      }
      this.scene.add(mesh);
    }
    void CRATE_BOXES;
  }

  private crateTex(): THREE.Texture {
    const S = 128;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    const rnd = this.rnd;
    const cols = [0x5c4632, 0x6b5138, 0x53402f];
    for (let i = 0; i < 6; i++) {
      g.fillStyle = '#' + cols[Math.floor(rnd() * cols.length)].toString(16).padStart(6, '0');
      g.fillRect(0, i * (S / 6), S, S / 6);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, i * (S / 6), S, 2);
    }
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.lineWidth = 4;
    g.strokeRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.strokeRect(8, 8, S - 16, S - 16);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // plant site: glowing floor ring + big site letter
  private buildSiteDecals(): void {
    for (const z of PLANT_ZONES) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(z.r - 10, z.r + 4, 56),
        new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.32, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
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
    // mid room, plaza, corridors, sites
    make(16.5 * CELL, 15.5 * CELL, CELL * 3, 0x9fb8ff, 0.5);
    make(16.5 * CELL, 6 * CELL, CELL * 3.4, 0xffe0b0, 0.5);
    make(8 * CELL, 22 * CELL, CELL * 2.6, 0x57c8ff, 0.6);
    make(25 * CELL, 22 * CELL, CELL * 2.6, 0xff9a4a, 0.6);
    make(16.5 * CELL, 25.5 * CELL, CELL * 3.4, 0x3d9bff, 0.6);
    make(16.5 * CELL, 2.5 * CELL, CELL * 3.4, 0xff6a3d, 0.6);
    make(22 * CELL, 12 * CELL, CELL * 2, 0xb9c7e0, 0.45);
    make(11 * CELL, 12 * CELL, CELL * 2, 0xb9c7e0, 0.45);
    // glowing strips along the central corridor
    for (let r = 8; r <= 13; r++) make((16.5 + (r % 2 ? 1.1 : -1.1)) * CELL, r * CELL + 0.5 * CELL, CELL * 0.24, 0x9fe2ff, 0.9);
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
    this.actorRoot.add(group);
    const tag = this.makeTag(name, team);
    if (tag) {
      tag.position.y = 90;
      rig.group.add(tag);
    }
    a = { group, rig, tag, px: 0, pz: 0, phase: 0, recoil: 0, visible: false, alive: 1 };
    this.actors.set(id, a);
    return a;
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
    this.scene.remove(a.group);
    this.actors.delete(id);
    this.hidden.delete(id);
  }

  reset(): void {
    for (const a of this.actors.values()) this.scene.remove(a.group);
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
      });
      if (a.tag) a.tag.visible = true;
      seen.add(p.id);
    }
    for (const id of [...this.actors.keys()]) {
      if (!seen.has(id)) this.removeActor(id);
    }
    void dt;
  }

  // ---- camera ---------------------------------------------------------------
  setCam(pos: { x: number; y: number; z: number }, yaw: number, pitch: number, duck: number): void {
    this.camera.position.set(pos.x, pos.y + (duck ? EYE_DUCK : EYE), pos.z);
    this.camera.rotation.y = yaw;
    this.camera.rotation.x = -pitch;
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

  bulletSpark(x: number, y: number, z: number): void {
    const s = new THREE.Mesh(new THREE.SphereGeometry(1.8, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.set(x, y, z);
    this.scene.add(s);
    this.fx.push({ obj: s, life: 0.14, max: 0.14, grow: 6 });
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
    this.renderer.render(this.scene, this.camera);
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
