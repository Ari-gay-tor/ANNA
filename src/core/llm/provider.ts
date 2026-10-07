// Provider-neutral LLM contract. The runtime depends on this file, never on a vendor SDK.

export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  system: string;
  messages: LLMMessage[];
  /** When set, the provider must ask the model for JSON matching this JSON Schema. */
  jsonSchema?: object;
  maxOutputTokens?: number;
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
}

export interface LLMResponse {
  text: string;
  /** The model that actually answered (may be a fallback). */
  model: string;
  usage?: LLMUsage;
}

export interface LLMProvider {
  generate(request: LLMRequest): Promise<LLMResponse>;
}

export type LLMErrorKind =
  /** Provider down, overloaded, timed out, or rejected the request. */
  | "UNAVAILABLE"
  /** Quota or rate limit hit (HTTP 429). The same model is never retried; Gemini moves on to its next model. */
  | "RATE_LIMITED"
  /** Provider refused the content. */
  | "BLOCKED"
  /** Provider answered with something unusable (e.g. empty). */
  | "BAD_RESPONSE"
  /** Missing or invalid configuration (API key, provider name). */
  | "CONFIG";

export class LLMError extends Error {
  constructor(
    readonly kind: LLMErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LLMError";
  }
}
