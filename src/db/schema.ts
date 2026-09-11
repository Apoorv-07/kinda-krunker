import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  real,
  index,
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
  mode: text("mode").notNull().default("dm"), // 'dm' | 'teams'
  // Multiplayer settings
  stackSize: integer("stack_size").notNull().default(5), // max players per stack/team (1-5)
  teamMode: text("team_mode").notNull().default("ffa"), // 'ffa' | 'teams'
  botFill: integer("bot_fill").notNull().default(5),
  /** legacy column from the bots-only build, kept in sync with botFill */
  botCount: integer("bot_count").notNull().default(5),
  difficulty: text("difficulty").notNull(), // 'easy' | 'normal' | 'hard'
  scoreLimit: integer("score_limit").notNull(),
  timeLimit: integer("time_limit").notNull(), // seconds
  status: text("status").notNull().default("waiting"), // 'waiting' | 'live' | 'ended'
  hostPlayerId: text("host_player_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// One row per connected player per lobby. Doubles as the roster AND the
// player's live transform — every sync tick upserts the caller's own row.
export const lobbyPlayers = pgTable(
  "lobby_players",
  {
    id: serial("id").primaryKey(),
    lobbyCode: text("lobby_code").notNull(),
    playerId: text("player_id").notNull(),
    name: text("name").notNull(),
    color: integer("color").notNull(),
    stackId: text("stack_id").notNull(), // party identifier (stack = team in 'teams' mode)
    team: integer("team").notNull().default(0),
    isHost: boolean("is_host").notNull().default(false),
    ready: boolean("ready").notNull().default(false),

    // live transform / combat state (client-authoritative per player)
    x: real("x").notNull().default(0),
    y: real("y").notNull().default(0),
    z: real("z").notNull().default(0),
    yaw: real("yaw").notNull().default(0),
    pitch: real("pitch").notNull().default(0),
    hp: integer("hp").notNull().default(100),
    alive: boolean("alive").notNull().default(true),
    weapon: text("weapon").notNull().default("ar"),

    kills: integer("kills").notNull().default(0),
    deaths: integer("deaths").notNull().default(0),
    score: integer("score").notNull().default(0),
    streak: integer("streak").notNull().default(0),
    // Guests can't mutate host-simulated bots directly, so they queue bot hits
    // here; the host drains them and applies the damage locally.
    botHits: jsonb("bot_hits").notNull().default([]),

    joinedAt: timestamp("joined_at").defaultNow().notNull(),
    lastSeen: timestamp("last_seen").defaultNow().notNull(),
  },
  (t) => [
    index("lobby_players_lobby_idx").on(t.lobbyCode),
    index("lobby_players_player_idx").on(t.playerId),
  ],
);

// Host-published world snapshot: bots, kill feed and damage events.
// Single row per lobby, overwritten every host tick.
export const lobbyState = pgTable("lobby_state", {
  lobbyCode: text("lobby_code").primaryKey(),
  tick: integer("tick").notNull().default(0),
  eventSeq: integer("event_seq").notNull().default(0),
  snapshot: jsonb("snapshot").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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

// Short-lived party codes so friends can group into a stack before joining.
export const parties = pgTable("parties", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  leaderName: text("leader_name").notNull(),
  stackId: text("stack_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Lobby = typeof lobbies.$inferSelect;
export type NewLobby = typeof lobbies.$inferInsert;
export type LobbyPlayer = typeof lobbyPlayers.$inferSelect;
export type ScoreRow = typeof scores.$inferSelect;
export type Party = typeof parties.$inferSelect;
