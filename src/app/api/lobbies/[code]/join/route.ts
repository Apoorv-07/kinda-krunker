import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure-schema";
import { lobbyPlayers, lobbies } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import {
  assignTeam, colorFor, describeError, electHost, getLobby, lobbyToNet, makeCode, reapStale, toNetPlayer,
} from "@/lib/server/lobby-service";
import { NET } from "@/lib/net/protocol";

export const dynamic = "force-dynamic";

/**
 * Join a lobby (or re-join / refresh presence). Creating a party beforehand
 * gives everyone in it the same stackId, and in 'teams' mode a stack becomes
 * one team — so a duo/trio/squad always spawns together.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  try {
    await ensureSchema();
    const { code } = await ctx.params;
    const lobbyCode = code.toUpperCase();
    const body = await req.json().catch(() => ({}));
    const playerId = String(body.playerId ?? "").slice(0, 64);
    const name = (String(body.name ?? "Player").slice(0, 16) || "Player").trim();
    const stackId = String(body.stackId ?? `solo-${playerId}`).slice(0, 64);

    if (!playerId) return Response.json({ error: "playerId is required" }, { status: 400 });

    const lobby = await getLobby(lobbyCode);
    if (!lobby) return Response.json({ error: "Lobby not found" }, { status: 404 });

    const db = getDb();
    await reapStale(lobbyCode);

    const roster = await db
      .select()
      .from(lobbyPlayers)
      .where(eq(lobbyPlayers.lobbyCode, lobbyCode));

    const existing = roster.find((r) => r.playerId === playerId);
    const activeCount = roster.filter(
      (r) => Date.now() - new Date(r.lastSeen).getTime() < NET.PLAYER_TIMEOUT_MS,
    ).length;

    if (!existing && activeCount >= NET.MAX_PLAYERS) {
      return Response.json({ error: "Lobby is full" }, { status: 409 });
    }

    // Stack capacity check (only matters when actually grouping up).
    if (!existing) {
      const inStack = roster.filter(
        (r) => r.stackId === stackId && Date.now() - new Date(r.lastSeen).getTime() < NET.PLAYER_TIMEOUT_MS,
      ).length;
      if (stackId !== `solo-${playerId}` && inStack >= Math.min(lobby.stackSize, NET.MAX_STACK)) {
        return Response.json({ error: `That stack is full (max ${lobby.stackSize})` }, { status: 409 });
      }
    }

    const team = await assignTeam(lobbyCode, lobby.teamMode as "ffa" | "teams", stackId);

    let row = existing;
    if (row) {
      const [updated] = await db
        .update(lobbyPlayers)
        .set({ name, stackId, team, lastSeen: new Date() })
        .where(eq(lobbyPlayers.id, row.id))
        .returning();
      row = updated;
    } else {
      const [inserted] = await db
        .insert(lobbyPlayers)
        .values({
          lobbyCode, playerId, name, stackId, team,
          color: colorFor(roster.length),
          alive: true, hp: 100, weapon: "ar",
        })
        .returning();
      row = inserted;
    }

    const hostId = await electHost(lobbyCode);

    // First player to arrive becomes the face of the lobby.
    if (lobby.hostName !== name && row.isHost) {
      await db.update(lobbies).set({ hostName: name }).where(eq(lobbies.code, lobbyCode));
    }

    const players = (await db
      .select()
      .from(lobbyPlayers)
      .where(eq(lobbyPlayers.lobbyCode, lobbyCode))).map((r) => toNetPlayer(r));

    return Response.json({
      ok: true,
      lobby: lobbyToNet(lobby),
      player: toNetPlayer(row),
      hostId,
      players,
    });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}

/** Explicit leave (called on unload where possible). */
export async function DELETE(req: Request, ctx: { params: Promise<{ code: string }> }) {
  try {
    await ensureSchema();
    const { code } = await ctx.params;
    const lobbyCode = code.toUpperCase();
    const body = await req.json().catch(() => ({}));
    const playerId = String(body.playerId ?? "");
    if (!playerId) return Response.json({ error: "playerId required" }, { status: 400 });

    const db = getDb();
    await db
      .delete(lobbyPlayers)
      .where(and(eq(lobbyPlayers.lobbyCode, lobbyCode), eq(lobbyPlayers.playerId, playerId)));
    const hostId = await electHost(lobbyCode);
    return Response.json({ ok: true, hostId });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}

// keep makeCode referenced for potential future reuse
void makeCode;
