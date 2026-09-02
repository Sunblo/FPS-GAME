// AXIOM SIEGE - core tuning constants (single source of truth, used by server & client)

export const GAME_NAME = 'AXIOM SIEGE';
export const GAME_SHORT = 'AXSIEGE';
export const MAP_NAME = 'REACTOR-09';
export const MAP_LONG = 'REACTOR-09 "Fusion Core"';

export const TEAM_ATTACK = 1; // orange "Breach Unit" - plants the device
export const TEAM_DEFEND = 2; // cyan  "Vault Guard" - defends sites
export const TEAM_NONE = 0;

// Physics -------------------------------------------------------------------
export const GRAVITY = 820; // units/s^2
export const JUMP_VEL = 352; // vertical launch speed (apex ~75.5u)
export const MAX_SPEED = 252; // units/s ground
export const WALK_FACTOR = 0.5;
export const CROUCH_FACTOR = 0.36;
export const AIR_FACTOR = 1.0;
export const ACCEL = 2400; // ground accel (u/s^2)
export const AIR_ACCEL = 1300;
export const FRICTION = 4.4; // stopping coefficient (higher = stop faster)
export const STEP_HEIGHT = 18; // max walkable ledge/step
export const PLAYER_RADIUS = 16; // XZ half-extent
export const STAND_HEIGHT = 72;
export const CROUCH_HEIGHT = 54;
export const EYE_STAND = 64;
export const EYE_CROUCH = 46;
export const MAX_EYE_DELTA_FALL = 900; // u/s fall that triggers land sound threshold

export const HULL_JUMP_CLEARANCE = 56; // a player can clear obstacles with top <= this by jumping

// Combat / timing -----------------------------------------------------------
export const TICK_RATE = 30;
export const PRED_TICK = 30; // client-side logical prediction cadence
export const MAX_HEALTH = 100;
export const MAX_ARMOR = 100;
export const ARMOR_DMG_ABSORB = 0.5; // fraction of non-penetrating damage armor eats
export const HEADSHOT_MULT = 4;
export const LIMB_MULT = 0.72; // legs/feet
export const BOMB_ARM_TIME = 45; // seconds after plant to detonate
export const PLANT_TIME = 3.2;
export const DEFUSE_TIME = 5;
export const BUY_TIME = 20; // seconds of buy phase into a round
export const FREEZE_TIME = 5; // frozen at round start (buy remains possible)
export const ROUND_TIME = 115; // live round length
export const WARMUP_TIME = 40; // warmup duration before first round
export const ROUND_END_DELAY = 6; // intermission after a round ends
export const RESPAWN_DELAY_SPECTATE = 1.5;

// Economy -------------------------------------------------------------------
export const START_MONEY = 800;
export const MAX_MONEY = 16000;
export const MONEY_KILL = 300;
export const MONEY_WIN = 3250;
export const MONEY_LOSS_START = 1400;
export const MONEY_LOSS_STEP = 500;
export const MONEY_LOSS_MAX = 3400;
export const MONEY_PLANT = 300; // planter bonus (team gets kill money too)
export const MONEY_TEAM_PLANT = 800; // shared plant reward for attackers
export const MONEY_DEFUSE = 300;
export const MONEY_TEAM_DEFUSE = 800;

// Match structure -----------------------------------------------------------
export const FIRST_TO = 13; // rounds to win
export const SIDE_SWAP_ROUND = 13; // round at which sides swap (after 12 rounds)
export const MAX_REG_ROUNDS = 24; // regulation cap before overtime
export const OT_FIRST_TO = 16;

// Network -------------------------------------------------------------------
export const NET_INPUT_RATE = 30; // client input packets per second
export const MAX_CLIENT_INPUTS_PER_SEC = 90;
export const MAX_NAME_LEN = 18;
export const HEARTBEAT_MS = 10000;
export const RECONNECT_WINDOW = 40000;
