# ANNA

ANNA is a personal assistant that reduces cognitive load: it asks the smallest useful question, then gives the clearest next step. This is V0, a single-user web app; product intent is in `docs/SPEC.md` and the build plan is in `docs/PLAN.md`.

## Setup

Requires Node 22 or newer.

```bash
npm install                 # also runs `prisma generate`
cp .env.example .env        # then edit .env (see below)
npm run db:deploy           # creates prisma/dev.db from the migrations
npm run dev                 # http://localhost:3000
```

For development you can use `npm run db:migrate` instead of `db:deploy`; it also applies new migrations and regenerates the client.

### Providers

- **Gemini (default).** Put your key in `.env` as `GEMINI_API_KEY`. Models and the 503 fallback chain are set by `GEMINI_MODEL` and `GEMINI_FALLBACK_MODELS`. Use a key from a Google project without billing, so quota exhaustion can only fail, never charge. If the key is missing, the UI shows a clear error instead of crashing.
- **No key needed.** Set `ANNA_PROVIDER=fake` in `.env` and restart. ANNA then answers with a canned echo reply, which is enough to work on the UI and the conversation flow offline.

Restart `npm run dev` after changing `.env`.

## Tests and checks

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest; uses a temporary SQLite database, never dev.db
npm run build       # production build (also type-checks)
```

On a fresh clone the first `npm test` creates its template database from `prisma/migrations`, so no setup beyond `npm install` is needed.

## Layout

`src/core` is pure logic and must not import Next, React, Prisma, or Node's `fs` (enforced by `tests/architecture.test.ts`). `src/data` holds the Prisma repositories, `src/server` the composition root, `src/app` the pages and API routes, and `src/components` the UI.
