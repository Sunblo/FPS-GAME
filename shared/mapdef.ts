// REACTOR-09 - original competitive map definition ("AXIOM SIEGE").
// A symmetric two-site tactical layout: Attackers spawn north, Defenders south.
//
// The layout is authored as floor rectangles over a cell grid (34 x 30 cells,
// each cell 64 units). Every cell not covered by a floor rectangle is solid
// wall. East regions are auto-mirrored west so the map is balanced.
//
// Orientation convention: row 0..ROWS is the Z axis (world +Z = south).
// worldX = (col+0.5)*CELL, worldZ = (row+0.5)*CELL.

import type { Box3 } from './types.ts';
import type { Vec3 } from './mathv.ts';
import { TEAM_ATTACK, TEAM_DEFEND } from './constants.ts';

export const CELL = 64;
export const COLS = 34;
export const ROWS = 30;
export const WALL_H = 300;
export const GROUND_H = 0;

export interface Rect { c0: number; c1: number; r0: number; r1: number }
export interface ObjectDef {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  mat: number; // 0 crate, 1 metalbox, 2 barrel, 3 sandbag(no), 4 container
  name?: string;
}
export interface PlantZone { site: number; x: number; z: number; r: number }

// ---- author floor rectangles -------------------------------------------------
const CENTER: Rect[] = [
  // Attackers spawn (north, row 2..3)
  { c0: 13, c1: 20, r0: 2, r1: 3 },
  // spawn door
  { c0: 15, c1: 18, r0: 4, r1: 4 },
  // North plaza
  { c0: 9, c1: 24, r0: 5, r1: 7 },
  // central T lane to mid
  { c0: 15, c1: 18, r0: 8, r1: 13 },
  // mid room
  { c0: 13, c1: 20, r0: 14, r1: 17 },
  // mid -> A / B doors
  { c0: 21, c1: 24, r0: 16, r1: 17 },
  { c0: 9, c1: 12, r0: 16, r1: 17 },
  // CT lane (center)
  { c0: 15, c1: 18, r0: 18, r1: 23 },
  // Defenders spawn
  { c0: 13, c1: 20, r0: 24, r1: 26 },
  // defenders back "arms"
  { c0: 6, c1: 27, r0: 25, r1: 26 },
];

// East-side regions; mirrored to build the West side.
const EAST: Rect[] = [
  // plaza -> A long throat
  { c0: 25, c1: 29, r0: 7, r1: 7 },
  // A long (outer east lane)
  { c0: 27, c1: 29, r0: 8, r1: 13 },
  // Site A
  { c0: 25, c1: 30, r0: 14, r1: 20 },
  // A-CT (defender short)
  { c0: 25, c1: 27, r0: 21, r1: 24 },
];

const ALL_RECTS: Rect[] = [...CENTER, ...EAST];
for (const r of EAST) {
  ALL_RECTS.push(mirrorRect(r));
}
function mirrorRect(r: Rect): Rect {
  return { c0: 33 - r.c1, c1: 33 - r.c0, r0: r.r0, r1: r.r1 };
}

// ---- cell floors ---------------------------------------------------------------
export const floorCells = new Uint8Array(COLS * ROWS);
function idx(c: number, r: number): number { return r * COLS + c; }
for (const rc of ALL_RECTS) {
  for (let r = rc.r0; r <= rc.r1; r++)
    for (let c = rc.c0; c <= rc.c1; c++) floorCells[idx(c, r)] = 1;
}

export function isFloorCell(c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
  return floorCells[idx(c, r)] === 1;
}
export function cellWorldX(c: number): number { return (c + 0.5) * CELL; }
export function cellWorldZ(r: number): number { return (r + 0.5) * CELL; }
export function worldToCell(x: number, z: number): [number, number] {
  return [Math.floor(x / CELL), Math.floor(z / CELL)];
}
export function pointInBounds(x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < COLS * CELL && z < ROWS * CELL;
}
export function cellSolid(c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return true;
  return floorCells[idx(c, r)] === 0;
}

