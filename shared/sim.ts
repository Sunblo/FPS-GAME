// MatchSim - authoritative round-based bomb/defusal simulation (original design).
// Runs identically inside a Cloudflare Durable Object (online) and in the
// browser for practice-with-bots. Clients only ever contribute *inputs*; every
// gameplay fact (position, damage, money, ammo, weapons, objectives, score)
// is decided here and never trusted from the wire.
import {
  MAX_HEALTH, MAX_ARMOR, TEAM_ATTACK, TEAM_DEFEND, GRAVITY,
  PLANT_TIME, DEFUSE_TIME, BOMB_ARM_TIME, FREEZE_TIME, BUY_TIME, ROUND_TIME,
  WARMUP_TIME, ROUND_END_DELAY, START_MONEY, MAX_MONEY, MONEY_KILL, MONEY_WIN,
  MONEY_LOSS_START, MONEY_LOSS_STEP, MONEY_LOSS_MAX, MONEY_PLANT,
  MONEY_TEAM_PLANT, MONEY_DEFUSE, MONEY_TEAM_DEFUSE, FIRST_TO, SIDE_SWAP_ROUND,
  ARMOR_DMG_ABSORB, HEADSHOT_MULT, LIMB_MULT, EYE_STAND, EYE_CROUCH,
  MAX_REG_ROUNDS,
} from './constants.ts';
import { clamp } from './mathv.ts';
import type { Vec3 } from './mathv.ts';
import { WEAPONS, UTILITIES, ARMOR_VEST, ARMOR_HELMET, catOf } from './weapons.ts';
import { stepPhysics, rayCollide } from './geo.ts';
import { SPAWNS, plantZoneAt, buyZone, COLLIDERS } from './mapdef.ts';
import type { CInput, MatchConfig, Phase, SnapEvt, Team } from './types.ts';

export const BTN = { JUMP: 1, CROUCH: 2, WALK: 4, FIRE: 8, ZOOM: 16, USE: 32 } as const;

export interface SlotW { id: string; mag: number; res: number }

export interface SimPlayer {
  id: string; name: string; team: Team; isBot: boolean; online: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  duck: boolean; onGround: boolean;
  hp: number; armor: number; hasHelmet: boolean;
  money: number; alive: boolean;
  slots: { knife: SlotW; pistol: SlotW; primary: SlotW };
  util: Record<string, number>;
  curW: string; equipT: number;
  nextFireAt: number; reloadUntil: number; reloadAt: number;
  recoilAmt: number; lastShotAt: number;
  hasBomb: boolean; kills: number; deaths: number; lossStreak: number;
  bombPlants: number; bombDefuses: number; hs: number; mvpScore: number;
  throwing: number;
  using: boolean; useKind: 'plant' | 'defuse'; useStart: number;
  useAt: { x: number; z: number }; useHeld: boolean; useBeepT: number;
  blindT: number; deadT: number; fireTick: number;
  walkPhase: number; moving: number; moveBits: number;
  cmd: { yaw: number; pitch: number; f: number; s: number; b: number };
}

export interface BombDrop { x: number; z: number }
export interface SmokeCloud { x: number; z: number; r: number; till: number }
export interface FireZone { x: number; z: number; r: number; till: number }
export interface GProj {
  id: number; type: string; x: number; y: number; z: number;
  vx: number; vy: number; vz: number; fuse: number; bounced: number;
  owner: string; tick: number; live: boolean;
}
export interface DecoyActive { x: number; z: number; till: number; next: number }

export interface MatchEvt extends SnapEvt {
  to?: string; // only delivered to that player id
}

const rnd = Math.random;

function blank(team: Team): SimPlayer {
  return {
    id: '', name: '', team, isBot: false, online: false,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0, duck: false, onGround: false,
    hp: MAX_HEALTH, armor: 0, hasHelmet: false, money: START_MONEY, alive: false,
    slots: {
      knife: { id: 'knife', mag: 0, res: 0 },
      pistol: { id: 'vireo', mag: WEAPONS.vireo.mag, res: WEAPONS.vireo.reserve },
      primary: { id: '', mag: 0, res: 0 },
    },
    util: { flash: 0, frag: 0, smoke: 0, fire: 0, decoy: 0 },
    curW: 'knife', equipT: 0,
    nextFireAt: 0, reloadUntil: 0, reloadAt: 0,
    recoilAmt: 0, lastShotAt: -9,
    hasBomb: false, kills: 0, deaths: 0, lossStreak: 0,
    bombPlants: 0, bombDefuses: 0, hs: 0, mvpScore: 0,
    throwing: 0,
    using: false, useKind: 'plant', useStart: 0, useAt: { x: 0, z: 0 },
    useHeld: false, useBeepT: 0,
    blindT: 0, deadT: 0, fireTick: 0,
    walkPhase: 0, moving: 0, moveBits: 0,
    cmd: { yaw: 0, pitch: 0, f: 0, s: 0, b: 0 },
  };
}

