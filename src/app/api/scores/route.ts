import { getDb } from "@/db";
import { scores } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(scores)
      .orderBy(desc(scores.score), desc(scores.kills))
      .limit(10);
    return Response.json({ scores: rows });
  } catch (err) {
    return Response.json({ scores: [], error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "Player").slice(0, 20) || "Player";
    const score = Math.max(0, Math.floor(Number(body.score) || 0));
    const kills = Math.max(0, Math.floor(Number(body.kills) || 0));
    const deaths = Math.max(0, Math.floor(Number(body.deaths) || 0));
    const map = String(body.map ?? "random").slice(0, 20);

    const db = getDb();
    const [row] = await db
      .insert(scores)
      .values({ name, score, kills, deaths, map })
      .returning();

    return Response.json({ score: row }, { status: 201 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