// ---- crates / gameplay objects (collide, block bots, break sight) --------------
// placed on cells; each is a 64x64 box unless a height given.
export const CRATES: { c: number; r: number; h: number; mat: number }[] = [
  // Site A cover
  { c: 26, r: 15, h: 48, mat: 0 },
  { c: 29, r: 15, h: 48, mat: 0 },
  { c: 25, r: 18, h: 64, mat: 1 },
  { c: 28, r: 19, h: 48, mat: 0 },
  { c: 30, r: 16, h: 56, mat: 2 },
  // Site A back corner cover
  { c: 26, r: 20, h: 40, mat: 3 },
  // Site B cover
  { c: 5, r: 15, h: 48, mat: 0 },
  { c: 8, r: 15, h: 48, mat: 0 },
  { c: 3, r: 18, h: 64, mat: 1 },
  { c: 6, r: 19, h: 48, mat: 0 },
  { c: 4, r: 16, h: 56, mat: 2 },
  // Mid room cover
  { c: 14, r: 15, h: 48, mat: 0 },
  { c: 19, r: 15, h: 48, mat: 0 },
  { c: 15, r: 17, h: 48, mat: 0 },
  { c: 18, r: 17, h: 48, mat: 0 },
  // North plaza cover
  { c: 10, r: 6, h: 48, mat: 0 },
  { c: 23, r: 6, h: 48, mat: 0 },
  { c: 12, r: 7, h: 64, mat: 1 },
  { c: 20, r: 7, h: 40, mat: 3 },
  // T lane cover
  { c: 16, r: 9, h: 48, mat: 0 },
  { c: 17, r: 12, h: 48, mat: 0 },
  // A long cover
  { c: 28, r: 10, h: 48, mat: 0 },
  // B long cover
  { c: 5, r: 10, h: 48, mat: 0 },
  // CT lane cover
  { c: 16, r: 20, h: 48, mat: 0 },
  { c: 17, r: 22, h: 48, mat: 0 },
  // defender spawn crates
  { c: 14, r: 25, h: 40, mat: 3 },
  { c: 19, r: 25, h: 40, mat: 3 },
];

export const COLLIDERS: Box3[] = [];
// solid wall cells (whole map outline + internal walls)
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++)
    if (floorCells[idx(c, r)] === 0)
      COLLIDERS.push({ x0: c * CELL, y0: 0, z0: r * CELL, x1: (c + 1) * CELL, y1: WALL_H, z1: (r + 1) * CELL });
// crates become colliders
export const CRATE_BOXES: Box3[] = [];
for (const o of CRATES) {
  const b: Box3 = {
    x0: o.c * CELL + 2, y0: 0, z0: o.r * CELL + 2,
    x1: (o.c + 1) * CELL - 2, y1: o.h, z1: (o.r + 1) * CELL - 2,
  };
  CRATE_BOXES.push(b);
  COLLIDERS.push(b);
}

// cells occupied by crates block the bot navgrid
export const navBlocked = new Uint8Array(COLS * ROWS);
for (const o of CRATES) navBlocked[idx(o.c, o.r)] = 1;

export function navPassable(c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
  return floorCells[idx(c, r)] === 1 && navBlocked[idx(c, r)] === 0;
}

// ---- spawns & zones ------------------------------------------------------------
function zoneCenter(rect: Rect): [number, number] {
  return [cellWorldX((rect.c0 + rect.c1) / 2), cellWorldZ((rect.r0 + rect.r1) / 2)];
}

// attacker spawn (north room) and defender spawn (south room)
const ATK_ZONE = CENTER[0]; // TSPAWN
const DEF_ZONE = CENTER[8]; // CTSPAWN

