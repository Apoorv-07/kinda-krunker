# Deploying BLOCKSHOT ARENA to Vercel

## Playing with friends (multiplayer)

The game supports real online play with **stacks** of up to 5 (solo / duo /
trio / squad / 5-stack).

**How it works**

- One player creates a match and becomes the **host**. The host runs the
  simulation (bots, bot fire, match timer) and publishes the world state.
- Everyone else sends their own position/health and receives everyone else's,
  ~10× per second over HTTP. No WebSocket is needed, so it runs on Vercel's
  serverless functions.
- In **Teams** mode your party is your team — everyone who joins with your
  party code spawns on your side. In **Free-for-all** every player is hostile.
- If the host disconnects, the server automatically promotes another player and
  the match keeps running.

**Steps**

1. Menu → **Play with Friends** → pick your stack size (1–5) and mode.
2. (Optional) **Create party** → share the 5-character code. Friends enter it
   under *Join a friend* so they land on your team.
3. **Create Match** → the waiting room shows the **lobby code**.
4. Friends open the same URL → **Lobby List** → Join, or use the lobby code.

**Latency expectations.** Because state travels over polling, expect roughly
100–250 ms of perceived delay on other players' movement (smoothed by client
interpolation). Your own movement and shooting are instant. Bots are simulated
by the host, so the host has the most accurate view. This is a deliberate
trade-off that keeps the game deployable to Vercel with zero extra
infrastructure; a dedicated WebSocket/WebRTC server would be needed for
tournament-grade netcode.

---

The app is Vercel-ready: the build never requires a live database (the Postgres
client is created lazily on the first request), so `vercel build` succeeds even
without env vars. You only need a Postgres database and one env var at runtime.

## 1. Create a Postgres database

Any of these work:

- **Vercel Postgres** (recommended, one click): Vercel dashboard → your project
  → Storage → `Add Integration` → Neon/Vercel Postgres.
- **Neon** (free tier): create a project at [neon.tech](https://neon.tech).
- **Supabase**: create a project, use the connection string from Settings → Database.

## 2. Create the tables — **automatic, no action needed** ✅

The app creates its own tables. On the first request it runs idempotent
`CREATE TABLE IF NOT EXISTS` statements for `lobbies` and `scores` (plus two
indexes), then caches the result for the life of the process. A brand-new
empty database works with nothing more than `DATABASE_URL`.

[`schema.sql`](./schema.sql) is still there if you prefer to create them by
hand (Neon: SQL Editor → paste → Run), but you do **not** have to.

> Requires the database user to have `CREATE` permission — the default on
> every free tier.

## 3. Set the environment variable

Vercel dashboard → project → **Settings → Environment Variables** → add:

```
DATABASE_URL=postgresql://user:password@host:5432/db
```

Add it for **Production**, **Preview**, and **Development** (or "All").

> **Serverless note:** if you use Neon/Vercel Postgres, prefer the **pooled**
> connection string (the host containing `-pooler`, port 5432) so serverless
> functions can burst connections. Plain strings also work but may hit
> connection limits under load.

## 4. Deploy

```bash
npx vercel --prod
```

or connect the GitHub repo (Apoorv-07/kinda-krunker) in Vercel — every push to
`main` auto-deploys. The `npm run build` step needs no database, so deploys
will not fail on missing env vars.

## Local dev

```bash
cp .env.example .env   # put your DATABASE_URL in .env
npm install
npx drizzle-kit push   # create tables if new database
npm run dev
```

## Troubleshooting

### ✅ Check `/api/health` first

Visit `https://your-app.vercel.app/api/health`. It reports *why* the database
is not connected (without ever exposing the connection string):

| Response | Meaning | Fix |
|---|---|---|
| `{"ok":true,"db":"reachable"}` | Working | Nothing to do |
| `envConfigured:false` | Deployment has **no** env var | Redeploy (see below) |
| `envConfigured:true` + `detail` | Var exists but connection failed | Check host/SSL/password |

### 🔴 `DATABASE_URL is not set` even though it's in the dashboard

**This is almost always a missing redeploy.** Vercel snapshots environment
variables **per deployment**. Adding (or editing) env vars never changes a
deployment that was already built — you must trigger a new one:

```bash
npx vercel --prod
```

or Dashboard → **Deployments** → ⋯ on the latest → **Redeploy** → confirm.

Order matters: add the env var **first**, then redeploy.

### 🟠 `relation "lobbies" does not exist` / `Failed query: select "id" from "lobbies"`

The tables were missing. **This is now self-healing** — the app creates them on
first use, so hitting `/api/health` once (or just loading the menu) fixes it.
If you still see it, the database user lacks `CREATE` permission; run
[`schema.sql`](./schema.sql) manually instead.

> Note: Drizzle wraps driver errors as `Failed query: <sql>`, which hides the
> real cause. The API now unwraps the underlying `cause` into its `error`
> field, and `/api/health` reports the failing link explicitly.

### 🟡 Pooled vs unpooled (Neon)

The Vercel–Neon integration sets several variables. `DATABASE_URL` is the
**pooled** endpoint (PgBouncer) — that is what you want for serverless, and it
is what this app uses. `DATABASE_URL_UNPOOLED` is the direct connection.

If you ever see errors mentioning `prepared statement ... already exists`,
you are pointed at a transaction-mode pooler; the app already keeps its pool
small and TLS explicit, but switching `DATABASE_URL` to the pooled host is the
right fix.

### ⚪ The game works even if the database is down

The arena generation, bots, weapons and scoring are all client-side. If the
lobby API is unreachable, **Quick Play** and **Create Lobby** fall back to a
locally generated "offline arena" so you can keep playing — you just won't
appear in the shared lobby list or global leaderboard until the DB connects.
