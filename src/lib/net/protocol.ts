// ---------------------------------------------------------------------------
// Wire protocol shared by the host-authoritative netcode.
//
// Topology: Vercel serverless cannot hold WebSockets open, so the game runs
// over short HTTP polling requests (~10 Hz).
//
//   - ONE player is the HOST. The host runs the full simulation (bots, bot
//     fire, physics for bots, match timer) and publishes a snapshot.
//   - Every OTHER player (GUEST) is authoritative only over its own body:
//     it sends its transform + hp, and receives everyone else's.
//   - Hits against remote players are detected by the shooter, but damage is
//     APPLIED by the victim (client-authoritative health), which keeps the
//     server a dumb relay — no simulation cost, works on any host.
//   - If the host goes silent the server promotes the next player, so a lobby
//     survives its host leaving.
// ---------------------------------------------------------------------------

export type TeamMode = "ffa" | "teams";
export type Difficulty = "easy" | "normal" | "hard";

export const NET = {
  /** Sync round-trip rate (ms). 100ms = 10 Hz. */
  TICK_MS: 100,
  /** A player whose lastSeen is older than this is considered gone. */
  PLAYER_TIMEOUT_MS: 8000,
  /** A host whose lastSeen is older than this is replaced. */
  HOST_TIMEOUT_MS: 6000,
  /** Max players in one lobby. */
  MAX_PLAYERS: 12,
  /** Max stack (party) size. */
  MAX_STACK: 5,
} as const;

export interface NetPlayer {
  playerId: string;
  name: string;
  color: number;
  stackId: string;
  team: number;
  isHost: boolean;
  isLocal?: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  weapon: string;
  kills: number;
  deaths: number;
  score: number;
  streak: number;
  /** ms since this player was last heard from (server-computed) */
  ageMs: number;
}

/** A bot as described by the host's snapshot. */
export interface NetBot {
  id: number;
  name: string;
  color: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  team: number;
  kills?: number;
  deaths?: number;
  score?: number;
}

export type NetEventKind = "dmg" | "kill" | "feed" | "start" | "end";

/** Server-relayed event, addressed either to one player or broadcast. */
export interface NetEvent {
  seq: number;
  kind: NetEventKind;
  /** target playerId for `dmg` events */
  to?: string;
  /** attacker playerId (or bot id as a string) */
  from?: string;
  fromName?: string;
  toName?: string;
  dmg?: number;
  head?: boolean;
  text?: string;
  weapon?: string;
}

export interface WorldSnapshot {
  tick: number;
  bots: NetBot[];
  events: NetEvent[];
  timeLeft: number;
}

/** What the host publishes each tick (bots are plain wire objects). */
export type HostSnapshot = WorldSnapshot;

/** What every client sends on every tick. */
export interface SyncRequest {
  playerId: string;
  name?: string;
  transform: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    hp: number;
    alive: boolean;
    weapon: string;
    deaths: number;
    streak: number;
  };
  /** set once on the tick where this player dies */
  killedBy?: string | null;
  killedByBotId?: number | null;
  headshot?: boolean;
  /** guest → host relay for damage dealt to host-simulated bots */
  botHits?: Array<{ botId: number; dmg: number; head: boolean }>;
  /** only sent by the host */
  snapshot?: WorldSnapshot;
  /** highest event seq this client has already applied */
  ackSeq?: number;
}

/** What every client receives on every tick. */
export interface SyncResponse {
  ok: true;
  lobby: {
    code: string;
    name: string;
    map: string;
    seed: number;
    mode: string;
    teamMode: TeamMode;
    stackSize: number;
    botFill: number;
    difficulty: Difficulty;
    scoreLimit: number;
    timeLimit: number;
    status: "waiting" | "live" | "ended";
  };
  hostId: string | null;
  players: NetPlayer[];
  bots: NetBot[];
  events: NetEvent[];
  timeLeft: number;
  serverTime: number;
  /** team scores in 'teams' mode: [teamIndex, score][] */
  teamScores: Array<{ team: number; score: number }>;
  matchOver: boolean;
  /** host only: guest-queued damage to apply to its bots */
  botHits: Array<{ botId: number; dmg: number; head: boolean }>;
}

export interface JoinRequest {
  playerId: string;
  name: string;
  stackId?: string;
  stackCode?: string;
}

export interface JoinResponse {
  ok: true;
  lobby: SyncResponse["lobby"];
  player: NetPlayer;
  hostId: string | null;
  players: NetPlayer[];
}

export const PLAYER_COLORS = [
  0x3ddc84, 0xef4444, 0x3b82f6, 0xeab308, 0xa855f7, 0xec4899, 0x06b6d4,
  0xf97316, 0x84cc16, 0x14b8a6, 0xf43f5e, 0x8b5cf6,
];

export const BOT_COLORS = [
  0xef4444, 0x3b82f6, 0xeab308, 0xa855f7, 0xec4899, 0x06b6d4, 0xf97316,
  0x84cc16, 0x14b8a6, 0xf43f5e,
];

export const BOT_NAMES = [
  "xX_Reaper_Xx",
  "NoScopeNina",
  "BlitzKrieg",
  "PixelPunisher",
  "TurboTommy",
  "ShadowSniper",
  "Blastoise99",
  "CrateCrawler",
  "HeadshotHarry",
  "LagginLarry",
  "NeonNemesis",
  "BoomBoomBetty",
  "QuickScopeQuin",
  "FragFred",
  "SneakySnek",
  "BulletBill",
  "DoomDaisy",
  "VandalVince",
  "GhostGerry",
  "MayhemMia",
];

export function stackLabel(size: number): string {
  return size === 1
    ? "Solo"
    : size === 2
      ? "Duo"
      : size === 3
        ? "Trio"
        : size === 4
          ? "Squad"
          : "5-Stack";
}
