// Core game orchestrator: input -> driver -> world/audio/hud events.
import { World } from './render.ts';
import { Sfx } from './audio.ts';
import { buildHud, buildBuyPanel, Radar, type Hud, type MenuStartArgs } from './ui.ts';
import { PracticeGame, OnlineGame, type GameDriver, type DriverView } from './game/driver.ts';
import type { PState } from '../../shared/protocol.ts';
import type { MatchEvt } from '../../shared/sim.ts';
import { BTN } from '../../shared/sim.ts';
import { PLANT_TIME, DEFUSE_TIME } from '../../shared/constants.ts';
import { PLANT_ZONES } from '../../shared/mapdef.ts';
import { catOf } from '../../shared/weapons.ts';

const DIGIT_TOOL: Record<string, string> = {
  '1': 'knife', '2': 'pistol', '3': 'primary', '4': 'flash', '5': 'smoke', '6': 'frag', '7': 'fire', '8': 'decoy',
};

function vmPower(w: string): number {
  const c = catOf(w);
  if (c === 'melee') return 0.3;
  if (c === 'pistol') return 1.0;
  if (c === 'smg') return 1.1;
  if (c === 'shotgun') return 2.0;
  if (c === 'sniper') return 2.3;
  if (c === 'lmg') return 1.3;
  return 1.5;
}

function tracerColor(w: string): number {
  const c = catOf(w);
  if (c === 'sniper') return 0xbfe4ff;
  if (c === 'rifle') return 0x9fd8ff;
  if (c === 'pistol') return 0xffe3a8;
  if (c === 'smg') return 0xfff2ad;
  if (c === 'shotgun') return 0xffb37a;
  if (c === 'lmg') return 0xffd9a0;
  return 0xcfe6ff;
}

export class Game {
  private world: World;
  private hud: Hud;
  private hudRoot: HTMLElement;
  private radar: Radar;
  private audio = new Sfx();
  private driver: GameDriver | null = null;
  private raf = 0;
  private lastT = 0;
  private keys: Record<string, boolean> = {};
  private mouse = { yaw: 0, pitch: 0 };
  private fireHeld = false;
  private locked = false;
  private over = false;
  private selfId = '';
  private specTarget = '';
  private cam = { x: 0, y: 0, z: 0 };
  private vmW = '';
  private vmTeam = -1;
  private vign = 0;
  private lastSb = 0;
  private buy = false;
  private sbOpen = false;
  private lastBars = { hp: -1, armor: -1 };
  private lastWpn = { w: '', mag: -2, res: -2 };
  private useStart = -1;
  private useKind: 'plant' | 'defuse' = 'plant';
  private joined = false;
  onExit: () => void = () => {};

  constructor(stage: HTMLElement, uiRoot: HTMLElement) {
    this.world = new World(stage);
    const h = buildHud(uiRoot);
    this.hud = h.hud;
    this.hudRoot = h.root;
    this.radar = new Radar(this.hudRoot.querySelector('#radar')!);
    this.bindKeys();
    this.bindPointer();
    const loop = (t: number) => { this.tick(t); };
    this.raf = requestAnimationFrame(loop);
  }

  start(opts: MenuStartArgs): void {
    this.disposeDriver();
    this.world.reset();
    this.audio.unlock();
    this.selfId = '';
    this.specTarget = '';
    this.over = false;
    this.joined = false;
    this.keys = {};
    this.mouse = { yaw: 0, pitch: 0 };
    this.buy = false;
    this.sbOpen = false;
    this.setBuy(false);
    this.setSb(false);
    this.hud.setConnState(opts.mode === 'online' ? 'CONNECTING…' : 'CLICK TO PLAY');
    this.hud.flash(0.4);

    const host = location.host;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    if (opts.mode === 'practice') {
      this.driver = new PracticeGame(opts.name, opts.teamSize, opts.skill);
      this.onJoined();
    } else {
      const g = new OnlineGame({ name: opts.name, code: opts.code, teamSize: opts.teamSize, url: `${proto}://${host}/ws` });
      this.driver = g;
      g.ready.then(() => this.onJoined()).catch(() => {});
    }
  }

  private onJoined(): void {
    this.joined = true;
    this.hudRoot.classList.add('show');
    this.hud.setConnState('CLICK TO PLAY');
    this.tryLock();
  }

