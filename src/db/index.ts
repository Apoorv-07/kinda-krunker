// ---------------------------------------------------------------------------
// Lazy, deployment-robust PostgreSQL client.
//
// Rules that matter for Vercel:
//  1. NOTHING throws at module-import time. `next build` evaluates every API
//     route's module graph, and the build environment has no DATABASE_URL.
//  2. Env vars are read at request time, when the runtime env exists.
//  3. Hosted Postgres (Neon/Supabase via the Vercel Marketplace) requires TLS,
//     and the pooled endpoint (PgBouncer, transaction mode) dislikes named
//     prepared statements — so we configure SSL explicitly and keep a small
//     connection pool.
// ---------------------------------------------------------------------------

import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type ArenaDb = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as typeof globalThis & {
  __arenaDbPool?: Pool;
  __arenaDbClient?: ArenaDb;
};

/**
 * Resolve a connection string from any of the names the various providers set.
 * Order: DATABASE_URL (ours) → POSTGRES_URL (Vercel/Neon marketplace) →
 * DATABASE_URL_UNPOOLED as a last resort.
 */
function resolveUrl(): { url: string; source: string } | null {
  const candidates: Array<[string, string | undefined]> = [
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["POSTGRES_URL", process.env.POSTGRES_URL],
    ["POSTGRES_PRISMA_URL", process.env.POSTGRES_PRISMA_URL],
    ["DATABASE_URL_UNPOOLED", process.env.DATABASE_URL_UNPOOLED],
  ];
  for (const [source, value] of candidates) {
    if (value && value.trim().length > 0) return { url: value.trim(), source };
  }
  return null;
}

/** True when the env var exists at all (used by /api/health diagnostics). */
export function hasDatabaseUrl(): boolean {
  return resolveUrl() !== null;
}

/** Which env var name the connection string came from. */
export function databaseUrlSource(): string | null {
  return resolveUrl()?.source ?? null;
}

function sslFor(url: string): import("pg").PoolConfig["ssl"] {
  // Explicitly disabled → respect it.
  if (/sslmode=disable/i.test(url)) return false;
  // Hosted providers always want TLS. `sslmode=require` in the string means
  // "encrypt, don't verify CA", which matches rejectUnauthorized: false.
  if (/sslmode=/i.test(url) || /neon\.tech|supabase\.(co|com)|amazonaws\.com|render\.com/i.test(url)) {
    return { rejectUnauthorized: false };
  }
  // Local Postgres (our sandbox) typically has no TLS.
  return false;
}

function getPool(): Pool {
  if (!globalForDb.__arenaDbPool) {
    const resolved = resolveUrl();
    if (!resolved) {
      throw new Error(
        "No database connection string found. Set DATABASE_URL in Vercel → Settings → Environment Variables, then REDEPLOY (existing deployments never pick up new env vars).",
      );
    }
    globalForDb.__arenaDbPool = new Pool({
      connectionString: resolved.url,
      ssl: sslFor(resolved.url),
      max: 5, // serverless-friendly
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalForDb.__arenaDbPool;
}

export function getDb(): ArenaDb {
  if (!globalForDb.__arenaDbClient) {
    globalForDb.__arenaDbClient = drizzle(getPool(), { schema });
  }
  return globalForDb.__arenaDbClient;
}
