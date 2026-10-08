// GET/PUT /api/settings/key: the masked key, the local-only guard, and the whole save path with Google replaced by a fake.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Services } from "../src/server/anna";
const PACKAGE_VERSION = (JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string }).version;

const fake = vi.hoisted(() => ({ created: [] as Array<{ apiKey: string; model: string; fallbackModels: string }>, calls: 0 }));

vi.mock("../src/core/llm/gemini", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/llm/gemini")>();
  const { LLMError } = await import("../src/core/llm/provider");
  class FakeGemini {
    constructor(private readonly options: { apiKey: string; model: string; fallbackModels: string }) {
      fake.created.push(options);
    }
    async generate() {
      fake.calls++;
      if (this.options.apiKey.startsWith("BAD")) throw new LLMError("CONFIG", "Gemini rejected the API key. Check GEMINI_API_KEY.", 400);
      if (this.options.apiKey.startsWith("QUOTA")) throw new LLMError("RATE_LIMITED", "Gemini quota or rate limit reached.", 429);
      if (this.options.apiKey.startsWith("DOWN")) throw new LLMError("UNAVAILABLE", "Gemini API error (503)", 503);
      return { text: "OK", model: "gemini:fake" };
    }
  }
  return { ...actual, GeminiProvider: FakeGemini };
});

import { GET, PUT } from "../src/app/api/settings/key/route";

const globalForServices = globalThis as unknown as { __annaServices?: Services };
const VARS = ["GEMINI_API_KEY", "ANNA_DATA_DIR", "ANNA_PROVIDER"] as const;
const saved: Partial<Record<(typeof VARS)[number], string | undefined>> = {};
let dataDir: string;

beforeEach(() => {
  for (const name of VARS) saved[name] = process.env[name];
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANNA_PROVIDER;
  dataDir = mkdtempSync(join(tmpdir(), "anna-keyroute-"));
  process.env.ANNA_DATA_DIR = dataDir;
  fake.created.length = 0;
  fake.calls = 0;
});
afterEach(() => {
  for (const name of VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  delete globalForServices.__annaServices;
  rmSync(dataDir, { recursive: true, force: true });
});

const URL_ = "http://127.0.0.1:3737/api/settings/key";
function get(headers: Record<string, string> = {}) {
  return GET(new Request(URL_, { headers: { host: "127.0.0.1:3737", ...headers } }));
}
function put(body: unknown, headers: Record<string, string> = {}) {
  return PUT(
    new Request(URL_, {
      method: "PUT",
      headers: { host: "127.0.0.1:3737", "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const GOOD = "AIzaSyFakeGoodKey_0123456789abcdEFGH";

describe("GET /api/settings/key", () => {
  it("with no key: setup is required, and there is nothing to show", async () => {
    const body = await (await get()).json();
    expect(body).toMatchObject({ required: true, configured: false, last4: null, mode: "tester", dataDir, version: PACKAGE_VERSION });
  });

  it("with a key: setup is not required, and only the last 4 characters come back, never the key", async () => {
    process.env.GEMINI_API_KEY = GOOD;
    const response = await get();
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ required: false, configured: true, last4: GOOD.slice(-4) });
    expect(text).not.toContain(GOOD);
    expect(text).not.toContain(GOOD.slice(0, 12));
  });

  it("answers only requests for this PC", async () => {
    expect((await get({ host: "anna.example.com" })).status).toBe(403);
    expect((await get({ origin: "https://evil.example" })).status).toBe(403);
    expect((await get({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await get({ host: "localhost:3737", origin: "http://localhost:3737" })).status).toBe(200);
  });
});

describe("PUT /api/settings/key", () => {
  it("a good key: checked with the cheapest default model and no fallbacks, saved to config.env, used at once, services reset", async () => {
    globalForServices.__annaServices = { sentinel: true } as unknown as Services;
    const response = await put({ key: `  ${GOOD}  ` });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ saved: true, status: "valid", configured: true, last4: GOOD.slice(-4) });
    expect(text).not.toContain(GOOD);

    expect(fake.created).toHaveLength(1);
    expect(fake.calls).toBe(1);
    expect(fake.created[0]).toMatchObject({ apiKey: GOOD, model: "gemini-3.5-flash-lite", fallbackModels: "" });

    expect(readFileSync(join(dataDir, "config.env"), "utf8")).toBe(`GEMINI_API_KEY=${GOOD}\n`);
    expect(process.env.GEMINI_API_KEY).toBe(GOOD);
    expect(globalForServices.__annaServices).toBeUndefined();
    // And the next GET sees it: setup is no longer required.
    expect(await (await get()).json()).toMatchObject({ required: false, last4: GOOD.slice(-4) });
  });

  it("a key Google rejects: a clear error, nothing saved, nothing reset", async () => {
    globalForServices.__annaServices = { sentinel: true } as unknown as Services;
    const response = await put({ key: "BAD-key-0123456789" });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toEqual({ kind: "CONFIG", message: "That key didn't work. Check that you copied all of it, then try again." });
    expect(() => readFileSync(join(dataDir, "config.env"))).toThrow();
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    expect(globalForServices.__annaServices).toBeDefined();
  });

  it("quota used up: saved anyway, with the plain message", async () => {
    const response = await put({ key: "QUOTA-key-0123456789" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ saved: true, status: "quota", message: "Key works but quota is used up today. Saved anyway." });
    expect(readFileSync(join(dataDir, "config.env"), "utf8")).toBe("GEMINI_API_KEY=QUOTA-key-0123456789\n");
    expect(process.env.GEMINI_API_KEY).toBe("QUOTA-key-0123456789");
  });

  it("Google cannot be reached: not saved, and it says so", async () => {
    const response = await put({ key: "DOWN-key-0123456789" });
    expect(response.status).toBe(503);
    expect((await response.json()).error.kind).toBe("UNAVAILABLE");
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
  });

  it.each([{}, { key: "" }, { key: "has space inside it" }, { key: "x".repeat(300) }, { key: 42 }, "not json"])("rejects a bad body %j before any call to Google", async (body) => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.kind).toBe("INVALID_REQUEST");
    expect(fake.created).toHaveLength(0);
  });

  it("accepts only requests from this PC, as JSON, and never reaches Google for the others", async () => {
    expect((await put({ key: GOOD }, { host: "anna.example.com" })).status).toBe(403);
    expect((await put({ key: GOOD }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await put({ key: GOOD }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await put({ key: GOOD }, { "content-type": "text/plain" })).status).toBe(403);
    expect(fake.created).toHaveLength(0);
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
  });

  it("the key is never in an error response", async () => {
    for (const key of ["BAD-key-0123456789", "DOWN-key-0123456789"]) {
      expect(await (await put({ key })).text()).not.toContain(key);
    }
  });
});
