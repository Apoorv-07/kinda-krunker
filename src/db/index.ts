// ---------------------------------------------------------------------------
// Lazy PostgreSQL client.
//
// IMPORTANT: nothing may throw at module-import time. Next.js evaluates every
// API route's module graph during `next build` ("Collecting page data"), and
// the build environment (e.g. Vercel) does not have DATABASE_URL. The pool
// and client are therefore created on first use — at request time — when the
// runtime env var is present.
// ---------------------------------------------------------------------------

import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type ArenaDb = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as typeof globalThis & {
  __arenaDbPool?: Pool;
  __arenaDbClient?: ArenaDb;
};

function getPool(): Pool {
  if (!globalForDb.__arenaDbPool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Add it to your Vercel Environment Variables (Project → Settings → Environment Variables).",
      );
    }
    globalForDb.__arenaDbPool = new Pool({
      connectionString: url,
      max: 10,
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
