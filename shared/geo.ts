// Shared movement + collision (runs identically on server, in the browser for
// practice mode, and client-side for prediction). Geometry is a set of AABB
// colliders; the player is modelled as an AABB (radius x radius x height).
import { COLLIDERS } from './mapdef.ts';
import type { Box3 } from './types.ts';
import {
  GRAVITY, JUMP_VEL, MAX_SPEED, WALK_FACTOR, CROUCH_FACTOR, ACCEL, AIR_ACCEL,
  FRICTION, STEP_HEIGHT, PLAYER_RADIUS,
} from './constants.ts';
import { clamp as clampV } from './mathv.ts';

export interface PhysBody {
  x: number; y: number; z: number; // feet position
  vx: number; vy: number; vz: number;
  onGround: boolean;
  duck: boolean;
}

export interface MoveIntent {
  f: number; // forward -1..1 (screen up)
  s: number; // strafe -1..1
  jump: boolean;
  walk: boolean;
}

const RAD = PLAYER_RADIUS;

function collidersAt(x: number, z: number): Box3[] {
  // returns colliders whose (expanded) XZ footprint contains the point
  const out: Box3[] = [];
  for (const c of COLLIDERS) {
    if (x > c.x0 - RAD && x < c.x1 + RAD && z > c.z0 - RAD && z < c.z1 + RAD) out.push(c);
  }
  return out;
}

// Highest surface top that a falling player can land on at (x,z).
function landTop(x: number, z: number): number {
  let best = 0;
  for (const c of COLLIDERS) {
    if (x > c.x0 - RAD && x < c.x1 + RAD && z > c.z0 - RAD && z < c.z1 + RAD) {
      if (c.y1 > best) best = c.y1;
    }
  }
  return best;
}

// Is the point horizontally blocked given the feet height? Low steps are
// climbable while grounded; anything higher than a step must be jumped.
function blocked(x: number, z: number, feetY: number, grounded: boolean): boolean {
  for (const c of COLLIDERS) {
    if (x > c.x0 - RAD && x < c.x1 + RAD && z > c.z0 - RAD && z < c.z1 + RAD) {
      if (feetY >= c.y1 - 0.01) continue; // standing/jumping above
      if (grounded && c.y1 - feetY <= STEP_HEIGHT) continue; // climbable step
      return true;
    }
  }
  return false;
}

// After horizontal motion completes, lift the player onto any step/surface they
// are grounded on top of (feet below its top by at most STEP_HEIGHT).
function stepUp(b: PhysBody): void {
  if (!b.onGround) return;
  let best = -1;
  for (const c of COLLIDERS) {
    if (b.x > c.x0 - RAD && b.x < c.x1 + RAD && b.z > c.z0 - RAD && b.z < c.z1 + RAD) {
      const diff = c.y1 - b.y;
      if (diff > 0.01 && diff <= STEP_HEIGHT && c.y1 > best) best = c.y1;
    }
  }
  if (best >= 0) { b.y = best; b.vy = 0; }
}

function tryHorizontal(b: PhysBody, nx: number, nz: number, dt: number): void {
  const grounded = b.onGround;
  if (!blocked(nx, b.z, b.y, grounded) && !blocked(b.x, nz, b.y, grounded)) {
    b.x = nx; b.z = nz;
    return;
  }
  if (!blocked(nx, b.z, b.y, grounded)) b.x = nx;
  else if (!blocked(nx, b.z, b.y - 0.5, grounded)) b.x = nx;
  if (!blocked(b.x, nz, b.y, grounded)) b.z = nz;
}

function resolveGround(b: PhysBody): void {
  const top = landTop(b.x, b.z);
  if (b.y <= top + 0.001 && b.vy <= 0.01) {
    // we are inside/on a surface while falling or resting -> stand on it
    if (b.y < top - 0.001) b.y = top;
    b.y = Math.max(b.y, top);
    b.vy = 0;
    b.onGround = true;
  } else if (b.onGround) {
    const topUnder = landTop(b.x, b.z);
    if (b.y <= topUnder + 0.01) {
      b.y = topUnder;
    }
  }
}

export function canJump(b: PhysBody): boolean {
  return b.onGround;
}

export interface StepResult { body: PhysBody; jumped: boolean; landed: boolean }

