// ---------------------------------------------------------------------------
// AABB physics: capsule-ish body vs axis-aligned boxes + an explicit ground
// plane. Pure (no three.js / DOM), allocation-free, headless-testable.
//
// Key rules:
//  - Horizontal (X/Z) resolution only fires when the body overlaps the box's
//    vertical *interior*. Standing on top of a box lets you walk freely and
//    never snaps you against a giant floor box.
//  - Vertical resolution lands you on box tops and bonks you on box bottoms.
//  - An absolute ground plane at GROUND_Y guarantees a solid landing no
//    matter what the box solver does — nobody ever falls into the void.
// ---------------------------------------------------------------------------

import { TUNE } from "./config";
import type { BoxDef } from "./maps";

export interface PhysBody {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  crouch: boolean;
  onGround: boolean;
}

const EPS = 0.001;
const GROUND_Y = 0;

export function moveBody(e: PhysBody, colliders: BoxDef[], dt: number): void {
  const r = TUNE.radius;
  const h = e.crouch ? TUNE.crouchHeight : TUNE.standHeight;
  e.onGround = false;

  e.pos.x += e.vel.x * dt;
  resolveHorizontal(e, colliders, e.vel.x * dt, r, h, "x");
  e.pos.z += e.vel.z * dt;
  resolveHorizontal(e, colliders, e.vel.z * dt, r, h, "z");

  e.pos.y += e.vel.y * dt;
  resolveY(e, colliders, e.vel.y * dt, r, h);

  // Absolute ground plane — every arena's floor top sits at GROUND_Y.
  if (e.pos.y <= GROUND_Y && e.vel.y <= 0) {
    e.pos.y = GROUND_Y;
    e.vel.y = 0;
    e.onGround = true;
  }

  // Never-sink failsafe: if something truly bizarre happens, reset to ground.
  if (e.pos.y < -8) {
    e.pos.y = GROUND_Y;
    e.vel.x = 0;
    e.vel.y = 0;
    e.vel.z = 0;
    e.onGround = true;
  }
}

function resolveHorizontal(
  e: PhysBody,
  colliders: BoxDef[],
  delta: number,
  r: number,
  h: number,
  axis: "x" | "z",
): void {
  if (delta === 0) return;
  const feet = e.pos.y;
  const head = feet + h;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    const bMinY = b.y - b.h / 2;
    const bMaxY = b.y + b.h / 2;
    // Only collide horizontally when the body overlaps the box's vertical
    // interior. Touching from on top must NOT trigger a horizontal clamp.
    if (head <= bMinY + EPS || feet >= bMaxY - EPS) continue;

    if (axis === "x") {
      const bMin = b.x - b.w / 2;
      const bMax = b.x + b.w / 2;
      // Strict "beyond" tests (no epsilon): any penetration resolves, so the
      // body can never sit in a window the vertical solver would snap from.
      if (e.pos.x + r < bMin || e.pos.x - r > bMax) continue;
      if (e.pos.z + r < b.z - b.d / 2 || e.pos.z - r > b.z + b.d / 2) continue;
      // Push out of the nearest face, regardless of movement direction.
      e.pos.x =
        e.pos.x - bMin < bMax - e.pos.x ? bMin - r - EPS : bMax + r + EPS;
      e.vel.x = 0;
    } else {
      const bMin = b.z - b.d / 2;
      const bMax = b.z + b.d / 2;
      if (e.pos.z + r < bMin || e.pos.z - r > bMax) continue;
      if (e.pos.x + r < b.x - b.w / 2 || e.pos.x - r > b.x + b.w / 2) continue;
      e.pos.z =
        e.pos.z - bMin < bMax - e.pos.z ? bMin - r - EPS : bMax + r + EPS;
      e.vel.z = 0;
    }
  }
}

function resolveY(
  e: PhysBody,
  colliders: BoxDef[],
  delta: number,
  r: number,
  h: number,
): void {
  const feet = e.pos.y;
  const head = feet + h;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (e.pos.x + r <= b.x - b.w / 2 || e.pos.x - r >= b.x + b.w / 2) continue;
    if (e.pos.z + r <= b.z - b.d / 2 || e.pos.z - r >= b.z + b.d / 2) continue;
    const bMinY = b.y - b.h / 2;
    const bMaxY = b.y + b.h / 2;
    if (delta <= 0) {
      // Landing: feet penetrated the top while the head is still above the bottom.
      if (feet <= bMaxY + EPS && head > bMinY) {
        e.pos.y = bMaxY;
        e.vel.y = 0;
        e.onGround = true;
      }
    } else {
      // Bonk: head crossed the bottom while the body is still below the box.
      if (head >= bMinY - EPS && feet < bMinY) {
        e.pos.y = bMinY - h - EPS;
        e.vel.y = 0;
      }
    }
  }
}
