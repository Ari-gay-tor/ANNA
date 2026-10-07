# V0 acceptance walkthrough

Spec section 40 (V0 Definition of Done), one line at a time, with the evidence for each. Written at the end of Slice 5, 2026-10-07.

## How to read this

| Mark | Meaning |
|---|---|
| ✅ proven | Deterministic behavior proven by a named test against a real temp SQLite database, or a real-model behavior that Ari ran by hand and logged in `docs/acceptance-log.md`. |
| ⚠️ partly | Some of the line is proven; the rest is named in the evidence (for example only one manual sample, a UI that was not checked by hand, or only the fake provider). |
| ❌ failing | Checked and it does not work. None at the time of writing. |
| ⏳ pending live run | The deciding evidence is a live-model run that has not happened yet. Fake-provider tests are listed, but they do not make the line ✅. |

A line that depends on what the real model says and has only fake-provider evidence is never ✅. The fake provider returns scripted text, so it proves the runtime, not the behavior.

## Where the live evidence stands

- **Behavior evals: first live run on 2026-10-07, on `gemini-3.5-flash-lite` only: 24/29** (`evals/reports/2026-10-07-2155.md`). Of the 5 failures, 2 were real bugs, now fixed (a false "updated the reminder" claim, and a duplicate question). 2 were over-strict checks, now loosened. 1 is a judgment call left open (`good-stuck-start`). Re-run of those 5 (`2026-10-07-2201.md`): 4 pass, and `good-stuck-start` still fails. Not yet run on `gemini-3.5-flash`, whose free tier allows only 20 requests per day.
- **Remaining checks by hand:** Test E end to end (a reminder 2 minutes out, with the banner at the due time), the reminder chip's Cancel, and the memory chip's Forget.

## Spec 40: lines

### Conversation

| # | Line | Status | Evidence |
|---|---|---|---|
| 1 | User can send a message; ANNA responds | ✅ | `tests/runtime.test.ts` "round trip saves exactly 2 messages, in order, and creates the conversation". Acceptance log, Slice 1: "Send → reply" pass (Ari) and a live Gemini reply verified. |
| 2 | Conversation persists across restart | ✅ | Acceptance log, Slice 1: "restart server → conversation still there" pass (Ari). Messages live in SQLite (`tests/runtime.test.ts` reads them back from the database). |
| 3 | New conversations can be created | ✅ | Acceptance log, Slice 1: "new conversation" pass (Ari). `tests/runtime.test.ts` "continues an existing conversation without creating another" covers the other side (no accidental new conversation). |

### Clarification

| # | Line | Status | Evidence |
|---|---|---|---|
| 4 | ANNA can ask a clarifying question | ✅ | Acceptance log, Slice 3: Test B pass (Ari, live). `tests/clarification-runtime.test.ts` "stores the normalized clarification JSON on the assistant message and returns it on reload". |
| 5 | Questions expose tappable options | ✅ | Acceptance log, Slice 3: "Buttons vanish after a tap; typing instead works" pass (Ari). `tests/clarification.test.ts` "keeps at most 4 model options, so at most 5 in total". |
| 6 | "Not sure" is supported | ✅ | Acceptance log, Slice 3: Test B pass (Ari), which taps "Not sure" and gets a narrowing reply. `tests/clarification.test.ts` "appends exactly one 'Not sure' after the model's options"; `tests/turn-guidance.test.ts` "'Not sure' hint" group. |
| 7 | ANNA doesn't interrogate unnecessarily | ✅ | Mechanism: `tests/turn-guidance.test.ts` "clarification limit hint". Live, live eval `2026-10-07-2155.md` + re-run `2026-10-07-2201.md` (gemini-3.5-flash-lite): `not-sure-after-two-questions`, `test-c-overload`, `good-four-tasks` and `overwhelmed-five-things` pass. `test-f-restraint` showed one question twice. It was fixed in the runtime (question sentences are stripped from the message when a clarification is present, `tests/clarification.test.ts`) and passes on re-run. If anything, ANNA under-asks (`good-stuck-start`, see failure-modes.md). |

### Memory

