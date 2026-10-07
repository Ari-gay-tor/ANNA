// Env -> provider wiring (src/server/providers.ts).
import { describe, expect, it } from "vitest";
import { FakeProvider } from "../src/core/llm/fake";
import { FallbackProvider } from "../src/core/llm/fallback";
import { GeminiProvider } from "../src/core/llm/gemini";
import { OpenAICompatibleProvider } from "../src/core/llm/openai-compatible";
import type { LLMRequest } from "../src/core/llm/provider";
import { createProvider, parseProviderNames, withReplyLogging } from "../src/server/providers";

const request: LLMRequest = { system: "s", messages: [{ role: "user", content: "hi" }] };

describe("parseProviderNames", () => {
  it.each([
    [undefined, ["gemini"]],
    ["", ["gemini"]],
    [" , ", ["gemini"]],
    ["fake", ["fake"]],
    [" Gemini , openai-compatible ", ["gemini", "openai-compatible"]],
    ["gemini,gemini,fake", ["gemini", "fake"]],
  ])("%j -> %j", (raw, expected) => {
    expect(parseProviderNames(raw)).toEqual(expected);
  });
});

describe("createProvider", () => {
  it("single provider is returned directly, not wrapped (unchanged behaviour)", () => {
    expect(createProvider({ ANNA_PROVIDER: "fake" })).toBeInstanceOf(FakeProvider);
    expect(createProvider({ ANNA_PROVIDER: "gemini", GEMINI_API_KEY: "k" })).toBeInstanceOf(GeminiProvider);
    expect(createProvider({ GEMINI_API_KEY: "k" })).toBeInstanceOf(GeminiProvider); // default is gemini
    expect(createProvider({ ANNA_PROVIDER: "openai-compatible", OPENAI_COMPAT_BASE_URL: "http://localhost:11434/v1", OPENAI_COMPAT_MODEL: "m" })).toBeInstanceOf(
      OpenAICompatibleProvider,
    );
  });

  it("a list becomes a FallbackProvider", () => {
    expect(createProvider({ ANNA_PROVIDER: "gemini,fake", GEMINI_API_KEY: "k" })).toBeInstanceOf(FallbackProvider);
  });

  it("missing Gemini key: CONFIG at reply time with a clear message, no crash", async () => {
    const provider = createProvider({ ANNA_PROVIDER: "gemini" });
    await expect(provider.generate(request)).rejects.toMatchObject({ kind: "CONFIG", message: expect.stringContaining("GEMINI_API_KEY is not set") });
  });

  it("unknown provider name: CONFIG listing the valid names", async () => {
    await expect(createProvider({ ANNA_PROVIDER: "bogus" }).generate(request)).rejects.toMatchObject({
      kind: "CONFIG",
      message: expect.stringContaining("gemini, openai-compatible, fake"),
    });
  });

  it.each([
    [{ OPENAI_COMPAT_MODEL: "m" }, "OPENAI_COMPAT_BASE_URL"],
    [{ OPENAI_COMPAT_BASE_URL: "http://localhost:11434/v1" }, "OPENAI_COMPAT_MODEL"],
    [{ OPENAI_COMPAT_BASE_URL: "http://x/v1", OPENAI_COMPAT_MODEL: "m", OPENAI_COMPAT_JSON_MODE: "yaml" }, "OPENAI_COMPAT_JSON_MODE"],
    [{ OPENAI_COMPAT_BASE_URL: "http://x/v1", OPENAI_COMPAT_MODEL: "m", OPENAI_COMPAT_TIMEOUT_MS: "soon" }, "OPENAI_COMPAT_TIMEOUT_MS"],
  ])("openai-compatible misconfigured (%j) -> CONFIG naming the variable", async (env, variable) => {
    const provider = createProvider({ ANNA_PROVIDER: "openai-compatible", ...env });
    await expect(provider.generate(request)).rejects.toMatchObject({ kind: "CONFIG", message: expect.stringContaining(variable) });
  });

  it.each(["abc", "0", "-5", "1.5"])("GEMINI_TIMEOUT_MS=%j -> CONFIG", async (value) => {
    const provider = createProvider({ ANNA_PROVIDER: "gemini", GEMINI_API_KEY: "k", GEMINI_TIMEOUT_MS: value });
    await expect(provider.generate(request)).rejects.toMatchObject({ kind: "CONFIG", message: expect.stringContaining("GEMINI_TIMEOUT_MS") });
  });

  it("blank GEMINI_TIMEOUT_MS uses the default (no error)", () => {
    expect(createProvider({ ANNA_PROVIDER: "gemini", GEMINI_API_KEY: "k", GEMINI_TIMEOUT_MS: "" })).toBeInstanceOf(GeminiProvider);
  });

  it("in a list, a misconfigured FIRST provider stops everything with CONFIG; a working later one is not used", async () => {
    const provider = createProvider({ ANNA_PROVIDER: "openai-compatible,fake" }); // base URL missing
    await expect(provider.generate(request)).rejects.toMatchObject({ kind: "CONFIG", message: expect.stringContaining("OPENAI_COMPAT_BASE_URL") });
  });

  it("in a list, a misconfigured LATER provider is fine until it is reached", async () => {
    const lines: string[] = [];
    const provider = createProvider({ ANNA_PROVIDER: "fake,openai-compatible" }, (l) => lines.push(l));
    expect((await provider.generate(request)).model).toBe("fake"); // first one answers; second never reached
    expect(lines.join("\n")).toContain('provider "openai-compatible" is misconfigured');
  });

  it("logs a skip line (no content) when falling back", async () => {
    // gemini with a bogus base URL would hit the network; use openai-compatible pointing at a refused port instead.
    const lines: string[] = [];
    const provider = createProvider(
      { ANNA_PROVIDER: "openai-compatible,fake", OPENAI_COMPAT_BASE_URL: "http://127.0.0.1:9/v1", OPENAI_COMPAT_MODEL: "m", OPENAI_COMPAT_TIMEOUT_MS: "2000" },
      (l) => lines.push(l),
    );
    const response = await provider.generate(request);
    expect(response.model).toBe("fake");
    expect(lines).toEqual(['[anna] provider "openai-compatible" failed (UNAVAILABLE), trying the next one']);
  });
});

describe("withReplyLogging", () => {
  it("logs one line with provider:model, duration and tokens, and never the content", async () => {
    const lines: string[] = [];
    const inner = {
      generate: async () => ({ text: "SECRET REPLY CONTENT", model: "gemini:gemini-3.5-flash", usage: { inputTokens: 12, outputTokens: 5 } }),
    };
    const response = await withReplyLogging(inner, (l) => lines.push(l)).generate({ system: "SECRET SYSTEM", messages: [{ role: "user", content: "SECRET USER" }] });
    expect(response.text).toBe("SECRET REPLY CONTENT");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[anna\] reply model=gemini:gemini-3\.5-flash ms=\d+ in=12 out=5$/);
    expect(lines[0]).not.toContain("SECRET");
  });

  it("logs nothing when the provider fails, and rethrows", async () => {
    const lines: string[] = [];
    const failing = { generate: async () => { throw new Error("boom"); } };
    await expect(withReplyLogging(failing, (l) => lines.push(l)).generate(request)).rejects.toThrow("boom");
    expect(lines).toEqual([]);
  });
});
