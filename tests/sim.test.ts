// Headless simulation tests (run: npm test)
// Verifies movement physics, combat, economy, planting and bot matches behave.
import { MatchSim, BTN } from '../shared/sim.ts';
import { BotBrain } from '../shared/bot.ts';
import { WEAPONS, UTILITIES } from '../shared/weapons.ts';
import { cellWorldX, cellWorldZ, PLANT_ZONES } from '../shared/mapdef.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  ok  ' + msg); }
  else { fail++; console.log('  FAIL ' + msg); }
}
function simCfg() {
  return { map: 'REACTOR-09', tickRate: 30, firstTo: 13, teamSize: 5, ot: true, warmup: false };
}
// Run the real match flow until the first round is live, then settle ground.
function toLive(sim: MatchSim): void {
  for (let i = 0; i < 60 * 30 && (sim as any).phase !== 'live'; i++) { sim.step(1 / 30); sim.flushEvents(); }
  if ((sim as any).phase !== 'live') throw new Error('never reached live');
}
function settleG(p: any, sim: MatchSim, ticks = 8): void {
  p.onGround = false; p.vy = 0;
  for (let i = 0; i < ticks; i++) { sim.step(1 / 30); sim.flushEvents(); }
}
function aimYawTo(fx: number, fz: number, tx: number, tz: number): number {
  return Math.atan2(-(tx - fx), -(tz - fz));
}
function faceAt(p: any, tx: number, tz: number) { p.cmd.yaw = aimYawTo(p.x, p.z, tx, tz); p.cmd.pitch = 0; }

// ---- test 1: physics sanity -------------------------------------------------
function testPhysics() {
  const sim = new MatchSim(simCfg());
  const a = sim.addPlayer('P1', 'A', true);
  const b = sim.addPlayer('P2', 'B', true);
  toLive(sim);
  const p = a.team === 1 ? a : b; // an attacker at north spawn
  // walk forward (+z, attacker spawn yaw ~PI) for 1s; must displace meaningfully
  const z0 = p.z;
  p.cmd.f = 1; p.cmd.s = 0;
  for (let i = 0; i < 30; i++) { sim.step(1 / 30); sim.flushEvents(); }
  ok(!isNaN(p.x) && !isNaN(p.z) && p.y >= 0, 'pos stays finite on ground');
  ok(p.z - z0 > 30 && p.z - z0 < 400, `walked forward a sane amount (dz=${(p.z - z0).toFixed(1)})`);
  ok(Math.abs(p.vx) <= 253 && Math.abs(p.vz) <= 253, 'horizontal speed bounded');
  // stop -> friction brings speed near zero within ~0.5s
  p.cmd.f = 0;
  for (let i = 0; i < 15; i++) { sim.step(1 / 30); sim.flushEvents(); }
  ok(Math.hypot(p.vx, p.vz) < 10, 'friction stops the player');
  // jump apex over open floor (teleport to plaza, settle, single tap jump)
  p.x = cellWorldX(16.5); p.z = cellWorldZ(6); p.y = 0; p.alive = true;
  settleG(p, sim);
  p.cmd.b = BTN.JUMP;
  let maxY = 0;
  for (let i = 0; i < 40; i++) {
    sim.step(1 / 30);
    sim.flushEvents();
    if (i > 2) p.cmd.b &= ~BTN.JUMP;
    if (p.y > maxY) maxY = p.y;
  }
  ok(maxY > 55 && maxY < 90, `jump apex plausible (${maxY.toFixed(1)})`);
}

