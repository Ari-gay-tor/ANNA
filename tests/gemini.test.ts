import { ApiError, type GenerateContentParameters } from "@google/genai";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GeminiProvider, rateLimitMessage, type GeminiModelsClient } from "../src/core/llm/gemini";
import { LLMError, type LLMRequest } from "../src/core/llm/provider";

const options = { apiKey: "unused", model: "primary", fallbackModels: "fallback-1,fallback-2" };
const request: LLMRequest = { system: "sys", messages: [{ role: "user", content: "hi" }] };

/** An API error with a specific message, e.g. a realistic 429 body. */
type ApiFailure = { status: number; message: string };
type Outcome = "ok" | 503 | 504 | 429 | 400 | 401 | "empty" | "abort" | "timeout-error" | "undici-timeout" | "other-error" | ApiFailure;

/** What Gemini returns for a free-tier 429, as the SDK puts it in ApiError.message (the JSON body). */
function quotaBody(violation: Record<string, unknown>, retryDelay?: string, errorExtra: Record<string, unknown> = {}): string {
  const details: unknown[] = [
    { "@type": "type.googleapis.com/google.rpc.Help", links: [{ description: "Learn more", url: "https://ai.google.dev/gemini-api/docs/rate-limits" }] },
    { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [violation] },
  ];
  if (retryDelay) details.push({ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay });
  return JSON.stringify({
    error: { code: 429, message: "You exceeded your current quota, please check your plan and billing details.", status: "RESOURCE_EXHAUSTED", details, ...errorExtra },
  });
}

const perDayBody = (model: string) =>
  quotaBody(
    {
      quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
      quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
      quotaDimensions: { location: "global", model },
      quotaValue: "20",
    },
    "28118s",
  );

const perMinuteBody = (model: string) =>
  quotaBody(
    {
      quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
      quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
      quotaDimensions: { location: "global", model },
      quotaValue: "5",
    },
    "34.5s",
  );

/** Fake SDK client: each call consumes the next outcome and records what it was given. */
function fakeModels(outcomes: Outcome[]) {
  const calls: Array<{ model: string; config: Record<string, unknown>; contents: unknown }> = [];
  const client = {
    calls,
    generateContent: async (params: GenerateContentParameters) => {
      calls.push({ model: params.model, config: (params.config ?? {}) as Record<string, unknown>, contents: params.contents });
      const outcome = outcomes.shift();
      if (outcome === "ok") return { text: `from ${params.model}`, candidates: [], usageMetadata: { promptTokenCount: 3 } } as never;
      if (outcome === "empty") return { text: "", candidates: [{ finishReason: "STOP" }] } as never;
      // What the real SDK throws when its per-attempt timeout fires (see the real-SDK tests below).
      if (outcome === "abort") throw new DOMException("This operation was aborted", "AbortError");
      if (outcome === "timeout-error") throw new DOMException("The operation timed out", "TimeoutError");
      if (outcome === "undici-timeout") throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT" }) });
      if (outcome === "other-error") throw new Error("socket exploded");
      if (typeof outcome === "object") throw new ApiError(outcome);
      throw new ApiError({ message: `status ${outcome}`, status: outcome as number });
    },
  };
  return client satisfies GeminiModelsClient;
}

