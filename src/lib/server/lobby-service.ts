// ---------------------------------------------------------------------------
// Lobby service: all shared multiplayer logic used by the API routes.
// Team assignment (stack = team), host election + migration, stale-player
// reaping, snapshot read/write. Keeps the routes thin and testable.
// ---------------------------------------------------------------------------

import { getDb } from "@/db";
import { lobbyPlayers, lobbyState, lobbies } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  NET, NetEvent, PLAYER_COLORS, SyncRequest, SyncResponse, TeamMode, WorldSnapshot,
} from "@/lib/net/protocol";

export type LobbyRow = typeof lobbies.$inferSelect;
export type PlayerRow = typeof lobbyPlayers.$inferSelect;

export function makeCode(len = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** Unwrap Drizzle's "Failed query" wrapper to surface the real driver error. */
export function describeError(err: unknown): string {
  const e = err as { cause?: unknown; message?: string } | null;
  const cause = e?.cause instanceof Error ? e.cause.message : e?.cause ? String(e.cause) : "";
  return (cause || e?.message || String(err)).slice(0, 300);
}

export async function getLobby(code: string): Promise<LobbyRow | null> {
  const db = getDb();
  const [row] = await db.select().from(lobbies).where(eq(lobbies.code, code.toUpperCase()));
  return row ?? null;
}

/** Drop players whose heartbeat went silent. */
export async function reapStale(lobbyCode: string): Promise<void> {
  const db = getDb();
  await db.delete(lobbyPlayers).where(
    and(
      eq(lobbyPlayers.lobbyCode, lobbyCode),
      sql`${lobbyPlayers.lastSeen} < now() - interval '${sql.raw(String(Math.round(NET.PLAYER_TIMEOUT_MS / 1000)))} seconds'`,
    ),
  );
}

/**
 * Elect a host. Prefers the existing host if still fresh; otherwise the
 * longest-standing player in the lobby takes over (host migration).
 */
export async function electHost(lobbyCode: string): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(lobbyPlayers)
    .where(eq(lobbyPlayers.lobbyCode, lobbyCode))
    .orderBy(lobbyPlayers.joinedAt);

  if (rows.length === 0) return null;

  const now = Date.now();
  const current = rows.find((r) => r.isHost);
  const currentFresh = current && now - new Date(current.lastSeen).getTime() < NET.HOST_TIMEOUT_MS;
  if (current && currentFresh) return current.playerId;

  // Promote the earliest joiner (self-join order is stable enough for friends).
  const next = rows[0];
  if (current && current.playerId !== next.playerId) {
    await db.update(lobbyPlayers).set({ isHost: false }).where(eq(lobbyPlayers.id, current.id));
  }
  if (!next.isHost) {
    await db.update(lobbyPlayers).set({ isHost: true }).where(eq(lobbyPlayers.id, next.id));
    await db.update(lobbies).set({ hostPlayerId: next.playerId }).where(eq(lobbies.code, lobbyCode));
    next.isHost = true;
  }
  return next.playerId;
}

/**
 * Assign a team. In 'teams' mode every stack (party) is its own team, so a
 * duo/trio/squad always lands together. In 'ffa' everyone is team 0 and
 * hostility is decided by "different playerId", not team.
 */
export async function assignTeam(
  lobbyCode: string,
  teamMode: TeamMode,
  stackId: string,
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ team: lobbyPlayers.team, stackId: lobbyPlayers.stackId })
    .from(lobbyPlayers)
    .where(eq(lobbyPlayers.lobbyCode, lobbyCode));

  if (teamMode === "ffa") return 0;

  // Reuse this stack's existing team so party members stay together.
  const sameStack = rows.find((r) => r.stackId === stackId);
  if (sameStack) return sameStack.team;

  // New stack → take the next free team index.
  const used = new Set(rows.map((r) => r.team));
  let t = 0;
  while (used.has(t)) t++;
  return t;
}

