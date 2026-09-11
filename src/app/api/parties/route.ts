import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure-schema";
import { parties } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { describeError, makeCode } from "@/lib/server/lobby-service";

export const dynamic = "force-dynamic";

/**
 * Parties ("stacks"). Create one → share the short code → friends join it and
 * everyone in it is guaranteed the same team when the lobby starts.
 * Rows expire after 6 hours to keep the table tiny.
 */
export async function POST(req: Request) {
  try {
    await ensureSchema();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "create");
    const db = getDb();

    // Purge old parties opportunistically.
    await db.delete(parties).where(sql`created_at < now() - interval '6 hours'`);

    if (action === "create") {
      const leaderName = (String(body.leaderName ?? "Player").slice(0, 16) || "Player").trim();
      const stackId = "p-" + makeCode(10);
      const code = makeCode(5);
      const [row] = await db
        .insert(parties)
        .values({ code, leaderName, stackId })
        .returning();
      return Response.json({ party: row }, { status: 201 });
    }

    if (action === "join") {
      const code = String(body.code ?? "").toUpperCase().trim();
      if (!code) return Response.json({ error: "Enter a party code" }, { status: 400 });
      const [row] = await db.select().from(parties).where(eq(parties.code, code));
      if (!row) return Response.json({ error: "Party not found — check the code" }, { status: 404 });
      return Response.json({ party: row });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}
