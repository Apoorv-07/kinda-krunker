import { db } from "@/db";
import { lobbies } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await ctx.params;
    const [row] = await db.select().from(lobbies).where(eq(lobbies.code, code.toUpperCase()));
    if (!row) {
      return Response.json({ error: "Lobby not found" }, { status: 404 });
    }
    return Response.json({ lobby: row });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
