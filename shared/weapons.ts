// AXIOM SIEGE original arsenal (names, values and balance are original)
import type { WeaponDef, UtilityDef } from './types.ts';

const deg = (v: number) => v; // spread values below are already in degrees

export const WEAPONS: Record<string, WeaponDef> = {};

function def(w: WeaponDef): WeaponDef {
  WEAPONS[w.id] = w;
  return w;
}

// --- Melee ---
def({
  id: 'knife', name: 'Ripper Edge', cat: 'melee', price: 0, dmg: 40, rpm: 240,
  auto: true, mag: 0, reserve: 0, reload: 0, range: 60, rangeMax: 90,
  spread: 0, spreadPerShot: 0, spreadMax: 0, moveSpread: 0, crouchFactor: 1,
  airSpread: 0, recoil: 0, recoilRandom: 0, recoilMax: 0, recoilRecover: 0,
  pellets: 1, armorPen: 0, killReward: 1500,
});

// --- Pistols ---
def({
  id: 'vireo', name: 'Vireo Mk.I', cat: 'pistol', price: 0, dmg: 27, rpm: 420,
  auto: true, mag: 20, reserve: 120, reload: 2.1, range: 1800, rangeMax: 4200,
  spread: 0.9, spreadPerShot: 0.8, spreadMax: 3.2, moveSpread: 2.6,
  crouchFactor: 0.7, airSpread: 3.2, recoil: 0.65, recoilRandom: 0.3,
  recoilMax: 6, recoilRecover: 14, pellets: 1, armorPen: 0.5, killReward: 300,
});
def({
  id: 'warden', name: 'Warden P-12', cat: 'pistol', price: 300, dmg: 34, rpm: 380,
  auto: true, mag: 13, reserve: 52, reload: 2.3, range: 2000, rangeMax: 4500,
  spread: 0.7, spreadPerShot: 0.9, spreadMax: 3.4, moveSpread: 2.4,
  crouchFactor: 0.65, airSpread: 3.0, recoil: 0.8, recoilRandom: 0.4,
  recoilMax: 7, recoilRecover: 13, pellets: 1, armorPen: 0.5, killReward: 300,
});
def({
  id: 'talon', name: 'Talon .45', cat: 'pistol', price: 700, dmg: 58, rpm: 260,
  auto: true, mag: 8, reserve: 32, reload: 2.6, range: 2200, rangeMax: 5000,
  spread: 0.4, spreadPerShot: 1.6, spreadMax: 4.4, moveSpread: 3.4,
  crouchFactor: 0.6, airSpread: 4.2, recoil: 2.4, recoilRandom: 0.6,
  recoilMax: 12, recoilRecover: 12, pellets: 1, armorPen: 0.8, killReward: 300,
});

// --- SMGs ---
def({
  id: 'marauder', name: 'Marauder PDW', cat: 'smg', price: 1200, dmg: 26, rpm: 720,
  auto: true, mag: 30, reserve: 120, reload: 2.6, range: 1400, rangeMax: 3200,
  spread: 1.4, spreadPerShot: 1.4, spreadMax: 6.5, moveSpread: 3.4,
  crouchFactor: 0.7, airSpread: 4.2, recoil: 0.9, recoilRandom: 0.5,
  recoilMax: 8, recoilRecover: 11, pellets: 1, armorPen: 0.6, killReward: 600,
});
def({
  id: 'skitter', name: 'Skitter KR-7', cat: 'smg', price: 2350, dmg: 25, rpm: 800,
  auto: true, mag: 50, reserve: 100, reload: 3.4, range: 1400, rangeMax: 3000,
  spread: 1.5, spreadPerShot: 1.3, spreadMax: 7, moveSpread: 3.0,
  crouchFactor: 0.7, airSpread: 4.0, recoil: 0.75, recoilRandom: 0.4,
  recoilMax: 7, recoilRecover: 12, pellets: 1, armorPen: 0.55, killReward: 600,
});

// --- Shotgun ---
def({
  id: 'breacher', name: 'Breacher M90', cat: 'shotgun', price: 1100, dmg: 11, rpm: 75,
  auto: true, mag: 8, reserve: 32, reload: 3.9, range: 500, rangeMax: 1400,
  spread: 3.2, spreadPerShot: 1.2, spreadMax: 4.6, moveSpread: 4.6,
  crouchFactor: 0.8, airSpread: 6.0, recoil: 1.4, recoilRandom: 0.5,
  recoilMax: 9, recoilRecover: 10, pellets: 9, armorPen: 0.4, killReward: 900,
});