export const SPAWNS: Record<number, { x: number; y: number; z: number; yaw: number }[]> = {
  [TEAM_ATTACK]: [],
  [TEAM_DEFEND]: [],
};
// Build up to 5 distinct spawn points per side
const spawnOffsets = [
  [0, 0], [-1, 0], [1, 0], [0, 1], [0, -1], [-1, 1], [1, 1], [-1, -1], [1, -1],
];
let spAtk = 0;
for (let i = 0; i < 5 && spAtk < 9; i++, spAtk++) {
  const [dx, dz] = spawnOffsets[spAtk];
  const c = (ATK_ZONE.c0 + ATK_ZONE.c1) / 2 + dx;
  const r = (ATK_ZONE.r0 + ATK_ZONE.r1) / 2 + dz;
  SPAWNS[TEAM_ATTACK].push({ x: cellWorldX(c), y: 0, z: cellWorldZ(r), yaw: Math.PI }); // face south
}
let spDef = 0;
for (let i = 0; i < 5 && spDef < 9; i++, spDef++) {
  const [dx, dz] = spawnOffsets[spDef];
  const c = (DEF_ZONE.c0 + DEF_ZONE.c1) / 2 + dx;
  const r = (DEF_ZONE.r0 + DEF_ZONE.r1) / 2 + dz;
  SPAWNS[TEAM_DEFEND].push({ x: cellWorldX(c), y: 0, z: cellWorldZ(r), yaw: 0 }); // face north
}

export const PLANT_ZONES: PlantZone[] = [
  { site: 1, x: cellWorldX(27.5), z: cellWorldZ(17), r: 150 }, // A
  { site: 2, x: cellWorldX(5.5), z: cellWorldZ(17), r: 150 }, // B
];

export function plantZoneAt(x: number, z: number): number {
  for (const p of PLANT_ZONES) {
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz <= p.r * p.r) return p.site;
  }
  return 0;
}
export function buyZone(team: number, x: number, z: number): boolean {
  const rect = team === TEAM_ATTACK ? ATK_ZONE : DEF_ZONE;
  const cx = cellWorldX((rect.c0 + rect.c1) / 2);
  const cz = cellWorldZ((rect.r0 + rect.r1) / 2);
  const dx = x - cx, dz = z - cz;
  return dx * dx + dz * dz < (CELL * 4) * (CELL * 4);
}

// anchor points used by bots / gameplay
export interface Anchor {
  x: number; y: number; z: number;
  kind: 'spawnA' | 'spawnB' | 'siteA' | 'siteB' | 'mid' | 'along' | 'blong' | 'aent' | 'bent' | 'cta' | 'ctb' | 'plaza';
}
export const ANCHORS: Anchor[] = [
  { x: cellWorldX(16.5), y: 0, z: cellWorldZ(2.5), kind: 'spawnA' },
  { x: cellWorldX(16.5), y: 0, z: cellWorldZ(25.5), kind: 'spawnB' },
  { x: cellWorldX(27.5), y: 0, z: cellWorldZ(17), kind: 'siteA' },
  { x: cellWorldX(5.5), y: 0, z: cellWorldZ(17), kind: 'siteB' },
  { x: cellWorldX(16.5), y: 0, z: cellWorldZ(15.5), kind: 'mid' },
  { x: cellWorldX(28), y: 0, z: cellWorldZ(10), kind: 'along' },
  { x: cellWorldX(5), y: 0, z: cellWorldZ(10), kind: 'blong' },
  { x: cellWorldX(25.5), y: 0, z: cellWorldZ(7.5), kind: 'aent' },
  { x: cellWorldX(8.5), y: 0, z: cellWorldZ(7.5), kind: 'bent' },
  { x: cellWorldX(26), y: 0, z: cellWorldZ(22), kind: 'cta' },
  { x: cellWorldX(7), y: 0, z: cellWorldZ(22), kind: 'ctb' },
  { x: cellWorldX(16.5), y: 0, z: cellWorldZ(6), kind: 'plaza' },
];
export function anchor(name: string): Vec3 {
  const a = ANCHORS.find((x) => x.kind === name);
  return { x: a ? a.x : 0, y: 0, z: a ? a.z : 0 };
}
export function anchorsOf(...names: string[]): Vec3[] {
  return ANCHORS.filter((a) => names.includes(a.kind)).map((a) => ({ x: a.x, y: 0, z: a.z }));
}

// world bounds used for culling & spawn sanity
export const MAP_BOUNDS = { x0: 0, z0: 0, x1: COLS * CELL, z1: ROWS * CELL };

// exported region rectangles for client minimap + bot nav seeds
export const REGION_RECTS = ALL_RECTS;
export const MAP_NAME = 'REACTOR-09';
