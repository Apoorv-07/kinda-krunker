import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

// Combat lobbies created by players. Each lobby has a unique code and a unique
// map seed so every lobby plays on its own generated arena.
export const lobbies = pgTable("lobbies", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  hostName: text("host_name").notNull(),
  map: text("map").notNull(), // 'random' | 'yard' | 'neon' | 'dusk'
  seed: integer("seed").notNull(),
  mode: text("mode").notNull(), // 'dm' (free-for-all deathmatch)
  botCount: integer("bot_count").notNull(),
  difficulty: text("difficulty").notNull(), // 'easy' | 'normal' | 'hard'
  scoreLimit: integer("score_limit").notNull(),
  timeLimit: integer("time_limit").notNull(), // seconds
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Global high-score table (mirrored locally in localStorage on the client).
export const scores = pgTable("scores", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  score: integer("score").notNull(),
  kills: integer("kills").notNull(),
  deaths: integer("deaths").notNull(),
  map: text("map").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Lobby = typeof lobbies.$inferSelect;
export type NewLobby = typeof lobbies.$inferInsert;
export type ScoreRow = typeof scores.$inferSelect;
export type NewScore = typeof scores.$inferInsert;
