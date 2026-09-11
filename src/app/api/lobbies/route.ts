import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure-schema";
import { lobbies } from "@/db/schema";
import { desc, sql, eq } from "drizzle-orm";
import { describeError, getLobby, makeCode } from "@/lib/server/lobby-service";

export const dynamic = "force-dynamic";

const MAPS = ["random", "yard", "neon", "dusk"];
const DIFFICULTIES = ["easy", "normal", "hard"];
const TEAM_MODES = ["ffa", "teams"];
const SCORE_LIMITS = [15, 25, 40, 0];
const TIME_LIMITS = [120, 300, 600];

function makeSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export async function GET() {
  try {
    await ensureSchema();
    const db = getDb();
    const rows = await db
      .select()
      .from(lobbies)
      .orderBy(desc(lobbies.createdAt))
      .limit(20);
    const [recent] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(lobbies)
      .where(sql`created_at > now() - interval '10 minutes'`);
    return Response.json({ lobbies: rows, activeCount: Number(recent?.n ?? 0) });
  } catch (err) {
    return Response.json({ lobbies: [], activeCount: 0, error: describeError(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureSchema();
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "Untitled Lobby").slice(0, 40) || "Untitled Lobby";
    const hostName = String(body.hostName ?? "Player").slice(0, 20) || "Player";
    const map = MAPS.includes(body.map) ? body.map : "random";
    const teamMode: string = TEAM_MODES.includes(body.teamMode) ? body.teamMode : "ffa";
    const stackSize = Math.max(1, Math.min(5, Math.floor(Number(body.stackSize) || 5)));
    const botFill = Math.max(0, Math.min(11, Math.floor(Number(body.botFill ?? body.botCount) ?? 5)));
    const difficulty = DIFFICULTIES.includes(body.difficulty) ? body.difficulty : "normal";
    const scoreLimit = SCORE_LIMITS.includes(Number(body.scoreLimit)) ? Number(body.scoreLimit) : 25;
    const timeLimit = TIME_LIMITS.includes(Number(body.timeLimit)) ? Number(body.timeLimit) : 300;

    const db = getDb();
    let code = makeCode();
    for (let i = 0; i < 5; i++) {
      const existing = await getLobby(code);
      if (!existing) break;
      code = makeCode();
    }

    const seed = makeSeed();
    const [row] = await db
      .insert(lobbies)
      .values({
        code, name, hostName, map, seed,
        mode: "dm", teamMode, stackSize, botFill, difficulty,
        // `botCount` is a legacy NOT NULL column kept in sync for older databases.
        botCount: botFill,
        scoreLimit, timeLimit, status: "waiting",
      })
      .returning();

    return Response.json({ lobby: row }, { status: 201 });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}

/** Host sets the lobby live (or resets it back to waiting). */
export async function PATCH(req: Request) {
  try {
    await ensureSchema();
    const body = await req.json().catch(() => ({}));
    const code = String(body.code ?? "").toUpperCase();
    const status = body.status === "live" ? "live" : body.status === "ended" ? "ended" : "waiting";
    const db = getDb();
    const [row] = await db
      .update(lobbies)
      .set({ status })
      .where(eq(lobbies.code, code))
      .returning();
    if (!row) return Response.json({ error: "Lobby not found" }, { status: 404 });
    return Response.json({ lobby: row });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}