export function stepPhysics(prev: PhysBody, intent: MoveIntent, yaw: number, dt: number): StepResult {
  const b: PhysBody = {
    x: prev.x, y: prev.y, z: prev.z,
    vx: prev.vx, vy: prev.vy, vz: prev.vz,
    onGround: prev.onGround, duck: prev.duck,
  };
  let jumped = false;
  let landed = false;

  // ground snap (on first step after spawn, or when walking off a ledge)
  if (b.onGround) {
    const top = landTop(b.x, b.z);
    if (b.y > top + 0.01) b.onGround = false; // walked off edge
    else b.y = top;
  } else {
    const top = landTop(b.x, b.z);
    if (b.vy <= 0 && b.y <= top + 0.01 && b.y > top - 0.5) {
      b.y = top; b.vy = 0; b.onGround = true; landed = true;
    }
  }

  // wish direction from facing
  const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
  const f = clampV(intent.f, -1, 1);
  const s = clampV(intent.s, -1, 1);
  // forward world vector (yaw=0 faces -Z), right = (+cos, 0, -sin) normalized
  let wx = (-sinY) * f + (cosY) * s;
  let wz = (-cosY) * f + (-sinY) * s;
  const wl = Math.hypot(wx, wz);
  if (wl > 1e-5) { wx /= wl; wz /= wl; }
  const hasWish = f !== 0 || s !== 0;

  let maxSpeed = MAX_SPEED;
  if (b.duck) maxSpeed *= CROUCH_FACTOR;
  else if (intent.walk) maxSpeed *= WALK_FACTOR;

  const grounded = b.onGround;

  // horizontal acceleration
  if (grounded) {
    const accel = ACCEL;
    let tgtX = wx * maxSpeed, tgtZ = wz * maxSpeed;
    if (!hasWish) { tgtX = 0; tgtZ = 0; }
    const ax = clampV(tgtX - b.vx, -accel * dt, accel * dt);
    const az = clampV(tgtZ - b.vz, -accel * dt, accel * dt);
    b.vx += ax; b.vz += az;
    if (!hasWish) {
      // friction: decay toward zero
      const fr = Math.max(0, 1 - FRICTION * dt);
      b.vx *= fr; b.vz *= fr;
      if (Math.abs(b.vx) < 0.5) b.vx = 0;
      if (Math.abs(b.vz) < 0.5) b.vz = 0;
    }
    // speed clamp
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > maxSpeed) { const k = maxSpeed / sp; b.vx *= k; b.vz *= k; }
  } else {
    const accel = AIR_ACCEL;
    const ax = clampV(wx * maxSpeed * 1.05 - b.vx, -accel * dt, accel * dt);
    const az = clampV(wz * maxSpeed * 1.05 - b.vz, -accel * dt, accel * dt);
    b.vx += ax; b.vz += az;
    const sp = Math.hypot(b.vx, b.vz);
    const airCap = maxSpeed * 1.3;
    if (sp > airCap) { const k = airCap / sp; b.vx *= k; b.vz *= k; }
  }

  if (intent.jump && grounded) {
    b.vy = JUMP_VEL;
    b.onGround = false;
    jumped = true;
  }

  // vertical
  if (!b.onGround) b.vy -= GRAVITY * dt;

  // integrate
  const hSpeed = Math.hypot(b.vx, b.vz);
  const dist = hSpeed * dt;
  const steps = Math.max(1, Math.ceil(dist / 24));
  const sdt = dt / steps;
  for (let i = 0; i < steps; i++) {
    const nx = b.x + b.vx * sdt;
    const nz = b.z + b.vz * sdt;
    tryHorizontal(b, nx, nz, sdt);
    if (b.onGround) stepUp(b);
  }

  // vertical integrate with landing
  if (!b.onGround) {
    const ny = b.y + b.vy * dt;
    const top = landTop(b.x, b.z);
    if (b.vy <= 0 && ny <= top + 0.001) {
      b.y = top;
      b.vy = 0;
      b.onGround = true;
      if (landed === false) landed = true;
    } else {
      b.y = ny;
      // head-room ceiling check not needed (no ceilings)
      if (b.y < top + 0.001 && b.vy <= 0) {
        b.y = top; b.vy = 0; b.onGround = true;
        landed = true;
      }
    }
  }

  // world clamp
  const M = 0;
  b.x = clampV(b.x, M + RAD, 34 * 64 - RAD);
  b.z = clampV(b.z, M + RAD, 30 * 64 - RAD);

  return { body: b, jumped, landed };
}
// raycast against colliders (bullets, bot line of sight)
export function rayCollide(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number, maxDist: number,
  ignoreBodiesAbove?: number,
): { hit: boolean; dist: number; x: number; y: number; z: number } {
  const len = Math.hypot(dx, dy, dz) || 1e-9;
  const ux = dx / len, uy = dy / len, uz = dz / len;
  let t = 0;
  const step = 6;
  let lastX = ox, lastY = oy, lastZ = oz;
  while (t < maxDist) {
    t = Math.min(t + step, maxDist);
    const px = ox + ux * t, py = oy + uy * t, pz = oz + uz * t;
    for (const c of COLLIDERS) {
      if (px > c.x0 && px < c.x1 && py > c.y0 && py < c.y1 && pz > c.z0 && pz < c.z1) {
        // hit
        return { hit: true, dist: t, x: px, y: py, z: pz };
      }
    }
    lastX = px; lastY = py; lastZ = pz;
  }
  return { hit: false, dist: maxDist, x: lastX, y: lastY, z: lastZ };
}
