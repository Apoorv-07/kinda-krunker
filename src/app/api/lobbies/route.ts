import { db } from "@/db";
import { lobbies } from "@/db/schema";
import { desc, sql, like } from "drizzle-orm";

export const dynamic = "force-dynamic";

const MAPS = ["random", "yard", "neon", "dusk"];
const DIFFICULTIES = ["easy", "normal", "hard"];
const BOT_COUNTS = [1, 2, 3, 4, 5, 6, 7];
const SCORE_LIMITS = [15, 25, 40, 0]; // 0 = time-based only
const TIME_LIMITS = [120, 300, 600];

function makeCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function makeSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export async function GET() {
  try {
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
    return Response.json({ lobbies: [], activeCount: 0, error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "Untitled Lobby").slice(0, 40) || "Untitled Lobby";
    const hostName = String(body.hostName ?? "Player").slice(0, 20) || "Player";
    const map = MAPS.includes(body.map) ? body.map : "random";
    const mode = "dm";
    const botCount = BOT_COUNTS.includes(Number(body.botCount)) ? Number(body.botCount) : 5;
    const difficulty = DIFFICULTIES.includes(body.difficulty) ? body.difficulty : "normal";
    const scoreLimit = SCORE_LIMITS.includes(Number(body.scoreLimit)) ? Number(body.scoreLimit) : 25;
    const timeLimit = TIME_LIMITS.includes(Number(body.timeLimit)) ? Number(body.timeLimit) : 300;

    // Unique code, retry on collision.
    let code = makeCode();
    for (let i = 0; i < 5; i++) {
      const existing = await db.select({ id: lobbies.id }).from(lobbies).where(like(lobbies.code, code));
      if (existing.length === 0) break;
      code = makeCode();
    }

    const seed = makeSeed();
    const [row] = await db
      .insert(lobbies)
      .values({ code, name, hostName, map, seed, mode, botCount, difficulty, scoreLimit, timeLimit })
      .returning();

    return Response.json({ lobby: row }, { status: 201 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}