export class MatchSim {
  cfg: MatchConfig;
  players = new Map<string, SimPlayer>();
  order: string[] = [];
  phase: Phase = 'warmup';
  now = 0;
  phaseUntil = 0;
  roundNum = 0;
  liveT = 0;
  buyUntil = 0;
  buyLeft = 0;
  freezeLeft = 0;
  warmupLeft = WARMUP_TIME;
  score: Record<number, number> = { [TEAM_ATTACK]: 0, [TEAM_DEFEND]: 0 };
  attackerSide: Team = TEAM_ATTACK;
  planted = 0;
  boomAt = 0;
  planter = '';
  drops: BombDrop[] = [];
  smokes: SmokeCloud[] = [];
  fires: FireZone[] = [];
  grenades: GProj[] = [];
  decoys: DecoyActive[] = [];
  matchOver = false;
  lastWinner = 0;
  lastReason = '';
  targetWin = FIRST_TO;
  maxRounds = MAX_REG_ROUNDS;
  private events: MatchEvt[] = [];
  private gid = 1;
  private dt = 1 / 30;
  paused = false;
  onLog?: (s: string) => void;

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    this.targetWin = cfg.firstTo || FIRST_TO;
    this.warmupLeft = cfg.warmup === false ? 6 : WARMUP_TIME;
    this.phaseUntil = this.warmupLeft;
  }
  log(s: string) { if (this.onLog) this.onLog(s); }

  // roster ----------------------------------------------------------------------
  addPlayer(id: string, name: string, isBot = false): SimPlayer {
    const p = blank(this.assignTeam());
    p.id = id; p.name = name; p.isBot = isBot; p.online = !isBot;
    this.players.set(id, p);
    this.order.push(id);
    return p;
  }
  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    p.online = false;
    p.alive = false;
    if (!p.isBot) {
      const online = [...this.players.values()].some((x) => !x.isBot && x.online && x.alive);
      if (!online && this.order.length > 0 && this.phase !== 'matchover') {
        this.phase = 'matchover';
      }
    }
  }
  assignTeam(): Team {
    let a = 0, b = 0;
    for (const p of this.players.values()) {
      if (p.team === TEAM_ATTACK) a++; else if (p.team === TEAM_DEFEND) b++;
    }
    return a <= b ? TEAM_ATTACK : TEAM_DEFEND;
  }
  playersOfTeam(t: Team): SimPlayer[] {
    const out: SimPlayer[] = [];
    for (const id of this.order) { const p = this.players.get(id)!; if (p.team === t) out.push(p); }
    return out;
  }

  // input storage ---------------------------------------------------------------
  applyInput(id: string, c: CInput): void {
    const p = this.players.get(id);
    if (!p || !p.online && !p.isBot) return;
    p.cmd.yaw = c.yaw;
    p.cmd.pitch = clamp(c.pitch, -1.553, 1.553);
    p.cmd.f = clamp(c.f, -1, 1);
    p.cmd.s = clamp(c.s, -1, 1);
    p.cmd.b = c.b & 63;
  }

  // helpers ----------------------------------------------------------------------
  eyeH(p: SimPlayer): number { return p.duck ? EYE_CROUCH : EYE_STAND; }
  aliveTeam(t: Team): SimPlayer[] { return this.playersOfTeam(t).filter((p) => p.alive); }
  attackerTeam(): SimPlayer[] { return this.playersOfTeam(this.attackerSide); }
  defenderTeam(): SimPlayer[] {
    return this.playersOfTeam(this.attackerSide === TEAM_ATTACK ? TEAM_DEFEND : TEAM_ATTACK);
  }
  isDefender(p: SimPlayer): boolean { return p.team !== this.attackerSide; }

  slotFor(p: SimPlayer, w: string): SlotW | null {
    if (w === 'knife') return p.slots.knife;
    if (catOf(w) === 'pistol') return p.slots.pistol;
    if (p.slots.primary.id === w) return p.slots.primary;
    return null;
  }
  reloading(p: SimPlayer): boolean { return this.now < p.reloadUntil; }

  // switching / reload -------------------------------------------------------------
  switchTo(p: SimPlayer, slot: number): void {
    if (!p.alive || this.now < p.equipT) return;
    if (this.reloading(p)) p.reloadUntil = 0;
    const owned: string[] = ['knife', p.slots.pistol.id];
    if (p.slots.primary.id) owned.push(p.slots.primary.id);
    for (const k of Object.keys(UTILITIES)) if ((p.util[k] ?? 0) > 0) owned.push(k);
    const target = slot === 0 ? 'knife' : slot === 1 ? p.slots.pistol.id : (owned[slot] ?? p.curW);
    if (target && target !== p.curW) {
      const t = catOf(target) === 'sniper' ? 1.1 : catOf(target) === 'melee' ? 0.45 : catOf(target) === 'utility' ? 0.6 : 0.75;
      p.curW = target;
      p.equipT = this.now + t;
      this.ev({ k: 'switch', to: p.id, snd: 'switch' });
    }
  }
  reload(p: SimPlayer): void {
    if (!p.alive || this.now < p.equipT || this.reloading(p)) return;
    const wd = WEAPONS[p.curW];
    const slot = this.slotFor(p, p.curW);
    if (!wd || !slot || wd.mag === 0 || slot.mag >= wd.mag || slot.res <= 0) return;
    p.reloadUntil = this.now + wd.reload;
    p.reloadAt = this.now;
    this.ev({ k: 'reload', to: p.id, snd: 'reload' });
  }
  private finishReload(p: SimPlayer): void {
    if (p.reloadAt <= 0) return;
    const wd = WEAPONS[p.curW];
    const slot = this.slotFor(p, p.curW);
    if (!wd || !slot) return;
    const need = Math.min(wd.mag - slot.mag, slot.res);
    slot.mag += need;
    slot.res -= need;
    p.reloadAt = 0;
    this.ev({ k: 'reload_done', to: p.id, snd: 'reload_end' });
  }

  // firing -------------------------------------------------------------------------
  private tryFire(p: SimPlayer): void {
    if (!p.alive || this.phase !== 'live' && this.phase !== 'warmup') return;
    if (this.now < p.equipT) return;
    const w = p.curW;
    if (catOf(w) === 'utility') return; // utilities throw on use button? we use fire to throw
    const wd = WEAPONS[w];
    if (!wd) return;
    if (this.now < p.nextFireAt) return;
    // throw utilities on fire when a util is equipped
    const interval = 60 / Math.max(wd.rpm, 1);
    p.nextFireAt = this.now + interval;
    if (this.reloading(p)) this.finishReload(p);
    // ammo
    const warmup = this.phase === 'warmup';
    const slot = this.slotFor(p, w);
    if (slot) {
      if (wd.mag > 0) {
        if (slot.mag <= 0) {
          p.nextFireAt = this.now + 0.25;
          this.ev({ k: 'empty', to: p.id, snd: 'dry' });
          return;
        }
        if (!warmup) slot.mag--;
      }
    }
    p.recoilAmt = Math.min(p.recoilAmt + wd.spreadPerShot * 1.0, wd.recoilMax);
    p.lastShotAt = this.now;
    const pellets = wd.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const sp = this.shotSpread(wd, p);
      const aY = p.cmd.yaw + (rnd() - 0.5) * 2 * (sp * Math.PI / 180);
      const aP = clamp(p.cmd.pitch + (rnd() - 0.5) * 2 * (sp * Math.PI / 180), -1.55, 1.55);
      this.fireRay(p, wd, this.fwd3(aY, aP), warmup);
    }
    this.ev({ k: 'shot', to: p.id, snd: 'shot' });
  }

  private shotSpread(wd: any, p: SimPlayer): number {
    let s = wd.spread + p.recoilAmt * (wd.spreadPerShot || 1);
    s *= p.duck ? wd.crouchFactor : 1;
    if (!p.onGround) s += wd.airSpread;
    else if (Math.hypot(p.vx, p.vz) > 90) s += wd.moveSpread;
    return Math.min(s, wd.spreadMax + wd.spread);
  }

  private fireRay(p: SimPlayer, wd: any, dir: Vec3, warmup: boolean): void {
    const from: Vec3 = { x: p.x, y: p.y + this.eyeH(p), z: p.z };
    const maxD = wd.rangeMax || 9000;
    const w = rayCollide(from.x, from.y, from.z, dir.x, dir.y, dir.z, maxD);
    let bestD = w.hit ? w.dist : maxD;
    let best: SimPlayer | null = null;
    let bestPart = 'body';
    if (wd.cat === 'melee') {
      // melee: short reach arc
      const reach = 84;
      for (const o of this.players.values()) {
        if (o.id === p.id || !o.alive || o.team === p.team) continue;
        const dx = o.x - p.x, dy = o.y + this.eyeH(o) - from.y, dz = o.z - p.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < reach) {
          // arc check: dot with dir
          const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / (d || 1);
          if (dot > 0.35 && d < bestD) { bestD = d; best = o; bestPart = d > reach * 0.55 ? 'body' : 'head'; }
        }
      }
      if (best) this.applyDamage(p, best, bestPart === 'head' ? wd.dmg * 1.9 : wd.dmg, bestPart, wd, warmup);
      return;
    }
    for (const o of this.players.values()) {
      if (o.id === p.id || !o.alive || o.team === p.team) continue;
      if (p.team === o.team) continue;
      const oh = this.eyeH(o);
      const parts = [
        { y: o.y + oh * 0.93, r: 10, name: 'head' },
        { y: o.y + oh * 0.5, r: 17, name: 'body' },
        { y: o.y + 10, r: 13, name: 'limbs' },
      ];
      for (const pt of parts) {
        const d = this.raySphere(from, dir, { x: o.x, y: pt.y, z: o.z }, pt.r);
        if (d < bestD) { bestD = d; best = o; bestPart = pt.name; }
      }
    }
    if (!best) return;
    if (warmup) { this.ev({ k: 'hitwarm', to: best.id }); return; }
    let dmg = wd.dmg;
    const t = Math.hypot(best.x - from.x, best.z - from.z);
    if (t > wd.range && wd.rangeMax > wd.range) {
      const f = Math.max(0.35, 1 - ((t - wd.range) / (wd.rangeMax - wd.range)) * 0.8);
      dmg *= f;
    }
    this.applyDamage(p, best, dmg, bestPart, wd, false);
  }

  private applyDamage(src: SimPlayer, t: SimPlayer, dmg0: number, part: string, wd: any, warm: boolean): void {
    if (warm || !t.alive || this.phase !== 'live') return;
    let dmg = dmg0;
    let head = false;
    if (part === 'head') { dmg *= HEADSHOT_MULT; head = true; }
    else if (part === 'limbs') dmg *= LIMB_MULT;
    if (t.armor > 0 && (!head || t.hasHelmet)) {
      const absorb = Math.min(t.armor, dmg * ARMOR_DMG_ABSORB);
      t.armor = Math.max(0, Math.round(t.armor - absorb));
      dmg -= absorb;
    }
    dmg = Math.max(1, Math.round(dmg));
    t.hp -= dmg;
    if (head) t.hs++;
    src.mvpScore += dmg;
    this.ev({ k: 'dmg', to: t.id, hs: head ? 1 : 0, w: wd.id, from: src.id, amt: dmg });
    if (t.hp <= 0) this.kill(t, src, head, wd.id);
  }

  private kill(t: SimPlayer, src: SimPlayer | null, head: boolean, w: string): void {
    t.alive = false;
    t.deaths++;
    t.using = false;
    t.reloadUntil = 0;
    if (t.hasBomb) {
      t.hasBomb = false;
      this.drops.push({ x: t.x, z: t.z });
    }
    if (src && src.team !== t.team) {
      src.kills++;
      const reward = WEAPONS[w] ? WEAPONS[w].killReward ?? MONEY_KILL : MONEY_KILL;
      src.money = Math.min(MAX_MONEY, src.money + reward);
      this.ev({ k: 'moneydelta', to: src.id, amt: reward, reason: 'kill' });
      this.ev({ k: 'kill', kid: src.id, kn: src.name, v: t.id, vn: t.name, hs: head ? 1 : 0, w, x: t.x, y: t.y, z: t.z });
    } else {
      this.ev({ k: 'kill', kid: 'world', kn: 'World', v: t.id, vn: t.name, hs: head ? 1 : 0, w, x: t.x, y: t.y, z: t.z });
    }
    this.ev({ k: 'youdead', to: t.id });
    this.checkWin();
  }

  // check round end by elimination ---------------------------------------------------
  checkWin(): void {
    if (this.phase !== 'live') return;
    const aLive = this.aliveTeam(this.attackerSide).length;
    const dLive = this.aliveTeam(this.attackerSide === TEAM_ATTACK ? TEAM_DEFEND : TEAM_ATTACK).length;
    if (dLive === 0) {
      // bomb planted: attackers may still win on boom; if not planted attackers win now
      if (this.planted === 0) this.winRound(this.attackerSide, 'elim');
      return;
    }
    if (aLive === 0) this.winRound(this.attackerSide === TEAM_ATTACK ? TEAM_DEFEND : TEAM_ATTACK, 'elim');
  }

  // grenades ----------------------------------------------------------------------
  private tryThrow(p: SimPlayer, u: string): void {
    if ((p.util[u] ?? 0) <= 0 || this.now < p.throwing) return;
    const uf = UTILITIES[u];
    p.throwing = this.now + 0.4;
    p.util[u]--;
    const speed = uf.throwSpeed ?? 950;
    const dir = this.fwd3(p.cmd.yaw, p.cmd.pitch - 0.06);
    const start: Vec3 = { x: p.x + dir.x * 40, y: p.y + this.eyeH(p) - 4, z: p.z + dir.z * 40 };
    let vy = dir.y * speed + 210;
    if (p.cmd.pitch < 0.2) vy = Math.sin(p.cmd.pitch) * speed + 150;
    const fuse = uf.kind === 'flash' ? 0.85 : uf.kind === 'smoke' ? 1.2 : uf.kind === 'decoy' ? 0.6 : uf.kind === 'fire' ? 0.35 : 1.7;
    this.grenades.push({
      id: this.gid++, type: uf.kind, x: start.x, y: start.y, z: start.z,
      vx: dir.x * speed + p.vx * 0.5, vy, vz: dir.z * speed + p.vz * 0.5,
      fuse, bounced: 0, owner: p.id, tick: 0, live: true,
    });
    this.ev({ k: 'throw', to: p.id, snd: 'throw' });
    this.ev({ k: 'gthrow', g: uf.kind, x: start.x, y: start.y, z: start.z });
    this.ev({ k: 'thrown', to: p.id, x: start.x, y: start.y, z: start.z, g: uf.kind });
  }

  private stepGrenades(dt: number): void {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      if (!g.live) { this.grenades.splice(i, 1); continue; }
      g.tick += dt;
      g.fuse -= dt;
      g.vy -= GRAVITY * dt;
      let nx = g.x + g.vx * dt;
      let ny = g.y + g.vy * dt;
      let nz = g.z + g.vz * dt;
      if (ny < 0) {
        if (g.vy < -60) { g.bounced++; g.vy = -g.vy * 0.42; g.vx *= 0.66; g.vz *= 0.66; }
        else { g.vy = 0; g.vx *= 0.82; g.vz *= 0.82; }
        ny = 0;
        g.y = 0;
        g.x = nx; g.z = nz;
      } else { g.y = ny; g.x = nx; g.z = nz; }
      // world colliders
      const speed = Math.hypot(g.vx, g.vz);
      if (speed > 20) {
        for (const c of COLLIDERS) {
          if (g.x > c.x0 && g.x < c.x1 && g.z > c.z0 && g.z < c.z1 && g.y > c.y0 && g.y < c.y1) {
            const pl = g.x - c.x0, pr = c.x1 - g.x, pz = g.z - c.z0, pz2 = c.z1 - g.z;
            const mx = Math.min(pl, pr), mz = Math.min(pz, pz2);
            if (mx < mz) {
              g.x = pl < pr ? c.x0 - 4 : c.x1 + 4;
              g.vx *= -0.5;
            } else {
              g.z = pz < pz2 ? c.z0 - 4 : c.z1 + 4;
              g.vz *= -0.5;
            }
            if (g.y < c.y1 - 4 && g.y > c.y0) {
              g.y = Math.max(g.y, c.y0 - 2);
              g.vy = Math.abs(g.vy) * 0.35;
            }
            g.bounced++;
          }
        }
      }
      const stopped = Math.hypot(g.vx, g.vy, g.vz) < 34 && g.tick > 0.3;
      if (g.fuse <= 0 || stopped && (g.type === 'fire' || g.type === 'decoy' || g.type === 'smoke')) {
        this.detonate(g);
      }
    }
  }

  private detonate(g: GProj): void {
    g.live = false;
    const owner = this.players.get(g.owner) ?? null;
    const pos = { x: g.x, z: g.z };
    switch (g.type) {
      case 'frag': {
        this.ev({ k: 'explode', g: 'frag', x: g.x, y: g.y, z: g.z, snd: 'boom' });
        for (const t of this.players.values()) {
          if (!t.alive || this.phase !== 'live') continue;
          const d = Math.hypot(t.x - pos.x, t.z - pos.z);
          if (d > 420) continue;
          const block = rayCollide(t.x, t.y + this.eyeH(t), t.z, pos.x - t.x, g.y - (t.y + this.eyeH(t)), pos.z - t.z, d + 2);
          const blocked = block.hit && block.dist < d - 60;
          let dmg = 105 * (1 - d / 420);
          if (blocked) dmg *= 0.12;
          dmg = Math.max(1, Math.round(dmg));
          if (owner && owner.team === t.team) dmg = Math.round(dmg * 0.5);
          if (dmg > 0) {
            if (t.armor > 0) { const a = Math.min(t.armor, dmg * 0.4); t.armor = Math.max(0, Math.round(t.armor - a)); dmg -= a; }
            t.hp -= dmg;
            this.ev({ k: 'dmg', to: t.id, w: 'frag', hs: 0, from: owner?.id ?? '', amt: dmg });
            if (t.hp <= 0) this.kill(t, owner, false, 'frag');
          }
        }
        break;
      }
      case 'smoke': {
        this.ev({ k: 'explode', g: 'smoke', x: g.x, y: g.y, z: g.z, snd: 'smoke_pop' });
        this.smokes.push({ x: g.x, z: g.z, r: 235, till: this.now + 17 });
        break;
      }
      case 'flash': {
        this.ev({ k: 'explode', g: 'flash', x: g.x, y: g.y, z: g.z, snd: 'flash_pop' });
        for (const t of this.players.values()) {
          if (!t.alive) continue;
          const d = Math.hypot(t.x - pos.x, t.z - pos.z);
          if (d > 1200) continue;
          const dx = pos.x - t.x, dz = pos.z - t.z;
          const len = Math.hypot(dx, dz) || 1;
          const fwd = this.fwd3(t.cmd.yaw, 0);
          const dot = (dx * fwd.x + dz * fwd.z) / len;
          let exposure = Math.max(0, 1 - d / 1200) * (0.3 + 0.7 * Math.max(0, dot));
          const bl = rayCollide(t.x, t.y + this.eyeH(t), t.z, dx, g.y - (t.y + this.eyeH(t)), dz, d + 2);
          if (bl.hit && bl.dist < d - 80) exposure *= 0.4;
          const dur = exposure * 3.4;
          if (dur > 0.2) {
            t.blindT = Math.max(t.blindT, dur);
            this.ev({ k: 'flash', to: t.id, d: dur, snd: 'flashbang' });
            if (t.using) t.using = false;
          }
        }
        break;
      }
      case 'fire': {
        this.ev({ k: 'explode', g: 'fire', x: g.x, y: g.y, z: g.z, snd: 'boom' });
        this.fires.push({ x: g.x, z: g.z, r: 150, till: this.now + 6.5 });
        for (const t of this.players.values()) {
          if (!t.alive) continue;
          if (Math.hypot(t.x - pos.x, t.z - pos.z) < 170) {
            t.hp -= 45;
            this.ev({ k: 'dmg', to: t.id, w: 'fire', hs: 0, amt: 45 });
            if (t.hp <= 0) this.kill(t, owner, false, 'fire');
          }
        }
        break;
      }
      case 'decoy': {
        this.ev({ k: 'explode', g: 'decoy', x: g.x, y: g.y, z: g.z, snd: 'smoke_pop' });
        this.decoys.push({ x: g.x, z: g.z, till: this.now + 5.5, next: this.now + 0.5 });
        break;
      }
    }
  }

  private moveGrenadesCleanup(): void {
    this.grenades = this.grenades.filter((g) => g.live);
  }

  // objectives ---------------------------------------------------------------------
  private beginUse(p: SimPlayer): void {
    if (this.phase !== 'live') return;
    const site = plantZoneAt(p.x, p.z);
    if (site <= 0) return;
    if (this.planted > 0) {
      if (p.team === this.attackerSide) return; // attackers can't defuse
      p.using = true; p.useKind = 'defuse'; p.useStart = this.now; p.useAt = { x: p.x, z: p.z }; p.useBeepT = 0;
      this.ev({ k: 'use_begin', to: p.id, kind: 'defuse', site });
    } else if (p.team === this.attackerSide && p.hasBomb) {
      p.using = true; p.useKind = 'plant'; p.useStart = this.now; p.useAt = { x: p.x, z: p.z }; p.useBeepT = 0;
      this.ev({ k: 'use_begin', to: p.id, kind: 'plant', site });
    }
  }
  private abortUse(p: SimPlayer): void {
    if (!p.using) return;
    const kind = p.useKind;
    p.using = false;
    this.ev({ k: 'use_end', to: p.id, kind });
  }
  private tickUse(p: SimPlayer, dt: number): void {
    if (!p.using || !p.alive || this.phase !== 'live') { if (p.using) this.abortUse(p); return; }
    const site = plantZoneAt(p.x, p.z);
    if (site <= 0) { this.abortUse(p); return; }
    if (Math.hypot(p.x - p.useAt.x, p.z - p.useAt.z) > 52) { this.abortUse(p); return; }
    if (this.planted > 0 && p.team === this.attackerSide) { this.abortUse(p); return; }
    const dur = p.useKind === 'plant' ? PLANT_TIME : DEFUSE_TIME;
    p.useBeepT -= dt;
    if (p.useBeepT <= 0) {
      p.useBeepT = p.useKind === 'plant' ? 0.28 : 0.5;
      this.ev({ k: 'channel_beep', to: p.id, kind: p.useKind, snd: p.useKind === 'plant' ? 'plant_beep' : 'defuse_beep' });
    }
    if (this.now - p.useStart >= dur) {
      if (p.useKind === 'plant') this.doPlant(p, site);
      else this.doDefuse(p, site);
    }
  }
  private doPlant(p: SimPlayer, site: number): void {
    if (this.planted > 0) { this.abortUse(p); return; }
    p.using = false;
    p.hasBomb = false;
    p.bombPlants++;
    this.planted = site;
    this.planter = p.id;
    this.boomAt = this.now + BOMB_ARM_TIME;
    p.money = Math.min(MAX_MONEY, p.money + MONEY_PLANT);
    this.ev({ k: 'moneydelta', to: p.id, amt: MONEY_PLANT, reason: 'plant' });
    const att = this.attackerTeam();
    if (att.length) {
      const share = Math.max(100, Math.floor(MONEY_TEAM_PLANT / att.length));
      for (const t of att) t.money = Math.min(MAX_MONEY, t.money + share);
    }
    this.ev({ k: 'planted', site, snd: 'plant', planter: p.name });
    this.drops = [];
  }
  private doDefuse(p: SimPlayer, site: number): void {
    if (this.planted <= 0) { this.abortUse(p); return; }
    p.using = false;
    p.bombDefuses++;
    p.money = Math.min(MAX_MONEY, p.money + MONEY_DEFUSE);
    this.ev({ k: 'moneydelta', to: p.id, amt: MONEY_DEFUSE, reason: 'defuse' });
    const def = this.playersOfTeam(p.team);
    if (def.length) {
      const share = Math.max(100, Math.floor(MONEY_TEAM_DEFUSE / def.length));
      for (const t of def) t.money = Math.min(MAX_MONEY, t.money + share);
    }
    this.ev({ k: 'defused', site, snd: 'defuse', defuser: p.name });
    this.planted = 0;
    this.winRound(p.team, 'defused');
  }

  // bomb pickup ---------------------------------------------------------------------
  private pickupBomb(): void {
    if (this.phase !== 'live' || this.planted > 0) return;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      for (const p of this.players.values()) {
        if (!p.alive || p.team !== this.attackerSide || p.hasBomb) continue;
        if (Math.hypot(p.x - d.x, p.z - d.z) < 58) {
          p.hasBomb = true;
          this.drops.splice(i, 1);
          this.ev({ k: 'bombpick', to: p.id, snd: 'bomb_pickup' });
          break;
        }
      }
    }
  }

  // round flow --------------------------------------------------------------------------
  private spawnPlayer(p: SimPlayer): void {
    const list = SPAWNS[p.team];
    const s = list[(this.order.indexOf(p.id) % list.length + p.team * 3) % list.length];
    p.x = s.x + (rnd() - 0.5) * 40;
    p.z = s.z + (rnd() - 0.5) * 40;
    p.x = clamp(p.x, 30, 34 * 64 - 30);
    p.z = clamp(p.z, 30, 30 * 64 - 30);
    p.y = 0;
    p.vx = 0; p.vy = 0; p.vz = 0;
    p.yaw = s.yaw; p.pitch = 0;
    p.cmd.yaw = s.yaw; p.cmd.pitch = 0; p.cmd.f = 0; p.cmd.s = 0; p.cmd.b = 0;
    p.alive = true; p.hp = MAX_HEALTH;
    p.using = false; p.reloadUntil = 0; p.reloadAt = 0; p.equipT = 0;
    p.recoilAmt = 0; p.throwing = 0;
    p.onGround = false;
    p.deadT = 0;
    this.ev({ k: 'spawn', to: p.id });
  }

  private startFirstRound(): void {
    this.roundNum = 1;
    this.prepRound(TEAM_ATTACK);
  }

  private prepRound(atkSide: Team): void {
    this.attackerSide = atkSide;
    this.planted = 0;
    this.planter = '';
    this.drops = [];
    this.grenades = [];
    this.phase = 'freeze';
    this.freezeLeft = FREEZE_TIME;
    this.phaseUntil = this.now + FREEZE_TIME;
    this.buyUntil = this.now + BUY_TIME;
    this.buyLeft = BUY_TIME;
    this.liveT = ROUND_TIME;
    // Players keep weapons + armor they own between rounds; each round re-supplies
    // full magazines/reserve, utilities reset to zero and everyone re-spawns.
    let bomb = true;
    for (const id of this.order) {
      const p = this.players.get(id)!;
      // refill owned weapons
      const refill = (slot: { id: string; mag: number; res: number }) => {
        const wd = WEAPONS[slot.id];
        if (wd && wd.mag > 0) {
          slot.mag = wd.mag;
          slot.res = wd.reserve;
        }
      };
      refill(p.slots.pistol);
      refill(p.slots.primary);
      p.util = { flash: 0, frag: 0, smoke: 0, fire: 0, decoy: 0 };
      p.curW = 'knife';
      p.equipT = 0;
      p.hasBomb = false;
      p.hp = MAX_HEALTH;
      p.reloadUntil = 0; p.reloadAt = 0; p.recoilAmt = 0; p.throwing = 0;
      p.using = false;
      this.spawnPlayer(p);
      if (p.team === this.attackerSide && bomb) {
        p.hasBomb = true; bomb = false;
      }
    }
    this.ev({ k: 'phase', ph: 'freeze', rnd: this.roundNum, snd: 'round_start' });
  }

  private nextRound(): void {
    const r = this.roundNum + 1;
    if (r >= SIDE_SWAP_ROUND && (r - 1) % (SIDE_SWAP_ROUND - 1) === 0) {
      this.attackerSide = this.attackerSide === TEAM_ATTACK ? TEAM_DEFEND : TEAM_ATTACK;
    }
    this.roundNum = r;
    if (this.roundNum > this.maxRounds && this.score[TEAM_ATTACK] === this.score[TEAM_DEFEND]) {
      this.targetWin += 1;
    }
    this.prepRound(this.attackerSide);
  }

  private finishRoundTime(): void {
    if (this.planted > 0) return; // round continues while armed
    this.winRound(this.attackerSide === TEAM_ATTACK ? TEAM_DEFEND : TEAM_ATTACK, 'time');
  }

  winRound(winTeam: Team, reason: string): void {
    if (this.phase === 'roundend' || this.phase === 'matchover') return;
    this.phase = 'roundend';
    this.lastWinner = winTeam;
    this.lastReason = reason;
    this.phaseUntil = this.now + ROUND_END_DELAY;
    this.score[winTeam]++;
    const losers = this.playersOfTeam(winTeam === TEAM_ATTACK ? TEAM_DEFEND : TEAM_ATTACK);
    const winners = this.playersOfTeam(winTeam);
    for (const p of winners) {
      p.money = Math.min(MAX_MONEY, p.money + MONEY_WIN);
      p.lossStreak = 0;
      this.ev({ k: 'moneydelta', to: p.id, amt: MONEY_WIN, reason: 'win' });
    }
    for (const p of losers) {
      p.lossStreak++;
      const bonus = Math.min(MONEY_LOSS_START + MONEY_LOSS_STEP * (p.lossStreak - 1), MONEY_LOSS_MAX);
      p.money = Math.min(MAX_MONEY, p.money + bonus);
      this.ev({ k: 'moneydelta', to: p.id, amt: bonus, reason: 'loss' });
    }
    if (reason === 'boom') {
      // attackers bonus for explosion
      for (const p of this.attackerTeam()) {
        p.money = Math.min(MAX_MONEY, p.money + 350);
      }
    }
    this.ev({ k: 'round', winner: winTeam, reason, score: { a: this.score[TEAM_ATTACK], d: this.score[TEAM_DEFEND] }, snd: 'round_end' });
    if (this.score[TEAM_ATTACK] >= this.targetWin || this.score[TEAM_DEFEND] >= this.targetWin) {
      this.matchOver = true;
      this.phase = 'matchover';
      this.ev({ k: 'match', winner: winTeam, score: { a: this.score[TEAM_ATTACK], d: this.score[TEAM_DEFEND] } });
    }
    for (const p of this.players.values()) { p.using = false; }
  }

  // buying ------------------------------------------------------------------------------
  buyAllowed(p: SimPlayer): boolean {
    if (this.phase === 'warmup') return true;
    if (this.phase === 'freeze') return buyZone(p.team, p.x, p.z);
    if (this.phase === 'live' && this.buyLeft > 0) return buyZone(p.team, p.x, p.z);
    return false;
  }
  buyItem(p: SimPlayer, item: string): { ok: boolean; err?: string } {
    if (!p.alive) return { ok: false, err: 'dead' };
    if (!this.buyAllowed(p)) return { ok: false, err: 'buy window over' };
    if (item === 'armor') {
      if (p.armor >= MAX_ARMOR) return { ok: false, err: 'already have armor' };
      if (p.money < ARMOR_VEST) return { ok: false, err: 'not enough money' };
      p.money -= ARMOR_VEST; p.armor = MAX_ARMOR;
      this.ev({ k: 'moneydelta', to: p.id, amt: -ARMOR_VEST, reason: 'buy' });
      this.ev({ k: 'buy', to: p.id, snd: 'buy' });
      return { ok: true };
    }
    if (item === 'helmet') {
      if (p.hasHelmet) return { ok: false, err: 'already owned' };
      if (p.money < ARMOR_HELMET) return { ok: false, err: 'not enough money' };
      if (p.armor < MAX_ARMOR) {
        if (p.money < ARMOR_HELMET + ARMOR_VEST) return { ok: false, err: 'not enough money' };
        p.money -= ARMOR_HELMET + ARMOR_VEST; p.armor = MAX_ARMOR;
      } else {
        p.money -= ARMOR_HELMET;
      }
      p.hasHelmet = true;
      this.ev({ k: 'moneydelta', to: p.id, amt: -ARMOR_HELMET - (p.armor < 100 ? 0 : 0), reason: 'buy' });
      this.ev({ k: 'buy', to: p.id, snd: 'buy' });
      return { ok: true };
    }
    const u = UTILITIES[item];
    if (u) {
      if ((p.util[item] ?? 0) >= u.maxCarry) return { ok: false, err: 'max carried' };
      if (p.money < u.price) return { ok: false, err: 'not enough money' };
      p.money -= u.price; p.util[item]++;
      this.ev({ k: 'moneydelta', to: p.id, amt: -u.price, reason: 'buy' });
      this.ev({ k: 'buy', to: p.id, snd: 'buy' });
      return { ok: true };
    }
    const wd = WEAPONS[item];
    if (wd && wd.cat !== 'melee') {
      if (p.money < wd.price) return { ok: false, err: 'not enough money' };
      p.money -= wd.price;
      if (wd.cat === 'pistol') p.slots.pistol = { id: item, mag: wd.mag, res: wd.reserve };
      else p.slots.primary = { id: item, mag: wd.mag, res: wd.reserve };
      this.ev({ k: 'moneydelta', to: p.id, amt: -wd.price, reason: 'buy' });
      this.ev({ k: 'buy', to: p.id, snd: 'buy' });
      return { ok: true };
    }
    return { ok: false, err: 'unknown item' };
  }

  // main tick ----------------------------------------------------------------------------
  step(dt: number): void {
    this.dt = dt;
    this.now += dt;
    // world cleanup
    this.smokes = this.smokes.filter((s) => s.till > this.now);
    this.fires = this.fires.filter((f) => f.till > this.now);
    this.decoys = this.decoys.filter((d) => d.till > this.now);
    for (const d of this.decoys) {
      if (d.next <= this.now) {
        d.next = this.now + 0.35;
        this.ev({ k: 'decoy_noise', x: d.x, z: d.z });
      }
    }
    this.moveGrenadesCleanup();

    switch (this.phase) {
      case 'warmup': {
        this.warmupLeft = Math.max(0, this.phaseUntil - this.now);
        if (this.warmupLeft <= 0) { this.startFirstRound(); break; }
        for (const p of this.players.values()) {
          if (!p.online && !p.isBot) continue;
          if (!p.alive) {
            if (this.now - p.deadT > 1.8) this.warmSpawn(p);
          }
        }
        this.simStep(dt, true, true);
        this.stepGrenades(dt);
        this.moveFireDamage(dt);
        break;
      }
      case 'freeze': {
        this.freezeLeft = Math.max(0, this.phaseUntil - this.now);
        this.buyLeft = Math.max(0, this.buyUntil - this.now);
        if (this.freezeLeft <= 0) {
          this.phase = 'live';
          this.phaseUntil = 0;
          this.ev({ k: 'phase', ph: 'live', snd: 'go' });
        }
        this.simStep(dt, false, false); // no movement during freeze, but track aim
        break;
      }
      case 'live': {
        if (this.buyLeft > 0) this.buyLeft = Math.max(0, this.buyUntil - this.now);
        this.simStep(dt, true, true);
        this.stepGrenades(dt);
        this.moveFireDamage(dt);
        this.pickupBomb();
        // bomb logic
        if (this.planted > 0 && this.now >= this.boomAt) {
          const site = this.planted;
          this.planted = 0;
          this.ev({ k: 'boom', site, snd: 'boom', x: 0, y: 0, z: 0 });
          this.winRound(this.attackerSide, 'boom');
        }
        if (this.planted === 0) {
          this.liveT -= dt;
          if (this.liveT <= 0) this.finishRoundTime();
        }
        break;
      }
      case 'roundend': {
        if (this.now >= this.phaseUntil) this.nextRound();
        break;
      }
      case 'matchover':
        break;
    }
  }

  private warmSpawn(p: SimPlayer): void {
    this.spawnPlayer(p);
    p.money = Math.min(p.money + 2000, MAX_MONEY);
  }

  private simStep(dt: number, move: boolean, act: boolean): void {
    for (const id of this.order) {
      const p = this.players.get(id)!;
      if (!p.online && !p.isBot) continue;
      if (!p.alive) continue;
      const c = p.cmd;
      // movement
      if (move) {
        const prev = { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, onGround: p.onGround, duck: p.duck };
        const res = stepPhysics(prev, { f: c.f, s: c.s, jump: (c.b & BTN.JUMP) !== 0, walk: (c.b & BTN.WALK) !== 0 }, p.cmd.yaw, dt);
        p.x = res.body.x; p.y = res.body.y; p.z = res.body.z;
        p.vx = res.body.vx; p.vy = res.body.vy; p.vz = res.body.vz;
        p.onGround = res.body.onGround;
        const spd = Math.hypot(p.vx, p.vz);
        if (res.landed) this.ev({ k: 'land', to: p.id });
        const mv = spd > 220 ? 2 : spd > 40 ? 1 : 0;
        p.moving = mv;
        p.walkPhase += spd * dt * 0.05;
      } else {
        p.vx *= 0.8; p.vz *= 0.8; p.vx = 0; p.vz = 0; p.vy = 0;
      }
      if (!act) continue;
      // fire
      const fire = (c.b & BTN.FIRE) !== 0;
      if (fire) {
        if (catOf(p.curW) === 'utility') {
          if (this.now < p.throwing) {
            // still recovering
          } else this.tryThrow(p, p.curW);
        } else {
          this.tryFire(p);
        }
      }
      // use channel edges
      const use = (c.b & BTN.USE) !== 0;
      if (use && !p.using && this.phase === 'live') this.beginUse(p);
      else if (!use && p.using) this.abortUse(p);
      else if (use && p.using) this.tickUse(p, dt);
      // reload finish
      if (this.reloading(p) && this.now >= p.reloadUntil) this.finishReload(p);
      // recoil decay
      if (this.now - p.lastShotAt > 0.08) {
        const wd = WEAPONS[p.curW];
        p.recoilAmt = Math.max(0, p.recoilAmt - (wd ? wd.recoilRecover : 8) * dt);
      }
      // blind decay
      if (p.blindT > 0) p.blindT -= dt;
    }
  }

  private moveFireDamage(dt: number): void {
    if (this.phase !== 'live' && this.phase !== 'warmup') return;
    for (const f of this.fires) {
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        if (Math.hypot(p.x - f.x, p.z - f.z) < f.r) {
          if (this.now - p.fireTick > 0.28) {
            p.fireTick = this.now;
            p.hp -= 8;
            this.ev({ k: 'dmg', to: p.id, w: 'fire', hs: 0, amt: 8 });
            if (p.using) this.abortUse(p);
            if (p.hp <= 0) this.kill(p, null, false, 'fire');
          }
        }
      }
    }
  }

  // events ---------------------------------------------------------------------------------
  ev(e: MatchEvt): void { this.events.push(e); }
  flushEvents(): { public: MatchEvt[]; per: Map<string, MatchEvt[]> } {
    const out = { public: [] as MatchEvt[], per: new Map<string, MatchEvt[]>() };
    for (const e of this.events) {
      if (e.to) {
        let l = out.per.get(e.to);
        if (!l) { l = []; out.per.set(e.to, l); }
        l.push(e);
      } else out.public.push(e);
    }
    this.events = [];
    return out;
  }

  fwd3(yaw: number, pitch: number): Vec3 {
    const cp = Math.cos(pitch);
    return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
  }
  raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number {
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - cc;
    if (disc < 0) return Infinity;
    const t = -b - Math.sqrt(disc);
    return t >= 0 ? t : Infinity;
  }

  // data for snapshot ------------------------------------------------------------------------
  header(): { ph: Phase; rt: number; bt: number; wt: number; scr: [number, number]; rnd: number; plant: number; boomIn: number } {
    let rt = 0, bt = 0, wt = 0;
    if (this.phase === 'live') {
      rt = Math.max(0, this.planted > 0 ? this.boomAt - this.now : this.liveT);
    } else if (this.phase === 'roundend') {
      rt = Math.max(0, this.phaseUntil - this.now);
    } else if (this.phase === 'freeze') {
      rt = Math.max(0, this.phaseUntil - this.now);
    } else if (this.phase === 'warmup') {
      wt = Math.max(0, this.phaseUntil - this.now);
    }
    if (this.phase === 'live' || this.phase === 'freeze') bt = Math.max(0, this.buyUntil - this.now);
    return {
      ph: this.phase, rt, bt, wt,
      scr: [this.score[TEAM_ATTACK], this.score[TEAM_DEFEND]],
      rnd: this.roundNum, plant: this.planted,
      boomIn: this.planted > 0 ? Math.max(0, this.boomAt - this.now) : 0,
    };
  }

  // spectate target
  spectateTarget(v: SimPlayer): SimPlayer {
    if (v.alive) return v;
    const mates = this.playersOfTeam(v.team).filter((p) => p.alive && p.id !== v.id);
    if (mates.length) return mates[0];
    const foes = this.playersOfTeam(this.attackerSide).filter((p) => p.alive && p.team !== v.team);
    if (foes.length) return foes[0];
    return v;
  }
}
