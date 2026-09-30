// REACTOR-09 - original competitive map ("AXIOM SIEGE").
// Dust II-inspired desert town: T spawn north, CT south, A east (long),
// B west (courtyard), mid through the center. Not a mirror.
//
// Floor rectangles on a 48 x 42 cell grid (each cell 64 units). Cells without
// floor are solid buildings. Orientation: row 0..ROWS is +Z south.
// worldX = (col+0.5)*CELL, worldZ = (row+0.5)*CELL.

import type { Box3 } from './types.ts';
import type { Vec3 } from './mathv.ts';
import { TEAM_ATTACK, TEAM_DEFEND } from './constants.ts';

export const CELL = 64;
export const COLS = 48;
export const ROWS = 42;
export const WALL_H = 168;
export const GROUND_H = 0;

export interface Rect { c0: number; c1: number; r0: number; r1: number }
export interface ObjectDef {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  mat: number;
  name?: string;
}
export interface PlantZone { site: number; x: number; z: number; r: number }

const LAST = COLS - 1;

const ATK_ZONE: Rect = { c0: 17, c1: 30, r0: 2, r1: 5 };
const DEF_ZONE: Rect = { c0: 16, c1: 31, r0: 34, r1: 38 };

const ALL_RECTS: Rect[] = [
  ATK_ZONE,
  { c0: 16, c1: 31, r0: 6, r1: 7 },
  { c0: 11, c1: 36, r0: 8, r1: 12 },
  { c0: 20, c1: 27, r0: 13, r1: 17 },
  { c0: 18, c1: 29, r0: 18, r1: 24 },
  { c0: 20, c1: 27, r0: 25, r1: 33 },
  DEF_ZONE,
  { c0: 6, c1: 41, r0: 36, r1: 38 },

  { c0: 37, c1: 45, r0: 8, r1: 17 },
  { c0: 34, c1: 45, r0: 18, r1: 27 },
  { c0: 30, c1: 33, r0: 19, r1: 23 },
  { c0: 36, c1: 43, r0: 28, r1: 35 },

  { c0: 3, c1: 10, r0: 8, r1: 17 },
  { c0: 3, c1: 14, r0: 18, r1: 27 },
  { c0: 15, c1: 17, r0: 19, r1: 23 },
  { c0: 5, c1: 12, r0: 28, r1: 35 },
];

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

export const CRATES: { c: number; r: number; h: number; mat: number }[] = [
  { c: 5, r: 20, h: 48, mat: 0 },
  { c: 8, r: 24, h: 64, mat: 0 },
  { c: 11, r: 20, h: 48, mat: 0 },
  { c: 10, r: 26, h: 40, mat: 3 },
  { c: 4, r: 25, h: 56, mat: 2 },
  { c: 40, r: 20, h: 48, mat: 0 },
  { c: 43, r: 23, h: 48, mat: 0 },
  { c: 38, r: 25, h: 40, mat: 3 },
  { c: 42, r: 26, h: 56, mat: 2 },
  { c: 20, r: 21, h: 48, mat: 0 },
  { c: 27, r: 21, h: 48, mat: 0 },
  { c: 23, r: 29, h: 40, mat: 3 },
  { c: 12, r: 10, h: 48, mat: 0 },
  { c: 35, r: 10, h: 48, mat: 0 },
  { c: 4, r: 12, h: 56, mat: 2 },
  { c: 44, r: 12, h: 56, mat: 2 },
  { c: 17, r: 36, h: 40, mat: 3 },
  { c: 30, r: 36, h: 40, mat: 3 },
];

export const COLLIDERS: Box3[] = [];
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++)
    if (floorCells[idx(c, r)] === 0)
      COLLIDERS.push({ x0: c * CELL, y0: 0, z0: r * CELL, x1: (c + 1) * CELL, y1: WALL_H, z1: (r + 1) * CELL });

export const CRATE_BOXES: Box3[] = [];
for (const o of CRATES) {
  const b: Box3 = {
    x0: o.c * CELL + 2, y0: 0, z0: o.r * CELL + 2,
    x1: (o.c + 1) * CELL - 2, y1: o.h, z1: (o.r + 1) * CELL - 2,
  };
  CRATE_BOXES.push(b);
  COLLIDERS.push(b);
}