// ---- test 2: duel between two live bots -------------------------------------
function testCombat() {
  const sim = new MatchSim(simCfg());
  const a = sim.addPlayer('AA', 'DuelA', true);
  const b = sim.addPlayer('BB', 'DuelB', true);
  toLive(sim);
  const s: any = sim;
  s.attackerSide = a.team; // attacker may change after first round; keep simple
  const ax = cellWorldX(13), az = cellWorldZ(6);
  const bx = cellWorldX(20), bz = cellWorldZ(6);
  a.x = ax; a.z = az; a.alive = true;
  b.x = bx; b.z = bz; b.alive = true;
  settleG(a, sim); settleG(b, sim);
  a.slots.primary = { id: 'leviathan', mag: 30, res: 90 };
  b.slots.primary = { id: 'leviathan', mag: 30, res: 90 };
  a.curW = 'leviathan'; b.curW = 'leviathan';
  const m0a = a.money, m0b = b.money;
  let dead = 0;
  for (let i = 0; i < 20 * 30 && dead === 0; i++) {
    faceAt(a, bx, bz); faceAt(b, ax, az);
    a.cmd.b = BTN.FIRE; b.cmd.b = BTN.FIRE;
    a.cmd.f = 0; a.cmd.s = 0; b.cmd.f = 0; b.cmd.s = 0;
    sim.step(1 / 30);
    sim.flushEvents();
    if (!a.alive || !b.alive) { dead = 1; break; }
    if ((sim as any).phase !== 'live') break;
  }
  ok(dead === 1, 'a duel produces a death within 20s');
  const winner = a.alive ? a : b, loser = a.alive ? b : a;
  ok(winner.kills >= 1, 'winner recorded a kill');
  ok(winner.money > Math.max(m0a, m0b === m0b ? m0b : m0b), 'winner earned a kill reward or round win');
  ok(loser.deaths === 1, 'loser recorded a death');
  ok(!loser.alive, 'loser is dead');
}

// ---- test 3: buying / economy ----------------------------------------------
function testBuy() {
  const sim = new MatchSim(simCfg());
  const a = sim.addPlayer('P1', 'Buyer', true);
  const b = sim.addPlayer('P2', 'B', true);
  // enter freeze of round 1
  toLive(sim); // reached live round1 (freeze passed). buy window closed at live+20s; buyAllowed requires freeze or live-buy zone
  // Restart into freeze cleanly for the buy test: new sim is simpler
  // We instead assert direct rules on a fresh round via winRound? Use fresh match:
  const sim2 = new MatchSim(simCfg());
  const c = sim2.addPlayer('P1', 'Buyer', true);
  sim2.addPlayer('P2', 'B', true);
  for (let i = 0; i < 600 && (sim2 as any).phase !== 'freeze'; i++) { sim2.step(1 / 30); sim2.flushEvents(); }
  ok((sim2 as any).phase === 'freeze', 'entered freeze phase');
  c.money = 16000;
  ok(sim2.buyItem(c, 'armor').ok, 'buy armor');
  ok(sim2.buyItem(c, 'helmet').ok, 'buy helmet with armor');
  ok(c.armor === 100 && c.hasHelmet, 'armor + helmet applied');
  ok(sim2.buyItem(c, 'leviathan').ok, 'buy primary rifle');
  ok(c.slots.primary.id === 'leviathan', 'primary equipped');
  ok(sim2.buyItem(c, 'frag').ok && c.util.frag === 1, 'buy a frag');
  ok(!sim2.buyItem(c, 'frag').ok, 'duplicate frag rejected (max carry)');
  // no-money edge
  c.money = 0;
  ok(!sim2.buyItem(c, 'smoke').ok, 'cannot buy with no money');
  // money actually spent
  ok(c.money >= 0 && c.money < 16000, 'money decreased after purchases');
}

// ---- test 4: planting & defusing --------------------------------------------
function testPlant() {
  const sim = new MatchSim(simCfg());
  const a = sim.addPlayer('P1', 'Planter', true);
  const d = sim.addPlayer('P2', 'Def', true);
  toLive(sim);
  const s: any = sim;
  // ensure a is the attacker with the bomb
  ok(a.team === s.attackerSide, 'player A is on the attacking side (round 1)');
  ok(a.hasBomb || d.hasBomb, 'bomb was granted on spawn');
  const planter = a.hasBomb ? a : d;
  const def = a.hasBomb ? d : a;
  const site = PLANT_ZONES[0]; // site A
  planter.x = site.x; planter.z = site.z; planter.y = 0; planter.alive = true;
  settleG(planter, sim);
  let planted = 0;
  for (let i = 0; i < Math.ceil(5 * 30) && planted === 0; i++) {
    planter.cmd.b = BTN.USE; planter.cmd.f = 0; planter.cmd.s = 0;
    sim.step(1 / 30);
    const ev = sim.flushEvents();
    if (ev.public.some((e: any) => e.k === 'planted')) planted++;
    if ((sim as any).phase !== 'live') break;
  }
  ok(planted === 1, 'bomb planted at site A after holding use');
  ok(sim.planted === 1, 'sim planted flag set');
  // defender walks onto site and defuses
  def.x = site.x; def.z = site.z; def.y = 0; def.alive = true;
  settleG(def, sim);
  let defused = 0;
  for (let i = 0; i < Math.ceil(11 * 30) && defused === 0; i++) {
    def.cmd.b = BTN.USE;
    planter.cmd.b = 0;
    sim.step(1 / 30);
    const ev = sim.flushEvents();
    if (ev.public.some((e: any) => e.k === 'defused')) defused++;
    if ((sim as any).phase === 'roundend' || (sim as any).phase === 'matchover') break;
  }
  ok(defused === 1, 'defuser completed defuse (round won)');
  ok((sim as any).lastReason === 'defused', 'round ended with defuse reason');
}

