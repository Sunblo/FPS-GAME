// BotBrain - offline bots for practice mode. Bots run *inside* the authoritative
// MatchSim and drive it with the exact same input primitives as a human would
// (move keys, mouse aim, fire, use, buy, switch). No client logic involved.
import { MatchSim, SimPlayer, BTN } from './sim.ts';
import { WEAPONS } from './weapons.ts';
import { rayCollide } from './geo.ts';
import {
  navPassable, COLS, cellWorldX, cellWorldZ, worldToCell,
} from './mapdef.ts';
import { clamp, dist2D } from './mathv.ts';

interface BotState {
  goal: string; // 'pushA' | 'pushB' | 'defA' | 'defB' | 'rotate' | 'idle'
  path: Vec[];
  pathAt: number;
  nextPath: number;
  targetId: string;
  targetT: number;
  noiseSeed: number;
  thinkT: number;
  moveT: number;
  strafeDir: number;
  strafeT: number;
  site: number; // 1 = A 2 = B for attackers
  havePlanted: boolean;
  buyDone: number;
  huntT: number;
  goalKey: string;
  aimYaw: number;
  aimPitch: number;
  lastF: number;
  lastS: number;
  firing: boolean;
  ducking: number;
}

interface Vec { x: number; z: number }

const rnd = Math.random;

export function botNames(count: number): string[] {
  const N = [
    'REAPER-9', 'Vector', 'OXIDE', 'Krait', 'MORGEN', 'Sable', 'Prime-7', 'Juniper',
    'Glaive', 'EMBER', 'Halcyon', 'Tarn', 'Vex', 'Cobalt', 'Nash', 'Rook',
    'Glint', 'Peregrine', 'Ion', 'Stalker', 'Nyx', 'Orbit', 'Fathom', 'Clutch',
    'Sera', 'Wick', 'Bramble', 'Ossa', 'Talon-4', 'Meridian',
  ];
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(N[i % N.length] + (i >= N.length ? '-' + i : ''));
  return out;
}

export class BotBrain {
  sim: MatchSim;
  skill: number;
  bots = new Map<string, BotState>();
  private watchYaw = 0;

  constructor(sim: MatchSim, skill = 0.6) {
    this.sim = sim;
    this.skill = clamp(skill, 0, 1);
    for (const p of sim.players.values()) if (p.isBot) this.bots.set(p.id, this.newState(p));
  }

  private newState(p: SimPlayer): BotState {
    return {
      goal: 'idle', path: [], pathAt: 0, nextPath: 0, targetId: '', targetT: 0,
      noiseSeed: Math.floor(rnd() * 1000), thinkT: rnd() * 0.2, moveT: 0,
      strafeDir: rnd() > 0.5 ? 1 : -1, strafeT: rnd() * 1.4 + 0.4,
      site: rnd() > 0.5 ? 1 : 2, havePlanted: false, buyDone: 0, huntT: 0,
      goalKey: '',
      aimYaw: p.yaw, aimPitch: 0, lastF: 0, lastS: 0, firing: false, ducking: 0,
    };
  }

  addBot(p: SimPlayer) { this.bots.set(p.id, this.newState(p)); }

