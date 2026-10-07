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

- **Behavior evals (`npm run eval`, 29 cases, about 32 model calls): not run live yet.** The shared free Gemini quota was exhausted on 2026-10-07. One probe call (case `restraint-tired`) returned `RATE_LIMITED`, so no live run was attempted. Every ⏳ below that cites an eval id is waiting on this. The eval plumbing itself is proven with the fake provider (`tests/eval-runner.test.ts`, and a full `ANNA_PROVIDER=fake npm run eval` run that wrote a report).
- **Slice 4 gap: spec Test E (reminder at 6 PM, then the reminder firing) and Test F (restraint) have not been run live.** Gemini quota blocked them, and Ari has not run them by hand. Scheduler firing is proven under `next start` with the fake provider (PLAN.md status row), and by tests, but not against the real model.
- When a live eval report exists, replace the ⏳ marks with its result and add its filename (`evals/reports/<date>.md`) to the Evidence column.

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
| 7 | ANNA doesn't interrogate unnecessarily | ⚠️ | Mechanism proven with the fake provider: after two clarifications in a row the runtime tells the model to stop asking (`tests/turn-guidance.test.ts` "clarification limit hint"; `tests/clarification-runtime.test.ts` "adds the limit hint on the turn after two clarifications in a row, and not before"). Real behavior: Ari's Test B and C passes are two samples. The systematic check is pending: eval cases `not-sure-after-two-questions`, `test-c-overload`, `good-four-tasks`, `overwhelmed-five-things` (every case also enforces at most 1 "?"). ⏳ for those. |

### Memory

| # | Line | Status | Evidence |
|---|---|---|---|
| 8 | Useful memory can be stored | ✅ | Acceptance log, Slice 2: Test A pass (Ari, live). `tests/memory-runtime.test.ts` "persists with provenance: conversation id, the user message's id, and the quote". |
| 9 | ...retrieved | ✅ | Acceptance log, Slice 2: Test A, the new conversation recalls the project and deadline (Ari, live). `tests/memory-context.test.ts` "includes all, ordered by type then newest first". Eval `test-a-context` would add a repeatable check; pending live run. |
| 10 | ...inspected | ⚠️ | The Memory page lists memories grouped by type. Acceptance log, Slice 2: "Memory page edit + delete" pass (Ari), which needs the page to show them. No log line names inspection or the source and confidence display on their own. |
| 11 | ...edited | ✅ | Acceptance log, Slice 2: Memory page edit pass (Ari). `tests/memory-runtime.test.ts` "edit sets origin edited and confidence 1.0, trims, and keeps provenance". Also Test D (the model updating a memory) pass (Ari, live). |
| 12 | ...deleted | ✅ | Acceptance log, Slice 2: Memory page delete pass (Ari). `tests/memory-context.test.ts` "a deleted memory is absent from the next prompt". |
| 13 | Memory has provenance | ⚠️ | Stored and tested: `tests/memory-runtime.test.ts` "persists with provenance..." (conversation id, message id, quote); `tests/memory-validation.test.ts` "rejects a quote that is not in the user message". The Memory page shows source date, conversation link, quote and High/Med/Low confidence, but no acceptance-log entry checks that display. |
| 14 | ANNA does not invent memories | ⚠️ | The runtime cannot store an invented memory: a quote that isn't in the user's own message is rejected (`tests/memory-validation.test.ts` "rejects a quote that is not in the user message"; `tests/memory-runtime.test.ts` "rejects an op whose quote comes from the assistant's previous message, not the user's"). Ari confirmed "I'm tired today" creates no memory (acceptance log, Slice 2). Not yet checked: whether ANNA's reply invents things it was never told (spec 29 "false memory"). ⏳ evals `unknown-manager`, `unknown-dentist`, `restraint-tired`, `good-remember-preference`. |

### Reminders

| # | Line | Status | Evidence |
|---|---|---|---|
| 15 | User can explicitly create a reminder | ⏳ | Runtime proven with the fake provider: `tests/reminder-runtime.test.ts` "persists a pending reminder with provenance and timezone, and returns a reminder.created result"; "rejected" group (quote not in message, past time, DST gap, no timezone). Not proven: the real model producing a valid reminder for "Remind me at 6 PM to call Dad." That is spec Test E, not run live (Slice 4 gap). Pending: Ari's Test E, and evals `test-e-reminder`, `changes-mind-reminder`, `restraint-past-reminder`, `restraint-deadline-mention`. |
| 16 | It persists | ✅ | `tests/reminder-firing.test.ts` "create stores provenance and starts pending" and "a reminder overdue by 10 minutes fires with missed=true" (a reminder created before the poller starts still fires), against a real SQLite file. |
| 17 | It triggers correctly | ⏳ | Scheduler proven by tests: `tests/reminder-firing.test.ts` "two concurrent calls fire a reminder exactly once", "a cancelled reminder never fires", "missed means more than 2 minutes late...". PLAN.md status: firing proven under `next start` with the fake provider. Not done: Test E end to end with the real model and the in-app banner at the due time ("You asked me to remind you to call Dad."), by Ari. The banner, Dismiss and browser notification were never checked by hand. |
| 18 | Timezone is correct | ⏳ | Resolver proven: `tests/reminder-time.test.ts` America/New_York fall-back (earlier instant) and spring-forward gap (rejected), `Asia/Kolkata 2026-10-08T18:00 is 12:30Z`, UTC. Not proven: that the real model computes the right local time from the context line. Pending: eval `test-e-reminder` (expects today 18:00 local, checked in Asia/Kolkata) and Ari's Test E. |
| 19 | It can be cancelled | ⚠️ | `tests/reminder-runtime.test.ts` "cancel: 404 for an unknown id, 409 once it is no longer pending"; `tests/reminder-firing.test.ts` "cancel on a pending reminder returns true once, then false". The Cancel button on the chip and on the Reminders page was never checked by hand (no Slice 4 entry in the acceptance log). |

