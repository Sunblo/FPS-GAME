// Shared data types & network protocol definitions (no DOM / no workers deps)

export type Team = 0 | 1 | 2;

export type Phase =
  | 'warmup'
  | 'freeze' // round start lock, buy allowed
  | 'live'
  | 'roundend'
  | 'matchover'
  | 'paused';

export interface Box3 {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
}

export type WeaponCat =
  | 'melee' | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'lmg';
export type GrenadeType = 'frag' | 'smoke' | 'flash' | 'fire' | 'decoy';

export interface WeaponDef {
  id: string;
  name: string;
  cat: WeaponCat;
  price: number;
  dmg: number; // base body damage at point blank
  rpm: number; // rounds per minute (rate limiter)
  auto: boolean;
  mag: number;
  reserve: number; // starting reserve ammo
  reload: number; // seconds
  range: number; // effective range units (falloff begins ~50%)
  rangeMax: number;
  spread: number; // base cone half-angle degrees
  spreadPerShot: number;
  spreadMax: number;
  moveSpread: number; // extra when moving
  crouchFactor: number; // multiplier while crouching
  airSpread: number;
  recoil: number; // degrees upward kick per shot
  recoilRandom: number; // degrees random per shot
  recoilMax: number;
  recoilRecover: number; // deg/s recovery
  pellets: number;
  armorPen: number; // 0..1 fraction of damage removed from armor pool per point dealt to body
  killReward: number;
  scope?: boolean;
  zoomFov?: number; // multiplier applied to base fov
  tracerEvery?: number;
  penetrable?: boolean;
  rangeMul?: number;
  headMul?: number; // default 4 unless overridden
  limbMul?: number; // default 0.72
}

export interface UtilityDef {
  id: string;
  name: string;
  price: number;
  kind: GrenadeType;
  maxCarry: number;
  throwSpeed?: number;
}

// --------------------------------------------------------------------------
// Player snapshot (server -> client per tick)
export interface PlayerSnap {
  id: string;
  n: string; // name
  t: Team; // team
  al: number; // alive 0/1
  x: number; y: number; z: number; // feet position
  yaw: number;
  pitch: number;
  c: number; // crouch 0/1
  hp: number;
  ar: number; // armor
  w: string; // current weapon id
  m: number; // mag ammo
  r: number; // reserve ammo
  mo: number; // money
  b: number; // bombCarry 0/1
  a: number; // anim flags bitmask: 1 shooting, 2 reloading, 4 throwing, 8 planting/defusing channel, 16 scope
  ms: number; // move state: 0 idle,1 walk,2 run
  sc: number; // score kills
  de: number; // deaths
  vx?: number; vz?: number; // velocity (for anim + spectate)
}

// Event kinds appended to snapshots. `k` discriminates; extra fields are
// carried verbatim over the wire, so a permissive index signature keeps the
// protocol flexible across all three runtimes (worker / browser / node).
export interface SnapEvt {
  k: string;
  to?: string;
  // kill
  kn?: string; // killer name
  v?: string; // victim id
  vn?: string; // victim name
  w?: string;
  hs?: number;
  x?: number; y?: number; z?: number;
  // round / phase
  winner?: number;
  reason?: string;
  ph?: string;
  site?: number;
  score?: { a: number; d: number };
  // use / plant / defuse
  kind?: string;
  // money
  amt?: number;
  // damage / flash
  d?: number;
  from?: string;
  dead?: number;
  // grenades
  g?: string;
  // text / sound
  msg?: string;
  sub?: string;
  snd?: string;
  [key: string]: any;
}

export interface SnapHeader {
  ph: Phase;
  rt: number; // round timer seconds remaining (live phase)
  bt: number; // buy timer remaining
  wt: number; // warmup/other remaining
  scr: number[]; // [attack, defend]
  rnd: number;
  plant: number; // planted site 0 none
  boomIn?: number; // seconds until detonation when planted
}

export interface Snapshot {
  t: 'snap';
  seq: number;
  h: SnapHeader;
  you: YouState;
  players: PlayerSnap[];
  evts: SnapEvt[];
}

export interface YouState {
  id: string;
  name: string;
  money: number;
  hp: number;
  ar: number;
  w: string;
  m: number;
  r: number;
  bomb: number; // has the device
  // authoritative position for reconciliation
  px: number; py: number; pz: number;
  pvx?: number; pvy?: number; pvz?: number;
  alive: number;
  weapons: string[]; // ids owned (excluding utilities)
  util: Record<string, number>;
  hasHelmet: number;
  kit: number;
}

// --------------------------------------------------------------------------
// Client -> server
export interface CInput {
  seq: number; // incrementing
  yaw: number;
  pitch: number;
  f: number; // forward -1..1
  s: number; // strafe -1..1
  b: number; // buttons bitmask
  mx?: number; my?: number; // mouse dx for server-side sanity? unused
}

export const BTN = { JUMP: 1, CROUCH: 2, WALK: 4, FIRE: 8, ZOOM: 16, USE: 32 } as const;

export interface MatchConfig {
  map: string;
  tickRate: number;
  firstTo: number;
  teamSize: number; // 1..5
  ot: boolean;
  warmup: boolean;
  region?: string;
  // Minimum number of live participants (humans + bots) needed before the
  // match may leave warmup / start the next round. Used by online hosts so
  // human-only rooms simply wait instead of seeding bots.
  minPlayers?: number;
}

export interface PlayerMeta {
  id: string;
  key: string; // opaque auth token
  name: string;
  online: boolean;
  elo?: number;
  matchId?: string;
  lobbyId?: string;
}

// Auth response from worker
export interface AuthResult {
  ok: boolean;
  id?: string;
  key?: string;
  name?: string;
  err?: string;
}
