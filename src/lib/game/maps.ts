// ---------------------------------------------------------------------------
// Procedural arena generation. Every lobby seed produces a unique layout:
// perimeter walls, crate cover, towers with jump pads, a central platform,
// spawn points and weapon pads. Pure data — rendering lives in the engine.
// ---------------------------------------------------------------------------

import { MapId, mulberry32, pick, randRange, shuffle, TUNE } from "./config";

export interface BoxDef {
  x: number; y: number; z: number; // center
  w: number; h: number; d: number;
  color: number;
  glow?: number; // emissive color
  glowI?: number;
  collide: boolean;
}

export interface SpawnDef { x: number; y: number; z: number; yaw: number }
export interface PadDef { x: number; y: number; z: number }
export interface WeaponPadDef { x: number; y: number; z: number }

export interface MapTheme {
  sky: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  ground: number;
  wall: number;
  crateA: number;
  crateB: number;
  accent: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  ambient: number;
}

export interface MapData {
  seed: number;
  theme: MapId;
  size: number; // half extent of playable area
  boxes: BoxDef[];
  spawns: SpawnDef[];
  pads: PadDef[]; // jump pads
  weaponPads: WeaponPadDef[];
  themeData: MapTheme;
}

export const THEMES: Record<MapId, MapTheme> = {
  yard: {
    sky: 0x8fc7e8, fog: 0xc3dfee, fogNear: 40, fogFar: 130,
    ground: 0xd8b27f, wall: 0xc9b693, crateA: 0xb5651d, crateB: 0x8a94a0,
    accent: 0x00b3ff,
    hemiSky: 0xffffff, hemiGround: 0xb8a888, hemiIntensity: 0.95,
    sunColor: 0xfff2d9, sunIntensity: 1.5, ambient: 0.55,
  },
  neon: {
    sky: 0x05060f, fog: 0x070716, fogNear: 26, fogFar: 95,
    ground: 0x12142a, wall: 0x23264d, crateA: 0x2b2f63, crateB: 0x1c1e42,
    accent: 0x00ffd5,
    hemiSky: 0x4455ff, hemiGround: 0x33104a, hemiIntensity: 0.85,
    sunColor: 0x8899ff, sunIntensity: 0.6, ambient: 0.6,
  },
  dusk: {
    sky: 0x2b1b4e, fog: 0x4a2a6a, fogNear: 34, fogFar: 110,
    ground: 0x3a2a55, wall: 0x5a3a7a, crateA: 0x8a4a6a, crateB: 0x4a6a8a,
    accent: 0xffc368,
    hemiSky: 0xff9966, hemiGround: 0x332244, hemiIntensity: 0.9,
    sunColor: 0xffb080, sunIntensity: 1.1, ambient: 0.55,
  },
};

const CRATE_SIZES = [1.0, 1.2, 1.5, 1.8, 2.2, 2.5];

