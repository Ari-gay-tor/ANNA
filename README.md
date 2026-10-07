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

- **Gemini (default).** Put your key in `.env` as `GEMINI_API_KEY`. Models and the fallback chain (429 quota, 503, 504 or timeout moves to the next model; free-tier limits are per model, so more models means more free replies per day) are set by `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` and `GEMINI_TIMEOUT_MS`. Use a key from a Google project without billing, so quota exhaustion can only fail, never charge. If the key is missing, the UI shows a clear error instead of crashing.
- **Local or other OpenAI-compatible model** (Ollama, LM Studio, OpenRouter, Groq): `ANNA_PROVIDER=openai-compatible` plus `OPENAI_COMPAT_BASE_URL` and `OPENAI_COMPAT_MODEL`.
- **Several, with fallback:** `ANNA_PROVIDER=gemini,openai-compatible` uses the next one only when the previous is unavailable or out of quota.
- **No key needed.** Set `ANNA_PROVIDER=fake` in `.env` and restart. ANNA then answers with a canned echo reply, which is enough to work on the UI and the conversation flow offline.

Restart `npm run dev` after changing `.env`. Step-by-step setup for each of these, including how to see which model answered: [docs/providers.md](docs/providers.md).

## Tests and checks

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest; uses a temporary SQLite database, never dev.db
npm run build       # production build (also type-checks)
```

On a fresh clone the first `npm test` creates its template database from `prisma/migrations`, so no setup beyond `npm install` is needed.

## Behavior evals

`npm run eval` sends the cases in `evals/cases.json` (spec Tests A-F, the spec 28 examples, every spec 30 situation, plus restraint and safety cases) to the **real model** and writes a report for you to read. It is not part of `npm test`.

```bash
npm run eval                                  # all cases
EVAL_ONLY=test-e-reminder,test-f-restraint npm run eval   # a subset, by id
EVAL_DELAY_MS=8000 npm run eval               # slower pacing (default 4000 ms between model calls)
ANNA_PROVIDER=fake npm run eval               # no model: checks the plumbing only, most cases will fail
```

- **Cost:** 29 cases, 32 model calls (one per turn; an invalid-JSON retry adds one). At the default pacing that is about 5 minutes. The calls come out of the same free Gemini quota as the app and Wallflower, so don't run it right before you need the quota. If two calls in a row come back `RATE_LIMITED`, the run stops and writes a partial report (and exits non-zero).
- **Each case** runs on a fresh temporary database (never `dev.db`) with a fixed clock (Wednesday 2026-10-07 10:00 in the case's timezone, Asia/Kolkata unless the case says otherwise), so results do not depend on the day you run it.
- **Reports** go to `evals/reports/<YYYY-MM-DD-HHmm>.md` (gitignored). The top has the pass rate overall and by category, the models that answered, and median and max latency. Failed cases come first. Each case shows the full transcript, every check with a tick or cross and the reason, word count, latency, model, and a blank "Reviewer notes:" line for you.
- **Automatic checks** are word count (default 80), question marks (default 1), whether a clarification was asked, the exact set of operations (memory, reminder), forbidden phrases, required phrases, and the local due time of a reminder. They catch rule breaks, not quality: read the transcripts. A failing check is a prompt to look, not a verdict.
- Failures worth keeping go in `failure-modes.md`.

## Layout

`src/core` is pure logic and must not import Next, React, Prisma, or Node's `fs` (enforced by `tests/architecture.test.ts`). `src/data` holds the Prisma repositories, `src/server` the composition root, `src/app` the pages and API routes, and `src/components` the UI.
