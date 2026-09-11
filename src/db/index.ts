// ---------------------------------------------------------------------------
// Lazy, self-healing PostgreSQL client.
//
// IMPORTANT: nothing may throw at module-import time. Next.js evaluates every
// API route's module graph during `next build` ("Collecting page data"), and
// the build environment (e.g. Vercel) does not have DATABASE_URL. The pool
// and client are therefore created on first use — at request time — when the
// runtime env var is present.
//
// Resilience:
//  - Tries several env var names, since Vercel's Postgres/Neon integration
//    can populate DATABASE_URL, POSTGRES_URL, POSTGRES_PRISMA_URL, etc.
//    depending on how it was installed.
//  - Auto-creates the required tables (idempotent `CREATE TABLE IF NOT
//    EXISTS`) the first time the database is touched, so forgetting to run
//    `schema.sql` on a fresh database never surfaces as a hard failure.
// ---------------------------------------------------------------------------

import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

export type ArenaDb = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as typeof globalThis & {
  __arenaDbPool?: Pool;
  __arenaDbClient?: ArenaDb;
  __arenaSchemaReady?: Promise<void>;
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

function client(): ArenaDb {
  if (!globalForDb.__arenaDbClient) {
    globalForDb.__arenaDbClient = drizzle(getPool(), { schema });
  }
  return globalForDb.__arenaDbClient;
}

// Idempotent DDL — mirrors schema.sql exactly. Safe to run on every cold
// start; CREATE TABLE IF NOT EXISTS is a no-op once the tables exist.
async function ensureSchema(db: ArenaDb): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "lobbies" (
      "id" SERIAL PRIMARY KEY,
      "code" TEXT NOT NULL UNIQUE,
      "name" TEXT NOT NULL,
      "host_name" TEXT NOT NULL,
      "map" TEXT NOT NULL,
      "seed" INTEGER NOT NULL,
      "mode" TEXT NOT NULL,
      "bot_count" INTEGER NOT NULL,
      "difficulty" TEXT NOT NULL,
      "score_limit" INTEGER NOT NULL,
      "time_limit" INTEGER NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'open',
      "created_at" TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "scores" (
      "id" SERIAL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "score" INTEGER NOT NULL,
      "kills" INTEGER NOT NULL,
      "deaths" INTEGER NOT NULL,
      "map" TEXT NOT NULL,
      "created_at" TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Returns a ready-to-query Drizzle client. Guarantees the required tables
 * exist (creating them on first call if needed) before resolving.
 */
export async function getDb(): Promise<ArenaDb> {
  const db = client();
  if (!globalForDb.__arenaSchemaReady) {
    globalForDb.__arenaSchemaReady = ensureSchema(db).catch((err) => {
      // Let the next call retry instead of caching a permanent failure.
      globalForDb.__arenaSchemaReady = undefined;
      throw err;
    });
  }
  await globalForDb.__arenaSchemaReady;
  return db;
}

/**
 * Unwraps Drizzle's `Failed query: ...` wrapper to surface the real
 * Postgres error (e.g. "relation does not exist", auth failure, SSL
 * mismatch) instead of an opaque message.
 */
export function dbErrorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const cause = (err as { cause?: unknown }).cause;
    if (cause && typeof cause === "object" && "message" in cause) {
      const code = (cause as { code?: string }).code;
      return `${(cause as { message: string }).message}${code ? ` (code ${code})` : ""}`;
    }
    if ("message" in err) return String((err as { message: unknown }).message);
  }
  return String(err);
}
