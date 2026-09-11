// ---------------------------------------------------------------------------
// Lazy PostgreSQL client.
//
// IMPORTANT: nothing may throw at module-import time. Next.js evaluates every
// API route's module graph during `next build` ("Collecting page data"), and
// the build environment (e.g. Vercel) does not have DATABASE_URL. The pool
// and client are therefore created on first use — at request time — when the
// runtime env var is present.
//
// Resilience: Vercel's Postgres/Neon integration exposes several env var
// names depending on how it was installed (DATABASE_URL, POSTGRES_URL,
// POSTGRES_PRISMA_URL, DATABASE_URL_UNPOOLED, POSTGRES_URL_NON_POOLING). We
// try the pooled ones first and fall back through the list so the app works
// regardless of which one the integration decided to populate.
// ---------------------------------------------------------------------------

import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type ArenaDb = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as typeof globalThis & {
  __arenaDbPool?: Pool;
  __arenaDbClient?: ArenaDb;
};

// Ordered by preference: pooled connection strings first (safe for
// serverless), then non-pooled fallbacks.
const CONNECTION_ENV_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_URL_NO_SSL",
] as const;

function resolveConnectionString(): string {
  for (const key of CONNECTION_ENV_KEYS) {
    const value = process.env[key];
    if (value && value.trim().length > 0) return value;
  }
  throw new Error(
    `No database connection string found. Checked env vars: ${CONNECTION_ENV_KEYS.join(", ")}. ` +
      "This almost always means the variables were added in the Vercel dashboard AFTER the last " +
      "deployment — Vercel bakes env vars into a deployment at build time, so you must trigger a " +
      "new deployment (Deployments → ⋯ → Redeploy, with build cache off) for them to take effect.",
  );
}

function getPool(): Pool {
  if (!globalForDb.__arenaDbPool) {
    const connectionString = resolveConnectionString();
    globalForDb.__arenaDbPool = new Pool({
      connectionString,
      max: 10,
      // Neon/Vercel Postgres require TLS; most of their connection strings
      // already include sslmode=require, but force it on so providers that
      // omit the query param still connect correctly.
      ssl: connectionString.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
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