  // pathfinding ----------------------------------------------------------------
  private findPath(sx: number, sz: number, tx: number, tz: number): Vec[] {
    const [sc, sr] = worldToCell(sx, sz);
    const [tc, tr] = worldToCell(tx, tz);
    if (!navPassable(tc, tr)) return [];
    const start = sr * COLS + sc, goal = tr * COLS + tc;
    if (start === goal) return [{ x: tx, z: tz }];
    const open = [start];
    const came = new Int32Array(COLS * 200).fill(-1);
    const gScore = new Float64Array(COLS * 400).fill(Infinity);
    gScore[start] = 0;
    const closed = new Uint8Array(COLS * 400);
    const h = (i: number) => {
      const c = i % COLS, r = (i / COLS) | 0;
      return Math.hypot(c - tc, r - tr);
    };
    let guard = 0;
    while (open.length && guard++ < 2500) {
      // pop min f
      let bi = 0, bf = Infinity;
      for (let i = 0; i < open.length; i++) {
        const f = gScore[open[i]] + h(open[i]);
        if (f < bf) { bf = f; bi = i; }
      }
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cc = cur % COLS, cr = (cur / COLS) | 0;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (const [dx, dz] of dirs) {
        const nc = cc + dx, nr = cr + dz;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= 30) continue;
        if (!navPassable(nc, nr)) continue;
        if (dx !== 0 && dz !== 0 && !(navPassable(cc + dx, cr) && navPassable(cc, cr + dz))) continue;
        const ni = nr * COLS + nc;
        if (closed[ni]) continue;
        const cost = (dx !== 0 && dz !== 0 ? 1.4142 : 1);
        const ng = gScore[cur] + cost;
        if (ng < gScore[ni]) {
          gScore[ni] = ng;
          came[ni] = cur;
          if (!open.includes(ni)) open.push(ni);
        }
      }
    }
    // reconstruct
    let cur = goal;
    const cells: number[] = [];
    while (cur !== -1 && cur !== start) {
      cells.push(cur);
      cur = came[cur];
      if (cur === -1) return [];
    }
    cells.reverse();
    const out: Vec[] = [];
    for (const ci of cells) {
      out.push({ x: cellWorldX(ci % COLS), z: cellWorldZ((ci / COLS) | 0) });
    }
    // append target
    out.push({ x: tx, z: tz });
    return out;
  }

  private los(sim: MatchSim, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    // smoke blocks
    for (const s of sim.smokes) {
      const d = pointSegDist(ax, az, bx, bz, s.x, s.z);
      if (d < s.r * 0.62) return false;
    }
    const r = rayCollide(ax, ay, az, bx - ax, by - ay, bz - az, Math.hypot(bx - ax, by - ay, bz - az) + 1);
    return !(r.hit && r.dist < Math.hypot(bx - ax, by - ay, bz - az) - 30);
  }

  // update called by host every sim tick -----------------------------------------
  step(): void {
    const sim = this.sim;
    // bots list mirror
    for (const id of sim.order) {
      const p = sim.players.get(id)!;
      if (!p.isBot) continue;
      if (!this.bots.has(id)) this.bots.set(id, this.newState(p));
      const bs = this.bots.get(id)!;
      if (!p.alive || sim.phase === 'matchover') { this.stillInput(p, bs); continue; }
      // handle buy at freeze
      if (sim.phase === 'warmup') {
        if (bs.buyDone !== -1) { bs.buyDone = -1; this.buy(p, bs, true); }
        this.warmupMove(p, bs);
        continue;
      }
      if (sim.phase === 'freeze' || (sim.phase === 'live' && sim.buyLeft > 0)) {
        if (bs.buyDone !== sim.roundNum) {
          bs.buyDone = sim.roundNum;
          this.buy(p, bs, false);
        }
      }
      if (sim.phase !== 'live') { this.stillInput(p, bs); continue; }
      // plant/defuse when convenient
      this.channel(p, bs);
      if (p.using) { // keep channeling
        this.setCmd(p, bs, { f: 0, s: 0, aimYaw: p.cmd.yaw, aimPitch: p.cmd.pitch, fire: false, use: true, jump: false, walk: false });
        continue;
      }
      if (p.blindT > 0) { this.blindMove(p, bs); continue; }

      bs.thinkT -= 1 / 30;
      if (bs.thinkT <= 0) {
        bs.thinkT = 0.18;
        this.think(p, bs);
      }
      this.act(p, bs);
    }
  }

  private stillInput(p: SimPlayer, bs: BotState): void {
    this.sim.applyInput(p.id, { seq: 0, yaw: p.cmd.yaw, pitch: 0, f: 0, s: 0, b: 0 });
  }

  private setCmd(p: SimPlayer, bs: BotState, a: { f: number; s: number; aimYaw: number; aimPitch: number; fire: boolean; use?: boolean; jump?: boolean; walk?: boolean }): void {
    let b = 0;
    if (a.fire) b |= BTN.FIRE;
    if (a.use) b |= BTN.USE;
    if (a.jump) b |= BTN.JUMP;
    if (a.walk) b |= BTN.WALK;
    if (bs.ducking > 0) b |= BTN.CROUCH;
    p.cmd.yaw = a.aimYaw;
    p.cmd.pitch = a.aimPitch;
    this.sim.applyInput(p.id, { seq: 0, yaw: a.aimYaw, pitch: a.aimPitch, f: a.f, s: a.s, b });
    bs.lastF = a.f; bs.lastS = a.s;
  }

  private fireAllowed(p: SimPlayer, d: number): boolean {
    const w = p.curW;
    const wd = WEAPONS[w];
    if (!wd) return false;
    const slot = this.sim.slotFor(p, w);
    if (slot && wd.mag > 0 && slot.mag <= 0) {
      this.sim.reload(p);
      return false;
    }
    if (catName(w) === 'sniper' && d < 300 && !this.sim.reloading(p)) return true;
    return true;
  }

  private nearestEnemy(p: SimPlayer): { enemy: SimPlayer; d: number } | null {
    let best: SimPlayer | null = null, bd = Infinity;
    for (const o of this.sim.players.values()) {
      if (!o.alive || o.team === p.team) continue;
      const d = dist2D(p.x, p.z, o.x, o.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best ? { enemy: best, d: bd } : null;
  }

  // fire control & aiming per tick ---------------------------------------------
  private act(p: SimPlayer, bs: BotState): void {
    const sim = this.sim;
    // if we have an active visible enemy within range -> fight
    let tgt = this.targetEnemy(p, bs);
    if (tgt) bs.targetT = Math.min(3.5, bs.targetT + 1 / 30);
    else bs.targetT = 0;
    if (!tgt) {
      // continue toward goal
      if (bs.path.length > bs.pathAt) {
        const wp = bs.path[bs.pathAt];
        const dist = dist2D(p.x, p.z, wp.x, wp.z);
        if (dist < 24 && bs.pathAt < bs.path.length - 1) bs.pathAt++;
        const t = this.steer(p, bs, wp, dist);
        this.setCmd(p, bs, { f: t.f, s: t.s, aimYaw: p.cmd.yaw, aimPitch: p.cmd.pitch, fire: false });
      } else {
        const a = this.anchorFor(p, bs);
        if (a) {
          const path = this.findPath(p.x, p.z, a.x, a.z);
          if (path.length) { bs.path = path; bs.pathAt = 0; }
        } else {
          this.setCmd(p, bs, { f: 0, s: 0, aimYaw: p.cmd.yaw, aimPitch: p.cmd.pitch, fire: false });
        }
      }
      return;
    }
    // fight
    const d = tgt.d;
    const aim = this.computeAim(p, tgt.enemy, d, bs);
    // avoid over-rotating: move strafe
    const sd = Math.sin(sim.now * 2.4 + bs.noiseSeed) * 0.7;
    const sm = 0.55;
    const inRange = d < 2600;
    const skillFire = this.wantFire(p, bs, d);
    let fire = inRange && skillFire && aim.settled;
    if (fire && !this.fireAllowed(p, d)) fire = false;
    if (fire && p.curW === 'knife' && d > 90) {
      this.ensureWeapon(p, bs, d);
      fire = false;
    }
    this.setCmd(p, bs, {
      f: clamp(0.6 * (aim.rangeClose ? 0 : 0.2), -1, 1),
      s: clamp(sd * sm, -1, 1),
      aimYaw: aim.yaw, aimPitch: aim.pitch, fire,
    });
    if (fire && sim.now - p.lastShotAt > 0.3) bs.targetT = 2.5;
  }

  private targetEnemy(p: SimPlayer, bs: BotState): { enemy: SimPlayer; d: number } | null {
    let best: SimPlayer | null = null; let bd = 20000;
    for (const o of this.sim.players.values()) {
      if (!o.alive || o.team === p.team || o.team === 0) continue;
      const d = dist2D(p.x, p.z, o.x, o.z);
      if (d > 2400) continue;
      // must have line of sight
      if (!this.los(this.sim, p.x, p.y + (p.duck ? 46 : 64), p.z, o.x, o.y + 40, o.z)) continue;
      // check behind
      const yawTo = Math.atan2(-(o.x - p.x), -(o.z - p.z));
      let dd = yawTo - p.cmd.yaw;
      while (dd > Math.PI) dd -= Math.PI * 2;
      while (dd < -Math.PI) dd += Math.PI * 2;
      if (Math.abs(dd) > 1.9 && d > 220) continue; // hard behind & not close
      if (d < bd) { bd = d; best = o; }
    }
    // decoy noise acts as an enemy "sound" for situational awareness
    if (!best) {
      for (const dc of this.sim.decoys) {
        if (dc.till > this.sim.now) {
          const d = dist2D(p.x, p.z, dc.x, dc.z);
          if (d < 900 && d < bd && d > 60) {
            // treat as unknown threat direction (not aimable)
            bd = d; best = null;
          }
        }
      }
    }
    return best ? { enemy: best, d: bd } : null;
  }

  private wantFire(p: SimPlayer, bs: BotState, d: number): boolean {
    const w = WEAPONS[p.curW];
    if (!w) return false;
    const cat = catName(p.curW);
    if (cat === 'melee') return d < 110;
    if (cat === 'sniper') return d > 240 || !p.onGround;
    if (d < 1400) return true;
    return rnd() < 0.5;
  }

  private computeAim(p: SimPlayer, e: SimPlayer, d: number, bs: BotState): { yaw: number; pitch: number; settled: boolean; rangeClose: boolean } {
    // lead target slightly
    const lead = Math.min(14, d / 40);
    const px = e.x + e.vx * lead * 0.02;
    const pz = e.z + e.vz * lead * 0.02;
    const ey = e.y + (e.duck ? 42 : 58);
    const dx = px - p.x, dy = ey - (p.y + (p.duck ? 46 : 64)), dz = pz - p.z;
    let yaw = Math.atan2(-dx, -dz);
    const horiz = Math.hypot(dx, dz);
    let pitch = Math.atan2(dy, Math.max(1, horiz));
    const noise = (1 - this.skill) * (1 + d / 600) * (Math.PI / 180) * 1.6;
    // accuracy improves over time aimed
    const settle = Math.min(1, bs.targetT * (1.2 + this.skill * 3));
    yaw += (rnd() - 0.5) * noise * (1 - settle * 0.7);
    pitch += (rnd() - 0.5) * noise * (1 - settle * 0.7);
    if (rnd() < 0.02) { yaw += (rnd() - 0.5) * 0.02; pitch += (rnd() - 0.5) * 0.02; }
    return { yaw, pitch, settled: settle > 0.55, rangeClose: d < 260 };
  }

  private ensureWeapon(p: SimPlayer, bs: BotState, d: number): void {
    const slot = p.slots.primary.id || p.slots.pistol.id;
    if (d < 90 && this.fireAllowed(p, 90) && p.curW !== 'knife') { this.sim.switchTo(p, 0); return; }
    if (d > 260 && slot && p.curW !== slot) {
      const idx = slot === p.slots.primary.id ? 2 : 1;
      this.sim.switchTo(p, idx);
    } else if (d <= 260 && slot && catName(p.curW) !== 'pistol' && !p.slots.primary.id) {
      // n/a
    }
  }

  private channel(p: SimPlayer, bs: BotState): void {
    const sim = this.sim;
    if (sim.phase !== 'live') return;
    if (p.team === sim.attackerSide) {
      // attackers with bomb plant if site secure
      if (p.hasBomb) {
        const here = this.siteAt(p.x, p.z);
        if (here > 0) {
          const danger = this.dangerNear(p, 700);
          if (!danger) {
            // make sure knife equipped not required for plant; plant channel in sim begins only when cmd use true
            // aim safe direction
            bs.ducking = 0;
            this.setCmd(p, bs, { f: 0, s: 0, aimYaw: p.cmd.yaw, aimPitch: -0.2, fire: false, use: true });
            return;
          } else {
            // engage danger instead (don't plant yet)
          }
        }
      } else if (bs.havePlanted) {
        // guard site after teammate plant
        const anchors = this.defendAnchors(p, bs.site);
        if (anchors.length) {
          const t = this.steer(p, bs, anchors[0], 0);
          this.setCmd(p, bs, { f: t.f, s: t.s, aimYaw: p.cmd.yaw, aimPitch: p.cmd.pitch, fire: false });
          return;
        }
      }
    } else {
      // defenders: if planted go defuse if safe
      if (sim.planted > 0) {
        const z = PLANTXY[sim.planted - 1];
        const d = dist2D(p.x, p.z, z.x, z.z);
        const danger = this.dangerNear(p, 480);
        if (d < 60 && !danger) {
          this.setCmd(p, bs, { f: 0, s: 0, aimYaw: p.cmd.yaw, aimPitch: -0.15, fire: false, use: true });
          return;
        }
      }
    }
  }
  private siteAt(x: number, z: number): number {
    const a = SITEA, b = SITEB;
    if (dist2D(x, z, a.x, a.z) < 170) return 1;
    if (dist2D(x, z, b.x, b.z) < 170) return 2;
    return 0;
  }
  private dangerNear(p: SimPlayer, r: number): boolean {
    for (const o of this.sim.players.values()) {
      if (!o.alive || o.team === p.team) continue;
      if (dist2D(p.x, p.z, o.x, o.z) < r) return true;
    }
    return false;
  }
  private defendAnchors(p: SimPlayer, site: number): Vec[] {
    const near = this.nearAnchor(p);
    return [near];
  }
  private nearAnchor(p: SimPlayer): Vec {
    return { x: p.x, z: p.z };
  }

  // high level tactics ----------------------------------------------------------
  private think(p: SimPlayer, bs: BotState): void {
    const sim = this.sim;
    const attack = p.team === sim.attackerSide;
    // bomb status
    const bombCarrier = [...sim.players.values()].find((q) => q.alive && q.team === p.team && q.hasBomb);
    // choose site for attackers
    if (attack) {
      if (sim.planted > 0) { bs.havePlanted = true; }
      // pick site
      if (!bs.havePlanted) {
        if (bombCarrier && bombCarrier.id === p.id) {
          // go chosen site
        } else {
          // pick a site (bias: match carrier if not self)
          bs.site = bombCarrier ? (this.siteAt(bombCarrier.x, bombCarrier.z) || bs.site) : bs.site;
        }
      }
    } else {
      // defenders: assign to sites defensively
      const mates = sim.playersOfTeam(p.team).filter((q) => q.alive && q.id !== p.id).length;
      const idx = sim.order.indexOf(p.id);
      bs.site = idx % 2 === 0 ? 1 : 2;
    }
    // movement target
    if (attack) {
      const targetPlant = sim.planted > 0 && bs.havePlanted;
      const plantA = PLANTXY[bs.site - 1];
      const targetPos = targetPlant ? PLANTXY[sim.planted - 1] : plantA;
      const d = dist2D(p.x, p.z, targetPos.x, targetPos.z);
      const here = this.siteAt(p.x, p.z);
      if (here === bs.site && p.hasBomb && d < 40) {
        // near plant spot
      } else if (d < 180 && this.dangerNear(p, 500)) {
        // fight to site
      }
      const key = 'A' + bs.site + (targetPlant ? 'P' : '') + (sim.planted > 0 && !bs.havePlanted ? '?' : '');
      if (bs.goalKey !== key || bs.path.length === 0 || bs.pathAt >= bs.path.length - 1) {
        bs.goalKey = key;
        const wp = this.findPath(p.x, p.z, targetPos.x, targetPos.z);
        if (wp.length) { bs.path = wp; bs.pathAt = 0; }
      }
    } else {
      // defender: go to a defensive anchor near a chokepoint
      let anchor: Vec;
      if (sim.planted > 0) anchor = PLANTXY[sim.planted - 1];
      else if (bs.site === 1) anchor = DEF_A;
      else anchor = DEF_B;
      // variety: some defenders hold mid
      const variety = (bs.noiseSeed % 5);
      if (sim.planted === 0) {
        if (variety === 0) anchor = MID_A;
        else if (variety === 1) anchor = MID_B;
      }
      const key = 'D' + bs.site + (sim.planted > 0 ? 'P' + sim.planted : '');
      if (bs.goalKey !== key || bs.path.length === 0 || bs.pathAt >= bs.path.length - 1) {
        bs.goalKey = key;
        const path = this.findPath(p.x, p.z, anchor.x, anchor.z);
        if (path.length) { bs.path = path; bs.pathAt = 0; }
      }
    }
  }

  private anchorFor(p: SimPlayer, bs: BotState): Vec | null {
    return null; // path already set; if reached goal stand
  }

  private steer(p: SimPlayer, bs: BotState, wp: Vec, _close: number): { f: number; s: number } {
    const dx = wp.x - p.x, dz = wp.z - p.z;
    const targetYaw = Math.atan2(-dx, -dz);
    // turn toward
    let diff = targetYaw - p.cmd.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const wantF = Math.cos(diff);
    const wantS = -Math.sin(diff);
    const moving = Math.hypot(dx, dz) > 30;
    const spd = wantF > 0.25 ? 1 : Math.abs(wantS) > 0.4 ? 0.4 : 0.2;
    return { f: (moving ? spd : 0), s: (moving ? wantS * 0.8 : 0) };
  }

  private warmupMove(p: SimPlayer, bs: BotState): void {
    const sim = this.sim;
    if (!bs.path.length || sim.now > bs.nextPath) {
      const e = this.targetEnemy(p, bs);
      if (e) {
        const aim = this.computeAim(p, e.enemy, e.d, bs);
        this.setCmd(p, bs, { f: 0, s: 0, aimYaw: aim.yaw, aimPitch: aim.pitch, fire: true });
        return;
      }
      // wander to random anchor
      const pickPt = ANCHOR_PTS[Math.floor(rnd() * ANCHOR_PTS.length)];
      bs.path = this.findPath(p.x, p.z, pickPt.x, pickPt.z);
      bs.pathAt = 0;
      bs.nextPath = sim.now + 3;
    }
    if (bs.path.length > bs.pathAt) {
      const wp = bs.path[bs.pathAt];
      if (dist2D(p.x, p.z, wp.x, wp.z) < 26 && bs.pathAt < bs.path.length - 1) bs.pathAt++;
      const t = this.steer(p, bs, wp, 0);
      this.setCmd(p, bs, { f: t.f, s: t.s, aimYaw: p.cmd.yaw, aimPitch: p.cmd.pitch, fire: false });
    }
  }

  private blindMove(p: SimPlayer, bs: BotState): void {
    // blinded: strafe randomly, don't fire
    const t = this.sim.now;
    const s = Math.sin(t * 2) * 0.6;
    this.setCmd(p, bs, { f: 0.3, s, aimYaw: p.cmd.yaw + Math.sin(t * 3) * 0.3, aimPitch: 0, fire: false });
  }

  // economy -------------------------------------------------------------------------
  private buy(p: SimPlayer, bs: BotState, warmup: boolean): void {
    const sim = this.sim;
    if (warmup) {
      sim.buyItem(p, 'armor');
      sim.buyItem(p, p.team === sim.attackerSide ? 'vanguard' : 'sentinel');
      return;
    }
    const atk = p.team === sim.attackerSide;
    const money = p.money;
    const role = atk ? 'atk' : 'def';
    const carry = p.hasBomb;
    // decide plan
    let primary = '';
    if (money >= 4700 && rnd() < 0.25) primary = 'leviathan';
    else if (money >= 2800) primary = atk ? 'vanguard' : 'sentinel';
    else if (money >= 2400) primary = rnd() < 0.5 ? 'skitter' : 'vanguard';
    else if (money >= 1500) primary = 'marauder';
    else if (money >= 1100 && rnd() < 0.3) primary = 'breacher';
    if (primary) sim.buyItem(p, primary);
    if (money > 2600 || primary === 'leviathan') {
      if (!p.hasHelmet) sim.buyItem(p, 'helmet');
      else if (p.armor < 100) sim.buyItem(p, 'armor');
    } else if (p.armor < 100 && money > 700) {
      sim.buyItem(p, 'armor');
    }
    // utilities
    if (role === 'atk') {
      if (money > 3200) { sim.buyItem(p, 'smoke'); sim.buyItem(p, 'flash'); }
      if (money > 4000) sim.buyItem(p, 'frag');
      if (money > 5200 && rnd() < 0.5) sim.buyItem(p, 'fire');
      if (carry) sim.buyItem(p, 'smoke');
    } else {
      if (money > 3000) { sim.buyItem(p, 'smoke'); sim.buyItem(p, 'flash'); }
      if (money > 3800) sim.buyItem(p, 'frag');
      if (money > 4600) sim.buyItem(p, 'decoy');
    }
    // equip
    if (primary) sim.switchTo(p, 2);
    void role;
  }
}

function catName(id: string): string {
  const w = WEAPONS[id];
  if (id === 'knife') return 'melee';
  if (w) return w.cat;
  if (UTIL_CATS[id]) return 'utility';
  return 'pistol';
}
const UTIL_CATS: Record<string, 1> = { flash: 1, frag: 1, smoke: 1, fire: 1, decoy: 1 };
const SITEA = { x: cellWorldX(27.5), z: cellWorldZ(17) };
const SITEB = { x: cellWorldX(5.5), z: cellWorldZ(17) };
const PLANTXY = [SITEA, SITEB];
const DEF_A = { x: cellWorldX(26), z: cellWorldZ(19.5) };
const DEF_B = { x: cellWorldX(7), z: cellWorldZ(19.5) };
const MID_A = { x: cellWorldX(18.5), z: cellWorldZ(12.5) };
const MID_B = { x: cellWorldX(15.5), z: cellWorldZ(19.5) };
const ANCHOR_PTS = [DEF_A, DEF_B, MID_A, MID_B, SITEA, SITEB,
  { x: cellWorldX(16.5), z: cellWorldZ(6) }, { x: cellWorldX(28), z: cellWorldZ(10) },
];

function pointSegDist(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
  const vx = bx - ax, vz = bz - az;
  const wx = px - ax, wz = pz - az;
  const c1 = vx * wx + vz * wz;
  if (c1 <= 0) return Math.hypot(px - ax, pz - az);
  const c2 = vx * vx + vz * vz;
  if (c2 <= c1) return Math.hypot(px - bx, pz - bz);
  const t = c1 / c2;
  return Math.hypot(px - (ax + t * vx), pz - (az + t * vz));
}