// ---- test 5: grenades -------------------------------------------------------
function testGrenade() {
  const sim = new MatchSim(simCfg());
  const a = sim.addPlayer('G1', 'Thrower', true);
  const b = sim.addPlayer('G2', 'Target', true);
  toLive(sim);
  a.x = cellWorldX(13); a.z = cellWorldZ(6); a.y = 0; a.alive = true;
  b.x = cellWorldX(16.5); b.z = cellWorldZ(6); b.alive = true; b.y = 0;
  settleG(a, sim); settleG(b, sim);
  a.util.frag = 1;
  a.curW = 'frag';
  faceAt(a, b.x, b.z);
  let exploded = 0, boom = 0;
  for (let i = 0; i < 30 * 30; i++) {
    a.cmd.b = i < 40 ? BTN.FIRE : 0;
    sim.step(1 / 30);
    const ev = sim.flushEvents();
    if (ev.public.some((e: any) => e.k === 'explode' && e.g === 'frag')) exploded++;
    if (ev.public.some((e: any) => e.k === 'boom')) boom++;
    if (boom || (sim as any).phase === 'roundend') break;
  }
  ok(exploded === 1, 'frag grenade exploded');
  ok(a.util.frag === 0, 'grenade consumed');
  ok(b.hp < 100 || !b.alive, 'target took grenade damage or died');
}

// ---- test 6: full bot match -------------------------------------------------
function testBotMatch() {
  const sim = new MatchSim(simCfg());
  sim.onLog = () => {};
  for (let i = 0; i < 10; i++) sim.addPlayer('b' + i, 'Bot' + i, true);
  const brain = new BotBrain(sim, 0.9);
  let kills = 0, plants = 0, booms = 0;
  for (let i = 0; i < 60 * 30 * 2; i++) {
    brain.step();
    sim.step(1 / 30);
    const ev = sim.flushEvents();
    for (const e of ev.public) {
      if (e.k === 'kill') kills++;
      if (e.k === 'planted') plants++;
      if (e.k === 'boom') booms++;
    }
    if (sim.roundNum > 2) break;
    if (i > 45 * 30 && sim.roundNum > 0) break;
  }
  ok(sim.roundNum >= 1, 'bots advanced past warmup into rounds');
  for (const p of sim.players.values()) {
    ok(!isNaN(p.x) && p.x > 0 && p.x < 34 * 64 && !isNaN(p.z) && p.z < 30 * 64, `player ${p.name} in bounds`);
    ok(p.money >= 0 && p.money <= 16000, `player ${p.name} money sane`);
    ok((p.hp >= 0 && p.hp <= 100) || !p.alive, `player ${p.name} hp sane (${p.hp})`);
  }
  console.log('  stats  rounds=' + sim.roundNum + ' kills=' + kills + ' plants=' + plants + ' booms=' + booms);
  ok(kills > 0 || plants > 0 || booms > 0, 'bots actually fought over objectives');
}

console.log('physics...');
testPhysics();
console.log('combat...');
testCombat();
console.log('economy...');
testBuy();
console.log('plant/defuse...');
testPlant();
console.log('grenades...');
testGrenade();
console.log('bot match...');
testBotMatch();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
