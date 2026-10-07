# Choosing the model behind ANNA

All of this is set in one file: `C:\Users\Ari\Documents\GitHub\anna\.env` (repo root, gitignored, never committed). **After editing `.env`, stop `npm run dev` (Ctrl+C) and start it again.** The server reads `.env` only at startup.

The full list of variables, with comments, is in `.env.example`.

## 1. Current setup

- ANNA uses **Gemini**. The API key in `.env` is the same one Wallflower uses, so **the two apps share one free daily quota**. If one of them burns it, the other gets "quota reached" (RATE_LIMITED) until it resets.
- Default models, if you don't set anything: `gemini-3.8-flash` first, then `gemini-3.5-flash`, then `gemini-3.5-flash-lite`.
- Gemini is on the free tier with no billing, so running out of quota can only fail, never charge.

Minimal `.env`:

```env
ANNA_PROVIDER=gemini
GEMINI_API_KEY=your-key-here
DATABASE_URL="file:./dev.db"
```

## 2. Change the Gemini model or its fallbacks

```env
GEMINI_MODEL=gemini-3.5-flash
GEMINI_FALLBACK_MODELS=gemini-3.5-flash-lite
GEMINI_TIMEOUT_MS=20000
```

- `GEMINI_MODEL`: tried first.
- `GEMINI_FALLBACK_MODELS`: comma-separated, tried in order, each at most once. Leave it empty (`GEMINI_FALLBACK_MODELS=`) to turn fallbacks off.
- `GEMINI_TIMEOUT_MS`: how long to wait for **each** model before giving up on it. Default 20000 (20 s).

What moves on to the next model: HTTP **503** (overloaded), HTTP **504** (Google's own deadline), and **no answer within the timeout**.

What never does: **429** (quota or rate limit). That stops right away and shows "quota reached". Retrying would only burn more quota.

Worst case a reply waits `timeout x number of models` (3 x 20 s by default) before it fails. If the first model is overloaded for a while, every chat pays one timeout. Put the model that works at the front (`GEMINI_MODEL=gemini-3.5-flash`) to skip the wait.

## 3. Use your own Gemini key instead

1. Open <https://aistudio.google.com/apikey> and create a key. Use a Google project that has **no billing account**.
2. In `.env`, change this one line:

   ```env
   GEMINI_API_KEY=your-new-key
   ```

3. Restart `npm run dev`.

## 4. Switch to a local model

ANNA can talk to any server that speaks the OpenAI chat API. Local ones need no key and cost nothing, but they are slower and smaller.

**Ollama**

1. Install Ollama from <https://ollama.com/download> and start it.
2. Download a model: `ollama pull llama3.1:8b`
   (Only a suggestion: it appears in Ollama's own structured-output examples. Not yet tested with ANNA.)
3. In `.env`:

   ```env
   ANNA_PROVIDER=openai-compatible
   OPENAI_COMPAT_BASE_URL=http://localhost:11434/v1
   OPENAI_COMPAT_MODEL=llama3.1:8b
   ```

4. Restart `npm run dev`.

**LM Studio**: load a model, open the Developer tab and start the local server (default port 1234), then:

```env
ANNA_PROVIDER=openai-compatible
OPENAI_COMPAT_BASE_URL=http://localhost:1234/v1
OPENAI_COMPAT_MODEL=the-model-name-shown-in-lm-studio
```

Optional settings (defaults shown):

```env
OPENAI_COMPAT_TIMEOUT_MS=60000     # local models are slow; raise it if replies time out
OPENAI_COMPAT_JSON_MODE=json_schema   # json_schema | json_object | none
OPENAI_COMPAT_API_KEY=             # leave empty for local servers
```

If a model keeps failing to return valid JSON, try `OPENAI_COMPAT_JSON_MODE=json_object`, then `none`. Also use `json_object` if a hosted endpoint rejects the schema with a "strict" error: ANNA's reply schema has optional fields, which strict OpenAI-style servers refuse.

**Heads up:** small local models (7-8B) follow ANNA's rules (be brief, ask one question, return JSON) noticeably worse than Gemini. Expect longer, chattier replies and the occasional "Sorry, I had trouble forming a reply."

## 5. Fallback between providers

`ANNA_PROVIDER` takes a comma-separated list. The first is tried first; the next one is used **only** when the previous one is unavailable (down, overloaded, timed out) or out of quota.

Gemini first, local model as the backup:

```env
ANNA_PROVIDER=gemini,openai-compatible
GEMINI_API_KEY=your-key-here
OPENAI_COMPAT_BASE_URL=http://localhost:11434/v1
OPENAI_COMPAT_MODEL=llama3.1:8b
```

It does **not** move on for configuration problems (missing key, wrong URL or model setting), because hiding those would leave you wondering why the backup never kicks in. If the backup is misconfigured, you'll see its error the first time Gemini fails.

**OpenRouter** (a hosted service that fronts many models; your old prototype used it):

```env
ANNA_PROVIDER=openai-compatible
OPENAI_COMPAT_BASE_URL=https://openrouter.ai/api/v1
OPENAI_COMPAT_MODEL=pick-a-model-id-from-openrouter.ai/models
OPENAI_COMPAT_API_KEY=your-openrouter-key
```

Get the key at <https://openrouter.ai/keys>. Model ids ending in `:free` are the free ones; check the price before using any other. Unlike a local model, this sends your messages to a third party. Groq works the same way: base URL `https://api.groq.com/openai/v1` and your Groq key.

## 6. Which model answered?

The terminal running `npm run dev` prints one line per model call (never the message text):

```
[anna] reply model=gemini:gemini-3.5-flash ms=2900 in=234 out=22
```

- `gemini:` / `openai-compatible:` / `fake` is the provider; after the colon is the model that actually answered. If it's not your first-choice model, a fallback kicked in.
- `ms` is how long the call took; `in` / `out` are token counts.
- When a whole provider is skipped you also see `[anna] provider "gemini" failed (UNAVAILABLE), trying the next one`.

## 7. Troubleshooting

- **"GEMINI_API_KEY is not set" / "rejected the API key" (CONFIG):** check `.env` for the key line (no quotes or spaces around it), then restart. Same idea for any `OPENAI_COMPAT_*` message: it names the variable that's wrong.
- **"quota or rate limit reached" (RATE_LIMITED):** the free daily quota is used up (remember Wallflower shares it). Wait for the reset, use your own key (section 3), or add a local backup (section 5).
- **"Couldn't reach http://localhost:11434/v1. Is Ollama running?":** start Ollama. A model must also be downloaded: if you see "model ... not found", run the `ollama pull` command from the message.
- **Replies take 20+ seconds:** a model in the chain is overloaded and is timing out before the next one answers. Check the log line to see which model finally replied, then put that one first in `GEMINI_MODEL`. Slow local model: raise `OPENAI_COMPAT_TIMEOUT_MS`.
- **Any error in the chat window:** your message is already saved. Press **Retry**; nothing is duplicated.
