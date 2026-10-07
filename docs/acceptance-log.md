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
