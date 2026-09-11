import { getDb, hasDatabaseUrl, databaseUrlSource } from "@/db";
import { ensureSchema, schemaExists } from "@/db/ensure-schema";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Deployment diagnostics — checks each link in the chain separately so the
 * exact failure is obvious. Never exposes the connection string.
 *
 *   1. envConfigured  → is a connection string visible to this deployment?
 *   2. db             → can we actually connect?
 *   3. tables         → do the lobbies/scores tables exist? (auto-created)
 */
export async function GET() {
  const envConfigured = hasDatabaseUrl();
  const envVar = databaseUrlSource();

  if (!envConfigured) {
    return Response.json(
      {
        ok: false,
        envConfigured: false,
        tables: false,
        reason:
          "No database connection string is visible to this deployment. Add DATABASE_URL in Vercel → Settings → Environment Variables, then REDEPLOY — existing deployments never pick up newly added env vars.",
      },
      { status: 503 },
    );
  }

  try {
    await getDb().execute(sql`select 1`);
  } catch (err) {
    return Response.json(
      {
        ok: false,
        envConfigured: true,
        envVar,
        tables: false,
        reason: "Connection string exists but the database could not be reached.",
        detail: describe(err),
      },
      { status: 500 },
    );
  }

  // Connected → make sure the tables exist (self-healing).
  try {
    await ensureSchema();
    const tables = await schemaExists();
    return Response.json({ ok: tables, envConfigured: true, envVar, db: "reachable", tables });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        envConfigured: true,
        envVar,
        db: "reachable",
        tables: false,
        reason: "Connected, but could not create the tables. Check that the database user has CREATE permission.",
        detail: describe(err),
      },
      { status: 500 },
    );
  }
}

function describe(err: unknown): string {
  const e = err as { cause?: unknown; message?: string } | null;
  const cause = e?.cause instanceof Error ? e.cause.message : e?.cause ? String(e.cause) : "";
  return (cause || e?.message || String(err)).slice(0, 300);
}
