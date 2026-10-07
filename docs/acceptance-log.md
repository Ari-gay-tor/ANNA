# Acceptance log

Manual checks Ari runs against the real model. One entry per slice. Failures also go in `failure-modes.md`.

## 2026-10-07: Slice 1
- Send → reply, restart server → conversation still there, new conversation: **pass** (Ari).
- Live Gemini reply verified by PM (`gemini-3.5-flash`, ~6.6 s).

## 2026-10-07: Slice 2
- Spec Test A (project + "deadline is Friday" → new conversation recalls it): **pass** (Ari).
- Spec Test D (conflicting preference → memory updated, not duplicated): **pass** (Ari).
- "I'm tired today" creates no memory: **pass** (Ari).
- Memory page edit + delete: **pass** (Ari).

## 2026-10-07: Slice 3
- Spec Test B (internship → options → "Not sure" narrows it down): **pass** (Ari).
- Spec Test C (four tasks → one next action, no plan): **pass** (Ari).
- Buttons vanish after a tap; typing instead works: **pass** (Ari).

## 2026-10-07: Slices 4-5 and V0 close-out
- Live behavior eval on `gemini-3.5-flash-lite`: 24/29. 2 real failures fixed, 2 checks loosened, re-run 4/5 (`good-stuck-start` logged). See `failure-modes.md`.
- Spec Test E by hand: "Remind me in 2 minutes to stretch." fired and showed the banner, and Dismiss cleared it: **pass** (Ari).
- Cancel a reminder from its chip and from `/reminders`: **pass** (Ari).
- Forget a memory from its chip; the Memory page shows source, quote and confidence: **pass** (Ari).
- **V0 definition of done: 27/27** (`docs/v0-acceptance.md`).
