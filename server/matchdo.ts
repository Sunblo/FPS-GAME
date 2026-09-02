// MatchDO: authoritative host for one game (one per room code).
// Runs the shared MatchSim at ~30Hz using wall-clock catch-up, steps a BotBrain
// for all bot seats, and fans out snapshots + per-recipient events to clients.
//
// Roster model: a match always has `seats = teamSize*2` players. Seats start as
// bots; when a human joins they take over an available bot seat (converted back
// to a bot on disconnect). This keeps the match live even while players come
// and go without restarting the simulation.
import { MatchSim } from '../shared/sim.ts';
import { BotBrain, botNames } from '../shared/bot.ts';
import type { MatchEvt } from '../shared/sim.ts';
import {
  headerOf, snapBodyOf,
  type InMsg, type OutMsg, type PState,
} from '../shared/protocol.ts';

const SIM_DT = 1 / 30;

interface Seat {
  // same id as sim player id
  id: string;
  human: boolean;
  session: WebSocket | null;
  name: string;
}

interface Session {
  key: string;
  seat: Seat;
  ws: WebSocket;
  name: string;
  lastPong: number;
}

interface Env {
  MATCHES: DurableObjectNamespace;
  APP_NAME: string;
  TICK_RATE: string;
}

export class MatchDO {
  state: DurableObjectState;
  env: Env;
  sim: MatchSim | null = null;
  brain: BotBrain | null = null;
  teamSize = 5;
  seats: Seat[] = [];
  sessions = new Map<string, Session>();
  accPublic: MatchEvt[] = [];
  accPer = new Map<string, MatchEvt[]>();
  lastWall = Date.now();
  lastSend = 0;
  seq = 0;
  ttl = Date.now() + 60_000; // destroy self when idle this long

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // --- lifecycle ---------------------------------------------------------------
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const name = url.searchParams.get('name') || 'HOSTILE';
    const key = url.searchParams.get('id') || Math.random().toString(36).slice(2);
    this.teamSize = clampI(url.searchParams.get('size'), 1, 5, this.teamSize);

    this.ensureMatch();
    if (!this.sim) return new Response('no match', { status: 500 });

    const sim = this.sim;
    // find or create a seat for this human
    let seat: Seat | undefined;
    for (const s of this.seats) {
      if (!s.human) { seat = s; break; }
    }
    if (!seat) {
      // everyone is human - only allowed if humans under capacity
      const hum = this.seats.filter((s) => s.human).length;
      if (hum >= this.teamSize * 2) {
        return new Response(JSON.stringify({ error: 'room full' }), { status: 423 });
      }
      const p = sim.addPlayer(idOf(this.seats.length), name);
      seat = { id: p.id, human: true, session: null, name };
      this.seats.push(seat);
      // keep seat count balanced to teamSize*2
      while (this.seats.length < this.teamSize * 2) {
        const bp = sim.addPlayer(idOf(this.seats.length), botNames(9)[0]);
        bp.isBot = true; bp.online = false;
        this.seats.push({ id: bp.id, human: false, session: null, name: bp.name });
      }
      this.rebuildBrain();
    } else {
      const p = sim.players.get(seat.id);
      if (p) {
        p.isBot = false; p.online = true;
        p.name = name;
      }
      seat.human = true;
      seat.name = name;
    }

    // websocket handshake: return a fresh pair; the client gets 'client', the DO
    // keeps 'server'.
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();

    const sess: Session = { key, seat, ws: server, name, lastPong: Date.now() };
    seat.session = server;
    this.sessions.set(key, sess);

    server.addEventListener('message', (ev) => this.onMessage(server, ev as MessageEvent));
    server.addEventListener('close', () => this.onClose(sess));
    server.addEventListener('error', () => this.onClose(sess));

    const p = this.sim.players.get(seat.id);
    const joined: OutMsg = {
      t: 'joined',
      id: seat.id,
      team: p ? p.team : 1,
      yourIndex: seatIdxOf(this.seats, seat),
      header: headerOf(this.sim),
    };
    server.send(JSON.stringify(joined));

    this.broadcast(true);
    this.scheduleAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  private ensureMatch(): void {
    if (this.sim) {
      // reuse while live; if humans all gone & match over, reset for next group
      const humans = this.seats.filter((s) => s.human && s.session);
      if (this.sim.phase !== 'matchover' || humans.length > 0) return;
    }
    this.sim = new MatchSim({
      map: 'REACTOR-09', tickRate: 30, firstTo: 13, teamSize: this.teamSize,
      ot: true, warmup: true,
    });
    this.sim.onLog = (s) => console.log('[sim]', s);
    this.sim.warmupLeft = 8;
    this.seats = [];
    this.brain = null;
    // seed seats as bots up to capacity
    const names = botNames(this.teamSize * 2 * 2);
    for (let i = 0; i < this.teamSize * 2; i++) {
      const id = idOf(i);
      const p = this.sim.addPlayer(id, names[i]);
      p.isBot = true; p.online = false;
      this.seats.push({ id, human: false, session: null, name: names[i] });
    }
    this.rebuildBrain();
    this.ttl = Date.now() + 60_000;
  }

  private rebuildBrain(): void {
    if (!this.sim) return;
    // re-create so its player mirror matches seats; players don't change id/team
    this.brain = new BotBrain(this.sim, 0.8);
  }

