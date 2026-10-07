# Post-V0 backlog

Nothing here gets built until V0 is done (`docs/PLAN.md` Slice 5) and a week of real use says it's needed (spec §48). Each item says what would justify it.

| Item | Notes | Build it when |
|---|---|---|
| TTS (read replies aloud) | Prototype in GitHub `Ari-gay-tor/ANNA`, folder `ANNA-tts/`. It is Kokoro-82M (Python, runs locally) with a custom voice `voices/anna_voice.pt` and a "comms" audio effect. `speak.py` reads lines on stdin and plays them on the speakers of the machine it runs on. For a web app the audio has to play in the browser, so it needs to become a small local HTTP service that returns WAV, behind a `SpeechProvider` interface (same pattern as `LLMProvider`). Undecided whether that service runs on this machine or the other one. | Ari finds themself wanting to listen instead of read during the use week |
| Speech-to-text input | Spec §16 long-term vision. | After TTS, and only if typing is the friction |
| Anthropic adapter | Second `LLMProvider`. | Slice 5 evals show Gemini is weak at clarification/brevity |
| Reminders outside the browser | Desktop notifications when ANNA isn't open, or a tray app. | Missed reminders show up in real use |
| Hosting for outside testers | Spec §48 wants 5–10 testers, but V0 has no auth and is single-user. Options: one install per person, or one hosted instance per person. | Before the first outside tester |
| Inferred pattern memories | Rejected in V0. They need evidence across conversations, which needs retrieval of past messages. | Real use shows recurring patterns that ANNA misses |
| Model-initiated "forget" | V0 deletes only from the Memory page. | Ari keeps asking ANNA in chat to forget things |
| Streaming replies | V0 doesn't stream because the output is structured JSON. | Reply latency is a top complaint |
| Scrub API key from non-quota Gemini errors | `toLLMError` in `src/core/llm/gemini.ts` copies raw upstream text into `Gemini API error (...)` / `Gemini request failed` messages. Google is not known to echo keys, but redact the key and cap the text (as `openai-compatible.ts` does). Small. | Next time the Gemini adapter is touched |
