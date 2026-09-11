import { getDb } from "@/db";
import { withSchema } from "@/lib/server/safe";
import { lobbyPlayers, parties } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  describeError,
  makeCode,
  reapStale,
  toNetPlayer,
} from "@/lib/server/lobby-service";
import { NET } from "@/lib/net/protocol";

export const dynamic = "force-dynamic";

/**
 * Parties ("stacks"). Create one → share the short code → friends join it.
 * The party remembers which match is running, so everyone who joins the party
 * gets a one-click "Join match" button instead of hunting the lobby list.
 * Rows expire after 6 hours to keep the table tiny.
 */
export async function POST(req: Request) {
  try {
    return withSchema(async () => {
      const body = await req.json().catch(() => ({}));
      const action = String(body.action ?? "create");
      const db = getDb();

      // Purge old parties opportunistically.
      await db
        .delete(parties)
        .where(sql`created_at < now() - interval '6 hours'`);

      // ---- create -------------------------------------------------------
      if (action === "create") {
        const leaderName = (
          String(body.leaderName ?? "Player").slice(0, 16) || "Player"
        ).trim();
        const stackId = "p-" + makeCode(10);
        const code = makeCode(5);
        const [row] = await db
          .insert(parties)
          .values({ code, leaderName, stackId })
          .returning();
        return Response.json({ party: row }, { status: 201 });
      }

      // ---- join ---------------------------------------------------------
      if (action === "join") {
        const code = String(body.code ?? "")
          .toUpperCase()
          .trim();
        if (!code)
          return Response.json(
            { error: "Enter a party code" },
            { status: 400 },
          );
        const [row] = await db
          .select()
          .from(parties)
          .where(eq(parties.code, code));
        if (!row)
          return Response.json(
            { error: "Party not found — check the code" },
            { status: 404 },
          );

        // Surface the live match so the friend can jump straight in.
        let match: {
          code: string;
          name: string;
          map: string;
          status: string;
          teamMode: string;
          stackSize: number;
          players: number;
          maxPlayers: number;
        } | null = null;
        if (row.lobbyCode) {
          const { getLobby } = await import("@/lib/server/lobby-service");
          const lobby = await getLobby(row.lobbyCode);
          if (lobby && lobby.status !== "ended") {
            const roster = await db
              .select()
              .from(lobbyPlayers)
              .where(eq(lobbyPlayers.lobbyCode, lobby.code));
            match = {
              code: lobby.code,
              name: lobby.name,
              map: lobby.map,
              status: lobby.status,
              teamMode: lobby.teamMode,
              stackSize: lobby.stackSize,
              players: roster.filter(
                (r) =>
                  Date.now() - new Date(r.lastSeen).getTime() <
                  NET.PLAYER_TIMEOUT_MS,
              ).length,
              maxPlayers: NET.MAX_PLAYERS,
            };
          }
        }
        return Response.json({ party: row, match });
      }

      // ---- current (poll: is my party in a match?) -----------------------
      if (action === "current") {
        const stackId = String(body.stackId ?? "");
        const code = String(body.code ?? "")
          .toUpperCase()
          .trim();
        if (!stackId && !code) {
          return Response.json(
            { error: "stackId or code required" },
            { status: 400 },
          );
        }
        const [row] = stackId
          ? await db.select().from(parties).where(eq(parties.stackId, stackId))
          : await db.select().from(parties).where(eq(parties.code, code));
        if (!row) return Response.json({ party: null, match: null });

        let match = null;
        if (row.lobbyCode) {
          const { getLobby } = await import("@/lib/server/lobby-service");
          const lobby = await getLobby(row.lobbyCode);
          if (lobby && lobby.status !== "ended") {
            const roster = await db
              .select()
              .from(lobbyPlayers)
              .where(eq(lobbyPlayers.lobbyCode, lobby.code));
            match = {
              code: lobby.code,
              name: lobby.name,
              map: lobby.map,
              status: lobby.status,
              teamMode: lobby.teamMode,
              stackSize: lobby.stackSize,
              players: roster.filter(
                (r) =>
                  Date.now() - new Date(r.lastSeen).getTime() <
                  NET.PLAYER_TIMEOUT_MS,
              ).length,
              maxPlayers: NET.MAX_PLAYERS,
            };
          }
        }
        return Response.json({ party: row, match });
      }

      // ---- setLobby (host links / unlinks the running match) -------------
      if (action === "setLobby") {
        const stackId = String(body.stackId ?? "");
        if (!stackId)
          return Response.json({ error: "stackId required" }, { status: 400 });
        const lobbyCode = body.lobbyCode
          ? String(body.lobbyCode).toUpperCase()
          : null;
        const lobbyName = body.lobbyName
          ? String(body.lobbyName).slice(0, 40)
          : null;
        const [row] = await db
          .update(parties)
          .set({ lobbyCode, lobbyName })
          .where(eq(parties.stackId, stackId))
          .returning();
        if (!row)
          return Response.json({ error: "Party not found" }, { status: 404 });
        return Response.json({ party: row });
      }

      return Response.json({ error: "Unknown action" }, { status: 400 });
    });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}

/** Party status probe used by the waiting room. */
export async function GET(req: Request) {
  try {
    return withSchema(async () => {
      const code =
        new URL(req.url).searchParams.get("code")?.toUpperCase() ?? "";
      if (!code)
        return Response.json({ error: "code required" }, { status: 400 });
      const db = getDb();
      const [row] = await db
        .select()
        .from(parties)
        .where(eq(parties.code, code));
      if (!row)
        return Response.json({ error: "Party not found" }, { status: 404 });
      if (row.lobbyCode) await reapStale(row.lobbyCode);
      const roster = row.lobbyCode
        ? (
            await db
              .select()
              .from(lobbyPlayers)
              .where(eq(lobbyPlayers.lobbyCode, row.lobbyCode))
          ).map((r) => toNetPlayer(r))
        : [];
      return Response.json({ party: row, players: roster });
    });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}
