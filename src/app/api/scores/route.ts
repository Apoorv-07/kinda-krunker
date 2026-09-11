import { getDb } from "@/db";
import { withSchema } from "@/lib/server/safe";
import { scores } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

function describe(err: unknown): string {
  const e = err as { cause?: unknown; message?: string } | null;
  const cause =
    e?.cause instanceof Error
      ? e.cause.message
      : e?.cause
        ? String(e.cause)
        : "";
  return (cause || e?.message || String(err)).slice(0, 300);
}

export async function GET() {
  try {
    return withSchema(async () => {
      const db = getDb();
      const rows = await db
        .select()
        .from(scores)
        .orderBy(desc(scores.score), desc(scores.kills))
        .limit(10);
      return Response.json({ scores: rows });
    });
  } catch (err) {
    return Response.json({ scores: [], error: describe(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    return withSchema(async () => {
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
    });
  } catch (err) {
    return Response.json({ error: describe(err) }, { status: 500 });
  }
}
