// Gemini adapter (free tier).
//
// Cost safety: never sets a service tier, never retries inside the SDK (attempts: 1),
// and never calls the same model twice. The free tier has no billing, so trying another model
// cannot cost money. A failure that is specific to one model moves on to the next model in the
// chain: HTTP 429 (free-tier quota is per model), HTTP 503, HTTP 504 (server deadline), or our
// own per-attempt timeout.

import { ApiError, GoogleGenAI, type GenerateContentConfig, type GenerateContentResponse } from "@google/genai";
import { LLMError, type LLMProvider, type LLMRequest, type LLMResponse } from "./provider";

export interface GeminiOptions {
  apiKey: string;
  /** Tried first. */
  model: string;
  /** Comma-separated models tried in order, each at most once, when the previous one hit its quota (429) or was overloaded (503, 504, timeout). Blank disables. */
  fallbackModels: string;
  /** Per-attempt timeout, in ms. Each model in the chain gets its own. */
  timeoutMs?: number;
}

/** The slice of the SDK we use, so tests can inject a fake. */
export type GeminiModelsClient = Pick<GoogleGenAI["models"], "generateContent">;

export const DEFAULT_GEMINI_TIMEOUT_MS = 20_000;

export class GeminiProvider implements LLMProvider {
  private readonly models: GeminiModelsClient;
  private readonly chain: string[];

