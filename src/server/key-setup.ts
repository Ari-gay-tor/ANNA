// First-run setup: is a usable provider key configured, check a pasted Gemini key with one tiny real call, and save it.
// Rules for the key: never logged, never returned (only its last 4 characters), never in a URL, and no text from the
// provider's error is passed on (it could echo the key), so every message here is fixed text.

import { z } from "zod";
import { GeminiProvider } from "../core/llm/gemini";
import { LLMError, type LLMProvider } from "../core/llm/provider";
import type { Env } from "./app-config";
import { writeEnvValue } from "./config-file";
import { DEFAULT_GEMINI_FALLBACKS, DEFAULT_GEMINI_MODEL, parseProviderNames } from "./providers";

export const KEY_VARIABLE = "GEMINI_API_KEY";

/** No whitespace, plain characters only (Google's keys are letters, digits, "_", "-" and ".") and a length cap. */
export const GEMINI_KEY_PATTERN = /^[A-Za-z0-9_.-]{8,200}$/;

export const GeminiKeyBody = z.object({
  key: z
    .string()
    .trim()
    .min(1, "Paste your key first.")
    .regex(GEMINI_KEY_PATTERN, "That doesn't look like a Gemini key. Paste it exactly as Google shows it, with no spaces."),
});

export const MESSAGES = {
  invalid: "That key didn't work. Check that you copied all of it, then try again.",
  quota: "Key works but quota is used up today. Saved anyway.",
  unreachable: "Couldn't reach Google just now. Check your internet connection and try again.",
  saveFailed: "The key worked but ANNA couldn't save it on this PC. Check that the ANNA data folder can be written to.",
} as const;

/** True when no provider ANNA would use can answer: every entry in ANNA_PROVIDER is a Gemini with no key or an unconfigured local model. */
export function setupRequired(env: Env): boolean {
  return !parseProviderNames(env.ANNA_PROVIDER).some((name) => {
    if (name === "fake") return true;
    if (name === "gemini") return Boolean(env[KEY_VARIABLE]?.trim());
    if (name === "openai-compatible") return Boolean(env.OPENAI_COMPAT_BASE_URL?.trim() && env.OPENAI_COMPAT_MODEL?.trim());
    return false;
  });
}

/** What the screens may know about the saved key: whether there is one, and its last 4 characters (nothing when the key is short). */
export function keyStatus(env: Env): { configured: boolean; last4: string | null } {
  const key = env[KEY_VARIABLE]?.trim() ?? "";
  return { configured: key !== "", last4: key.length >= 12 ? key.slice(-4) : null };
}

/** The cheapest model in the default chain: the last one (the "lite" model), so the check costs as little as possible. */
export function cheapestDefaultModel(): string {
  const chain = [DEFAULT_GEMINI_MODEL, ...DEFAULT_GEMINI_FALLBACKS.split(",").map((m) => m.trim())].filter(Boolean);
  return chain[chain.length - 1]!;
}

export type KeyCheck = "valid" | "invalid" | "quota" | "unreachable";

const CHECK_TIMEOUT_MS = 15_000;

/**
 * One tiny real call (a few tokens, the cheapest model, no fallbacks, no retries). Any real answer from Google, even an empty
 * or blocked one, proves the key is accepted; only a rejected key is "invalid".
 */
export async function checkGeminiKey(key: string, makeProvider: (key: string) => LLMProvider = defaultProvider): Promise<KeyCheck> {
  try {
    await makeProvider(key).generate({ system: "Reply with the single word OK.", messages: [{ role: "user", content: "OK?" }], maxOutputTokens: 8 });
    return "valid";
  } catch (error) {
    if (error instanceof LLMError) {
      if (error.kind === "CONFIG") return "invalid";
      if (error.kind === "RATE_LIMITED") return "quota";
      if (error.kind === "BAD_RESPONSE" || error.kind === "BLOCKED") return "valid";
    }
    return "unreachable";
  }
}

function defaultProvider(key: string): LLMProvider {
  return new GeminiProvider({ apiKey: key, model: cheapestDefaultModel(), fallbackModels: "", timeoutMs: CHECK_TIMEOUT_MS });
}

export type KeyUpdate =
  | { status: "valid" | "quota" }
  | { status: "invalid" | "unreachable" | "save_failed" };

export interface KeyUpdateDeps {
  /** Defaults to the real one-call check. */
  check?: (key: string) => Promise<KeyCheck>;
  /** The file the key is saved to (config.env or .env). */
  configFile: string;
  /** The server's environment: updated so the new key is used at once. */
  env: Env;
  /** Drops the cached services so the next request builds a provider with the new key. */
  resetServices: () => void;
  log?: (line: string) => void;
}

/** Checks the key; when Google accepts it (or only the daily quota is used up), saves it, applies it, and resets the services. */
export async function updateGeminiKey(key: string, deps: KeyUpdateDeps): Promise<KeyUpdate> {
  const log = deps.log ?? (() => {});
  const result = await (deps.check ?? checkGeminiKey)(key);
  log(`[anna] setup: key check result=${result}`);
  if (result !== "valid" && result !== "quota") return { status: result };
  try {
    writeEnvValue(deps.configFile, KEY_VARIABLE, key);
  } catch (error) {
    log(`[anna] setup: could not write the key to the config file (${(error as NodeJS.ErrnoException).code ?? "unknown error"})`);
    return { status: "save_failed" };
  }
  deps.env[KEY_VARIABLE] = key;
  deps.resetServices();
  log("[anna] setup: key saved, services reset");
  return { status: result };
}
