import { getDb } from "@/db";
import { withSchema } from "@/lib/server/safe";
import { lobbies } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  try {
    return withSchema(async () => {
      const { code } = await ctx.params;
      const db = getDb();
      const [row] = await db
        .select()
        .from(lobbies)
        .where(eq(lobbies.code, code.toUpperCase()));
      if (!row) {
        return Response.json({ error: "Lobby not found" }, { status: 404 });
      }
      return Response.json({ lobby: row });
    });
  } catch (err) {
    const e = err as { cause?: unknown; message?: string } | null;
    const cause =
      e?.cause instanceof Error
        ? e.cause.message
        : e?.cause
          ? String(e.cause)
          : "";
    return Response.json(
      { error: (cause || e?.message || String(err)).slice(0, 300) },
      { status: 500 },
    );
  }
}
