# ANNA: rules for agents working in this repo

Read `docs/PLAN.md` first. Read `docs/SPEC.md` for product intent. Build only the slice you were assigned.

## Hard rules

1. **No scope expansion.** If something isn't in your slice's "Builds" list, don't build it. If you think it's needed, stop and say so in your report.
2. **Layering.** `src/core` never imports `next`, `react`, `@prisma/client`, `src/data`, `src/app`, `src/components`, or `node:fs`. `tests/architecture.test.ts` enforces this.
3. **The LLM never mutates state.** Model output is parsed with zod, and operations go through the validators in `src/core/runtime`. The runtime decides, not the model.
4. **No new dependencies** beyond those listed in PLAN.md "Stack" without asking.
5. **Don't commit.** The PM reviews and commits.
6. **Never print or log API keys.** `.env` and `.env.local` are gitignored.
7. **Prove it.** Your report must include the real output of `npm run typecheck`, `npm test`, and (Slice 1+) `npm run build`. If something fails, say so plainly. Don't call it done.

## `ANNA-tts/`

This is Ari's Kokoro text-to-speech prototype, written in Python. It is not part of V0 and is not wired into the app. Don't modify it or integrate it unless the slice brief says to (see `docs/backlog.md`). The Node build, typecheck and tests ignore it.

## Style

- Small files, plain functions, descriptive names. Comments only where the why isn't obvious.
- Match existing code. Wallflower (`../wallflower`) is the reference for the Gemini adapter and test setup patterns.
- Tests: vitest, files in `tests/`. Data-layer tests use a temp SQLite file, never `dev.db`.

## Commands

```bash
npm run dev        # Next dev server
npm run typecheck
npm test
npm run build
npm run db:migrate # prisma migrate dev
```