// --- Rifles ---
def({
  id: 'vanguard', name: 'Vanguard AR-3', cat: 'rifle', price: 2700, dmg: 35, rpm: 600,
  auto: true, mag: 30, reserve: 90, reload: 2.6, range: 2600, rangeMax: 7000,
  spread: 0.55, spreadPerShot: 2.6, spreadMax: 8.5, moveSpread: 4.0,
  crouchFactor: 0.62, airSpread: 6.5, recoil: 1.5, recoilRandom: 0.5,
  recoilMax: 13, recoilRecover: 10, pellets: 1, armorPen: 0.77, killReward: 300,
});
def({
  id: 'sentinel', name: 'Sentinel C-8', cat: 'rifle', price: 3100, dmg: 33, rpm: 660,
  auto: true, mag: 30, reserve: 90, reload: 2.6, range: 2600, rangeMax: 6800,
  spread: 0.5, spreadPerShot: 2.3, spreadMax: 8, moveSpread: 3.6,
  crouchFactor: 0.62, airSpread: 6.0, recoil: 1.3, recoilRandom: 0.45,
  recoilMax: 12, recoilRecover: 10.5, pellets: 1, armorPen: 0.77, killReward: 300,
});

// --- Snipers ---
def({
  id: 'sparrow', name: 'Sparrow Light Mark', cat: 'sniper', price: 1700, dmg: 58, rpm: 65,
  auto: true, mag: 10, reserve: 90, reload: 2.7, range: 3200, rangeMax: 12000,
  spread: 0, spreadPerShot: 0, spreadMax: 0, moveSpread: 1.6,
  crouchFactor: 1, airSpread: 2.4, recoil: 3.2, recoilRandom: 0.6,
  recoilMax: 14, recoilRecover: 9, pellets: 1, armorPen: 0.9, killReward: 300,
  scope: true, zoomFov: 0.45,
});
def({
  id: 'leviathan', name: 'Leviathan DMR', cat: 'sniper', price: 4750, dmg: 110, rpm: 40,
  auto: true, mag: 5, reserve: 30, reload: 3.6, range: 3600, rangeMax: 14000,
  spread: 0, spreadPerShot: 0, spreadMax: 0, moveSpread: 3.6,
  crouchFactor: 1, airSpread: 6.0, recoil: 4.5, recoilRandom: 1.0,
  recoilMax: 16, recoilRecover: 8, pellets: 1, armorPen: 1.0, killReward: 100,
  scope: true, zoomFov: 0.3,
});

// --- LMG ---
def({
  id: 'bulwark', name: 'Bulwark X9', cat: 'lmg', price: 5200, dmg: 30, rpm: 660,
  auto: true, mag: 100, reserve: 200, reload: 5.4, range: 2400, rangeMax: 6000,
  spread: 0.9, spreadPerShot: 2.0, spreadMax: 9, moveSpread: 4.8,
  crouchFactor: 0.7, airSpread: 7.0, recoil: 1.4, recoilRandom: 0.5,
  recoilMax: 14, recoilRecover: 8.5, pellets: 1, armorPen: 0.7, killReward: 300,
});

export const WEAPON_ORDER: string[] = [
  'knife', 'vireo', 'warden', 'tlon'.replace('tlon', 'talon'), 'marauder', 'skitter',
  'breacher', 'vanguard', 'sentinel', 'sparrow', 'leviathan', 'bulwark',
];

export const UTILITIES: Record<string, UtilityDef> = {
  flash: { id: 'flash', name: 'Blink Grenade', price: 200, kind: 'flash', maxCarry: 2 },
  frag: { id: 'frag', name: 'Impact Frag', price: 300, kind: 'frag', maxCarry: 1 },
  smoke: { id: 'smoke', name: 'Smoke Choke', price: 280, kind: 'smoke', maxCarry: 1 },
  fire: { id: 'fire', name: 'Inferno Gel', price: 500, kind: 'fire', maxCarry: 1 },
  decoy: { id: 'decoy', name: 'Decoy Ghost', price: 60, kind: 'decoy', maxCarry: 1 },
};

export const ARMOR_VEST = 650;
export const ARMOR_HELMET = 1000; // vest + helmet together

export const UTILITY_LIST = ['flash', 'frag', 'smoke', 'fire', 'decoy'];

export function weaponName(id: string): string {
  return WEAPONS[id]?.name ?? id;
}
export function weaponById(id: string): WeaponDef | undefined {
  return WEAPONS[id];
}
export function slotOf(id: string): number {
  if (id === 'knife') return 0;
  const cat = WEAPONS[id]?.cat;
  if (cat === 'pistol') return 1;
  if (cat === 'melee') return 0;
  return 2; // primary slot
}
export function catOf(id: string): string {
  if (UTILITIES[id]) return 'utility';
  if (id === 'knife') return 'melee';
  return WEAPONS[id]?.cat ?? 'pistol';
}