import { ApiError, type GenerateContentParameters } from "@google/genai";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GeminiProvider, type GeminiModelsClient } from "../src/core/llm/gemini";
import { LLMError, type LLMRequest } from "../src/core/llm/provider";

const options = { apiKey: "unused", model: "primary", fallbackModels: "fallback-1,fallback-2" };
const request: LLMRequest = { system: "sys", messages: [{ role: "user", content: "hi" }] };

type Outcome = "ok" | 503 | 504 | 429 | 400 | 401 | "empty" | "abort" | "timeout-error" | "undici-timeout" | "other-error";

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

  it("429 after a timeout still stops the chain", async () => {
    const models = fakeModels(["abort", 429, "ok"]);
    await expect(new GeminiProvider(options, models).generate(request)).rejects.toMatchObject({ kind: "RATE_LIMITED" });
    expect(models.calls).toHaveLength(2);
  });

  it("429 throws RATE_LIMITED and the models client is called exactly once", async () => {
    const models = fakeModels([429, "ok"]);
    const error = await new GeminiProvider(options, models).generate(request).catch((e) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect(error.kind).toBe("RATE_LIMITED");
    expect(models.calls).toHaveLength(1);
  });

  it("429 on a fallback stops the chain", async () => {
    const models = fakeModels([503, 429, "ok"]);
    await expect(new GeminiProvider(options, models).generate(request)).rejects.toMatchObject({ kind: "RATE_LIMITED" });
    expect(models.calls).toHaveLength(2);
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
