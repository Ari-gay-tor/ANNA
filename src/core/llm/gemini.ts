// Gemini adapter (free tier).
//
// Cost safety: never sets a service tier, never retries inside the SDK (attempts: 1),
// and treats HTTP 429 as a hard stop. Only HTTP 503 (overload) moves on to the next model.

import { ApiError, GoogleGenAI, type GenerateContentConfig, type GenerateContentResponse } from "@google/genai";
import { LLMError, type LLMProvider, type LLMRequest, type LLMResponse } from "./provider";

export interface GeminiOptions {
  apiKey: string;
  /** Tried first. */
  model: string;
  /** Comma-separated models tried in order, each at most once, only when the previous one returned 503. Blank disables. */
  fallbackModels: string;
  timeoutMs?: number;
}

/** The slice of the SDK we use, so tests can inject a fake. */
export type GeminiModelsClient = Pick<GoogleGenAI["models"], "generateContent">;

const DEFAULT_TIMEOUT_MS = 60_000;

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
        httpOptions: { timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, retryOptions: { attempts: 1 } },
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
        return { text: requireText(response), model, usage: usageOf(response) };
      } catch (error) {
        const overloaded = error instanceof LLMError && error.kind === "UNAVAILABLE" && error.status === 503;
        if (!overloaded) throw error;
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
      throw toLLMError(error);
    }
    if (response.promptFeedback?.blockReason) {
      throw new LLMError("BLOCKED", `Prompt blocked: ${response.promptFeedback.blockReason}`);
    }
    return response;
  }
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

/** Maps any SDK failure to an LLMError. Never includes the API key. */
export function toLLMError(error: unknown): LLMError {
  if (error instanceof LLMError) return error;
  if (error instanceof ApiError) {
    if (error.status === 429) return new LLMError("RATE_LIMITED", "Gemini quota or rate limit reached.", 429);
    if (error.status === 401 || error.status === 403 || (error.status === 400 && /api key/i.test(error.message))) {
      return new LLMError("CONFIG", "Gemini rejected the API key. Check GEMINI_API_KEY.", error.status);
    }
    return new LLMError("UNAVAILABLE", `Gemini API error (${error.status}): ${error.message}`, error.status);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/RESOURCE_EXHAUSTED|quota/i.test(message)) return new LLMError("RATE_LIMITED", "Gemini quota or rate limit reached.", 429);
  return new LLMError("UNAVAILABLE", `Gemini request failed: ${message}`);
}
