import { describe, expect, it } from "vitest";
import { FakeProvider } from "../src/core/llm/fake";
import { FallbackProvider } from "../src/core/llm/fallback";
import { LLMError, type LLMRequest } from "../src/core/llm/provider";

const request: LLMRequest = { system: "s", messages: [{ role: "user", content: "hi" }] };
const reply = (text: string) => JSON.stringify({ message: text });

function chain(...scripts: Array<Array<string | Error>>) {
  const providers = scripts.map((script, i) => ({ name: `p${i + 1}`, provider: new FakeProvider(script) }));
  const skipped: string[] = [];
  const fallback = new FallbackProvider(providers, ({ name, error }) => skipped.push(`${name}:${error.kind}`));
  return { fallback, providers: providers.map((p) => p.provider), skipped };
}

describe("FallbackProvider", () => {
  it("uses the first provider when it works and never touches the others", async () => {
    const { fallback, providers } = chain([reply("one")], [reply("two")]);
    expect((await fallback.generate(request)).text).toBe(reply("one"));
    expect(providers.map((p) => p.calls.length)).toEqual([1, 0]);
  });

  it("falls back on UNAVAILABLE", async () => {
    const { fallback, providers, skipped } = chain([new LLMError("UNAVAILABLE", "down", 503)], [reply("two")]);
    expect((await fallback.generate(request)).text).toBe(reply("two"));
    expect(providers.map((p) => p.calls.length)).toEqual([1, 1]);
    expect(skipped).toEqual(["p1:UNAVAILABLE"]);
  });

  it("falls back on RATE_LIMITED", async () => {
    const { fallback, skipped } = chain([new LLMError("RATE_LIMITED", "quota", 429)], [reply("two")]);
    expect((await fallback.generate(request)).text).toBe(reply("two"));
    expect(skipped).toEqual(["p1:RATE_LIMITED"]);
  });

  it.each(["CONFIG", "BLOCKED", "BAD_RESPONSE"] as const)("does not fall back on %s", async (kind) => {
    const { fallback, providers } = chain([new LLMError(kind, "stop here")], [reply("two")]);
    await expect(fallback.generate(request)).rejects.toMatchObject({ kind });
    expect(providers.map((p) => p.calls.length)).toEqual([1, 0]);
  });

  it("a CONFIG error in a later provider stops the chain and surfaces", async () => {
    const { fallback, providers } = chain([new LLMError("UNAVAILABLE", "down")], [new LLMError("CONFIG", "OPENAI_COMPAT_BASE_URL is not set.")], [reply("three")]);
    await expect(fallback.generate(request)).rejects.toMatchObject({ kind: "CONFIG", message: "OPENAI_COMPAT_BASE_URL is not set." });
    expect(providers.map((p) => p.calls.length)).toEqual([1, 1, 0]);
  });

  it("walks the whole list in order; when all fail, the last error surfaces", async () => {
    const { fallback, providers } = chain(
      [new LLMError("UNAVAILABLE", "first down", 503)],
      [new LLMError("RATE_LIMITED", "second quota", 429)],
      [new LLMError("UNAVAILABLE", "third down", 500)],
    );
    await expect(fallback.generate(request)).rejects.toMatchObject({ kind: "UNAVAILABLE", message: "third down", status: 500 });
    expect(providers.map((p) => p.calls.length)).toEqual([1, 1, 1]);
  });

  it("does not swallow unexpected (non-LLM) errors", async () => {
    const { fallback, providers } = chain([new Error("bug")], [reply("two")]);
    await expect(fallback.generate(request)).rejects.toThrow("bug");
    expect(providers[1]!.calls).toHaveLength(0);
  });

  it("rejects an empty provider list with CONFIG", () => {
    expect(() => new FallbackProvider([])).toThrowError(expect.objectContaining({ kind: "CONFIG" }));
  });
});