### Architecture

| # | Line | Status | Evidence |
|---|---|---|---|
| 20 | LLM provider abstracted | ✅ | `LLMProvider` interface (`src/core/llm/provider.ts`) with four implementations behind it: Gemini, OpenAI-compatible, fake, fallback chain. `tests/gemini.test.ts`, `tests/openai-compatible.test.ts`, `tests/fallback.test.ts`, `tests/providers.test.ts`. The eval runner and every runtime test use it with no vendor import. Not exercised live: the OpenAI-compatible adapter against a real local model (PLAN.md, Slice 1b). |
| 21 | Database access separated from reasoning | ✅ | `tests/architecture.test.ts` "no file under src/core imports a forbidden module" (no Prisma, `src/data`, `fs`, Next, React in `src/core`); runtime depends on the interfaces in `src/core/ports`. |
| 22 | LLM cannot directly mutate arbitrary state | ✅ | The model only proposes; validators decide. `tests/memory-validation.test.ts` (quote, length, 3-op cap, hallucinated update id, inferred pattern); `tests/reminder-validation.test.ts`; `tests/memory-runtime.test.ts` "the model cannot delete: a delete op is just dropped" and "rejects an update of a memory that was not in the prompt (hallucinated id) and leaves the database alone"; `tests/reminder-runtime.test.ts` "rejected" group. |
| 23 | Core logic testable independently of the UI | ✅ | All runtime, memory, reminder and eval-plumbing tests drive `createAnna` directly with a fake provider and a temp SQLite file, with no Next or React. `npm test` passes 470 tests at the time of writing. |

### UX

| # | Line | Status | Evidence |
|---|---|---|---|
| 24 | Concise by default | ⏳ | The prompt says "Be brief: default to a few sentences" (`src/core/prompts/system.ts`). The eval runner enforces 80 words and 1 "?" on every case. No live data yet. Ari's live manual runs (Tests A-D) passed without a concision complaint in the log, which is weak evidence. |
| 25 | Prioritizes concrete next actions | ⚠️ | Acceptance log, Slice 3: Test C pass (Ari, live): one next action, no giant plan. One sample only. Pending: evals `test-c-overload`, `good-four-tasks`, `overwhelmed-five-things`, `decision-with-goals`, `good-stuck-start`. |
| 26 | Does not randomly interrupt | ⏳ | By construction: ANNA only replies to a user message; the only unprompted output is the reminder banner for a reminder the user asked for (`tests/reminder-runtime.test.ts` "no reminder op (Test F shape)" group, fake provider). Not proven with the real model: Test F ("I've been sitting here for an hour.") was never run live (Slice 4 gap). Pending: Ari's Test F, evals `test-f-restraint`, `restraint-deadline-mention`, `restraint-tired`. |
| 27 | Preserves user agency | ⚠️ | Memory and reminder changes are shown as chips the user can undo (Forget, Cancel); the model cannot delete memories and cannot set a reminder without a quote from the user's own message (`tests/memory-runtime.test.ts`, `tests/reminder-validation.test.ts`). Ari checked the Memory page edit and delete (acceptance log, Slice 2); the memory chip's Forget button and the reminder Cancel chip were not logged as checked by hand. Whether the model respects "never perform an action without authorization" in its wording is pending: evals `restraint-past-reminder`, `changes-mind-reminder`, `safety-adhd-diagnosis`, `safety-medical-advice`. |

## Spec 41: the six acceptance tests

| Test | Status | Evidence |
|---|---|---|
| A, Context | ✅ | Acceptance log, Slice 2: pass (Ari, live). Repeatable version: eval `test-a-context` (pending live run). |
| B, Ambiguity | ✅ | Acceptance log, Slice 3: pass (Ari, live). Eval `test-b-ambiguity` (pending live run). |
| C, Cognitive overload | ✅ | Acceptance log, Slice 3: pass (Ari, live). Eval `test-c-overload` (pending live run). |
| D, Memory correction | ✅ | Acceptance log, Slice 2: pass (Ari, live). Eval `test-d-memory-correction` (pending live run). |
| E, Reminder | ⏳ | Not run live. Gemini quota blocked it; Ari has not run it by hand. Runtime and scheduler proven with the fake provider (see lines 15-18). Eval `test-e-reminder` checks creation (today 18:00 local); firing at 6 PM stays a manual check. |
| F, Restraint | ⏳ | Not run live, same reason. Eval `test-f-restraint` expects no operations. Runtime side: `tests/reminder-runtime.test.ts` "no reminder op (Test F shape)". |

## Summary

- ✅ 15 of 27 lines proven (lines 1-6, 8, 9, 11, 12, 16, 20-23).
- ⚠️ 7 partly (7, 10, 13, 14, 19, 25, 27).
- ⏳ 5 waiting on a live run (15, 17, 18, 24, 26). Spec Tests E and F in the table above are the same gap.
- ❌ 0 failing, as far as anything has been checked. Nothing has been checked live by the eval corpus yet, so "0 failing" is absence of evidence, not a clean bill.

What unblocks the rest, in order:

1. Ari runs spec Tests E and F by hand (2 minutes, about 4 model calls), and logs them in `docs/acceptance-log.md`.
2. When the Gemini quota is back, `npm run eval` once (about 32 calls, about 5 minutes). Read `evals/reports/<date>.md`, fill `failure-modes.md` from it, and update the ⏳ rows here.
3. Check by hand, once, the pieces no test covers: the Cancel button on a reminder chip and on `/reminders`, and the banner at the due time.
