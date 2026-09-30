// Game drivers: "practice" runs the authoritative MatchSim + BotBrain locally
// (single-player vs bots); "online" talks to the authoritative MatchDO host.
// Both expose the same narrow API so render/HUD/audio code is mode agnostic.
import { MatchSim } from '../../../shared/sim.ts';
import { BotBrain, botNames } from '../../../shared/bot.ts';
import { headerOf, snapBodyOf, type SnapHeader, type PState, type SmokeInfo, type FireInfo } from '../../../shared/protocol.ts';
import { BTN, type MatchEvt } from '../../../shared/sim.ts';
import type { CInput } from '../../../shared/types.ts';
import { stepPhysics, type PhysBody } from '../../../shared/geo.ts';

export interface DriverView {
  header: SnapHeader;
  players: PState[];
  smokes: SmokeInfo[];
  fires: FireInfo[];
  simNow: number;
  simAge: number; // seconds since the newest snapshot was produced (for view extrapolation)
  selfId: string;
  online: boolean;
}

export abstract class GameDriver {
  abstract get view(): DriverView;
  abstract step(dt: number): void;
  abstract events(): MatchEvt[];
  abstract setInput(c: CInput): void;
  abstract action(a: { t: 'buy' | 'slot' | 'reload' | 'weapon'; item?: string; slot?: number; id?: string }): void;
  abstract dispose(): void;
}

// ------------------------------------------------------------------ practice
export class PracticeGame extends GameDriver {
  sim: MatchSim;
  brain: BotBrain | null;
  private humanId: string;
  private acc = 0;
  private lastTickMs = 0;
  private frame: DriverView;
  private evQ: MatchEvt[] = [];
  private perTo: Map<string, MatchEvt[]> = new Map();
  private pub: MatchEvt[] = [];

  constructor(name: string, teamSize: number, skill = 0.7) {
    super();
    this.sim = new MatchSim({ map: 'REACTOR-09', tickRate: 30, firstTo: 13, teamSize, ot: true, warmup: true });
    this.sim.onLog = () => {};
    const human = this.sim.addPlayer('local', name);
    this.humanId = human.id;
    const names = botNames(teamSize * 4);
    let k = 0;
    for (let i = 0; i < teamSize * 2; i++) {
      if (i === 0) continue; // seat 0 is the human
      this.sim.addPlayer('bot' + i, names[k++ % names.length], true);
    }
    this.brain = new BotBrain(this.sim, skill);
    this.frame = {
      header: headerOf(this.sim),
      players: [],
      smokes: [],
      fires: [],
      simNow: 0,
      simAge: 0,
      selfId: this.humanId,
      online: false,
    };
  }

  get view(): DriverView { return this.frame; }

  step(dt: number): void {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= 1 / 30) {
      this.acc -= 1 / 30;
      if (this.brain) this.brain.step();
      this.sim.step(1 / 30);
      this.lastTickMs = performance.now();
      const out = this.sim.flushEvents();
      for (const e of out.public) this.pub.push(e);
      for (const [id, list] of out.per) {
        let cur = this.perTo.get(id);
        if (!cur) { cur = []; this.perTo.set(id, cur); }
        for (const e of list) cur.push(e);
      }
    }
    this.refreshView();
  }

  private refreshView(): void {
    const body = snapBodyOf(this.sim);
    this.frame = {
      header: headerOf(this.sim),
      players: body.players,
      smokes: body.smokes,
      fires: body.fires,
      simNow: body.simNow,
      simAge: Math.max(0, Math.min(0.06, (performance.now() - this.lastTickMs) / 1000)),
      selfId: this.humanId,
      online: false,
    };
  }

  events(): MatchEvt[] {
    const mine = this.perTo.get(this.humanId) || [];
    const all = this.pub.concat(mine);
    this.pub = [];
    this.perTo.set(this.humanId, []);
    return all;
  }

  setInput(c: CInput): void { this.sim.applyInput(this.humanId, c); }
  action(a: { t: 'buy' | 'slot' | 'reload' | 'weapon'; item?: string; slot?: number; id?: string }): void {
    const p = this.sim.players.get(this.humanId);
    if (!p) return;
    if (a.t === 'buy' && a.item) this.sim.buyItem(p, a.item);
    else if (a.t === 'slot' && a.slot !== undefined) this.sim.switchTo(p, a.slot);
    else if (a.t === 'reload') this.sim.reload(p);
    else if (a.t === 'weapon' && a.id) this.sim.switchToId(p, a.id);
  }
  dispose(): void { /* nothing */ }
}

// -------------------------------------------------------------------- online
export interface OnlineOpts {
  name: string;
  code: string;
  teamSize: number;
  url: string; // ws base e.g. wss://host/ws
}

export class OnlineGame extends GameDriver {
  ws: WebSocket;
  private _view: DriverView = {
    header: {
      ph: 'warmup', rnd: 1, scr: [0, 0], atkTeam: 1, plant: 0, boomIn: 0,
      rt: 0, bt: 0, wt: 0, targetWin: 13, pl: 0,
    },
    players: [], smokes: [], fires: [], simNow: 0, simAge: 0,
    selfId: '', online: true,
  };
  private selfId = '';
  private evQ: MatchEvt[] = [];
  private snapAtMs = 0;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((e: Error) => void) | null = null;
  ready: Promise<void>;
  joined = false;
  private closed = false;
  private pred: PhysBody | null = null;
  private lastCmd: CInput | null = null;
  private predAlive = false;
  private canMove = true;
  private seq = 0;

