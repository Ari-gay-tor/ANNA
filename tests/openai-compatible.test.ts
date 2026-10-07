import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { OpenAICompatibleProvider, type OpenAICompatibleOptions } from "../src/core/llm/openai-compatible";
import { LLMError, type LLMRequest } from "../src/core/llm/provider";

const BASE = "http://localhost:11434/v1";
const options: OpenAICompatibleOptions = { baseUrl: BASE, model: "llama3.1:8b" };
const schema = { type: "object", properties: { message: { type: "string" } }, required: ["message"] };
const request: LLMRequest = {
  system: "You are ANNA.",
  messages: [
    { role: "user", content: "first" },
    { role: "assistant", content: "second" },
    { role: "user", content: "third" },
  ],
  jsonSchema: schema,
};

interface Captured {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
  body: Record<string, any>;
}

/** Fake fetch: records the call and answers with `respond`. */
function fakeFetch(respond: (call: Captured) => Response | Promise<Response>) {
  const calls: Captured[] = [];
  const fn = (async (input: unknown, init: RequestInit = {}) => {
    const call: Captured = {
      url: String(input),
      init,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ok = (content: unknown = '{"message":"hi"}', extra: Record<string, unknown> = {}) =>
  Response.json({ model: "llama3.1:8b", choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 7, completion_tokens: 3 }, ...extra });

describe("OpenAICompatibleProvider request shape", () => {
  it("POSTs to {baseUrl}/chat/completions with the system message first, then history in order", async () => {
    const { fn, calls } = fakeFetch(() => ok());
    const response = await new OpenAICompatibleProvider({ ...options, baseUrl: `${BASE}///` }, fn).generate({ ...request, maxOutputTokens: 300 });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.body.model).toBe("llama3.1:8b");
    expect(calls[0]!.body.max_tokens).toBe(300);
    expect(calls[0]!.body.messages).toEqual([
      { role: "system", content: "You are ANNA." },
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
      { role: "user", content: "third" },
    ]);
    expect(response).toEqual({
      text: '{"message":"hi"}',
      model: "openai-compatible:llama3.1:8b",
      usage: { inputTokens: 7, outputTokens: 3 },
    });
  });

  it("sends no Authorization header when the key is empty or absent", async () => {
    for (const apiKey of [undefined, "", "   "]) {
      const { fn, calls } = fakeFetch(() => ok());
      await new OpenAICompatibleProvider({ ...options, apiKey }, fn).generate(request);
      expect(calls[0]!.headers).toEqual({ "Content-Type": "application/json" });
    }
  });

  it("sends Authorization: Bearer <key> when a key is set", async () => {
    const { fn, calls } = fakeFetch(() => ok());
    await new OpenAICompatibleProvider({ ...options, apiKey: " sk-test " }, fn).generate(request);
    expect(calls[0]!.headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer sk-test" });
  });

  it("json_schema mode (default): strict json_schema response_format named anna_response", async () => {
    const { fn, calls } = fakeFetch(() => ok());
    await new OpenAICompatibleProvider(options, fn).generate(request);
    expect(calls[0]!.body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "anna_response", schema, strict: true },
    });
    expect(calls[0]!.body.messages[0].content).toBe("You are ANNA."); // schema is not duplicated into the prompt
  });

  it("json_object mode: response_format json_object, and the schema goes into the system prompt", async () => {
    const { fn, calls } = fakeFetch(() => ok());
    await new OpenAICompatibleProvider({ ...options, jsonMode: "json_object" }, fn).generate(request);
    expect(calls[0]!.body.response_format).toEqual({ type: "json_object" });
    expect(calls[0]!.body.messages[0].content).toContain("You are ANNA.");
    expect(calls[0]!.body.messages[0].content).toContain(JSON.stringify(schema));
  });

  it("none mode: no response_format, schema in the system prompt", async () => {
    const { fn, calls } = fakeFetch(() => ok());
    await new OpenAICompatibleProvider({ ...options, jsonMode: "none" }, fn).generate(request);
    expect(calls[0]!.body).not.toHaveProperty("response_format");
    expect(calls[0]!.body.messages[0].content).toContain(JSON.stringify(schema));
  });

  it("without a jsonSchema, no response_format and an untouched system prompt in every mode", async () => {
    for (const jsonMode of ["json_schema", "json_object", "none"] as const) {
      const { fn, calls } = fakeFetch(() => ok("plain text"));
      await new OpenAICompatibleProvider({ ...options, jsonMode }, fn).generate({ system: "S", messages: [{ role: "user", content: "x" }] });
      expect(calls[0]!.body).not.toHaveProperty("response_format");
      expect(calls[0]!.body).not.toHaveProperty("max_tokens");
      expect(calls[0]!.body.messages[0]).toEqual({ role: "system", content: "S" });
    }
  });

  it("passes an abort signal to fetch", async () => {
    const { fn, calls } = fakeFetch(() => ok());
    await new OpenAICompatibleProvider(options, fn).generate(request);
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("OpenAICompatibleProvider error mapping", () => {
  const run = async (respond: (c: Captured) => Response | Promise<Response>, opts: Partial<OpenAICompatibleOptions> = {}) => {
    const { fn, calls } = fakeFetch(respond);
    const error = await new OpenAICompatibleProvider({ ...options, ...opts }, fn).generate(request).catch((e) => e);
    return { error: error as LLMError, calls };
  };

  it("429 -> RATE_LIMITED, called once", async () => {
    const { error, calls } = await run(() => new Response("slow down", { status: 429 }));
    expect(error).toBeInstanceOf(LLMError);
    expect(error.kind).toBe("RATE_LIMITED");
    expect(calls).toHaveLength(1);
  });

  it.each([401, 403])("%i -> CONFIG", async (status) => {
    const { error } = await run(() => new Response("nope", { status }));
    expect(error.kind).toBe("CONFIG");
    expect(error.message).toContain("OPENAI_COMPAT_API_KEY");
  });

  it("other 4xx -> UNAVAILABLE with the status and a short body slice", async () => {
    const body = JSON.stringify({ error: { message: "model 'x' not found, try pulling it first" } });
    const { error } = await run(() => new Response(body, { status: 404 }));
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.status).toBe(404);
    expect(error.message).toContain("404");
    expect(error.message).toContain("not found, try pulling it first");
    expect(error.message).toContain("ollama pull llama3.1:8b"); // base URL is Ollama's port
  });

  it("no ollama hint for a non-Ollama 404", async () => {
    const { error } = await run(() => new Response("missing", { status: 404 }), { baseUrl: "https://openrouter.ai/api/v1" });
    expect(error.message).toBe("The model server returned 404: missing");
  });

  it("truncates a long error body and collapses whitespace", async () => {
    const { error } = await run(() => new Response(`start\n\n${"x".repeat(5000)}`, { status: 400 }));
    expect(error.message.length).toBeLessThan(300);
    expect(error.message).toContain("start xxx");
    expect(error.message.endsWith("...")).toBe(true);
  });

  it("scrubs the API key if the server echoes it in an error body", async () => {
    const { error } = await run(() => new Response("bad header: Bearer sk-secret-123", { status: 400 }), { apiKey: "sk-secret-123" });
    expect(error.message).not.toContain("sk-secret-123");
    expect(error.message).toContain("[redacted]");
  });

  it.each([500, 502, 503, 504])("%i -> UNAVAILABLE", async (status) => {
    const { error } = await run(() => new Response("oops", { status }));
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.status).toBe(status);
  });

  it("network error -> UNAVAILABLE", async () => {
    const { error } = await run(() => {
      throw new TypeError("fetch failed");
    });
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.message).toContain("fetch failed");
  });

  it("timeout (TimeoutError / AbortError) -> UNAVAILABLE mentioning the seconds", async () => {
    for (const name of ["TimeoutError", "AbortError"]) {
      const { error } = await run(
        () => {
          throw new DOMException("aborted", name);
        },
        { timeoutMs: 5000 },
      );
      expect(error.kind).toBe("UNAVAILABLE");
      expect(error.message).toContain("5s");
    }
  });

  it("a hung server really times out via the signal", async () => {
    const hang = (async (_url: unknown, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
      })) as unknown as typeof fetch;
    const started = Date.now();
    const error = await new OpenAICompatibleProvider({ ...options, timeoutMs: 100 }, hang).generate(request).catch((e) => e);
    expect(error.kind).toBe("UNAVAILABLE");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("connection refused (Ollama) -> UNAVAILABLE 'Couldn't reach ... Is Ollama running?'", async () => {
    const { error } = await run(() => {
      throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), { code: "ECONNREFUSED" }) });
    });
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.message).toBe("Couldn't reach http://localhost:11434/v1. Is Ollama running?");
  });

  it("connection refused as an AggregateError (localhost on dual-stack) is recognised too", async () => {
    const { error } = await run(() => {
      const inner = Object.assign(new Error("connect ECONNREFUSED ::1:11434"), { code: "ECONNREFUSED" });
      throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new AggregateError([inner]), { code: "ECONNREFUSED" }) });
    });
    expect(error.message).toContain("Is Ollama running?");
  });

  it("connection refused hints: LM Studio port and generic", async () => {
    const refuse = () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    };
    expect((await run(refuse, { baseUrl: "http://localhost:1234/v1" })).error.message).toBe(
      "Couldn't reach http://localhost:1234/v1. Is the LM Studio server running?",
    );
    expect((await run(refuse, { baseUrl: "https://example.test/v1" })).error.message).toBe(
      "Couldn't reach https://example.test/v1. Is the server running?",
    );
  });

  it("real fetch against a closed local port -> the refused-connection message", async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise((resolve) => probe.close(resolve)); // now nothing listens on this port
    const error = await new OpenAICompatibleProvider({ ...options, baseUrl: `http://127.0.0.1:${port}/v1` })
      .generate(request)
      .catch((e) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect(error.kind).toBe("UNAVAILABLE");
    expect(error.message).toBe(`Couldn't reach http://127.0.0.1:${port}/v1. Is the server running?`);
  });

  it.each([
    ["no choices", { choices: [] }],
    ["choices missing", {}],
    ["message missing", { choices: [{}] }],
    ["content null", { choices: [{ message: { content: null } }] }],
    ["content empty", { choices: [{ message: { content: "" } }] }],
    ["content whitespace", { choices: [{ message: { content: "  \n " } }] }],
    ["content not a string", { choices: [{ message: { content: [{ type: "text" }] } }] }],
  ])("%s -> BAD_RESPONSE", async (_name, payload) => {
    const { error } = await run(() => Response.json(payload));
    expect(error.kind).toBe("BAD_RESPONSE");
  });

  it("a 200 with a non-JSON body -> BAD_RESPONSE", async () => {
    const { error } = await run(() => new Response("<html>proxy page</html>", { status: 200 }));
    expect(error.kind).toBe("BAD_RESPONSE");
  });
});

describe("OpenAICompatibleProvider construction", () => {
  it.each([
    [{ baseUrl: "", model: "m" }, "OPENAI_COMPAT_BASE_URL is not set"],
    [{ baseUrl: "not a url", model: "m" }, "not a valid"],
    [{ baseUrl: "ftp://x/v1", model: "m" }, "not a valid"],
    [{ baseUrl: BASE, model: "  " }, "OPENAI_COMPAT_MODEL is not set"],
    [{ baseUrl: BASE, model: "m", jsonMode: "bogus" as never }, "OPENAI_COMPAT_JSON_MODE"],
  ])("rejects %j with CONFIG", (opts, text) => {
    expect(() => new OpenAICompatibleProvider(opts)).toThrowError(expect.objectContaining({ kind: "CONFIG", message: expect.stringContaining(text) }));
  });
});
