import { getDb, dbErrorMessage } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ ok: false, error: dbErrorMessage(err) }, { status: 500 });
  }
}
