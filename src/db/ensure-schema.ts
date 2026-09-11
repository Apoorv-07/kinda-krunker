// ---------------------------------------------------------------------------
// Self-healing schema.
//
// Creates the tables on first use so a fresh database (Neon, Supabase, Vercel
// Postgres) works with NOTHING more than DATABASE_URL — no manual SQL step.
// The DDL is idempotent (`IF NOT EXISTS`) and the work is memoized per
// process, so it costs one round-trip on the first request and nothing after.
// Mirrors src/db/schema.ts and schema.sql exactly.
// ---------------------------------------------------------------------------

import { sql } from "drizzle-orm";
import { getDb } from "./index";

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "lobbies" (
     "id" SERIAL PRIMARY KEY,
     "code" TEXT NOT NULL UNIQUE,
     "name" TEXT NOT NULL,
     "host_name" TEXT NOT NULL,
     "map" TEXT NOT NULL,
     "seed" INTEGER NOT NULL,
     "mode" TEXT NOT NULL,
     "bot_count" INTEGER NOT NULL DEFAULT 5,
     "bot_fill" INTEGER NOT NULL DEFAULT 5,
     "stack_size" INTEGER NOT NULL DEFAULT 5,
     "team_mode" TEXT NOT NULL DEFAULT 'ffa',
     "difficulty" TEXT NOT NULL,
     "score_limit" INTEGER NOT NULL,
     "time_limit" INTEGER NOT NULL,
     "status" TEXT NOT NULL DEFAULT 'waiting',
     "host_player_id" TEXT,
     "created_at" TIMESTAMP NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS "scores" (
     "id" SERIAL PRIMARY KEY,
     "name" TEXT NOT NULL,
     "score" INTEGER NOT NULL,
     "kills" INTEGER NOT NULL,
     "deaths" INTEGER NOT NULL,
     "map" TEXT NOT NULL,
     "created_at" TIMESTAMP NOT NULL DEFAULT now()
   )`,
  // Leaderboard always orders by score descending — a matching index keeps the
  // top-10 read cheap as the table grows.
  `CREATE INDEX IF NOT EXISTS "scores_score_idx" ON "scores" ("score" DESC)`,
  `CREATE INDEX IF NOT EXISTS "lobbies_created_at_idx" ON "lobbies" ("created_at" DESC)`,

  // --- multiplayer ---
  `CREATE TABLE IF NOT EXISTS "lobby_players" (
     "id" SERIAL PRIMARY KEY,
     "lobby_code" TEXT NOT NULL,
     "player_id" TEXT NOT NULL,
     "name" TEXT NOT NULL,
     "color" INTEGER NOT NULL,
     "stack_id" TEXT NOT NULL,
     "team" INTEGER NOT NULL DEFAULT 0,
     "is_host" BOOLEAN NOT NULL DEFAULT false,
     "ready" BOOLEAN NOT NULL DEFAULT false,
     "x" REAL NOT NULL DEFAULT 0,
     "y" REAL NOT NULL DEFAULT 0,
     "z" REAL NOT NULL DEFAULT 0,
     "yaw" REAL NOT NULL DEFAULT 0,
     "pitch" REAL NOT NULL DEFAULT 0,
     "hp" INTEGER NOT NULL DEFAULT 100,
     "alive" BOOLEAN NOT NULL DEFAULT true,
     "weapon" TEXT NOT NULL DEFAULT 'ar',
     "kills" INTEGER NOT NULL DEFAULT 0,
     "deaths" INTEGER NOT NULL DEFAULT 0,
     "score" INTEGER NOT NULL DEFAULT 0,
     "streak" INTEGER NOT NULL DEFAULT 0,
     "bot_hits" JSONB NOT NULL DEFAULT '[]',
     "joined_at" TIMESTAMP NOT NULL DEFAULT now(),
     "last_seen" TIMESTAMP NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS "lobby_state" (
     "lobby_code" TEXT PRIMARY KEY,
     "tick" INTEGER NOT NULL DEFAULT 0,
     "event_seq" INTEGER NOT NULL DEFAULT 0,
     "snapshot" JSONB NOT NULL,
     "updated_at" TIMESTAMP NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS "parties" (
     "id" SERIAL PRIMARY KEY,
     "code" TEXT NOT NULL UNIQUE,
     "leader_name" TEXT NOT NULL,
     "stack_id" TEXT NOT NULL,
     "lobby_code" TEXT,
     "lobby_name" TEXT,
     "created_at" TIMESTAMP NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS "lobby_players_lobby_idx" ON "lobby_players" ("lobby_code")`,
  `CREATE INDEX IF NOT EXISTS "lobby_players_player_idx" ON "lobby_players" ("player_id")`,
];

/**
 * One-time column migration for databases created by an earlier build, whose
 * `lobbies` table predates the multiplayer columns. Safe to run repeatedly.
 */
const MIGRATIONS: Array<{ column: string; ddl: string }> = [
  { column: "stack_size", ddl: `ALTER TABLE "lobbies" ADD COLUMN IF NOT EXISTS "stack_size" INTEGER NOT NULL DEFAULT 5` },
  { column: "team_mode", ddl: `ALTER TABLE "lobbies" ADD COLUMN IF NOT EXISTS "team_mode" TEXT NOT NULL DEFAULT 'ffa'` },
  { column: "bot_fill", ddl: `ALTER TABLE "lobbies" ADD COLUMN IF NOT EXISTS "bot_fill" INTEGER NOT NULL DEFAULT 5` },
  { column: "host_player_id", ddl: `ALTER TABLE "lobbies" ADD COLUMN IF NOT EXISTS "host_player_id" TEXT` },
  { column: "status", ddl: `ALTER TABLE "lobbies" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'waiting'` },
  { column: "bot_hits", ddl: `ALTER TABLE "lobby_players" ADD COLUMN IF NOT EXISTS "bot_hits" JSONB NOT NULL DEFAULT '[]'` },
  { column: "parties.lobby_code", ddl: `ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "lobby_code" TEXT` },
  { column: "parties.lobby_name", ddl: `ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "lobby_name" TEXT` },
];

const globalForSchema = globalThis as typeof globalThis & {
  __arenaSchemaReady?: Promise<void>;
};

/**
 * Ensure the tables exist. Concurrent callers share one promise; a failure
 * clears the cache so the next request can retry instead of being poisoned.
 */
export function ensureSchema(): Promise<void> {
  if (!globalForSchema.__arenaSchemaReady) {
    globalForSchema.__arenaSchemaReady = (async () => {
      const db = getDb();
      for (const stmt of DDL) {
        await db.execute(sql.raw(stmt));
      }
      // Upgrade older databases in place.
      for (const m of MIGRATIONS) {
        await db.execute(sql.raw(m.ddl));
      }
    })().catch((err) => {
      globalForSchema.__arenaSchemaReady = undefined;
      throw err;
    });
  }
  return globalForSchema.__arenaSchemaReady;
}

/**
 * Forget the memoized result so the next call re-runs the DDL. Called when a
 * query reports a missing relation — e.g. someone dropped a table, or the
 * database was swapped underneath a long-lived serverless instance.
 */
export function invalidateSchema(): void {
  globalForSchema.__arenaSchemaReady = undefined;
}

/** True when the error is "table does not exist". */
export function isMissingRelation(err: unknown): boolean {
  const msg = ((err as { message?: string } | null)?.message ?? String(err)).toLowerCase();
  const cause = (err as { cause?: { message?: string } } | null)?.cause?.message?.toLowerCase() ?? "";
  return msg.includes("does not exist") || cause.includes("does not exist");
}

/** True when the lobbies/scores tables are present (used by /api/health). */
export async function schemaExists(): Promise<boolean> {
  try {
    const db = getDb();
    const res = await db.execute<{ ok: boolean }>(
      sql`select to_regclass('public.lobbies') is not null and to_regclass('public.scores') is not null as ok`,
    );
    const rows = (res as unknown as { rows?: Array<{ ok: boolean }> }).rows ?? [];
    return Boolean(rows[0]?.ok);
  } catch {
    return false;
  }
}
