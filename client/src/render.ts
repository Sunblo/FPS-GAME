// Three.js scene for AXIOM SIEGE. Renders the REACTOR-09 geometry from
// shared/mapdef.ts plus live players, smokes, fires and transient effects.
// Camera/aim is owned by the game loop; this module only draws.
import * as THREE from 'three';
import {
  COLLIDERS, CRATE_BOXES, PLANT_ZONES, CELL, COLS, ROWS, WALL_H, floorCells,
} from '../../shared/mapdef.ts';
import type { PState } from '../../shared/protocol.ts';

export interface PlayerDraw {
  actor: THREE.Group;
  target: { x: number; y: number; z: number; yaw: number; pitch: number };
  alive: number;
}

export class World {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  container: HTMLElement;
  actors = new Map<string, PlayerDraw>();
  private smokeMesh: THREE.Mesh;
  private smokeGeo: THREE.PlaneGeometry;
  private smokeMat: THREE.MeshBasicMaterial;
  private smokesById = new Map<string, THREE.Sprite>();
  private fireMats = new Map<string, THREE.Mesh>();
  private fx: { obj: THREE.Object3D; life: number; max: number; grow?: number }[] = [];
  private rnd = Math.random;
  private smokeTex: THREE.Texture;
  private selfEye = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x06090e);
    this.scene.fog = new THREE.Fog(0x0a1220, 500, 2600);

    this.camera = new THREE.PerspectiveCamera(76, container.clientWidth / container.clientHeight, 4, 6000);
    this.camera.rotation.order = 'YXZ';

    this.buildLights();
    this.buildMap();
    this.smokeTex = this.makeSoftTex();

    // smoke cloud instance
    this.smokeGeo = new THREE.PlaneGeometry(1, 1);
    this.smokeMat = new THREE.MeshBasicMaterial({ map: this.smokeTex, transparent: true, depthWrite: false, blending: THREE.NormalBlending });
    this.smokeMesh = new THREE.Mesh(this.smokeGeo, this.smokeMat);
    this.smokeMesh.visible = false;

    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xdfeeff, 0x1a1f28, 0.85);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfff2dd, 1.15);
    dir.position.set(900, 2400, -700);
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(0x8fb6ff, 0.4);
    fill.position.set(-800, 1200, 1000);
    this.scene.add(fill);
  }

  private buildMap(): void {
    // ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(COLS * CELL, ROWS * CELL),
      new THREE.MeshStandardMaterial({ color: 0x2b3a49, roughness: 0.92, metalness: 0.02 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // subtle large checker on the ground so motion reads well
    const cw = 2 * CELL;
    const tex = document.createElement('canvas');
    tex.width = tex.height = 64;
    const g = tex.getContext('2d')!;
    g.fillStyle = '#34465a';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#31404f';
    g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
    const ct = new THREE.CanvasTexture(tex);
    ct.wrapS = ct.wrapT = THREE.RepeatWrapping;
    ct.repeat.set(COLS * CELL / cw, ROWS * CELL / cw);
    const grid = new THREE.Mesh(
      new THREE.PlaneGeometry(COLS * CELL, ROWS * CELL),
      new THREE.MeshBasicMaterial({ map: ct, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = 0.35;
    this.scene.add(grid);

    // walls from solid cells
    const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1c2836, roughness: 0.9 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0x2a3a4e, roughness: 0.9 });
    const count = COLS * ROWS;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (cellSolidHere(c, r)) {
          const m = new THREE.Mesh(wallGeo, wallMat);
          m.position.set((c + 0.5) * CELL, WALL_H / 2, (r + 0.5) * CELL);
          this.scene.add(m);
          // visible lip
          const lip = new THREE.Mesh(new THREE.BoxGeometry(CELL, 8, CELL), topMat);
          lip.position.set((c + 0.5) * CELL, WALL_H + 4, (r + 0.5) * CELL);
          this.scene.add(lip);
        }
      }
    }

    // crates
    const cratePalette = [0x7a5c34, 0x55637a, 0x8c3b2b, 0x6a5136];
    for (const b of CRATE_BOXES) {
      const w = b.x1 - b.x0, d = b.z1 - b.z0, h = b.y1 - b.y0;
      const ci = this.rnd();
      const col = cratePalette[Math.floor(ci * cratePalette.length) % cratePalette.length];
      const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 });
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set((b.x0 + b.x1) / 2, h / 2, (b.z0 + b.z1) / 2);
      // darker edge
      const e = new THREE.Mesh(new THREE.BoxGeometry(w + 2, h + 2, d + 2),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
      e.position.copy(m.position);
      this.scene.add(e);
      this.scene.add(m);
    }

    // plant site markers
    const ringGeo = new THREE.RingGeometry(120, 150, 48);
    for (const z of PLANT_ZONES) {
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xffb454, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(z.x, 0.8, z.z);
      this.scene.add(ring);
    }
    // world bounds glow lines optional - skip

    void wallMat; void ground;
  }

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

  private actorFor(id: string): PlayerDraw {
    let a = this.actors.get(id);
    if (a) return a;
    const group = new THREE.Group();
    // capsule body
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(12, 40, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x88aabb, roughness: 0.7 }));
    body.position.y = 32;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(8.5, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xd8c0a0, roughness: 0.8 }));
    head.position.y = 68;
    group.add(head);
    // gun
    const gun = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 26),
      new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5 }));
    gun.position.set(10, 50, -14);
    group.add(gun);
    // name helper placeholder text handled by DOM; keep cheap 3D billboard small bar
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(28, 8),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }));
    tag.position.y = 88;
    group.add(tag);
    a = { actor: group, target: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, alive: 1 };
    this.actors.set(id, a);
    this.scene.add(group);
    return a;
  }

  removeActor(id: string): void {
    const a = this.actors.get(id);
    if (!a) return;
    this.scene.remove(a.actor);
    this.actors.delete(id);
  }

  reset(): void {
    for (const a of this.actors.values()) this.scene.remove(a.actor);
    this.actors.clear();
    this.hidden.clear();
    for (const s of this.smokesById.values()) this.scene.remove(s);
    this.smokesById.clear();
    for (const m of this.fireMats.values()) this.scene.remove(m);
    this.fireMats.clear();
    for (const f of this.fx) this.scene.remove(f.obj);
    this.fx = [];
  }

  // set team-tint for the player
  setTeam(id: string, team: number): void {
    const a = this.actors.get(id);
    if (!a) return;
    const body = a.actor.children[0] as THREE.Mesh;
    (body.material as THREE.MeshStandardMaterial).color.set(team === 2 ? 0x4fc3ff : team === 1 ? 0xff8a4c : 0x777777);
  }

  update(dt: number, players: PState[], selfId: string): void {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === selfId && p.alive) continue; // first-person hides self
      if (p.id === selfId && !p.alive) continue; // dead self: no corpse
      if (!p.alive) {
        this.ensureHide(p.id);
        seen.add(p.id);
        continue;
      }
      const a = this.actorFor(p.id);
      this.setTeam(p.id, p.team);
      a.alive = 1;
      a.target.x = p.x; a.target.y = p.y; a.target.z = p.z;
      a.target.yaw = p.yaw; a.target.pitch = p.pitch;
      seen.add(p.id);
    }
    // remove actors that vanished
    for (const id of [...this.actors.keys()]) {
      if (!seen.has(id)) this.removeActor(id);
    }
    // ease actors toward their targets
    const k = 1 - Math.exp(-9 * dt);
    for (const a of this.actors.values()) {
      const g = a.actor;
      g.position.x += (a.target.x - g.position.x) * k;
      g.position.y += (a.target.y - g.position.y) * k;
      g.position.z += (a.target.z - g.position.z) * k;
      let d = a.target.yaw - g.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      g.rotation.y += d * k;
      // gun pitch
      const gun = g.children[2];
      gun.rotation.x = -a.target.pitch;
    }
  }

  private hidden = new Set<string>();
  private ensureHide(id: string): void {
    const a = this.actors.get(id);
    if (!a || this.hidden.has(id)) return;
    a.actor.visible = false;
    this.hidden.add(id);
  }

  // position camera from aim
  setCam(pos: { x: number; y: number; z: number }, yaw: number, pitch: number, duck: number): void {
    this.camera.position.set(pos.x, pos.y + (duck ? 40 : 60), pos.z);
    this.camera.rotation.y = yaw;
    this.camera.rotation.x = -pitch;
    this.selfEye = duck ? 40 : 60;
  }

  get eyeY(): number { return this.selfEye; }

  // world space point just in front of gun (self) for muzzle
  gunMouth(): { x: number; y: number; z: number } {
    const dir = new THREE.Vector3(0, 0, -1);
    dir.applyEuler(this.camera.rotation);
    return {
      x: this.camera.position.x + dir.x * 28,
      y: this.camera.position.y - 8 + dir.y * 28,
      z: this.camera.position.z + dir.z * 28,
    };
  }

  muzzle(id: string, x: number, y: number, z: number, big: boolean): void {
    const s = new THREE.Mesh(
      big ? new THREE.SphereGeometry(6, 6, 4) : new THREE.SphereGeometry(3.4, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0xffdda0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }),
    );
    s.position.set(x, y, z);
    this.scene.add(s);
    this.fx.push({ obj: s, life: big ? 0.09 : 0.05, max: big ? 0.09 : 0.05 });
  }

  bulletSpark(x: number, y: number, z: number): void {
    const s = new THREE.Mesh(new THREE.SphereGeometry(1.6, 4, 3),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending }));
    s.position.set(x, y, z);
    this.scene.add(s);
    this.fx.push({ obj: s, life: 0.14, max: 0.14, grow: 6 });
  }

  // smoke cloud at position with radius, live for till seconds
  updateSmokes(smokes: { x: number; z: number; r: number; till: number }[], now: number): void {
    const active = new Set<string>();
    for (let i = 0; i < smokes.length; i++) {
      const s = smokes[i];
      const key = i + '_' + s.x.toFixed(0) + s.z.toFixed(0);
      active.add(key);
      let spr = this.smokesById.get(key);
      if (!spr) {
        spr = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.smokeTex, color: 0xc9d2dd, transparent: true, opacity: 0.55,
          depthWrite: false,
        }));
        spr.renderOrder = 2;
        this.smokesById.set(key, spr);
        this.scene.add(spr);
      }
      const age = Math.max(0, Math.min(1, (s.till - now) / 12));
      spr.position.set(s.x, 70, s.z);
      spr.scale.setScalar(s.r * 2.4 * (0.7 + 0.3 * age));
      (spr.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(0.6, age * 0.8));
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
        const geo = new THREE.CircleGeometry(1, 24);
        m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: 0xff7a20, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending,
        }));
        m.rotation.x = -Math.PI / 2;
        m.renderOrder = 1;
        this.fireMats.set(key, m);
        this.scene.add(m);
      }
      const age = Math.max(0, Math.min(1, (f.till - now) / 6.5));
      const scale = f.r * 2 * (0.5 + 0.5 * age);
      m.scale.set(scale, scale, scale);
      m.position.set(f.x, 2 + Math.sin(now * 10 + i) * 1.5, f.z);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.15 + age * 0.6;
    }
    for (const [k, m] of this.fireMats) {
      if (!active.has(k)) {
        this.scene.remove(m);
        this.fireMats.delete(k);
      }
    }
  }

  bombFlash(x: number, y: number, z: number): void {
    const light = new THREE.PointLight(0xffffff, 4, 3000);
    light.position.set(x, y, z);
    this.scene.add(light);
    this.fx.push({ obj: light, life: 0.8, max: 0.8 });
    this.muzzle('bomb', x, y + 20, z, true);
  }

  flashBang(x: number, y: number, z: number): void {
    const l = new THREE.PointLight(0xffffff, 2.5, 1600);
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
    // hide dead actors for good
    for (const id of [...this.hidden]) {
      const a = this.actors.get(id);
      if (!a) { this.hidden.delete(id); continue; }
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  // raycast picker util for crosshair world position (blocked by colliders)
  rayBlocked(from: THREE.Vector3, dir: THREE.Vector3): number {
    let best = Infinity;
    for (const c of COLLIDERS) {
      const hit = rayAABB(from, dir, c.x0, c.y0, c.z0, c.x1, c.y1, c.z1);
      if (hit !== null && hit < best) best = hit;
    }
    return best;
  }
}

function cellSolidHere(c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
  return floorCells[r * COLS + c] === 0;
}

// slab ray intersection (AABB, y-up)
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