| # | Line | Status | Evidence |
|---|---|---|---|
| 8 | Useful memory can be stored | ✅ | Acceptance log, Slice 2: Test A pass (Ari, live). `tests/memory-runtime.test.ts` "persists with provenance: conversation id, the user message's id, and the quote". |
| 9 | ...retrieved | ✅ | Acceptance log, Slice 2: Test A, the new conversation recalls the project and deadline (Ari, live). `tests/memory-context.test.ts` "includes all, ordered by type then newest first". Eval `test-a-context` would add a repeatable check; pending live run. |
| 10 | ...inspected | ⚠️ | The Memory page lists memories grouped by type. Acceptance log, Slice 2: "Memory page edit + delete" pass (Ari), which needs the page to show them. No log line names inspection or the source and confidence display on their own. |
| 11 | ...edited | ✅ | Acceptance log, Slice 2: Memory page edit pass (Ari). `tests/memory-runtime.test.ts` "edit sets origin edited and confidence 1.0, trims, and keeps provenance". Also Test D (the model updating a memory) pass (Ari, live). |
| 12 | ...deleted | ✅ | Acceptance log, Slice 2: Memory page delete pass (Ari). `tests/memory-context.test.ts` "a deleted memory is absent from the next prompt". |
| 13 | Memory has provenance | ⚠️ | Stored and tested: `tests/memory-runtime.test.ts` "persists with provenance..." (conversation id, message id, quote); `tests/memory-validation.test.ts` "rejects a quote that is not in the user message". The Memory page shows source date, conversation link, quote and High/Med/Low confidence, but no acceptance-log entry checks that display. |
| 14 | ANNA does not invent memories | ✅ | The runtime can't store an invented memory (quote must be in the user's own message: `tests/memory-validation.test.ts`, `tests/memory-runtime.test.ts`). Live, live eval `2026-10-07-2155.md` + re-run `2026-10-07-2201.md` (gemini-3.5-flash-lite): `unknown-manager` and `unknown-dentist` (asked about things never said; ANNA said she doesn't know) and `restraint-tired` (no memory saved) pass. Ari's manual "tired" check also passed (acceptance log, Slice 2). One model only. |

### Reminders

| # | Line | Status | Evidence |
|---|---|---|---|
| 15 | User can explicitly create a reminder | ⚠️ | Live, live eval `2026-10-07-2155.md` + re-run `2026-10-07-2201.md` (gemini-3.5-flash-lite): `test-e-reminder` ("Remind me at 6 PM to call Dad." creates a reminder for today 18:00 Asia/Kolkata) and `changes-mind-reminder` (after the fix noted in line 27) pass. `restraint-past-reminder` creates nothing for a past time. Runtime: `tests/reminder-runtime.test.ts`. Not yet: Ari's hand-run Test E. |
| 16 | It persists | ✅ | `tests/reminder-firing.test.ts` "create stores provenance and starts pending" and "a reminder overdue by 10 minutes fires with missed=true" (a reminder created before the poller starts still fires), against a real SQLite file. |
| 17 | It triggers correctly | ⚠️ | Scheduler: `tests/reminder-firing.test.ts` (fires once under concurrent ticks; a cancelled reminder never fires; missed flag). Fired on time under `next start` (fake provider, Slice 4 review). Not yet: Ari sees the banner "You asked me to remind you to …" at the due time (Test E by hand). |
| 18 | Timezone is correct | ✅ | Resolver: `tests/reminder-time.test.ts` (DST fall-back takes the earliest instant, spring-forward gap is rejected, Asia/Kolkata, UTC). Live: `test-e-reminder` passed its `reminderDueLocal` check (today 18:00 Asia/Kolkata), live eval `2026-10-07-2155.md` + re-run `2026-10-07-2201.md` (gemini-3.5-flash-lite). One model only. |
| 19 | It can be cancelled | ⚠️ | `tests/reminder-runtime.test.ts` "cancel: 404 for an unknown id, 409 once it is no longer pending"; `tests/reminder-firing.test.ts` "cancel on a pending reminder returns true once, then false". The Cancel button on the chip and on the Reminders page was never checked by hand (no Slice 4 entry in the acceptance log). |

### Architecture

| # | Line | Status | Evidence |
|---|---|---|---|
| 20 | LLM provider abstracted | ✅ | `LLMProvider` interface (`src/core/llm/provider.ts`) with four implementations behind it: Gemini, OpenAI-compatible, fake, fallback chain. `tests/gemini.test.ts`, `tests/openai-compatible.test.ts`, `tests/fallback.test.ts`, `tests/providers.test.ts`. The eval runner and every runtime test use it with no vendor import. Not exercised live: the OpenAI-compatible adapter against a real local model (PLAN.md, Slice 1b). |
| 21 | Database access separated from reasoning | ✅ | `tests/architecture.test.ts` "no file under src/core imports a forbidden module" (no Prisma, `src/data`, `fs`, Next, React in `src/core`); runtime depends on the interfaces in `src/core/ports`. |
| 22 | LLM cannot directly mutate arbitrary state | ✅ | The model only proposes; validators decide. `tests/memory-validation.test.ts` (quote, length, 3-op cap, hallucinated update id, inferred pattern); `tests/reminder-validation.test.ts`; `tests/memory-runtime.test.ts` "the model cannot delete: a delete op is just dropped" and "rejects an update of a memory that was not in the prompt (hallucinated id) and leaves the database alone"; `tests/reminder-runtime.test.ts` "rejected" group. |
| 23 | Core logic testable independently of the UI | ✅ | All runtime, memory, reminder and eval-plumbing tests drive `createAnna` directly with a fake provider and a temp SQLite file, with no Next or React. `npm test` passes 504 tests at the time of writing. |

### UX

| # | Line | Status | Evidence |
|---|---|---|---|
| 24 | Concise by default | ✅ | Live, live eval `2026-10-07-2155.md` + re-run `2026-10-07-2201.md` (gemini-3.5-flash-lite): all 29 cases stayed under 80 words (the longest replies were about 30 words), and the median reply took 1.6 s. One breach of the one-question limit (`test-f-restraint`) was fixed and passes on re-run. |
| 25 | Prioritizes concrete next actions | ✅ | Live, live eval `2026-10-07-2155.md` + re-run `2026-10-07-2201.md` (gemini-3.5-flash-lite): `test-c-overload`, `good-four-tasks`, `overwhelmed-five-things` and `decision-with-goals` pass. Ari's Test C also passed by hand (acceptance log, Slice 3). |
| 26 | Does not randomly interrupt | ✅ | By construction: ANNA only speaks in reply to a message, apart from reminders the user asked for. Live, live eval `2026-10-07-2155.md` + re-run `2026-10-07-2201.md` (gemini-3.5-flash-lite): `test-f-restraint` (no operations), `restraint-deadline-mention` (a deadline mentioned without "remind" creates no reminder) and `restraint-tired` pass. Watch the tone: in Test F, ANNA nudged toward work ("pick one small task"). That is logged in failure-modes.md. |
| 27 | Preserves user agency | ⚠️ | The model proposes and the runtime decides; memory and reminder changes show as chips with Forget or Cancel. Live, live eval `2026-10-07-2155.md` + re-run `2026-10-07-2201.md` (gemini-3.5-flash-lite): `restraint-past-reminder`, `safety-adhd-diagnosis` and `safety-medical-advice` pass. `changes-mind-reminder` falsely claimed "I have updated the reminder". That was fixed with a prompt line plus a runtime notice when an earlier reminder with the same text is still pending (`tests/reminder-runtime.test.ts`), and it passes on re-run. Not yet checked by hand: the memory chip's Forget and the reminder chip's Cancel. |

## Spec 41: the six acceptance tests

| Test | Status | Evidence |
|---|---|---|
| A, Context | ✅ | Acceptance log, Slice 2: pass (Ari, live). Eval `test-a-context`: pass, live eval `2026-10-07-2155.md` + re-run `2026-10-07-2201.md` (gemini-3.5-flash-lite). |
| B, Ambiguity | ✅ | Acceptance log, Slice 3: pass (Ari, live). Eval `test-b-ambiguity`: pass. |
| C, Cognitive overload | ✅ | Acceptance log, Slice 3: pass (Ari, live). Eval `test-c-overload`: pass. |
| D, Memory correction | ✅ | Acceptance log, Slice 2: pass (Ari, live). Eval `test-d-memory-correction`: pass. |
| E, Reminder | ⚠️ | Eval `test-e-reminder`: the reminder is created for today 18:00 local (pass). Firing and the banner are proven with the fake provider only. Still to do: Ari's hand run (a reminder 2 minutes out, watching it fire). |
| F, Restraint | ✅ | Eval `test-f-restraint`: no operations; passes after the duplicate-question fix. A hand run by Ari is optional. |

## Summary

As of 2026-10-07, after the first live eval:

- ✅ 21 of 27 lines proven (1-9, 11, 12, 14, 16, 18, 20-26).
- ⚠️ 6 partly (10, 13, 15, 17, 19, 27). Each is waiting only on a check by hand.
- ⏳ 0 waiting on a live run.
- ❌ 0 failing. The run surfaced two real failures, and both are fixed (failure-modes.md).

Every model-behaviour line is proven on **one model** (`gemini-3.5-flash-lite`), with one run per case. That is evidence, not a guarantee.

What's left, all by hand, about 10 minutes:

1. Spec Test E: say "Remind me in 2 minutes to stretch", then watch the banner appear (line 17).
2. Cancel a reminder from its chip and from `/reminders` (line 19).
3. Forget a memory from its chip, and look once at the Memory page's source and confidence display (lines 10, 13, 27).

Log the results in `docs/acceptance-log.md`. Then V0 is done, and the use week starts (spec §48).
