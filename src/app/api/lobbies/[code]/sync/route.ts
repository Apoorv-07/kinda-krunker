import { getDb } from "@/db";
import { withSchema } from "@/lib/server/safe";
import { lobbyPlayers } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  applySync,
  describeError,
  drainBotHits,
  electHost,
  getLobby,
  lobbyToNet,
  mergeEvents,
  reapStale,
  readSnapshot,
  toNetPlayer,
  writeSnapshot,
} from "@/lib/server/lobby-service";
import type {
  NetBot,
  NetEvent,
  SyncRequest,
  WorldSnapshot,
} from "@/lib/net/protocol";

export const dynamic = "force-dynamic";

/**
 * The netcode hot path. Every client POSTs here ~10×/second:
 *   - writes its own transform/health (client-authoritative)
 *   - reads the roster, the host's bot snapshot, and any events addressed to it
 * The host additionally publishes the world snapshot (bots, feed, timer).
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  try {
    return withSchema(async () => {
      const { code } = await ctx.params;
      const lobbyCode = code.toUpperCase();

      const body = (await req.json().catch(() => ({}))) as Partial<SyncRequest>;
      const playerId = String(body.playerId ?? "");
      if (!playerId)
        return Response.json({ error: "playerId required" }, { status: 400 });

      const lobby = await getLobby(lobbyCode);
      if (!lobby)
        return Response.json({ error: "Lobby not found" }, { status: 404 });

      const db = getDb();

      // Host publishes first so guests read fresh data in the same request cycle.
      const incoming = body.snapshot;
      const ackSeq = Math.max(0, Math.floor(Number(body.ackSeq) || 0));
      if (incoming) {
        const { snap, eventSeq } = await readSnapshot(lobbyCode);
        const incomingEvents: NetEvent[] = Array.isArray(incoming.events)
          ? incoming.events
          : [];
        const base: WorldSnapshot = {
          tick: Math.max(0, Math.floor(Number(incoming.tick) || 0)),
          bots: Array.isArray(incoming.bots) ? (incoming.bots as NetBot[]) : [],
          events: incomingEvents,
          timeLeft: Math.max(0, Math.floor(Number(incoming.timeLeft) || 0)),
        };
        // Events created by the host this tick get sequence numbers past the
        // last known one so guests can ack them exactly once.
        let nextSeq = eventSeq;
        const numbered = incomingEvents.map((e) => ({
          ...e,
          seq: e.seq > 0 ? e.seq : ++nextSeq,
        }));
        const merged = mergeEvents({ ...base, events: numbered }, [], ackSeq);
        await writeSnapshot(
          lobbyCode,
          { ...base, events: merged.events },
          merged.seq,
        );
      }

      // Apply this player's authoritative state, including kill credit.
      if (body.transform) {
        await applySync(lobbyCode, {
          playerId,
          transform: {
            x: Number(body.transform.x) || 0,
            y: Number(body.transform.y) || 0,
            z: Number(body.transform.z) || 0,
            yaw: Number(body.transform.yaw) || 0,
            pitch: Number(body.transform.pitch) || 0,
            hp: Number(body.transform.hp) || 0,
            alive: Boolean(body.transform.alive),
            weapon: String(body.transform.weapon ?? "ar"),
            deaths: Number(body.transform.deaths) || 0,
            streak: Number(body.transform.streak) || 0,
          },
          killedBy: body.killedBy ?? null,
          killedByBotId: body.killedByBotId ?? null,
          botHits: Array.isArray(body.botHits) ? body.botHits.slice(0, 30) : [],
        });
      } else {
        // Heartbeat only.
        await db
          .update(lobbyPlayers)
          .set({ lastSeen: new Date() })
          .where(eq(lobbyPlayers.playerId, playerId));
      }

      await reapStale(lobbyCode);
      const hostId = await electHost(lobbyCode);

      const roster = await db
        .select()
        .from(lobbyPlayers)
        .where(eq(lobbyPlayers.lobbyCode, lobbyCode));
      const players = roster.map((r) => toNetPlayer(r));
      const me = players.find((p) => p.playerId === playerId);

      const { snap } = await readSnapshot(lobbyCode);

      // Events addressed to me or broadcast.
      const events = (snap?.events ?? []).filter(
        (e) =>
          e.seq > ackSeq && (e.kind !== "dmg" || !e.to || e.to === playerId),
      );

      // Team aggregate for 'teams' mode.
      const teamMap = new Map<number, number>();
      for (const p of players) {
        if (lobby.teamMode !== "teams") break;
        teamMap.set(p.team, (teamMap.get(p.team) ?? 0) + p.score);
      }

      const status = lobby.status as "waiting" | "live" | "ended";
      const matchOver = status === "ended";

      return Response.json({
        ok: true,
        lobby: lobbyToNet(lobby),
        hostId,
        players,
        me: me ?? null,
        bots: snap?.bots ?? [],
        events,
        timeLeft: snap?.timeLeft ?? lobby.timeLimit,
        teamScores: [...teamMap.entries()].map(([team, score]) => ({
          team,
          score,
        })),
        serverTime: Date.now(),
        matchOver,
        // Only meaningful to the host: guest damage queued against its bots.
        botHits: hostId === playerId ? await drainBotHits(lobbyCode) : [],
      });
    });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}