export const navBlocked = new Uint8Array(COLS * ROWS);
for (const o of CRATES) navBlocked[idx(o.c, o.r)] = 1;

export function navPassable(c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
  return floorCells[idx(c, r)] === 1 && navBlocked[idx(c, r)] === 0;
}

export const SPAWNS: Record<number, { x: number; y: number; z: number; yaw: number }[]> = {
  [TEAM_ATTACK]: [],
  [TEAM_DEFEND]: [],
};
const spawnOffsets = [
  [0, 0], [-1, 0], [1, 0], [0, 1], [0, -1], [-2, 0], [2, 0], [-1, 1], [1, 1],
];
for (let i = 0; i < 5; i++) {
  const [dx, dz] = spawnOffsets[i];
  const c = (ATK_ZONE.c0 + ATK_ZONE.c1) / 2 + dx;
  const r = (ATK_ZONE.r0 + ATK_ZONE.r1) / 2 + dz;
  SPAWNS[TEAM_ATTACK].push({ x: cellWorldX(c), y: 0, z: cellWorldZ(r), yaw: Math.PI });
}
for (let i = 0; i < 5; i++) {
  const [dx, dz] = spawnOffsets[i];
  const c = (DEF_ZONE.c0 + DEF_ZONE.c1) / 2 + dx;
  const r = (DEF_ZONE.r0 + DEF_ZONE.r1) / 2 + dz;
  SPAWNS[TEAM_DEFEND].push({ x: cellWorldX(c), y: 0, z: cellWorldZ(r), yaw: 0 });
}

export const PLANT_ZONES: PlantZone[] = [
  { site: 1, x: cellWorldX(39.5), z: cellWorldZ(22.5), r: 190 },
  { site: 2, x: cellWorldX(LAST - 39.5), z: cellWorldZ(22.5), r: 190 },
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
  return dx * dx + dz * dz < (CELL * 6) * (CELL * 6);
}

export interface Anchor {
  x: number; y: number; z: number;
  kind: 'spawnA' | 'spawnB' | 'siteA' | 'siteB' | 'mid' | 'along' | 'blong' | 'aent' | 'bent' | 'cta' | 'ctb' | 'plaza';
}
export const ANCHORS: Anchor[] = [
  { x: cellWorldX(23.5), y: 0, z: cellWorldZ(3.5), kind: 'spawnA' },
  { x: cellWorldX(23.5), y: 0, z: cellWorldZ(36), kind: 'spawnB' },
  { x: cellWorldX(39.5), y: 0, z: cellWorldZ(22.5), kind: 'siteA' },
  { x: cellWorldX(LAST - 39.5), y: 0, z: cellWorldZ(22.5), kind: 'siteB' },
  { x: cellWorldX(23.5), y: 0, z: cellWorldZ(21), kind: 'mid' },
  { x: cellWorldX(42), y: 0, z: cellWorldZ(14), kind: 'along' },
  { x: cellWorldX(LAST - 42), y: 0, z: cellWorldZ(14), kind: 'blong' },
  { x: cellWorldX(41), y: 0, z: cellWorldZ(10), kind: 'aent' },
  { x: cellWorldX(LAST - 41), y: 0, z: cellWorldZ(10), kind: 'bent' },
  { x: cellWorldX(39.5), y: 0, z: cellWorldZ(31), kind: 'cta' },
  { x: cellWorldX(LAST - 39.5), y: 0, z: cellWorldZ(31), kind: 'ctb' },
  { x: cellWorldX(23.5), y: 0, z: cellWorldZ(9), kind: 'plaza' },
];
export function anchor(name: string): Vec3 {
  const a = ANCHORS.find((x) => x.kind === name);
  return { x: a ? a.x : 0, y: 0, z: a ? a.z : 0 };
}
export function anchorsOf(...names: string[]): Vec3[] {
  return ANCHORS.filter((a) => names.includes(a.kind)).map((a) => ({ x: a.x, y: 0, z: a.z }));
}

export const MAP_BOUNDS = { x0: 0, z0: 0, x1: COLS * CELL, z1: ROWS * CELL };
export const REGION_RECTS = ALL_RECTS;
export const MAP_NAME = 'REACTOR-09';