  constructor(opts: OnlineOpts) {
    super();
    this.ws = new WebSocket(`${opts.url}?code=${encodeURIComponent(opts.code)}&name=${encodeURIComponent(opts.name)}&id=${Math.random().toString(36).slice(2)}&size=${opts.teamSize}`);
    this.ready = new Promise((res, rej) => {
      this.readyResolve = res;
      this.readyReject = rej;
    });
    this.ws.onmessage = (ev: MessageEvent) => this.handle(ev);
    this.ws.onclose = () => {
      this.closed = true;
      if (!this.joined && this.readyReject) { this.readyReject(new Error('closed')); this.readyReject = null; this.readyResolve = null; }
    };
    this.ws.onerror = () => {
      this.closed = true;
      if (!this.joined && this.readyReject) { this.readyReject(new Error('ws')); this.readyReject = null; this.readyResolve = null; }
    };
  }

  private handle(ev: MessageEvent): void {
    if (typeof ev.data !== 'string') return;
    let m: unknown;
    try { m = JSON.parse(ev.data); } catch { return; }
    const msg = m as { t: string };
    if (msg.t === 'joined') {
      const j = msg as unknown as { id: string; team: number; header: SnapHeader };
      this.selfId = j.id;
      this._view.selfId = j.id;
      this._view.header = j.header;
      this.joined = true;
      if (this.readyResolve) { this.readyResolve(); this.readyResolve = null; this.readyReject = null; }
    } else if (msg.t === 'snap') {
      const s = msg as unknown as { header: SnapHeader; players: PState[]; smokes: SmokeInfo[]; fires: FireInfo[]; events: MatchEvt[] };
      this._view.header = s.header;
      this._view.players = s.players;
      this._view.smokes = s.smokes;
      this._view.fires = s.fires;
      this._view.simNow = Date.now() / 1000;
      this.snapAtMs = Date.now();
      this.applySnap(s.players, s.header.ph);
      for (const e of s.events) this.evQ.push(e);
    } else if (msg.t === 'kicked') {
      this.closed = true;
    }
  }

  get view(): DriverView {
    if (this.snapAtMs > 0) {
      this._view.simAge = Math.max(0, Math.min(0.06, (Date.now() - this.snapAtMs) / 1000));
    }
    return this._view;
  }
  step(dt: number): void {
    if (this.pred && this.predAlive && this.lastCmd && this.canMove) {
      this.pred.duck = (this.lastCmd.b & BTN.CROUCH) !== 0;
      const res = stepPhysics(
        this.pred,
        {
          f: this.lastCmd.f,
          s: this.lastCmd.s,
          jump: (this.lastCmd.b & BTN.JUMP) !== 0,
          walk: (this.lastCmd.b & BTN.WALK) !== 0,
        },
        this.lastCmd.yaw,
        Math.min(dt, 0.05),
      );
      this.pred = res.body;
      this.writePred();
    }
    this.sendMove();
  }

  private applySnap(players: PState[], ph: string): void {
    this.canMove = ph === 'warmup' || ph === 'live';
    const me = players.find((p) => p.id === this.selfId);
    if (!me || !me.alive) {
      this.pred = null;
      this.predAlive = false;
      return;
    }
    const tele = !this.pred || !this.predAlive
      || Math.hypot((this.pred.x - me.x), (this.pred.z - me.z)) > 220
      || Math.abs(this.pred.y - me.y) > 90;
    if (tele) {
      this.pred = {
        x: me.x, y: me.y, z: me.z,
        vx: 0, vy: 0, vz: 0,
        onGround: true,
        duck: me.duck === 1,
      };
    }
    this.predAlive = true;
    this.writePred();
  }

  private writePred(): void {
    if (!this.pred) return;
    const me = this._view.players.find((p) => p.id === this.selfId);
    if (!me) return;
    me.x = this.pred.x;
    me.y = this.pred.y;
    me.z = this.pred.z;
    me.vx = this.pred.vx;
    me.vy = this.pred.vy;
    me.vz = this.pred.vz;
    me.duck = this.pred.duck ? 1 : 0;
    const spd = Math.hypot(this.pred.vx, this.pred.vz);
    me.moving = spd > 220 ? 2 : spd > 40 ? 1 : 0;
  }

  events(): MatchEvt[] {
    if (this.evQ.length === 0) return [];
    const out = this.evQ;
    this.evQ = [];
    return out;
  }
  setInput(c: CInput): void {
    this.seq += 1;
    this.lastCmd = { ...c, seq: this.seq };
  }

  private sendMove(): void {
    if (this.ws.readyState !== WebSocket.OPEN || !this.lastCmd) return;
    const c = this.lastCmd;
    const body = this.pred;
    this.ws.send(JSON.stringify({
      t: 'input', seq: c.seq, yaw: c.yaw, pitch: c.pitch, f: c.f, s: c.s, b: c.b,
      px: body?.x, py: body?.y, pz: body?.z,
      pvx: body?.vx, pvy: body?.vy, pvz: body?.vz,
    }));
  }
  action(a: { t: 'buy' | 'slot' | 'reload' | 'weapon'; item?: string; slot?: number; id?: string }): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    if (a.t === 'buy' && a.item) this.ws.send(JSON.stringify({ t: 'buy', item: a.item }));
    else if (a.t === 'slot' && a.slot !== undefined) this.ws.send(JSON.stringify({ t: 'slot', slot: a.slot }));
    else if (a.t === 'reload') this.ws.send(JSON.stringify({ t: 'reload' }));
    else if (a.t === 'weapon' && a.id) this.ws.send(JSON.stringify({ t: 'w', id: a.id }));
  }
  dispose(): void {
    try { this.ws.close(); } catch { /* noop */ }
  }
}
