// After a new key is saved the cached services are dropped, so the next request builds a provider with the key: no restart.
import { copyFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../src/core/llm/gemini", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/llm/gemini")>();
  const { LLMError } = await import("../src/core/llm/provider");
  class FakeGemini {
    constructor(private readonly options: { apiKey: string }) {
      // Like the real adapter: no key is a CONFIG error when the provider is built.
      if (!options.apiKey.trim()) throw new LLMError("CONFIG", "GEMINI_API_KEY is not set.");
    }
    async generate() {
      return { text: JSON.stringify({ message: `answered with the key ending ${this.options.apiKey.slice(-4)}` }), model: "gemini:fake" };
    }
  }
  return { ...actual, GeminiProvider: FakeGemini };
});

import { getPrisma } from "../src/data/prisma";
import { getServices, resetServices } from "../src/server/anna";

const SAVED = { DATABASE_URL: process.env.DATABASE_URL, ANNA_PROVIDER: process.env.ANNA_PROVIDER, GEMINI_API_KEY: process.env.GEMINI_API_KEY };

beforeAll(() => {
  const dir = join(process.cwd(), "node_modules", ".anna-test");
  const file = join(dir, `${randomUUID()}.db`);
  copyFileSync(join(dir, "template.db"), file);
  process.env.DATABASE_URL = `file:${file.replace(/\\/g, "/")}`;
  // Creating the Prisma client loads the repo .env into process.env (never over a variable that is already set, so DATABASE_URL above wins).
  // Create it first, then clear what the test controls.
  getPrisma();
  process.env.ANNA_PROVIDER = "gemini";
  delete process.env.GEMINI_API_KEY;
});
afterAll(async () => {
  resetServices();
  for (const [name, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("resetServices", () => {
  it("getServices is cached until it is reset, then builds a new set", () => {
    const first = getServices();
    expect(getServices()).toBe(first);
    resetServices();
    expect(getServices()).not.toBe(first);
  });

  it("a key saved after startup is used by the next message once the services are reset", async () => {
    resetServices();
    // No key yet: the reply fails with the CONFIG error.
    await expect(getServices().anna.handleMessage({ text: "hello" })).rejects.toMatchObject({ cause: { kind: "CONFIG" } });

    // The key arrives (the save endpoint sets the environment variable) but the cached provider has not seen it.
    process.env.GEMINI_API_KEY = "AIzaFakeKeyEndingAB12";
    await expect(getServices().anna.handleMessage({ text: "hello again" })).rejects.toMatchObject({ cause: { kind: "CONFIG" } });

    // After the reset, the same call works, with no restart.
    resetServices();
    const result = await getServices().anna.handleMessage({ text: "one more" });
    expect(result.assistantMessage.content).toBe("answered with the key ending AB12");
  });
});
