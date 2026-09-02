// Wire protocol between client and the authoritative MatchDO host.
// Everything is JSON. The client never sends world state or damage/kill
// claims: only inputs + menu actions. The server broadcasts slim snapshots
// plus per-recipient event queues.
import type { SimPlayer, MatchEvt, MatchSim } from './sim.ts';

// ---- client -> server ---------------------------------------------------------
export interface CmdJoin { t: 'join'; name: string; proto: number }
export interface CmdInput {
  t: 'input';
  seq: number;
  yaw: number;
  pitch: number;
  f: number;
  s: number;
  b: number; // BTN bitmask
}
export interface CmdBuy { t: 'buy'; item: string }
export interface CmdSlot { t: 'slot'; slot: number }
export interface CmdReload { t: 'reload' }
export interface CmdWeapon { t: 'w'; id: string }
export interface CmdPing { t: 'ping'; ts: number }
export interface CmdChat { t: 'chat'; text: string }
export interface CmdRestart { t: 'restart' }

export type InMsg =
  | CmdJoin | CmdInput | CmdBuy | CmdSlot | CmdReload | CmdWeapon | CmdPing | CmdChat | CmdRestart;

// ---- server -> client ---------------------------------------------------------
// Slim per-player state carried in snapshots.
export interface PState {
  id: string;
  name: string;
  team: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  vx: number; vy: number; vz: number;
  hp: number;
  armor: number;
  money: number;
  hasBomb: number;
  alive: number;
  duck: number;
  blind: number;
  curW: string;
  moving: number;
  using: number;
  useKind: string;
  mag: number;
  res: number;
  kills: number;
  deaths: number;
}

export interface SmokeInfo { x: number; z: number; r: number; till: number }
export interface FireInfo { x: number; z: number; r: number; till: number }

export interface SnapHeader {
  ph: string;
  rnd: number;
  scr: [number, number];
  atkTeam: number;
  plant: number;
  boomIn: number;
  rt: number;
  bt: number;
  wt: number;
  targetWin: number;
}

export interface MsgJoined {
  t: 'joined';
  id: string;
  team: number;
  yourIndex: number;
  header: SnapHeader;
}
export interface MsgSnap {
  t: 'snap';
  seq: number;
  now: number;
  header: SnapHeader;
  players: PState[];
  smokes: SmokeInfo[];
  fires: FireInfo[];
  // events relevant to the recipient (public ones + their own private ones)
  events: MatchEvt[];
}
export interface MsgPong { t: 'pong'; ts: number }
export interface MsgKicked { t: 'kicked'; reason: string }

export type OutMsg = MsgJoined | MsgSnap | MsgPong | MsgKicked;

// ---- helpers ----------------------------------------------------------------
export function playerState(p: SimPlayer): PState {
  let mag = -1, res = -1;
  if (p.curW !== 'knife') {
    const sl = p.slots.pistol.id === p.curW ? p.slots.pistol
      : p.slots.primary.id === p.curW ? p.slots.primary : null;
    if (sl) { mag = sl.mag; res = sl.res; }
  }
  return {
    id: p.id, name: p.name, team: p.team,
    x: p.x, y: p.y, z: p.z,
    yaw: p.cmd.yaw, pitch: p.cmd.pitch,
    vx: p.vx, vy: p.vy, vz: p.vz,
    hp: p.hp, armor: p.armor, money: p.money,
    hasBomb: p.hasBomb ? 1 : 0, alive: p.alive ? 1 : 0,
    duck: p.duck ? 1 : 0, blind: p.blindT > 0 ? 1 : 0,
    curW: p.curW, moving: p.moving, using: p.using ? 1 : 0, useKind: p.useKind,
    mag, res,
    kills: p.kills, deaths: p.deaths,
  };
}

export const PROTO_VERSION = 1;
export const PROTO_TS = 30000;

export function headerOf(sim: MatchSim): SnapHeader {
  const h = sim.header();
  return {
    ph: h.ph, rnd: h.rnd, scr: [h.scr[0], h.scr[1]],
    atkTeam: sim.attackerSide, plant: h.plant, boomIn: h.boomIn,
    rt: h.rt, bt: h.bt, wt: h.wt, targetWin: sim.targetWin,
  };
}

export interface SnapBody { players: PState[]; smokes: SmokeInfo[]; fires: FireInfo[]; simNow: number }

export function snapBodyOf(sim: MatchSim): SnapBody {
  const players: PState[] = [];
  for (const id of sim.order) {
    const p = sim.players.get(id);
    if (!p) continue;
    if (!p.online && !p.isBot) continue;
    players.push(playerState(p));
  }
  const smokes: SmokeInfo[] = sim.smokes.map((s) => ({ x: s.x, z: s.z, r: s.r, till: s.till }));
  const fires: FireInfo[] = sim.fires.map((f) => ({ x: f.x, z: f.z, r: f.r, till: f.till }));
  return { players, smokes, fires, simNow: sim.now };
}
