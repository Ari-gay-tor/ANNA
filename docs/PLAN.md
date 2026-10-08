# ANNA V0 build plan

Product intent lives in `docs/SPEC.md`. This file says what gets built, in what order, and what proves each slice is done.

**Roles:** the PM agent writes each slice brief and reviews the work. An implementer agent builds the slice. Ari approves each slice before the next one starts. Nothing outside this file gets built without Ari's OK.

## Status

**V0 is done (2026-10-07).** Slice 6 (one-click app) was added at Ari's request before the use week, because needing a terminal to open ANNA would undermine the experiment (spec §32: do users choose to ask ANNA when stuck?). After Slice 6: one week of daily use, logging failures in `failure-modes.md` (spec §48).

| Slice | What | Status |
|---|---|---|
| 1 | Scaffold, chat loop, persistence, provider interface | done: reviewed, Ari manual check passed 2026-10-07 (send, reply, restart, still there) |
| 1b | Gemini timeout fallthrough, OpenAI-compatible provider (local Ollama/LM Studio), provider fallback chain, `docs/providers.md` | done: reviewed, live Gemini verified (added at Ari's request 2026-10-07); live local-model call untested (no Ollama model installed) |
| 2 | Memory | done: reviewed, Ari manual Tests A + D + "tired" check passed 2026-10-07 |
| 3 | Clarification and options | done: reviewed, Ari manual Tests B + C passed 2026-10-07 |
| 4 | Reminders | done: reviewed; live eval + Ari's Test E and Cancel checks passed 2026-10-07 |
| 5 | Behavior evals, failure log, acceptance walkthrough | done: first live eval 24/29, fixes re-run; V0 definition of done 27/27 (2026-10-07) |
| 6 | One-click app on Ari's PC (own window, auto-start at login, Windows reminder toasts) | done: installed by Ari, toast confirmed on screen 2026-10-08; auto-start at login not yet confirmed |
| 7 | UI polish: look & feel + smoother flow (added at Ari's request 2026-10-08; no engagement hooks: spec §14/§29) | in progress |

## Stack (decided)

| Choice | Why |
|---|---|
| Next.js (App Router) + TypeScript, Node 22 | Spec §20. Route handlers are the only server surface. |
| Prisma 6 + SQLite | Same as Wallflower, known to work here. Not Prisma 7 (config model changed). |
| zod | Validates every LLM output and every API body. |
| vitest | Unit and data-layer tests. Data tests use a temp SQLite file. |
| Plain CSS (one `globals.css` + CSS modules) | No UI framework. Spec §19: no elaborate UI. |
| `@google/genai`, Gemini first | Free tier, key already exists. Adapter pattern copied from Wallflower's `src/ai/gemini.ts` (503 fallback chain, no SDK retries, 429 = stop). |
| luxon (Slice 4 only) | DST-correct local-time to UTC. The only extra runtime dependency. |
| TypeScript version | Use whatever `next build` supports. If TS 7 breaks Next's type check, pin TS 5.x and note it in `docs/decisions/`. |

Not used: Tailwind, component libraries, state libraries, ORMs other than Prisma, vector DBs, auth, streaming.

## Architecture

```
src/app/            Next pages + route handlers. Thin: parse with zod, call runtime, return JSON.
src/components/     React UI.
src/core/           Pure logic. MUST NOT import next, react, @prisma/client, src/data, src/app, node:fs.
  domain/           Types and zod schemas (AnnaResponse, operations).
  runtime/          createAnna(deps): handleMessage, generateReply. Context building, op validation, op execution.
  llm/              LLMProvider interface, gemini.ts, fake.ts.
  ports/            Repository interfaces.
  prompts/          System prompt (short; spec §27).
  time/             (Slice 4) local time resolution.
src/data/           Prisma client + repository implementations of core/ports.
src/server/         Composition root (builds the runtime from env) and the reminder poller (Slice 4).
tests/              vitest. tests/architecture.test.ts enforces the src/core import rule.
evals/              (Slice 5) behavior corpus + runner + reports.
```

Request flow (spec §24):

1. `handleMessage({conversationId?, text, selectedOption?})` saves the user message, then calls `generateReply(conversationId)`.
2. `generateReply` loads the last 20 messages, builds context (now, user timezone, memories from Slice 2), and calls `LLMProvider.generate` with a JSON schema.
3. The output is parsed with zod. If invalid, retry once. If still invalid, return a plain-text fallback reply with no operations.
4. Operations are validated, then executed. Results are stored on the assistant message as chips.
5. The assistant message is saved and returned.

If the provider fails, the user message stays saved and no assistant message is written. The UI shows the error and a Retry button that calls `generateReply` again, without duplicating the user message.

The LLM never touches the database. It can only propose the operation types defined in `core/domain`, and the runtime decides.

## Database schema (final V0 shape; each slice adds only its own tables)

```prisma
model Conversation {
  id        String    @id @default(cuid())
  title     String                       // first user message, truncated to 60 chars; no LLM call
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  messages  Message[]
}

model Message {
  id             String   @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String   // "user" | "assistant"
  content        String
  clarification  String?  // JSON text {question, options[]}            (Slice 3)
  operations     String?  // JSON text: executed op results for chips     (Slice 2+)
  selectedOption Boolean  @default(false) // user message came from a tapped option (Slice 3)
  createdAt      DateTime @default(now())
  @@index([conversationId, createdAt])
}

model Memory {                                                            // Slice 2
  id                   String   @id @default(cuid())
  type                 String   // fact | preference | goal | commitment | pattern
  statement            String
  confidence           Float    // set by runtime, not trusted from model
  origin               String   // stated | inferred | edited
  evidenceQuote        String?
  sourceConversationId String?
  sourceMessageId      String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}

model Reminder {                                                          // Slice 4
  id                   String    @id @default(cuid())
  text                 String
  dueAt                DateTime  // UTC instant
  timezone             String    // IANA zone used to resolve it
  status               String    // pending | fired | cancelled
  firedAt              DateTime?
  missed               Boolean   @default(false) // fired >2 min late (app was closed)
  acknowledgedAt       DateTime?
  sourceConversationId String?
  sourceMessageId      String?
  createdAt            DateTime  @default(now())
  @@index([status, dueAt])
}

model Setting { key String @id  value String }  // "timezone"
```

JSON is stored as text and parsed with zod on read. Enum-like fields are strings validated in `core/domain`. There is no User table (single user, no auth). Goals and commitments are `Memory.type`, not tables.

---

## Slice 1: Scaffold, chat loop, persistence, provider interface

**Builds:**

- The Next app, Prisma with `Conversation`, `Message` and `Setting`, and the first migration.
- `LLMProvider` interface: `generate({system, messages, jsonSchema?, maxOutputTokens?}) → {text, model, usage}`, plus typed errors (UNAVAILABLE, RATE_LIMITED, BLOCKED, BAD_RESPONSE, CONFIG).
- Gemini adapter: 503 fallback chain, never retry 429.
- Fake adapter: canned or scripted responses, used by tests and by `ANNA_PROVIDER=fake` for offline UI work.
- `AnnaResponse` zod schema, `{ message }` only for now.
- Runtime with `handleMessage` and `generateReply`, the system prompt (spec §27 contract plus "be brief"), and a context block with the current local date/time and timezone.
- The browser sends its IANA timezone, which is saved to `Setting`.
- UI with three parts:
  - a sidebar listing conversations, newest first, with a "New conversation" button;
  - a chat pane;
  - an error state with Retry.
- `.env.example` with `ANNA_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` and `DATABASE_URL`.
- A README with run steps.

**Acceptance (proof):**

1. `npm run typecheck`, `npm test` and `npm run build` all pass. Paste the output.
2. Runtime tests with the fake provider and temp DB cover four cases:
   - a message round-trip saves 2 messages;
   - provider failure keeps the user message and writes no assistant message;
   - Retry produces exactly 1 assistant message;
   - invalid JSON is retried once, then falls back to plain text.
3. A Gemini adapter test with a mocked SDK client: 503 falls through the chain, and 429 throws RATE_LIMITED without retrying.
4. `tests/architecture.test.ts` fails if any file in `src/core` imports a forbidden module.
5. Ari runs it manually: send → reply, restart `npm run dev` → conversation still there, new conversation works.

**Not building:** memory, options, reminders, streaming, markdown rendering (plain text with line breaks only), settings page, model picker, styling beyond clean and readable, dark mode, auth.

**Stop:** when 1–5 pass. No polish.

## Slice 2: Memory

**Builds:**

- The `Memory` table and repository.
- Operations `memory.create {type, statement, evidenceQuote, origin}` and `memory.update {memoryId, statement, evidenceQuote}`. The model cannot delete memories. Deleting is user-only, from the Memory page.
- Validation rules:
  - `evidenceQuote` must be a normalized substring of the current user message.
  - Statements are at most 300 chars, with at most 3 memory ops per turn.
  - `update` may only target a memory id that was in this turn's context.
  - `pattern` is allowed only with origin `stated` (the user said it about themselves). Inferred patterns are rejected in V0.
  - An exact normalized duplicate statement is skipped.
- The runtime sets confidence: `stated` = 0.9, `inferred` = min(model value, 0.6), `edited` = 1.0.
- Retrieval includes all memories up to 60, ordered preference → goal → commitment → fact → pattern, newest first within each type. Over 60, the rest are ranked by keyword overlap with the current message. Memories go into the prompt with id, type, statement and date.
- The prompt tells the model to:
  - write absolute dates into statements ("Friday 2026-10-09", not "Friday");
  - use a memory only when it is relevant;
  - never claim to know something not in context.
- Chips on assistant messages ("Remembered: …" / "Updated: …") with a Forget button.
- If an op with origin `stated` is rejected, the runtime appends one line saying it wasn't saved. Rejected inferred ops are only logged.
- A `/memory` page grouped by type. Each memory shows its source (date, link to the conversation, quote) and confidence (High/Med/Low), and can be edited (origin becomes `edited`) or deleted.

**Acceptance (proof):**

1. Unit tests cover the validation rules:
   - quote not in message → rejected;
   - inferred pattern → rejected;
   - update of an id not in context → rejected;
   - fourth op → rejected;
   - duplicate → skipped;
   - confidence is set by the runtime.
2. Context test: a deleted memory is absent from the next prompt, and an edited memory appears with its new text.
3. Ari runs spec Test A and Test D manually against Gemini. The log goes in `docs/acceptance-log.md`.
4. Ari checks manually that "I'm tired today" creates no memory.

**Not building:** embeddings, FTS, memory merging, Goal/Commitment tables, model-initiated forget, memory export, "why do you think that" chat command.

**Stop:** when 1–4 pass.

## Slice 3: Clarification and options

**Builds:**

- `AnnaResponse.clarification {question, options[0..4]}`.
- The runtime trims and dedupes options, drops any variant of "not sure", and always appends "Not sure".
- Option buttons show only on the latest assistant message. Tapping one sends the option text as a user message with `selectedOption=true`. Free text still works.
- Two prompt hints, injected by the runtime:
  1. After 2 consecutive clarifying assistant turns: "Do not ask another question. Give your best answer and state your assumptions."
  2. When the last user message is a tapped "Not sure": "Narrow it down: offer concrete guesses or an easier either/or question. Do not ask the user to rephrase."

**Acceptance (proof):**

1. Unit tests cover:
   - "Not sure" is always present exactly once;
   - there are at most 5 buttons;
   - a tapped option is stored with `selectedOption`;
   - both prompt hints trigger under the right conditions and not otherwise.
2. Ari runs spec Test B and Test C manually and logs them.

**Not building:** multi-select, forms, wizards, voice, option icons.

**Stop:** when 1–2 pass.

## Slice 4: Reminders

**Builds:**

- The `Reminder` table.
- Operation `reminder.create {text, evidenceQuote, localDateTime "YYYY-MM-DDTHH:mm" | inMinutes 1..10080}`, at most 1 per turn.
- The runtime resolves the time in the user's saved timezone with luxon. It rejects:
  - times in the past;
  - DST-gap times that don't exist;
  - empty text;
  - a quote that isn't in the user message.
- DST-ambiguous times take the earlier instant (documented).
- If a reminder op is rejected, the runtime appends a line saying it wasn't set and why. The reply must never claim a reminder exists when it doesn't.
- A chip ("Reminder set: Call Dad · Today 6:00 PM") with a Cancel button.
- `/reminders` page listing pending reminders (with cancel) and recently fired ones.
- The poller is started from `instrumentation.ts`. It is guarded by a `globalThis` flag so hot reload can't start a second one. It ticks every 15 s, and fires through a conditional update (`status = pending` → `fired`) so a reminder can't fire twice. It sets `missed` if a reminder fires more than 2 min late.
- The UI polls every 15 s for fired, unacknowledged reminders. It shows a banner, "You asked me to remind you to call Dad.", with a Dismiss button, plus a browser Notification if the user granted permission. Permission is asked only from a button, never automatically.

**Acceptance (proof):**

1. Unit tests for the time resolver cover:
   - `America/New_York` 2026-11-01 01:30 (ambiguous, earlier instant);
   - 2027-03-14 02:30 (doesn't exist, rejected);
   - `Asia/Kolkata`;
   - `UTC`;
   - past time rejected;
   - `inMinutes`.
2. Scheduler tests:
   - two overlapping ticks fire a reminder once;
   - a cancelled reminder never fires;
   - a reminder that was overdue on startup fires with `missed=true`.
3. Ari runs spec Test E manually with a reminder 2 minutes out, and logs it.

**Not building:** recurring reminders, snooze, editing a reminder (cancel + recreate), push/email/SMS/desktop app delivery, model-initiated reminders without an explicit request.

**Stop:** when 1–3 pass.

## Slice 5: Behavior evals, failure log, acceptance walkthrough

**Builds:**

- `evals/cases.json` with at least 20 cases covering every spec §30 category plus Tests A–F. Each case can seed memories and prior messages.
- `npm run eval` runs every case against the real provider on a fresh temp DB. Its automatic checks:
  - word count limit;
  - at most 1 question unless it's a clarification;
  - expected ops: none, memory, or reminder;
  - forbidden phrases.
- The runner writes `evals/reports/<date>.md` for Ari to read.
- `failure-modes.md` (template already in place) is filled from the eval report.
- `docs/v0-acceptance.md` walks through spec §40 line by line, with evidence for each line.

**Acceptance (proof):**

1. `npm run eval` completes, and the report exists.
2. Test F passes automatically (no ops).
3. Every §40 line has evidence or is marked as failing with a reason.

**Not building:** LLM-as-judge, dashboards, CI eval runs, prompt auto-tuning.

**Stop:** when 1–3 pass. Then building stops. Ari uses ANNA daily for 1 week and logs failures (spec §48) before any new work is planned.

---

## Decisions log (short; longer ones go in docs/decisions/)

- 2026-10-07: New repo, not inside Wallflower (different product; Discord is out of V0 scope).
- 2026-10-07: Gemini first. The Anthropic adapter comes after the Slice 5 evals, if they show it's needed.
- 2026-10-07: Reminders fire only while the ANNA server is running and show in-app. Accepted for V0.
- 2026-10-07: TTS stays out of V0. See `docs/backlog.md`.
- 2026-10-07: Next 16 works with TypeScript 7, so no TS pin was needed.
- 2026-10-07: The history window sent to the model always starts on a user turn (leading assistant turns are dropped).
- 2026-10-07: Invalid model output is retried once. Provider errors (including empty responses) are not retried; the UI shows Retry.
- 2026-10-07: Slice 1b. Gemini falls through on 503, 504 and timeouts (20 s per model). An OpenAI-compatible provider covers local models. `ANNA_PROVIDER` can list several providers; fallback happens only on UNAVAILABLE/RATE_LIMITED, never on CONFIG.
- 2026-10-07: Gemini free-tier limits are per model (gemini-3.5-flash: 20 requests/day). A 429 now moves on to the next model in the chain (no billing on the key, so this costs nothing); the same model is still never retried. This supersedes the earlier "429 = stop" rule.