  private tryLock(): void {
    const c = this.world.container.querySelector('canvas');
    if (c) {
      const r = c.requestPointerLock();
      if (r && typeof r.then === 'function') r.catch(() => {});
    }
  }

  private disposeDriver(): void {
    if (this.driver) { this.driver.dispose(); this.driver = null; }
    this.hudRoot.classList.remove('show');
  }

  // ---- input binding --------------------------------------------------------
  private bindKeys(): void {
    document.addEventListener('keydown', (e) => {
      if (!this.locked && !this.over) return;
      if (e.repeat) return;
      this.keys[e.code] = true;
      const d = this.driver;
      if (!d) return;
      if (e.code === 'KeyR') d.action({ t: 'reload' });
      else if (e.code === 'KeyB') { this.buy = !this.buy; this.setBuy(this.buy); }
      else if (e.code === 'Tab') { this.sbOpen = true; this.setSb(true); }
      else if (e.code === 'KeyE') { /* use is fire bit; nothing here */ }
      else if (e.code.startsWith('Digit')) this.digitTool(e.code, d);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    document.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'Tab' && this.sbOpen) { this.sbOpen = false; this.setSb(false); }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const sens = (this.keys['ControlLeft'] || this.keys['ControlRight']) ? 1.0 : 2.3;
      this.mouse.yaw -= e.movementX * 0.0021 * sens;
      this.mouse.pitch -= e.movementY * 0.0021 * sens;
      const lim = Math.PI / 2 - 0.02;
      this.mouse.pitch = Math.max(-lim, Math.min(lim, this.mouse.pitch));
    });
    document.addEventListener('mousedown', (e) => { if (e.button === 0) this.fireHeld = true; });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.fireHeld = false; });
  }

  private bindPointer(): void {
    const ov = this.hudRoot.querySelector('#pointer') as HTMLElement;
    ov.addEventListener('click', () => {
      if (this.buy) { this.buy = false; this.setBuy(false); }
      this.tryLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement != null;
      if (this.locked) {
        this.buy = false;
        this.setBuy(false);
        this.hud.setConnState('');
      } else if (this.joined && !this.over) {
        this.hud.setConnState('CLICK TO PLAY');
      }
    });
  }

  private digitTool(code: string, d: GameDriver): void {
    const id = DIGIT_TOOL[code];
    if (!id) return;
    if (id === 'knife') d.action({ t: 'slot', slot: 0 });
    else if (id === 'pistol') d.action({ t: 'slot', slot: 1 });
    else if (id === 'primary') d.action({ t: 'slot', slot: 2 });
    else d.action({ t: 'weapon', id });
  }

  private setBuy(v: boolean): void {
    this.hudRoot.querySelector('#buypanel')?.classList.toggle('hidden', !v);
    if (v) {
      const me = this.self();
      const box = this.hudRoot.querySelector('#buybox') as HTMLElement;
      if (box) buildBuyPanel(box, me, { onBuy: (item) => this.driver?.action({ t: 'buy', item }) });
    }
  }

  private setSb(v: boolean): void {
    this.hud.setSbOpen(v);
    if (v) this.renderScoreboard();
  }

  private self(): PState | undefined {
    if (!this.driver) return undefined;
    return this.driver.view.players.find((p) => p.id === this.driver!.view.selfId);
  }

  // ---- main tick --------------------------------------------------------------
  private tick(t: number): void {
    requestAnimationFrame((tt) => this.tick(tt));
    const dt = Math.min(0.1, (t - this.lastT) / 1000 || 0.016);
    this.lastT = t;
    const d = this.driver;
    if (!d) { this.world.render(); return; }
    d.step(dt);
    const view = d.view;
    if (!this.joined && !view.selfId) { this.world.render(); return; }

    if (this.locked && !this.over) {
      d.setInput({ seq: 0, yaw: this.mouse.yaw, pitch: this.mouse.pitch, f: this.forward(), s: this.strafe(), b: this.buttons() });
    }

    const me = this.self();
    this.camControl(view, me, dt);
    this.updateVm(view, me, dt);

    this.world.update(dt, view.players, view.selfId);
    this.world.updateSmokes(view.smokes, view.simNow);
    this.world.updateFires(view.fires, view.simNow);
    this.world.tickFx(dt);
    this.updateHud(view, me);
    this.updateUse(view, me);

    const evs = d.events();
    for (const e of evs) this.onEvent(e, view);

    this.vign *= Math.exp(-2.4 * dt);
    if (this.vign < 0.02) this.vign = 0;
    if (this.vign > 0) this.hud.vignette(Math.min(1, this.vign));

    if (this.sbOpen && t - this.lastSb > 400) { this.lastSb = t; this.renderScoreboard(); }
    this.world.render();
  }

  private buttons(): number {
    let b = 0;
    if (this.keys['Space']) b |= BTN.JUMP;
    if (this.keys['ControlLeft'] || this.keys['ControlRight']) b |= BTN.CROUCH;
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) b |= BTN.WALK;
    if (this.fireHeld) b |= BTN.FIRE;
    if (this.keys['KeyE']) b |= BTN.USE;
    return b;
  }
  private forward(): number {
    let f = 0;
    if (this.keys['KeyW']) f += 1;
    if (this.keys['KeyS']) f -= 1;
    return f;
  }
  private strafe(): number {
    let s = 0;
    if (this.keys['KeyD']) s += 1;
    if (this.keys['KeyA']) s -= 1;
    return s;
  }

  // ---- camera ----------------------------------------------------------------
  private camControl(view: DriverView, me: PState | undefined, dt: number): void {
    if (me && me.alive) {
      this.specTarget = '';
      // Extrapolate the newest authoritative snapshot forward by its age using the
      // snapshot velocity so the own view does not lag a full tick behind input,
      // then track it with a fast (near-crisp) easing. Snap instantly across large
      // gaps (spawn/teleport/round reset) so the camera never sweeps the map.
      const age = Math.max(0, Math.min(view.simAge, 0.06));
      const tx = me.x + me.vx * age;
      const ty = me.y;
      const tz = me.z + me.vz * age;
      const dx = tx - this.cam.x, dy = ty - this.cam.y, dz = tz - this.cam.z;
      const dist = Math.hypot(dx, dy, dz);
      const k = dist > 240 ? 1 : 1 - Math.exp(-55 * Math.min(dt, 0.05));
      this.cam.x += dx * k;
      this.cam.y += dy * k;
      this.cam.z += dz * k;
      this.world.setCam(this.cam, this.mouse.yaw, this.mouse.pitch, me.duck ? 1 : 0);
      return;
    }
    if (!me) return;
    const alive = view.players.filter((p) => p.alive && p.id !== view.selfId);
    const mates = alive.filter((p) => p.team === me.team);
    const foes = alive.filter((p) => p.team !== me.team);
    const pick = mates.length ? mates : foes.length ? foes : alive;
    const cur = pick.find((p) => p.id === this.specTarget) || pick[0];
    if (cur) {
      this.specTarget = cur.id;
      this.cam.x += (cur.x - this.cam.x) * 0.18;
      this.cam.y += (cur.y - this.cam.y) * 0.18;
      this.cam.z += (cur.z - this.cam.z) * 0.18;
      this.mouse.yaw += angDiff(cur.yaw, this.mouse.yaw) * 0.12;
      this.mouse.pitch += (cur.pitch - this.mouse.pitch) * 0.12;
    }
    this.world.setCam(this.cam, this.mouse.yaw, this.mouse.pitch, 0);
  }

  // ---- first-person held weapon ----------------------------------------------
  private updateVm(view: DriverView, me: PState | undefined, dt: number): void {
    void view;
    const w = this.world;
    if (me && me.alive && me.curW) {
      if (me.curW !== this.vmW || me.team !== this.vmTeam) {
        this.vmW = me.curW;
        this.vmTeam = me.team;
        w.vmSet(me.curW, me.team);
      }
      w.vmShow(true);
      w.vmUpdate(dt, { speed: Math.hypot(me.vx, me.vz), duck: me.duck === 1, using: me.using === 1 });
    } else {
      if (this.vmW) { this.vmW = ''; this.vmTeam = -1; }
      w.vmShow(false);
    }
  }

  // ---- hud ---------------------------------------------------------------------
  private updateHud(view: DriverView, me: PState | undefined): void {
    const h = view.header;
    if (!this.selfId) this.hud.setHeader(h, null);
    if (me) {
      this.selfId = me.id;
      if (me.hp !== this.lastBars.hp || me.armor !== this.lastBars.armor) {
        this.hud.setBars(me.hp, me.armor);
        this.lastBars = { hp: me.hp, armor: me.armor };
      }
      if (me.curW !== this.lastWpn.w || me.mag !== this.lastWpn.mag || me.res !== this.lastWpn.res) {
        this.hud.setWeapon(me.curW, me.mag, me.res);
        this.lastWpn = { w: me.curW, mag: me.mag, res: me.res };
      }
      this.hud.setBomb(!!me.hasBomb);
    }
    const t = Math.ceil(h.ph === 'live' ? (h.boomIn > 0 ? h.boomIn : h.rt) : h.boomIn > 0 || h.ph === 'freeze' ? h.bt : h.ph === 'warmup' ? h.wt : h.rt);
    const key = `${h.ph}|${h.rnd}|${h.scr[0]}-${h.scr[1]}|${t}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      this.hud.setHeader(h, this.lastWinner);
    }
    this.radar.draw(view.players, me, h);
  }

  private lastWinner: number | null = null;
  private hudKey = '';

  private updateUse(view: DriverView, me: PState | undefined): void {
    const el = this.hudRoot.querySelector('#progwrap') as HTMLElement;
    const msg = this.hudRoot.querySelector('#plantmsg') as HTMLElement;
    if (me && me.alive && me.using && (me.useKind === 'plant' || me.useKind === 'defuse')) {
      if (this.useStart < 0) { this.useStart = this.lastT; this.useKind = me.useKind; }
      const dur = this.useKind === 'plant' ? PLANT_TIME : DEFUSE_TIME;
      const frac = (this.lastT - this.useStart) / 1000 / dur;
      this.hud.plantProg(frac, this.useKind);
      void el; void msg;
    } else if (this.useStart >= 0) {
      this.useStart = -1;
      el.classList.add('hidden');
      msg.classList.add('hidden');
    }
  }

  private renderScoreboard(): void {
    const d = this.driver;
    if (!d) return;
    const v = d.view;
    this.hud.scoreboard(v.players, v.header, v.selfId);
  }

  // ---- events -------------------------------------------------------------------
  private onEvent(e: MatchEvt, view: DriverView): void {
    const E = e as unknown as Record<string, any>;
    switch (e.k) {
      case 'kill': {
        const kid = String(E.kid ?? '');
        const isKiller = kid === this.selfId;
        const isVic = String(E.v ?? '') === this.selfId;
        this.hud.killfeed({ kid, kn: String(E.kn ?? ''), v: String(E.v ?? ''), vn: String(E.vn ?? ''), w: String(E.w ?? ''), hs: E.hs ? 1 : 0 });
        if (isKiller) { this.hud.crosshair(true); setTimeout(() => this.hud.crosshair(false), 90); this.audio.killmark(); }
        if (isVic) { this.vign = 1; this.audio.hurt(); }
        break;
      }
      case 'dmg':
        if (e.to === this.selfId) {
          const amt = Number(E.amt ?? 10);
          this.vign = Math.max(this.vign, Math.min(1, amt / 60));
          if (E.hs) this.audio.headhit();
          this.audio.hurt();
        }
        break;
      case 'youdead':
        if (e.to === this.selfId) { this.vign = 1; this.audio.hurt(); }
        break;
      case 'round': {
        this.lastWinner = E.winner ?? null;
        const reason = String(E.reason ?? '');
        const me = this.self();
        const won = me ? me.team === E.winner : false;
        let text: string;
        if (reason === 'defused') text = 'BOMB DEFUSED';
        else if (reason === 'boom') text = 'BOMB DETONATED';
        else text = won ? 'ROUND WON' : 'ROUND LOST';
        if (!won && me) this.hud.banner('loss', text, `${view.header.scr[0]} - ${view.header.scr[1]}`);
        else if (won) this.hud.banner('win', text, `${view.header.scr[0]} - ${view.header.scr[1]}`);
        if (won) this.audio.roundWin(); else this.audio.roundLose();
        break;
      }
      case 'match': {
        const me = this.self();
        const won = me ? me.team === E.winner : false;
        this.hud.banner(won ? 'win' : 'loss', won ? 'VICTORY' : 'DEFEAT', `MATCH FINAL ${view.header.scr[0]} - ${view.header.scr[1]}`);
        this.audio.bombPlanted();
        this.over = true;
        if (this.locked) document.exitPointerLock?.();
        setTimeout(() => this.endGame(), 10000);
        break;
      }
      case 'phase':
        if (E.ph === 'live') this.hud.banner('info', 'FIGHT');
        break;
      case 'planted':
        this.hud.banner('info', 'BOMB PLANTED — DEFENDERS HAVE ' + Math.ceil(view.header.boomIn) + 's');
        this.audio.bombPlanted();
        break;
      case 'defused':
        this.hud.banner('info', 'BOMB DEFUSED');
        this.audio.defuseBeep();
        break;
      case 'boom': {
        const site = Number(E.site ?? 0);
        const z = PLANT_ZONES[site - 1];
        if (z) this.world.bombFlash(z.x, 2, z.z);
        this.audio.boom(0.95);
        break;
      }
      case 'flash':
        if (e.to === this.selfId) {
          const dur = Math.max(0.4, Number(E.d ?? 1));
          this.hud.flash(dur);
          this.audio.flashPop();
        }
        break;
      case 'explode': {
        const g = String(E.g ?? '');
        const x = Number(E.x ?? 0), y = Number(E.y ?? 0), z = Number(E.z ?? 0);
        const me = this.self();
        const dist = me ? Math.hypot(me.x - x, me.z - z) : 9000;
        const gain = Math.max(0, 1 - dist / 2600);
        if (g === 'frag') this.audio.fragPop(gain);
        else if (g === 'smoke' || g === 'decoy') this.audio.smokePop(gain);
        else if (g === 'flash') this.audio.flashPop();
        else if (g === 'fire') this.audio.boom(gain * 0.5);
        this.audio.throwSnd();
        break;
      }
      case 'muzzle': {
        const id = String(E.id ?? '');
        const x = Number(E.x ?? 0), y = Number(E.y ?? 0), z = Number(E.z ?? 0);
        const w = String(E.w ?? 'knife');
        const big = w === 'obliterator' || w === 'raptor';
        if (id !== this.selfId) {
          this.world.muzzle(id, x, y, z, big);
          const me = this.self();
          if (me) {
            const dist = Math.hypot(me.x - x, me.z - z);
            const g = Math.max(0, 1 - dist / 3000);
            if (g > 0.05) this.audio.gunshot(w, Math.min(1, g));
          }
        }
        break;
      }
      case 'shot':
        if (e.to === this.selfId) {
          const me = this.self();
          const w = me?.curW ?? '';
          const m = this.world.gunMouth();
          this.world.ownMuzzle(m.x, m.y, m.z, w === 'obliterator' || w === 'raptor', vmPower(w));
          this.audio.gunshot(w, 0.5);
        }
        break;
      case 'tracer': {
        const id = String(E.id ?? '');
        const w = String(E.w ?? 'vireo');
        const x0 = Number(E.x0 ?? 0), y0 = Number(E.y0 ?? 0), z0 = Number(E.z0 ?? 0);
        const x1 = Number(E.x1 ?? 0), y1 = Number(E.y1 ?? 0), z1 = Number(E.z1 ?? 0);
        // Own bullets are invisible (no beam leaving the gun); the impact marker
        // below is the feedback. Everyone else sees the full tracer.
        if (id !== this.selfId) this.world.tracer(x0, y0, z0, x1, y1, z1, tracerColor(w));
        this.world.impact(x1, y1, z1);
        break;
      }
      case 'reload': if (e.to === this.selfId) this.audio.reload(); break;
      case 'reload_done': if (e.to === this.selfId) this.audio.reloadDone(); break;
      case 'empty': if (e.to === this.selfId) this.audio.dry(); break;
      case 'throw': case 'thrown': if (e.to === this.selfId) this.audio.throwSnd(); break;
      case 'channel_beep': if (e.to === this.selfId) { if (E.kind === 'plant') this.audio.plantBeep(true); else this.audio.defuseBeep(); } break;
      case 'use_begin': if (e.to === this.selfId) { this.useStart = this.lastT; this.useKind = E.kind === 'plant' ? 'plant' : 'defuse'; } break;
      case 'land': if (e.to === this.selfId) this.audio.land(0.3); break;
      case 'switch': if (e.to === this.selfId) this.audio.switch(); break;
      case 'buy': if (e.to === this.selfId) this.audio.buy(); break;
      case 'bombpick': if (e.to === this.selfId) this.audio.pick(); break;
      default: break;
    }
  }

  private endGame(): void {
    this.disposeDriver();
    document.exitPointerLock?.();
    this.audio.setMuted(true);
    this.onExit();
  }
}

function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