  constructor(options: GeminiOptions, models?: GeminiModelsClient) {
    const primary = options.model.trim();
    if (!primary) throw new LLMError("CONFIG", "GEMINI_MODEL is empty.");
    if (!models && !options.apiKey.trim()) {
      throw new LLMError("CONFIG", "GEMINI_API_KEY is not set.");
    }
    this.models =
      models ??
      new GoogleGenAI({
        apiKey: options.apiKey,
        httpOptions: { timeout: options.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS, retryOptions: { attempts: 1 } },
      }).models;
    const fallbacks = options.fallbackModels
      .split(",")
      .map((m) => m.trim())
      .filter((m, i, all) => m && m !== primary && all.indexOf(m) === i);
    this.chain = [primary, ...fallbacks];
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const config = buildConfig(request);
    const contents = request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    let lastError: unknown;
    for (const model of this.chain) {
      try {
        const response = await this.call(model, contents, config);
        return { text: requireText(response), model: `gemini:${model}`, usage: usageOf(response) };
      } catch (error) {
        if (!movesToNextModel(error)) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  private async call(model: string, contents: Array<{ role: string; parts: Array<{ text: string }> }>, config: GenerateContentConfig) {
    let response: GenerateContentResponse;
    try {
      response = await this.models.generateContent({ model, contents, config });
    } catch (error) {
      throw toLLMError(error, model);
    }
    if (response.promptFeedback?.blockReason) {
      throw new LLMError("BLOCKED", `Prompt blocked: ${response.promptFeedback.blockReason}`);
    }
    return response;
  }
}

/**
 * 429 (free-tier quota is per model), 503, 504 and client-side timeouts (mapped to status 504 by
 * toLLMError) move on to the next model. Everything else (400, 401, blocked prompts, ...) stops the chain.
 */
function movesToNextModel(error: unknown): boolean {
  if (!(error instanceof LLMError)) return false;
  if (error.kind === "RATE_LIMITED") return true;
  return error.kind === "UNAVAILABLE" && (error.status === 503 || error.status === 504);
}

function buildConfig(request: LLMRequest): GenerateContentConfig {
  const config: GenerateContentConfig = { systemInstruction: request.system };
  if (request.maxOutputTokens !== undefined) config.maxOutputTokens = request.maxOutputTokens;
  if (request.jsonSchema) {
    config.responseMimeType = "application/json";
    config.responseJsonSchema = request.jsonSchema;
  }
  return config;
}

function requireText(response: GenerateContentResponse): string {
  const text = response.text?.trim();
  if (!text) {
    const reason = response.candidates?.[0]?.finishReason ?? "unknown";
    throw new LLMError(reason === "SAFETY" ? "BLOCKED" : "BAD_RESPONSE", `Empty response from Gemini (finishReason=${reason})`);
  }
  return text;
}

function usageOf(response: GenerateContentResponse) {
  const usage = response.usageMetadata;
  return {
    inputTokens: usage?.promptTokenCount,
    outputTokens: usage?.candidatesTokenCount,
    thinkingTokens: usage?.thoughtsTokenCount,
  };
}

/** Maps any SDK failure to an LLMError. Never includes the API key. `model` is the model that was called, for the 429 message. */
export function toLLMError(error: unknown, model?: string): LLMError {
  if (error instanceof LLMError) return error;
  if (error instanceof ApiError) {
    if (error.status === 429) return new LLMError("RATE_LIMITED", rateLimitMessage(error.message, model), 429);
    if (error.status === 401 || error.status === 403 || (error.status === 400 && /api key/i.test(error.message))) {
      return new LLMError("CONFIG", "Gemini rejected the API key. Check GEMINI_API_KEY.", error.status);
    }
    return new LLMError("UNAVAILABLE", `Gemini API error (${error.status}): ${error.message}`, error.status);
  }
  // The SDK aborts its fetch when `timeout` elapses; that surfaces as a DOMException named
  // "AbortError" (verified against the real SDK). Treated like a gateway timeout.
  if (isTimeout(error)) return new LLMError("UNAVAILABLE", "Gemini did not answer in time (request timed out).", 504);
  const message = error instanceof Error ? error.message : String(error);
  if (/RESOURCE_EXHAUSTED|quota/i.test(message)) return new LLMError("RATE_LIMITED", rateLimitMessage(message, model), 429);
  return new LLMError("UNAVAILABLE", `Gemini request failed: ${message}`);
}

const TIMEOUT_CODES = new Set(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT"]);

/** True for an aborted/timed-out fetch, looking through `cause` chains (undici wraps some errors). */
function isTimeout(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 3) return false;
  const { name, code, cause } = error as { name?: unknown; code?: unknown; cause?: unknown };
  if (name === "AbortError" || name === "TimeoutError") return true;
  if (typeof code === "string" && TIMEOUT_CODES.has(code)) return true;
  return isTimeout(cause, depth + 1);
}

const GENERIC_RATE_LIMIT_MESSAGE = "Gemini quota or rate limit reached.";

/**
 * Builds the RATE_LIMITED message from a 429 body (the SDK puts the JSON body in `error.message`).
 * Reads only quotaId, quotaValue and retryDelay, defensively, and builds the sentence from fixed
 * words plus digits and the configured model name. Nothing else from the body is copied, so an
 * echoed API key cannot reach the message. Falls back to the generic text when none of the three is present.
 */
export function rateLimitMessage(raw: string, model?: string): string {
  const quotaId = field(raw, "quotaId", "[A-Za-z0-9_.:-]+");
  const value = field(raw, "quotaValue", String.raw`\d{1,12}`);
  const delaySeconds = field(raw, "retryDelay", String.raw`\d{1,9}(?:\.\d+)?(?=s)`);
  if (!quotaId && !value && !delaySeconds) return GENERIC_RATE_LIMIT_MESSAGE;

  const period = quotaId && /PerMinute/i.test(quotaId) ? "minute" : quotaId && /PerDay/i.test(quotaId) ? "day" : undefined;
  const noun = quotaId && /token/i.test(quotaId) ? "tokens" : "requests";
  const limit = value && period ? ` (${value} ${noun} per ${period})` : value ? ` (limit ${value})` : period ? ` (per-${period} limit)` : "";
  const head = period === "minute" ? "Gemini free rate limit reached" : period === "day" ? "Gemini free quota used up" : "Gemini quota or rate limit reached";
  const sentence = `${head}${model ? ` for ${model}` : ""}${limit}.`;
  if (!delaySeconds) return sentence;
  return `${sentence} ${period === "minute" ? "Try again" : "Resets"} in about ${formatDelay(Number(delaySeconds))}.`;
}

/** First `"name": "value"` (or `"name": value`) in the raw text, tolerating JSON that was escaped once more. */
function field(raw: string, name: string, valuePattern: string): string | undefined {
  const match = new RegExp(String.raw`\\?"${name}\\?"\s*:\s*\\?"?(${valuePattern})`).exec(raw);
  return match?.[1];
}

/** Whole hours (rounded down, so 7.8 h reads "7 h"), else minutes, else seconds (both rounded up). */
function formatDelay(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "a while";
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} h`;
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} min`;
  return `${Math.max(1, Math.ceil(seconds))} s`;
}