describe("GeminiProvider", () => {
  it("uses the primary model when it works and reports usage", async () => {
    const models = fakeModels(["ok"]);
    const response = await new GeminiProvider(options, models).generate(request);
    expect(response).toMatchObject({ text: "from primary", model: "gemini:primary", usage: { inputTokens: 3 } });
    expect(models.calls).toHaveLength(1);
  });

  it("503 on the primary succeeds on the fallback", async () => {
    const models = fakeModels([503, "ok"]);
    const response = await new GeminiProvider(options, models).generate(request);
    expect(response.model).toBe("gemini:fallback-1");
    expect(models.calls.map((c) => c.model)).toEqual(["primary", "fallback-1"]);
  });

  it("walks the whole chain in order, each model once, then gives up with UNAVAILABLE", async () => {
    const models = fakeModels([503, 503, 503, "ok"]);
    await expect(new GeminiProvider(options, models).generate(request)).rejects.toMatchObject({ kind: "UNAVAILABLE", status: 503 });
    expect(models.calls.map((c) => c.model)).toEqual(["primary", "fallback-1", "fallback-2"]);
  });

  it("504 DEADLINE_EXCEEDED falls through to the next model", async () => {
    const models = fakeModels([504, "ok"]);
    const response = await new GeminiProvider(options, models).generate(request);
    expect(response.model).toBe("gemini:fallback-1");
    expect(models.calls.map((c) => c.model)).toEqual(["primary", "fallback-1"]);
  });

  it.each(["abort", "timeout-error", "undici-timeout"] as const)("a client-side timeout (%s) falls through to the next model", async (shape) => {
    const models = fakeModels([shape, shape, "ok"]);
    const response = await new GeminiProvider(options, models).generate(request);
    expect(response.model).toBe("gemini:fallback-2");
    expect(models.calls.map((c) => c.model)).toEqual(["primary", "fallback-1", "fallback-2"]);
  });

  it("when every model times out, the error is UNAVAILABLE", async () => {
    const models = fakeModels(["abort", "abort", "abort"]);
    await expect(new GeminiProvider(options, models).generate(request)).rejects.toMatchObject({ kind: "UNAVAILABLE", status: 504 });
    expect(models.calls).toHaveLength(3);
  });

  it("an unrecognised error does not fall through", async () => {
    const models = fakeModels(["other-error", "ok"]);
    await expect(new GeminiProvider(options, models).generate(request)).rejects.toMatchObject({ kind: "UNAVAILABLE" });
    expect(models.calls).toHaveLength(1);
  });

  it("429 on the primary succeeds on the fallback (free-tier quota is per model)", async () => {
    const models = fakeModels([429, "ok"]);
    const response = await new GeminiProvider(options, models).generate(request);
    expect(response.model).toBe("gemini:fallback-1");
    expect(models.calls.map((c) => c.model)).toEqual(["primary", "fallback-1"]);
  });

  it("429 on the primary and the first fallback still reaches the last model", async () => {
    const models = fakeModels([429, 429, "ok"]);
    const response = await new GeminiProvider(options, models).generate(request);
    expect(response.model).toBe("gemini:fallback-2");
    expect(models.calls.map((c) => c.model)).toEqual(["primary", "fallback-1", "fallback-2"]);
  });

  it("a timeout then a 429 both fall through to the next model", async () => {
    const models = fakeModels(["abort", 429, "ok"]);
    const response = await new GeminiProvider(options, models).generate(request);
    expect(response.model).toBe("gemini:fallback-2");
    expect(models.calls).toHaveLength(3);
  });

  it("503 then 429 then success walks on to the third model", async () => {
    const models = fakeModels([503, 429, "ok"]);
    const response = await new GeminiProvider(options, models).generate(request);
    expect(response.model).toBe("gemini:fallback-2");
    expect(models.calls.map((c) => c.model)).toEqual(["primary", "fallback-1", "fallback-2"]);
  });

  it("429 on every model throws RATE_LIMITED with the last model's detail, calling each model once", async () => {
    const models = fakeModels([
      { status: 429, message: perDayBody("primary") },
      { status: 429, message: perDayBody("fallback-1") },
      { status: 429, message: perMinuteBody("fallback-2") },
    ]);
    const error = await new GeminiProvider(options, models).generate(request).catch((e) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect(error.kind).toBe("RATE_LIMITED");
    expect(error.status).toBe(429);
    expect(error.message).toBe("Gemini free rate limit reached for fallback-2 (5 requests per minute). Try again in about 35 s.");
    expect(models.calls.map((c) => c.model)).toEqual(["primary", "fallback-1", "fallback-2"]);
  });

  it("if the last model fails with 503 after earlier 429s, the last error (UNAVAILABLE) surfaces", async () => {
    const models = fakeModels([429, 429, 503]);
    await expect(new GeminiProvider(options, models).generate(request)).rejects.toMatchObject({ kind: "UNAVAILABLE", status: 503 });
    expect(models.calls).toHaveLength(3);
  });

  it("with no fallbacks, a 429 throws RATE_LIMITED after one call", async () => {
    const models = fakeModels([429, "ok"]);
    await expect(new GeminiProvider({ ...options, fallbackModels: "" }, models).generate(request)).rejects.toMatchObject({ kind: "RATE_LIMITED" });
    expect(models.calls).toHaveLength(1);
  });

  it("a non-quota error after a 429 stops the chain (a bad key is not masked)", async () => {
    const models = fakeModels([429, 401, "ok"]);
    await expect(new GeminiProvider(options, models).generate(request)).rejects.toMatchObject({ kind: "CONFIG" });
    expect(models.calls).toHaveLength(2);
  });

  it("the 429 message names the model and the per-day limit, taken from a realistic body", async () => {
    const models = fakeModels([{ status: 429, message: perDayBody("primary") }]);
    const error = await new GeminiProvider({ ...options, fallbackModels: "" }, models).generate(request).catch((e) => e);
    expect(error.message).toBe("Gemini free quota used up for primary (20 requests per day). Resets in about 7 h.");
  });

  it("a 429 body without details gives the generic text", async () => {
    const models = fakeModels([429]);
    const error = await new GeminiProvider({ ...options, fallbackModels: "" }, models).generate(request).catch((e) => e);
    expect(error.message).toBe("Gemini quota or rate limit reached.");
  });

  it("a fake API key echoed inside the 429 body never appears in the thrown message", async () => {
    const key = "AIzaSyFAKE-KEY-0123456789abcdefghijklmnopq";
    const hostile = quotaBody(
      {
        quotaMetric: `generativelanguage.googleapis.com/generate_content_free_tier_requests?key=${key}`,
        quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
        quotaDimensions: { location: "global", model: key },
        quotaValue: "20",
      },
      "28118s",
      { message: `Quota exceeded for key ${key}` },
    );
    const bodies = [
      hostile,
      `request to https://x/models/m:generateContent?key=${key} failed`,
      `{"quotaId": "${key}", "quotaValue": "${key}", "retryDelay": "${key}"}`,
    ];
    for (const message of bodies) {
      const models = fakeModels([{ status: 429, message }]);
      const error = await new GeminiProvider({ ...options, apiKey: key, fallbackModels: "" }, models).generate(request).catch((e) => e);
      expect(error.kind).toBe("RATE_LIMITED");
      expect(error.message).not.toContain(key);
      expect(error.message).not.toContain("AIza");
    }
  });

  it("does not fall back on 400", async () => {
    const models = fakeModels([400, "ok"]);
    await expect(new GeminiProvider(options, models).generate(request)).rejects.toMatchObject({ kind: "UNAVAILABLE", status: 400 });
    expect(models.calls).toHaveLength(1);
  });

  it("maps 401 to CONFIG without falling back", async () => {
    const models = fakeModels([401, "ok"]);
    await expect(new GeminiProvider(options, models).generate(request)).rejects.toMatchObject({ kind: "CONFIG" });
    expect(models.calls).toHaveLength(1);
  });

  it("blank fallback list disables fallbacks", async () => {
    const models = fakeModels([503, "ok"]);
    await expect(new GeminiProvider({ ...options, fallbackModels: "" }, models).generate(request)).rejects.toMatchObject({ status: 503 });
    expect(models.calls).toHaveLength(1);
  });

  it("empty response is BAD_RESPONSE", async () => {
    const models = fakeModels(["empty"]);
    await expect(new GeminiProvider(options, models).generate(request)).rejects.toMatchObject({ kind: "BAD_RESPONSE" });
  });

  it("passes the JSON schema through as responseJsonSchema with a JSON mime type", async () => {
    const schema = { type: "object", properties: { message: { type: "string" } }, required: ["message"] };
    const models = fakeModels(["ok"]);
    await new GeminiProvider(options, models).generate({ ...request, jsonSchema: schema, maxOutputTokens: 256 });
    expect(models.calls[0]!.config).toMatchObject({
      systemInstruction: "sys",
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      maxOutputTokens: 256,
    });
  });

  it("omits JSON config when no schema is given, and maps roles to user/model", async () => {
    const models = fakeModels(["ok"]);
    await new GeminiProvider(options, models).generate({
      system: "s",
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
    });
    expect(models.calls[0]!.config).not.toHaveProperty("responseMimeType");
    expect(models.calls[0]!.config).not.toHaveProperty("responseJsonSchema");
    expect(models.calls[0]!.contents).toEqual([
      { role: "user", parts: [{ text: "a" }] },
      { role: "model", parts: [{ text: "b" }] },
    ]);
  });

  it("without an API key and no injected client, throws CONFIG", () => {
    expect(() => new GeminiProvider({ ...options, apiKey: "  " })).toThrowError(expect.objectContaining({ kind: "CONFIG" }));
  });
});

describe("rateLimitMessage", () => {
  it("per-day body", () => {
    expect(rateLimitMessage(perDayBody("gemini-3.5-flash"), "gemini-3.5-flash")).toBe(
      "Gemini free quota used up for gemini-3.5-flash (20 requests per day). Resets in about 7 h.",
    );
  });

  it("per-minute body", () => {
    expect(rateLimitMessage(perMinuteBody("m"), "m")).toBe("Gemini free rate limit reached for m (5 requests per minute). Try again in about 35 s.");
  });

  it("token quotas say tokens, not requests", () => {
    const body = quotaBody({ quotaId: "GenerateContentInputTokensPerModelPerMinute-FreeTier", quotaValue: "250000" }, "12s");
    expect(rateLimitMessage(body, "m")).toBe("Gemini free rate limit reached for m (250000 tokens per minute). Try again in about 12 s.");
  });

  it.each([
    ["59s", "59 s"],
    ["60s", "1 min"],
    ["90s", "2 min"],
    ["3599s", "60 min"],
    ["3600s", "1 h"],
    ["0.4s", "1 s"],
  ])("retryDelay %s reads as %s", (delay, shown) => {
    const body = quotaBody({ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }, delay);
    expect(rateLimitMessage(body, "m")).toBe(`Gemini free quota used up for m (20 requests per day). Resets in about ${shown}.`);
  });

  it("works with only some fields, an unknown quotaId, or JSON escaped a second time", () => {
    expect(rateLimitMessage(quotaBody({ quotaId: "SomethingNew", quotaValue: "7" }), "m")).toBe("Gemini quota or rate limit reached for m (limit 7).");
    expect(rateLimitMessage(JSON.stringify({ retryDelay: "120s" }), "m")).toBe("Gemini quota or rate limit reached for m. Resets in about 2 min.");
    expect(rateLimitMessage(JSON.stringify(perDayBody("m")), "m")).toBe("Gemini free quota used up for m (20 requests per day). Resets in about 7 h.");
    expect(rateLimitMessage(perDayBody("m"))).toBe("Gemini free quota used up (20 requests per day). Resets in about 7 h.");
  });

  it.each(["", "status 429", "not json {{{", '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}', '{"quotaValue": "twenty", "retryDelay": "soon"}'])(
    "falls back to the generic text for %j",
    (raw) => {
      expect(rateLimitMessage(raw, "m")).toBe("Gemini quota or rate limit reached.");
    },
  );
});

// These use the real SDK against a local HTTP server (GOOGLE_GEMINI_BASE_URL), no network or quota.
describe("GeminiProvider with the real SDK and a local server", () => {
  let server: Server;
  let baseUrl: string;
  const seen: Array<{ url: string; timeoutHeader: string | undefined }> = [];
  const savedBase = process.env.GOOGLE_GEMINI_BASE_URL;

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ url: req.url ?? "", timeoutHeader: req.headers["x-server-timeout"] as string | undefined });
      if ((req.url ?? "").includes("models/slow")) return; // never answer
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "hello from local" }] }, finishReason: "STOP" }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.GOOGLE_GEMINI_BASE_URL = baseUrl;
  });

  afterAll(async () => {
    if (savedBase === undefined) delete process.env.GOOGLE_GEMINI_BASE_URL;
    else process.env.GOOGLE_GEMINI_BASE_URL = savedBase;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it("a hung model times out after timeoutMs and the next model answers; the timeout reaches the SDK", async () => {
    seen.length = 0;
    const provider = new GeminiProvider({ apiKey: "k", model: "slow", fallbackModels: "fast", timeoutMs: 300 });
    const started = Date.now();
    const response = await provider.generate(request);
    const elapsed = Date.now() - started;

    expect(response).toMatchObject({ text: "hello from local", model: "gemini:fast" });
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(5000);
    expect(seen.map((s) => s.url.includes("models/slow") ? "slow" : "fast")).toEqual(["slow", "fast"]);
    expect(seen[0]!.timeoutHeader).toBe("1"); // SDK sends X-Server-Timeout = ceil(timeoutMs / 1000)
  });

  it("if every model hangs, the failure is UNAVAILABLE after one timeout per model", async () => {
    const provider = new GeminiProvider({ apiKey: "k", model: "slow", fallbackModels: "slow2", timeoutMs: 200 });
    const started = Date.now();
    await expect(provider.generate(request)).rejects.toMatchObject({ kind: "UNAVAILABLE" });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
