-- BLOCKSHOT ARENA — database schema
-- Run this once in your database's SQL console (Vercel Postgres / Neon / Supabase)
-- to create the tables. It is idempotent (CREATE TABLE IF NOT EXISTS).

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
);

CREATE TABLE IF NOT EXISTS "scores" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "kills" INTEGER NOT NULL,
  "deaths" INTEGER NOT NULL,
  "map" TEXT NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT now()
);