function nearSpawn(x: number, z: number, spawns: SpawnDef[], r: number): boolean {
  for (const s of spawns) {
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

function nearBox(x: number, z: number, y: number, boxes: BoxDef[], r: number): boolean {
  for (const b of boxes) {
    // ignore ground-scale / tall structure boxes — only test against
    // crate/cover sized props so the floor and walls never reject placement
    if (b.w > 8 || b.d > 8 || b.h > 3) continue;
    if (y > b.y + b.h / 2 + 1 || y < b.y - b.h / 2 - 1) continue;
    const dx = Math.max(Math.abs(x - b.x) - b.w / 2, 0);
    const dz = Math.max(Math.abs(z - b.z) - b.d / 2, 0);
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

export function generateMap(theme: MapId, seed: number): MapData {
  const rng = mulberry32(seed);
  const t = THEMES[theme];
  const half = 30;
  const boxes: BoxDef[] = [];
  const pads: PadDef[] = [];
  const weaponPads: WeaponPadDef[] = [];

  // --- floor (thick so no fall-through is even possible) ------------------
  boxes.push({ x: 0, y: -2, z: 0, w: half * 2 + 6, h: 4, d: half * 2 + 6, color: t.ground, collide: true });
  // --- perimeter walls (taller than any jump-pad apex so nobody can
  //     launch over them) ---------------------------------------------------
  const wallH = 8, wallT = 1;
  boxes.push({ x: 0, y: wallH / 2, z: -half - wallT / 2, w: half * 2 + wallT * 2, h: wallH, d: wallT, color: t.wall, collide: true });
  boxes.push({ x: 0, y: wallH / 2, z: half + wallT / 2, w: half * 2 + wallT * 2, h: wallH, d: wallT, color: t.wall, collide: true });
  boxes.push({ x: -half - wallT / 2, y: wallH / 2, z: 0, w: wallT, h: wallH, d: half * 2, color: t.wall, collide: true });
  boxes.push({ x: half + wallT / 2, y: wallH / 2, z: 0, w: wallT, h: wallH, d: half * 2, color: t.wall, collide: true });
  // glowing trim on top of walls (non colliding)
  for (const [x, z, w, d] of [
    [0, -half - wallT / 2, half * 2 + wallT * 2, 0.3],
    [0, half + wallT / 2, half * 2 + wallT * 2, 0.3],
    [-half - wallT / 2, 0, 0.3, half * 2],
    [half + wallT / 2, 0, 0.3, half * 2],
  ] as const) {
    boxes.push({ x, y: wallH + 0.15, z, w, h: 0.3, d, color: t.accent, glow: t.accent, glowI: 1.4, collide: false });
  }

  // --- spawns (corners + edge midpoints) ----------------------------------
  const spawns: SpawnDef[] = shuffle(rng, [
    { x: -24, y: 0, z: -24, yaw: Math.PI / 4 },
    { x: 24, y: 0, z: -24, yaw: (Math.PI * 3) / 4 },
    { x: -24, y: 0, z: 24, yaw: -Math.PI / 4 },
    { x: 24, y: 0, z: 24, yaw: (-Math.PI * 3) / 4 },
    { x: -24, y: 0, z: 0, yaw: 0 },
    { x: 24, y: 0, z: 0, yaw: Math.PI },
    { x: 0, y: 0, z: -24, yaw: Math.PI / 2 },
    { x: 0, y: 0, z: 24, yaw: -Math.PI / 2 },
  ]);

  // --- corner towers with jump pads --------------------------------------
  const towerSpots: Array<[number, number]> = [
    [-17, -17], [17, -17], [-17, 17], [17, 17],
  ];
  for (const [tx, tz] of towerSpots) {
    const glowStrip = theme === "neon" && rng() > 0.4;
    boxes.push({ x: tx, y: 2.0, z: tz, w: 3.4, h: 4, d: 3.4, color: t.crateB, collide: true });
    if (glowStrip) {
      boxes.push({ x: tx, y: 3.6, z: tz - 1.75, w: 3.0, h: 0.28, d: 0.12, color: t.accent, glow: t.accent, glowI: 2.0, collide: false });
    }
  }

  // --- central platform (jump pad added later) ------------------------------
  boxes.push({ x: 0, y: 4.6, z: 0, w: 5, h: 0.8, d: 5, color: t.crateB, collide: true });
  if (theme === "neon") {
    boxes.push({ x: 0, y: 4.3, z: -2.55, w: 4.6, h: 0.24, d: 0.12, color: 0xff2bd6, glow: 0xff2bd6, glowI: 2.2, collide: false });
    boxes.push({ x: 0, y: 4.3, z: 2.55, w: 4.6, h: 0.24, d: 0.12, color: 0x00ffd5, glow: 0x00ffd5, glowI: 2.2, collide: false });
  }

  // --- crate clusters -------------------------------------------------------
  const clusterCount = 12 + Math.floor(rng() * 4);
  for (let i = 0; i < clusterCount; i++) {
    const cx = randRange(rng, -26, 26);
    const cz = randRange(rng, -26, 26);
    if (nearSpawn(cx, cz, spawns, 4)) continue;
    if (nearBox(cx, cz, 0, boxes, 2.5)) continue;
    const size = pick(rng, CRATE_SIZES);
    const stack = rng() > 0.55 ? Math.min(1.2 + rng() * 1.0, 3.2) : size;
    boxes.push({
      x: cx, y: size / 2, z: cz, w: size, h: size, d: size,
      color: rng() > 0.5 ? t.crateA : t.crateB, collide: true,
    });
    if (stack > size + 0.01) {
      boxes.push({
        x: cx + (rng() - 0.5) * 0.4, y: size + (stack - size) / 2 - 0.05, z: cz + (rng() - 0.5) * 0.4,
        w: stack - size + 0.3, h: stack - size + 0.2, d: stack - size + 0.3,
        color: t.crateB, collide: true,
      });
    }
    // sometimes a second crate next to the first
    if (rng() > 0.5) {
      const s2 = pick(rng, CRATE_SIZES.slice(0, 4));
      const ox = (rng() - 0.5) * 5, oz = (rng() - 0.5) * 5;
      if (!nearSpawn(cx + ox, cz + oz, spawns, 3.5)) {
        boxes.push({ x: cx + ox, y: s2 / 2, z: cz + oz, w: s2, h: s2, d: s2, color: t.crateA, collide: true });
      }
    }
  }

  // --- low cover walls ------------------------------------------------------
  for (let i = 0; i < 5; i++) {
    const cx = randRange(rng, -24, 24);
    const cz = randRange(rng, -24, 24);
    if (nearSpawn(cx, cz, spawns, 4)) continue;
    if (nearBox(cx, cz, 0, boxes, 2)) continue;
    const long = randRange(rng, 2.5, 5);
    const rot = rng() > 0.5;
    boxes.push({
      x: cx, y: 0.6, z: cz,
      w: rot ? 0.7 : long, h: 1.2, d: rot ? long : 0.7,
      color: t.crateB, collide: true,
    });
    if (theme === "neon") {
      boxes.push({
        x: cx, y: 1.25, z: cz,
        w: rot ? 0.74 : long, h: 0.12, d: rot ? long : 0.74,
        color: t.accent, glow: t.accent, glowI: 1.6, collide: false,
      });
    }
  }

  // --- jump pads: placed LAST so every pad is guaranteed clear of walls,
  //     crates, spawns and other pads (no more launches from inside a box) ---
  const tryPad = (x: number, z: number): boolean => {
    if (nearSpawn(x, z, spawns, 3)) return false;
    if (nearBox(x, z, 0, boxes, 1.7)) return false;
    for (const [tx, tz] of towerSpots) {
      const dx = x - tx, dz = z - tz;
      if (dx * dx + dz * dz < 4.5 * 4.5) return false; // keep clear of tower bases
    }
    for (const p of pads) {
      const dx = x - p.x, dz = z - p.z;
      if (dx * dx + dz * dz < 9) return false;
    }
    pads.push({ x, y: 0, z });
    return true;
  };
  // pads that launch onto the corner towers
  for (const [tx, tz] of towerSpots) {
    const px = tx + (tx > 0 ? -4.5 : 4.5);
    const pz = tz + (tz > 0 ? -4.5 : 4.5);
    let placed = tryPad(px, pz);
    for (let a = 0; !placed && a < 14; a++) {
      placed = tryPad(px + (rng() - 0.5) * 3.2, pz + (rng() - 0.5) * 3.2);
    }
  }
  // central pad onto the high platform
  {
    let placed = tryPad(0, 6.5);
    for (let a = 0; !placed && a < 14; a++) {
      placed = tryPad((rng() - 0.5) * 3, 6.5 + (rng() - 0.5) * 3);
    }
  }
  // a few extra pads in open ground
  for (let i = 0; i < 3; i++) {
    for (let a = 0; a < 10; a++) {
      if (tryPad(randRange(rng, -22, 22), randRange(rng, -22, 22))) break;
    }
  }

  // --- weapon pads -----------------------------------------------------------
  const wpSpots: Array<[number, number]> = [
    [-12, 12], [12, -12], [12, 12], [-12, -12], [0, 14], [0, -14], [14, 0], [-14, 0],
  ];
  const spots = shuffle(rng, wpSpots);
  const weapons: Array<"smg" | "shotgun" | "sniper"> = ["smg", "shotgun", "sniper", "smg", "shotgun", "sniper"];
  let wi = 0;
  for (const [wx, wz] of spots) {
    if (wi >= 5) break;
    if (nearBox(wx, wz, 0, boxes, 1.8)) continue;
    weaponPads.push({ x: wx, y: 0, z: wz });
    wi++;
  }
  void weapons; // weapon type assigned round-robin by the engine
  void TUNE;

  return { seed, theme, size: half, boxes, spawns, pads, weaponPads, themeData: t };
}

// ---------------------------------------------------------------------------
// World raycast against AABBs (slab method). Returns distance to nearest hit
// or Infinity. Used for shooting, bot line-of-sight and tracer endpoints.
// ---------------------------------------------------------------------------
export function raycastWorld(
  boxes: BoxDef[],
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
): number {
  let best = maxDist;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const minX = b.x - b.w / 2, maxX = b.x + b.w / 2;
    const minY = b.y - b.h / 2, maxY = b.y + b.h / 2;
    const minZ = b.z - b.d / 2, maxZ = b.z + b.d / 2;
    let tmin = 0;
    let tmax = best;
    // X slab
    if (Math.abs(dx) < 1e-9) {
      if (ox < minX || ox > maxX) continue;
    } else {
      let t1 = (minX - ox) / dx;
      let t2 = (maxX - ox) / dx;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Y slab
    if (Math.abs(dy) < 1e-9) {
      if (oy < minY || oy > maxY) continue;
    } else {
      let t1 = (minY - oy) / dy;
      let t2 = (maxY - oy) / dy;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    // Z slab
    if (Math.abs(dz) < 1e-9) {
      if (oz < minZ || oz > maxZ) continue;
    } else {
      let t1 = (minZ - oz) / dz;
      let t2 = (maxZ - oz) / dz;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (tmin < best) best = tmin;
  }
  return best;
}
