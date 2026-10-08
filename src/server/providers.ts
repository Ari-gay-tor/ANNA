// Builds the LLM provider from env. ANNA_PROVIDER is a comma-separated list of
// gemini | openai-compatible | fake. One name gives that provider; several give a FallbackProvider.
//
// Bad config never crashes startup: the broken provider is replaced by one that throws CONFIG
// when it is reached, so the UI can show the message.

import { FakeProvider } from "../core/llm/fake";
import { FallbackProvider, type NamedProvider } from "../core/llm/fallback";
import { DEFAULT_GEMINI_TIMEOUT_MS, GeminiProvider } from "../core/llm/gemini";
import {
  DEFAULT_OPENAI_COMPAT_TIMEOUT_MS,
  JSON_MODES,
  OpenAICompatibleProvider,
  type JsonMode,
} from "../core/llm/openai-compatible";
import { LLMError, type LLMProvider, type LLMRequest, type LLMResponse } from "../core/llm/provider";
import { activeConfig } from "./data-dir";

type Env = Record<string, string | undefined>;
type Log = (line: string) => void;

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_GEMINI_FALLBACKS = "gemini-3.5-flash,gemini-3.5-flash-lite";
export const PROVIDER_NAMES = ["gemini", "openai-compatible", "fake"] as const;

/** Throws the CONFIG error when reached, so a misconfiguration is reported at reply time. */
class MisconfiguredProvider implements LLMProvider {
  constructor(readonly error: LLMError) {}
  async generate(_request: LLMRequest): Promise<LLMResponse> {
    throw this.error;
  }
}

export function parseProviderNames(raw: string | undefined): string[] {
  const names = (raw ?? "")
    .split(",")
    .map((n) => n.trim().toLowerCase())
    .filter((n, i, all) => n && all.indexOf(n) === i);
  return names.length > 0 ? names : ["gemini"];
}

export function createProvider(env: Env, log: Log = () => {}): LLMProvider {
  const named: NamedProvider[] = parseProviderNames(env.ANNA_PROVIDER).map((name) => {
    try {
      return { name, provider: createOne(name, env) };
    } catch (error) {
      if (!(error instanceof LLMError) || error.kind !== "CONFIG") throw error;
      log(`[anna] provider "${name}" is misconfigured: ${error.message}`);
      return { name, provider: new MisconfiguredProvider(error) };
    }
  });
  const [only] = named;
  if (named.length === 1 && only) return only.provider;
  return new FallbackProvider(named, ({ name, error }) =>
    log(`[anna] provider "${name}" failed (${error.kind}), trying the next one`),
  );
}

function createOne(name: string, env: Env): LLMProvider {
  switch (name) {
    case "fake":
      return new FakeProvider();
    case "gemini":
      return createGemini(env);
    case "openai-compatible":
      return createOpenAICompatible(env);
    default:
      throw new LLMError("CONFIG", `Unknown ANNA_PROVIDER entry "${name}". Valid: ${PROVIDER_NAMES.join(", ")}.`);
  }
}

function createGemini(env: Env): GeminiProvider {
  try {
    return new GeminiProvider({
      apiKey: env.GEMINI_API_KEY ?? "",
      model: env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
      fallbackModels: env.GEMINI_FALLBACK_MODELS ?? DEFAULT_GEMINI_FALLBACKS,
      timeoutMs: parseMs(env.GEMINI_TIMEOUT_MS, "GEMINI_TIMEOUT_MS", DEFAULT_GEMINI_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof LLMError && error.message.includes("GEMINI_API_KEY")) {
      // A tester has no .env: the key is saved from the Settings page (to config.env). Only a developer's checkout names .env.
      const fix =
        activeConfig(env).mode === "tester"
          ? "Set it up in ANNA's Settings."
          : "Set it up in ANNA's Settings, or add it to .env and restart the server.";
      throw new LLMError("CONFIG", `${error.message} ${fix}`);
    }
    throw error;
  }
}

function createOpenAICompatible(env: Env): OpenAICompatibleProvider {
  const jsonMode = (env.OPENAI_COMPAT_JSON_MODE?.trim() || "json_schema") as JsonMode;
  if (!JSON_MODES.includes(jsonMode)) {
    throw new LLMError("CONFIG", `OPENAI_COMPAT_JSON_MODE must be one of ${JSON_MODES.join(", ")}.`);
  }
  return new OpenAICompatibleProvider({
    baseUrl: env.OPENAI_COMPAT_BASE_URL ?? "",
    model: env.OPENAI_COMPAT_MODEL ?? "",
    apiKey: env.OPENAI_COMPAT_API_KEY,
    timeoutMs: parseMs(env.OPENAI_COMPAT_TIMEOUT_MS, "OPENAI_COMPAT_TIMEOUT_MS", DEFAULT_OPENAI_COMPAT_TIMEOUT_MS),
    jsonMode,
  });
}

function parseMs(raw: string | undefined, name: string, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) {
    throw new LLMError("CONFIG", `${name} must be a positive whole number of milliseconds (got "${trimmed}").`);
  }
  return value;
}

/** Logs one line per provider call: which provider:model answered, how long it took, token counts. Never the content. */
export function withReplyLogging(provider: LLMProvider, log: Log): LLMProvider {
  return {
    async generate(request) {
      const start = Date.now();
      const response = await provider.generate(request);
      const tokens = response.usage ? ` in=${response.usage.inputTokens ?? "?"} out=${response.usage.outputTokens ?? "?"}` : "";
      log(`[anna] reply model=${response.model} ms=${Date.now() - start}${tokens}`);
      return response;
    },
  };
}