  // --- messaging ---------------------------------------------------------------
  private onMessage(ws: WebSocket, ev: MessageEvent): void {
    if (typeof ev.data !== 'string') return;
    let msg: InMsg;
    try { msg = JSON.parse(ev.data) as InMsg; } catch { return; }
    const sess = this.findByWs(ws);
    if (!sess || !this.sim) return;
    const p = this.sim.players.get(sess.seat.id);
    if (!p) return;

    this.ttl = Date.now() + 120_000;
    switch (msg.t) {
      case 'input':
        p.cmd.yaw = clamp(msg.yaw, -Math.PI * 4, Math.PI * 4);
        p.cmd.pitch = clamp(msg.pitch, -1.553, 1.553);
        p.cmd.f = clamp(msg.f, -1, 1);
        p.cmd.s = clamp(msg.s, -1, 1);
        p.cmd.b = msg.b & 63;
        break;
      case 'buy':
        if (this.sim) this.sim.buyItem(p, sanitizeItem(msg.item));
        break;
      case 'slot':
        if (this.sim) this.sim.switchTo(p, clampI(String(msg.slot), 0, 3, 0));
        break;
      case 'reload':
        if (this.sim) this.sim.reload(p);
        break;
      case 'w':
        if (this.sim) this.sim.switchToId(p, String((msg as { id: string }).id || ''));
        break;
      case 'chat':
        break;
      case 'restart':
        break;
    }
    // step simulation to keep in sync with wall clock
    this.pump(false);
  }

  private onClose(sess: Session): void {
    const seat = sess.seat;
    seat.session = null;
    this.sessions.delete(sess.key);
    if (this.sim) {
      const p = this.sim.players.get(seat.id);
      if (p && seat.human) {
        // convert the vacated human seat back to a bot so play continues
        p.isBot = true;
        p.online = false;
        seat.human = false;
        seat.name = p.name;
        if (this.brain) this.brain.step();
      }
    }
  }

  private findByWs(ws: WebSocket): Session | null {
    for (const s of this.sessions.values()) if (s.ws === ws) return s;
    return null;
  }

  // --- simulation pump -----------------------------------------------------------
  private pump(forceSend: boolean): void {
    if (!this.sim) return;
    const now = Date.now();
    let elapsed = (now - this.lastWall) / 1000;
    this.lastWall = now;
    if (elapsed > 0.6) elapsed = 0.6;
    let steps = Math.max(1, Math.round(elapsed * 30));
    if (steps > 30) steps = 30;

    const sim = this.sim;
    for (let i = 0; i < steps; i++) {
      if (this.brain) this.brain.step();
      sim.step(SIM_DT);
      this.collectEvents();
      if (this.wantImmediate()) this.broadcast(false);
    }
    if (steps > 0) this.broadcast(forceSend);
    this.scheduleAlarm();
  }

  private wantImmediate(): boolean {
    for (const e of this.accPublic) {
      const k = e.k;
      if (k === 'kill' || k === 'planted' || k === 'defused' || k === 'boom' ||
          k === 'round' || k === 'match' || k === 'phase' || k === 'spawn') return true;
    }
    return false;
  }

  private collectEvents(): void {
    if (!this.sim) return;
    const out = this.sim.flushEvents();
    for (const e of out.public) this.accPublic.push(e);
    for (const [id, list] of out.per) {
      let cur = this.accPer.get(id);
      if (!cur) { cur = []; this.accPer.set(id, cur); }
      for (const e of list) cur.push(e);
    }
    // cap memory
    if (this.accPublic.length > 400) this.accPublic.splice(0, this.accPublic.length - 200);
  }

  private broadcast(force: boolean): void {
    if (!this.sim) return;
    const now = Date.now();
    if (!force && now - this.lastSend < 90) return;
    this.lastSend = now;
    const sim = this.sim;
    const header = headerOf(sim);
    const seq = ++this.seq;

    const body = snapBodyOf(sim);
    const players = body.players;
    const smokes = body.smokes;
    const fires = body.fires;

    const pub = this.accPublic;
    this.accPublic = [];
    const perMap = this.accPer;
    this.accPer = new Map();

    for (const s of this.sessions.values()) {
      if (!s.seat.session) continue;
      const own = perMap.get(s.seat.id) || [];
      const myPlayers = players.slice(); // shallow ok
      const msg: OutMsg = {
        t: 'snap',
        seq,
        now: Date.now(),
        header,
        players: myPlayers,
        smokes,
        fires,
        events: pub.concat(own),
      };
      try {
        s.seat.session.send(JSON.stringify(msg));
      } catch {
        // socket dead; will be cleaned on close
      }
    }
  }

  private scheduleAlarm(): void {
    if (this.sessions.size === 0) return;
    void this.state.storage.setAlarm(Date.now() + 900).catch(() => {});
  }

  async alarm(): Promise<void> {
    // Keep the simulation ticking even if clients go quiet for a moment.
    if (this.sessions.size === 0) return;
    if (Date.now() > this.ttl && this.sim && this.sim.phase === 'matchover') return;
    this.pump(true);
  }
}

function idOf(n: number): string {
  return 'P' + (n + 1).toString().padStart(2, '0');
}
function seatIdxOf(seats: Seat[], s: Seat): number {
  return seats.indexOf(s);
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function clampI(v: string | null, lo: number, hi: number, d: number): number {
  const n = parseInt(v ?? '', 10);
  if (isNaN(n)) return d;
  return Math.max(lo, Math.min(hi, n));
}
const ITEMS = new Set(['armor', 'helmet', 'frag', 'smoke', 'flash', 'fire', 'decoy',
  'leviathan', 'vanguard', 'sentinel', 'skitter', 'marauder', 'breacher',
  'pax', 'mirage', 'shadow', 'talisman', 'verge', 'nova-x', 'obliterator',
  'raptor', 'viper', 'hydra', 'gauss-p', 'atlas-p', 'ranger-p', 'cyclone-p']);
function sanitizeItem(s: string): string {
  return ITEMS.has(s) ? s : '';
}
