import { ApiError, type GenerateContentParameters } from "@google/genai";
import { describe, expect, it } from "vitest";
import { GeminiProvider, type GeminiModelsClient } from "../src/core/llm/gemini";
import { LLMError, type LLMRequest } from "../src/core/llm/provider";

const options = { apiKey: "unused", model: "primary", fallbackModels: "fallback-1,fallback-2" };
const request: LLMRequest = { system: "sys", messages: [{ role: "user", content: "hi" }] };

type Outcome = "ok" | 503 | 429 | 400 | 401 | "empty";

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
      throw new ApiError({ message: `status ${outcome}`, status: outcome as number });
    },
  };
  return client satisfies GeminiModelsClient;
}

describe("GeminiProvider", () => {
  it("uses the primary model when it works and reports usage", async () => {
    const models = fakeModels(["ok"]);
    const response = await new GeminiProvider(options, models).generate(request);
    expect(response).toMatchObject({ text: "from primary", model: "primary", usage: { inputTokens: 3 } });
    expect(models.calls).toHaveLength(1);
  });

  it("503 on the primary succeeds on the fallback", async () => {
    const models = fakeModels([503, "ok"]);
    const response = await new GeminiProvider(options, models).generate(request);
    expect(response.model).toBe("fallback-1");
    expect(models.calls.map((c) => c.model)).toEqual(["primary", "fallback-1"]);
  });

  it("walks the whole chain in order, each model once, then gives up with UNAVAILABLE", async () => {
    const models = fakeModels([503, 503, 503, "ok"]);
    await expect(new GeminiProvider(options, models).generate(request)).rejects.toMatchObject({ kind: "UNAVAILABLE", status: 503 });
    expect(models.calls.map((c) => c.model)).toEqual(["primary", "fallback-1", "fallback-2"]);
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
