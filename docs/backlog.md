# Post-V0 backlog

Nothing here gets built until V0 is done (`docs/PLAN.md` Slice 5) and a week of real use says it's needed (spec §48). Each item says what would justify it.

| Item | Notes | Build it when |
|---|---|---|
| TTS (read replies aloud) | Ari already has a TTS on another machine. It is local-only and not in this repo. The likely shape is that machine running TTS as a small HTTP service on the LAN, and ANNA calling it behind a `SpeechProvider` interface, the same pattern as `LLMProvider`. Undecided. | Ari finds themself wanting to listen instead of read during the use week |
| Speech-to-text input | Spec §16 long-term vision. | After TTS, and only if typing is the friction |
| Anthropic adapter | Second `LLMProvider`. | Slice 5 evals show Gemini is weak at clarification/brevity |
| Reminders outside the browser | Desktop notifications when ANNA isn't open, or a tray app. | Missed reminders show up in real use |
| Hosting for outside testers | Spec §48 wants 5–10 testers, but V0 has no auth and is single-user. Options: one install per person, or one hosted instance per person. | Before the first outside tester |
| Inferred pattern memories | Rejected in V0. They need evidence across conversations, which needs retrieval of past messages. | Real use shows recurring patterns that ANNA misses |
| Model-initiated "forget" | V0 deletes only from the Memory page. | Ari keeps asking ANNA in chat to forget things |
| Streaming replies | V0 doesn't stream because the output is structured JSON. | Reply latency is a top complaint |