export function colorFor(index: number): number {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

export async function readSnapshot(lobbyCode: string): Promise<{ snap: WorldSnapshot | null; eventSeq: number }> {
  const db = getDb();
  const [row] = await db.select().from(lobbyState).where(eq(lobbyState.lobbyCode, lobbyCode));
  if (!row) return { snap: null, eventSeq: 0 };
  const snap = row.snapshot as WorldSnapshot;
  return { snap: snap ?? null, eventSeq: row.eventSeq ?? 0 };
}

export async function writeSnapshot(lobbyCode: string, snap: WorldSnapshot, eventSeq: number): Promise<void> {
  const db = getDb();
  await db
    .insert(lobbyState)
    .values({ lobbyCode, tick: snap.tick, eventSeq, snapshot: snap, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: lobbyState.lobbyCode,
      set: { tick: snap.tick, eventSeq, snapshot: snap, updatedAt: new Date() },
    });
}

export function toNetPlayer(r: PlayerRow, now = Date.now()) {
  return {
    playerId: r.playerId,
    name: r.name,
    color: r.color,
    stackId: r.stackId,
    team: r.team,
    isHost: r.isHost,
    x: r.x, y: r.y, z: r.z,
    yaw: r.yaw, pitch: r.pitch,
    hp: r.hp, alive: r.alive, weapon: r.weapon,
    kills: r.kills, deaths: r.deaths, score: r.score, streak: r.streak,
    ageMs: Math.max(0, now - new Date(r.lastSeen).getTime()),
  };
}

export function lobbyToNet(l: LobbyRow): SyncResponse["lobby"] {
  return {
    code: l.code,
    name: l.name,
    map: l.map,
    seed: l.seed,
    mode: l.mode,
    teamMode: l.teamMode as TeamMode,
    stackSize: l.stackSize,
    botFill: l.botFill,
    difficulty: l.difficulty as SyncResponse["lobby"]["difficulty"],
    scoreLimit: l.scoreLimit,
    timeLimit: l.timeLimit,
    status: l.status as SyncResponse["lobby"]["status"],
  };
}

/**
 * Apply one player's reported state. Handles the kill credit path: the victim
 * is authoritative about its own death, and the server credits the killer so
 * the scoreboard stays consistent for everyone.
 */
export interface BotHit { botId: number; dmg: number; head: boolean }

export async function applySync(
  lobbyCode: string,
  req: SyncRequest & { botHits?: BotHit[] },
): Promise<void> {
  const db = getDb();
  const t = req.transform;
  const now = new Date();

  await db
    .update(lobbyPlayers)
    .set({
      x: t.x, y: t.y, z: t.z,
      yaw: t.yaw, pitch: t.pitch,
      hp: Math.max(0, Math.min(100, Math.round(t.hp))),
      alive: t.alive,
      weapon: t.weapon,
      deaths: Math.max(0, Math.floor(t.deaths)),
      streak: Math.max(0, Math.floor(t.streak)),
      // Accumulate queued bot damage for the host to drain. Reset whenever the
      // caller is the host (which sends no bot hits) so the buffer self-clears.
      botHits: req.botHits && req.botHits.length > 0 ? req.botHits : [],
      lastSeen: now,
    })
    .where(and(eq(lobbyPlayers.lobbyCode, lobbyCode), eq(lobbyPlayers.playerId, req.playerId)));

  if (req.killedBy) {
    // Credit the killer (another player).
    await db
      .update(lobbyPlayers)
      .set({
        kills: sql`${lobbyPlayers.kills} + 1`,
        score: sql`${lobbyPlayers.score} + 100`,
        streak: sql`${lobbyPlayers.streak} + 1`,
      })
      .where(and(eq(lobbyPlayers.lobbyCode, lobbyCode), eq(lobbyPlayers.playerId, req.killedBy)));
  } else if (req.killedByBotId != null) {
    // Bot kills are tracked on the host's own row for the scoreboard.
    await db
      .update(lobbyPlayers)
      .set({
        kills: sql`${lobbyPlayers.kills} + 1`,
        score: sql`${lobbyPlayers.score} + 100`,
        streak: sql`${lobbyPlayers.streak} + 1`,
      })
      .where(and(eq(lobbyPlayers.lobbyCode, lobbyCode), eq(lobbyPlayers.playerId, req.playerId)));
  }
}

/**
 * Host-only: read and clear the bot damage queued by every guest. Called on the
 * host's sync tick so guests' shots land on host-simulated bots.
 */
export async function drainBotHits(lobbyCode: string): Promise<BotHit[]> {
  const db = getDb();
  const rows = await db
    .select({ id: lobbyPlayers.id, botHits: lobbyPlayers.botHits })
    .from(lobbyPlayers)
    .where(eq(lobbyPlayers.lobbyCode, lobbyCode));

  const hits: BotHit[] = [];
  for (const r of rows) {
    const arr = r.botHits as unknown;
    if (!Array.isArray(arr) || arr.length === 0) continue;
    for (const h of arr as BotHit[]) {
      if (h && typeof h.botId === "number" && typeof h.dmg === "number") {
        hits.push({ botId: h.botId, dmg: h.dmg, head: !!h.head });
      }
    }
  }
  if (hits.length > 0) {
    // Clear the buffers now that the host has consumed them.
    await db
      .update(lobbyPlayers)
      .set({ botHits: [] })
      .where(eq(lobbyPlayers.lobbyCode, lobbyCode));
  }
  return hits;
}

/** Merge relayed events into a snapshot, dropping anything already acked. */
export function mergeEvents(snap: WorldSnapshot, incoming: NetEvent[], ackSeq: number): { events: NetEvent[]; seq: number } {
  const keep = snap.events.filter((e) => e.seq > ackSeq);
  const all = [...keep, ...incoming].sort((a, b) => a.seq - b.seq);
  // Cap the buffer so a lagging client can't grow it forever.
  const events = all.slice(-40);
  const seq = events.length ? events[events.length - 1].seq : ackSeq;
  return { events, seq };
}
