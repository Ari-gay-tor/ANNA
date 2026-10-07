// Provider for any OpenAI-compatible chat API: Ollama, LM Studio, OpenRouter, Groq, ...
// Uses global fetch and POST {baseUrl}/chat/completions. No SDK.

import { LLMError, type LLMProvider, type LLMRequest, type LLMResponse } from "./provider";

export type JsonMode = "json_schema" | "json_object" | "none";
export const JSON_MODES: readonly JsonMode[] = ["json_schema", "json_object", "none"];

export const DEFAULT_OPENAI_COMPAT_TIMEOUT_MS = 60_000;

export interface OpenAICompatibleOptions {
  /** e.g. http://localhost:11434/v1 */
  baseUrl: string;
  model: string;
  /** Optional. When blank, no Authorization header is sent. */
  apiKey?: string;
  timeoutMs?: number;
  /**
   * How to ask for JSON when the request has a schema:
   * json_schema (default): response_format json_schema, strict.
   * json_object: response_format json_object; the schema is appended to the system prompt.
   * none: no response_format; the schema is appended to the system prompt.
   */
  jsonMode?: JsonMode;
}

type FetchFn = typeof fetch;

export class OpenAICompatibleProvider implements LLMProvider {
  private readonly url: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly jsonMode: JsonMode;

  constructor(
    options: OpenAICompatibleOptions,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
  ) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
    if (!baseUrl) throw new LLMError("CONFIG", "OPENAI_COMPAT_BASE_URL is not set.");
    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("bad protocol");
    } catch {
      throw new LLMError("CONFIG", `OPENAI_COMPAT_BASE_URL is not a valid http(s) URL: "${baseUrl}".`);
    }
    const model = options.model.trim();
    if (!model) throw new LLMError("CONFIG", "OPENAI_COMPAT_MODEL is not set.");
    const jsonMode = options.jsonMode ?? "json_schema";
    if (!JSON_MODES.includes(jsonMode)) {
      throw new LLMError("CONFIG", `OPENAI_COMPAT_JSON_MODE must be one of ${JSON_MODES.join(", ")}.`);
    }
    this.baseUrl = baseUrl;
    this.url = `${baseUrl}/chat/completions`;
    this.model = model;
    this.apiKey = (options.apiKey ?? "").trim();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_OPENAI_COMPAT_TIMEOUT_MS;
    this.jsonMode = jsonMode;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const response = await this.post(this.buildBody(request));
    if (!response.ok) throw await this.httpError(response);

    let data: ChatCompletion;
    try {
      data = (await response.json()) as ChatCompletion;
    } catch (error) {
      throw this.transportError(error, "returned a response that was not valid JSON", "BAD_RESPONSE");
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new LLMError("BAD_RESPONSE", "The model returned an empty reply (no choices[0].message.content).");
    }
    return {
      text: content,
      model: `openai-compatible:${data.model || this.model}`,
      usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
    };
  }

  private buildBody(request: LLMRequest): Record<string, unknown> {
    let system = request.system;
    const body: Record<string, unknown> = { model: this.model };
    if (request.jsonSchema) {
      if (this.jsonMode === "json_schema") {
        body.response_format = {
          type: "json_schema",
          json_schema: { name: "anna_response", schema: request.jsonSchema, strict: true },
        };
      } else {
        // The server will not see the schema, so put it in the prompt.
        if (this.jsonMode === "json_object") body.response_format = { type: "json_object" };
        system = `${system}\n\nReply with a single JSON object matching this JSON Schema:\n${JSON.stringify(request.jsonSchema)}`;
      }
    }
    if (request.maxOutputTokens !== undefined) body.max_tokens = request.maxOutputTokens;
    body.messages = [{ role: "system", content: system }, ...request.messages.map((m) => ({ role: m.role, content: m.content }))];
    return body;
  }

  private async post(body: unknown): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    try {
      return await this.fetchFn(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw this.transportError(error, "request failed", "UNAVAILABLE");
    }
  }

  private async httpError(response: Response): Promise<LLMError> {
    const status = response.status;
    if (status === 429) return new LLMError("RATE_LIMITED", "The model server rate-limited the request (429).", 429);
    if (status === 401 || status === 403) {
      return new LLMError("CONFIG", `The model server rejected the credentials (${status}). Check OPENAI_COMPAT_API_KEY.`, status);
    }
    const detail = await this.bodySnippet(response);
    const pullHint = status === 404 && this.baseUrl.includes(":11434") ? ` If the model is not installed, run: ollama pull ${this.model}` : "";
    return new LLMError("UNAVAILABLE", `The model server returned ${status}${detail ? `: ${detail}` : ""}${pullHint}`, status);
  }

  /** A short, single-line slice of an error body, with the API key scrubbed. Never includes headers. */
  private async bodySnippet(response: Response): Promise<string> {
    let text = "";
    try {
      text = await response.text();
    } catch {
      return "";
    }
    if (this.apiKey) text = text.split(this.apiKey).join("[redacted]");
    const oneLine = text.replace(/\s+/g, " ").trim();
    return oneLine.length > 200 ? `${oneLine.slice(0, 200)}...` : oneLine;
  }

  private transportError(error: unknown, what: string, kind: "UNAVAILABLE" | "BAD_RESPONSE"): LLMError {
    if (hasName(error, ["AbortError", "TimeoutError"])) {
      return new LLMError("UNAVAILABLE", `The model server did not answer within ${Math.round(this.timeoutMs / 1000)}s.`);
    }
    if (errorCodes(error).has("ECONNREFUSED")) {
      return new LLMError("UNAVAILABLE", `Couldn't reach ${this.baseUrl}. ${this.serverHint()}`);
    }
    const reason = error instanceof Error ? error.message : String(error);
    return new LLMError(kind, `The model server ${what}: ${reason}`);
  }

  private serverHint(): string {
    if (this.baseUrl.includes(":11434")) return "Is Ollama running?";
    if (this.baseUrl.includes(":1234")) return "Is the LM Studio server running?";
    return "Is the server running?";
  }
}

interface ChatCompletion {
  model?: string;
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function hasName(error: unknown, names: string[]): boolean {
  return typeof error === "object" && error !== null && names.includes((error as { name?: string }).name ?? "");
}

/** Error codes on an error, its `cause`, and any AggregateError members (undici/Node wrap connect failures). */
function errorCodes(error: unknown, depth = 0, found = new Set<string>()): Set<string> {
  if (!error || typeof error !== "object" || depth > 3) return found;
  const { code, cause, errors } = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof code === "string") found.add(code);
  errorCodes(cause, depth + 1, found);
  if (Array.isArray(errors)) for (const inner of errors) errorCodes(inner, depth + 1, found);
  return found;
}
