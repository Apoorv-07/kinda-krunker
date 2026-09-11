// ---------------------------------------------------------------------------
// BLOCKSHOT ARENA — shared game config: types, tuning, weapons, names, utils.
// ---------------------------------------------------------------------------

export interface LobbyConfig {
  code: string;
  name: string;
  hostName: string;
  map: MapId;
  seed: number;
  botCount: number;
  difficulty: Difficulty;
  scoreLimit: number;
  timeLimit: number;
  /** multiplayer: 'ffa' = everyone hostile, 'teams' = your stack is a team */
  teamMode?: "ffa" | "teams";
  /** max players per stack/team */
  stackSize?: number;
  /** set when this lobby already has a host on the server */
  hostPlayerId?: string | null;
}

export type MapId = "yard" | "neon" | "dusk";
export type Difficulty = "easy" | "normal" | "hard";
export type WeaponId = "ar" | "smg" | "shotgun" | "sniper";

export const MAP_LABEL: Record<MapId, string> = {
  yard: "Crates Yard",
  neon: "Neon Grid",
  dusk: "Dusk Towers",
};

export const DIFFICULTY_TUNING: Record<
  Difficulty,
  { react: number; spread: number; fireDelay: number; dmgMul: number; label: string }
> = {
  easy: { react: 0.55, spread: 0.16, fireDelay: 0.34, dmgMul: 0.7, label: "Easy" },
  normal: { react: 0.32, spread: 0.09, fireDelay: 0.22, dmgMul: 1.0, label: "Normal" },
  hard: { react: 0.16, spread: 0.05, fireDelay: 0.15, dmgMul: 1.25, label: "Hard" },
};

export interface WeaponDef {
  id: WeaponId;
  name: string;
  dmg: number;
  headMul: number;
  mag: number;
  reserve: number;
  rpm: number; // rounds per minute
  reload: number; // seconds
  spread: number; // base inaccuracy (radians)
  moveSpread: number; // added while moving
  adsFov: number;
  pellets: number;
  auto: boolean;
  zoomMul: number; // fov multiplier while ADS
  range: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  ar: {
    id: "ar", name: "VANDAL AR", dmg: 18, headMul: 2, mag: 30, reserve: 150,
    rpm: 600, reload: 1.6, spread: 0.016, moveSpread: 0.03, adsFov: 60,
    pellets: 1, auto: true, zoomMul: 0.72, range: 120,
  },
  smg: {
    id: "smg", name: "VIPER SMG", dmg: 11, headMul: 1.8, mag: 40, reserve: 200,
    rpm: 920, reload: 1.4, spread: 0.03, moveSpread: 0.035, adsFov: 65,
    pellets: 1, auto: true, zoomMul: 0.8, range: 70,
  },
  shotgun: {
    id: "shotgun", name: "BOOMER SG", dmg: 8, headMul: 1.5, mag: 6, reserve: 48,
    rpm: 82, reload: 2.2, spread: 0.075, moveSpread: 0.02, adsFov: 70,
    pellets: 8, auto: false, zoomMul: 0.9, range: 45,
  },
  sniper: {
    id: "sniper", name: "RAILGUN .50", dmg: 85, headMul: 2, mag: 5, reserve: 25,
    rpm: 52, reload: 2.4, spread: 0.002, moveSpread: 0.08, adsFov: 26,
    pellets: 1, auto: false, zoomMul: 0.3, range: 300,
  },
};

export const WEAPON_ORDER: WeaponId[] = ["ar", "smg", "shotgun", "sniper"];

export const BOT_NAMES = [
  "xX_Reaper_Xx", "NoScopeNina", "BlitzKrieg", "PixelPunisher", "TurboTommy",
  "ShadowSniper", "Blastoise99", "CrateCrawler", "HeadshotHarry", "LagginLarry",
  "NeonNemesis", "BoomBoomBetty", "QuickScopeQuin", "FragFred", "SneakySnek",
  "BulletBill", "DoomDaisy", "VandalVince", "GhostGerry", "MayhemMia",
  "TriggerToni", "RapidRoxie", "ClutchCarter", "SprayPraySam",
];

export const BOT_COLORS = [
  0xef4444, 0x3b82f6, 0x22c55e, 0xeab308, 0xa855f7,
  0xec4899, 0x06b6d4, 0xf97316, 0x84cc16, 0x14b8a6,
];

// --- tuning ---------------------------------------------------------------
export const TUNE = {
  gravity: 26,
  jumpVel: 9.4,
  walkSpeed: 7.0,
  sprintSpeed: 9.8,
  crouchSpeed: 3.4,
  slideSpeed: 12.5,
  slideTime: 0.55,
  airAccel: 9,
  groundAccel: 38,
  eyeHeight: 1.62,
  crouchEyeHeight: 0.98,
  standHeight: 1.72,
  crouchHeight: 1.0,
  radius: 0.42,
  maxHp: 100,
  regenDelay: 3.0,
  regenRate: 20,
  spawnProtect: 1.6,
  respawnTime: 2.6,
  warmupTime: 3.0,
  padLaunch: 19.0,
};

export type MatchState = "warmup" | "playing" | "paused" | "ended";

// --- math utils (allocation-free where it matters) -------------------------
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const damp = (a: number, b: number, lambda: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));
export const randRange = (rng: () => number, lo: number, hi: number) => lo + rng() * (hi - lo);

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function shuffle<T>(rng: () => number, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
