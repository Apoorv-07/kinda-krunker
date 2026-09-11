# Deploying BLOCKSHOT ARENA to Vercel

The app is Vercel-ready: the build never requires a live database (the Postgres
client is created lazily on the first request), so `vercel build` succeeds even
without env vars. You only need a Postgres database and one env var at runtime.

## 1. Create a Postgres database

Any of these work:

- **Vercel Postgres** (recommended, one click): Vercel dashboard → your project
  → Storage → `Add Integration` → Neon/Vercel Postgres.
- **Neon** (free tier): create a project at [neon.tech](https://neon.tech).
- **Supabase**: create a project, use the connection string from Settings → Database.

## 2. Create the tables (once)

Run [`schema.sql`](./schema.sql) in your database's SQL console:

- Neon: Dashboard → SQL Editor → paste `schema.sql` → Run
- Supabase: Dashboard → SQL Editor → paste → Run
- psql: `psql "$DATABASE_URL" -f schema.sql`

(Alternatively, with the env var set locally: `npx drizzle-kit push`.)

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

- **`DATABASE_URL is not set`** at runtime → the env var is missing or added
  for the wrong environment scope. Rebuild after adding it.
- **`relation "lobbies" does not exist`** → run `schema.sql` first.
- **connection timeout** on serverless → switch to the pooled connection
  string (see note above).
