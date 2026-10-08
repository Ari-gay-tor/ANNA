import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LLMError, type LLMProvider, type LLMRequest } from "../src/core/llm/provider";
import {
  GEMINI_KEY_PATTERN,
  GeminiKeyBody,
  cheapestDefaultModel,
  checkGeminiKey,
  keyStatus,
  setupRequired,
  updateGeminiKey,
  type KeyCheck,
} from "../src/server/key-setup";

const KEY = "AIzaSyA-fake-test-key_0123456789abcdefgh";

describe("setupRequired: is a usable provider key configured?", () => {
  it("no key: setup is required (Gemini is the default provider)", () => {
    expect(setupRequired({})).toBe(true);
    expect(setupRequired({ ANNA_PROVIDER: "gemini" })).toBe(true);
    expect(setupRequired({ GEMINI_API_KEY: "   " })).toBe(true);
  });

  it("a key: setup is not required", () => {
    expect(setupRequired({ GEMINI_API_KEY: KEY })).toBe(false);
    expect(setupRequired({ ANNA_PROVIDER: "gemini", GEMINI_API_KEY: KEY })).toBe(false);
  });

  it("the fake provider needs no key, and a configured local model counts as usable", () => {
    expect(setupRequired({ ANNA_PROVIDER: "fake" })).toBe(false);
    expect(setupRequired({ ANNA_PROVIDER: "openai-compatible" })).toBe(true);
    expect(setupRequired({ ANNA_PROVIDER: "openai-compatible", OPENAI_COMPAT_BASE_URL: "http://localhost:11434/v1", OPENAI_COMPAT_MODEL: "m" })).toBe(false);
  });

  it("a chain is usable when any provider in it is", () => {
    expect(setupRequired({ ANNA_PROVIDER: "gemini,fake" })).toBe(false);
    expect(setupRequired({ ANNA_PROVIDER: "gemini,openai-compatible" })).toBe(true);
  });
});

describe("keyStatus: only the last 4 characters, never the key", () => {
  it("no key", () => {
    expect(keyStatus({})).toEqual({ configured: false, last4: null });
  });

  it("a key shows its last 4 characters and nothing else", () => {
    const status = keyStatus({ GEMINI_API_KEY: KEY });
    expect(status).toEqual({ configured: true, last4: KEY.slice(-4) });
    expect(JSON.stringify(status)).not.toContain(KEY);
  });

  it("a short key shows no characters at all", () => {
    expect(keyStatus({ GEMINI_API_KEY: "short-key" })).toEqual({ configured: true, last4: null });
  });
});

describe("the key body", () => {
  it("trims, and accepts the characters Google keys use", () => {
    expect(GeminiKeyBody.parse({ key: `  ${KEY}\n` }).key).toBe(KEY);
    expect(GeminiKeyBody.safeParse({ key: "AQ.Ab8RN6-new.style_key" }).success).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["   ", "blank"],
    ["abc def ghijklmn", "inner space"],
    ["abcd\nefghijklmn=1", "line break"],
    ["short", "too short"],
    ["x".repeat(201), "too long"],
    ['abcdefgh"; rm', "quote and semicolon"],
    ["abcdefgh#comment", "hash"],
  ])("rejects %j (%s)", (key) => {
    expect(GeminiKeyBody.safeParse({ key }).success).toBe(false);
  });

  it("pattern: non-empty, no whitespace, capped", () => {
    expect(GEMINI_KEY_PATTERN.test(KEY)).toBe(true);
    expect(GEMINI_KEY_PATTERN.test(`${KEY} `)).toBe(false);
  });
});

describe("checkGeminiKey: one tiny call, mapped to a result", () => {
  const failing = (error: unknown): ((key: string) => LLMProvider) => () => ({
    generate: async () => {
      throw error;
    },
  });

  it("uses the cheapest model in the default chain (the lite one)", () => {
    expect(cheapestDefaultModel()).toBe("gemini-3.5-flash-lite");
  });

  it("an answer is valid, and the call is tiny", async () => {
    const generate = vi.fn(async (_request: LLMRequest) => ({ text: "OK", model: "m" }));
    expect(await checkGeminiKey(KEY, () => ({ generate }))).toBe("valid");
    expect(generate).toHaveBeenCalledTimes(1);
    const request = generate.mock.calls[0]![0];
    expect(request.maxOutputTokens).toBeLessThanOrEqual(16);
    expect(request.messages).toHaveLength(1);
  });

  it.each<[LLMError, KeyCheck]>([
    [new LLMError("CONFIG", "Gemini rejected the API key."), "invalid"],
    [new LLMError("RATE_LIMITED", "Gemini quota or rate limit reached.", 429), "quota"],
    [new LLMError("UNAVAILABLE", "Gemini API error (503)", 503), "unreachable"],
    [new LLMError("BAD_RESPONSE", "Empty response"), "valid"], // Google answered, so the key is accepted
    [new LLMError("BLOCKED", "blocked"), "valid"],
  ])("%s -> %s", async (error, expected) => {
    expect(await checkGeminiKey(KEY, failing(error))).toBe(expected);
  });

  it("any other failure (no network, ...) is unreachable, never valid", async () => {
    expect(await checkGeminiKey(KEY, failing(new TypeError("fetch failed")))).toBe("unreachable");
  });
});

describe("updateGeminiKey", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "anna-key-"));
    dirs.push(dir);
    const configFile = join(dir, "data", "config.env");
    const env: Record<string, string | undefined> = {};
    const resetServices = vi.fn();
    const logs: string[] = [];
    return { dir, configFile, env, resetServices, logs, log: (line: string) => logs.push(line) };
  }

  it("a valid key is saved to the config file, put in the environment, and the services are reset", async () => {
    const t = setup();
    const result = await updateGeminiKey(KEY, { ...t, check: async () => "valid" });
    expect(result).toEqual({ status: "valid" });
    expect(readFileSync(t.configFile, "utf8")).toBe(`GEMINI_API_KEY=${KEY}\n`);
    expect(t.env.GEMINI_API_KEY).toBe(KEY);
    expect(t.resetServices).toHaveBeenCalledTimes(1);
  });

  it("keeps the other lines of an existing config file", async () => {
    const t = setup();
    const file = join(t.dir, "keep.env");
    writeFileSync(file, "# mine\nANNA_PORT=3747\nGEMINI_API_KEY=old-key-1234\nGEMINI_MODEL=gemini-3.8-flash\n");
    await updateGeminiKey(KEY, { ...t, configFile: file, check: async () => "valid" });
    expect(readFileSync(file, "utf8")).toBe(`# mine\nANNA_PORT=3747\nGEMINI_API_KEY=${KEY}\nGEMINI_MODEL=gemini-3.8-flash\n`);
  });

  it("quota used up: the key works, so it is saved anyway", async () => {
    const t = setup();
    expect(await updateGeminiKey(KEY, { ...t, check: async () => "quota" })).toEqual({ status: "quota" });
    expect(readFileSync(t.configFile, "utf8")).toContain(KEY);
    expect(t.resetServices).toHaveBeenCalledTimes(1);
  });

  it.each<KeyCheck>(["invalid", "unreachable"])("%s: nothing is saved, the environment is untouched, nothing is reset", async (check) => {
    const t = setup();
    t.env.GEMINI_API_KEY = "previous-key-1234";
    expect(await updateGeminiKey(KEY, { ...t, check: async () => check })).toEqual({ status: check });
    expect(() => readFileSync(t.configFile)).toThrow();
    expect(t.env.GEMINI_API_KEY).toBe("previous-key-1234");
    expect(t.resetServices).not.toHaveBeenCalled();
  });

  it("when the file cannot be written: save_failed, and the new key is not used", async () => {
    const t = setup();
    const blocker = join(t.dir, "blocker");
    writeFileSync(blocker, "a file, not a folder");
    const result = await updateGeminiKey(KEY, { ...t, configFile: join(blocker, "config.env"), check: async () => "valid" });
    expect(result).toEqual({ status: "save_failed" });
    expect(t.env.GEMINI_API_KEY).toBeUndefined();
    expect(t.resetServices).not.toHaveBeenCalled();
  });

  it("never writes the key to the log", async () => {
    const t = setup();
    await updateGeminiKey(KEY, { ...t, check: async () => "valid" });
    await updateGeminiKey(KEY, { ...t, check: async () => "invalid" });
    expect(t.logs.length).toBeGreaterThan(0);
    expect(t.logs.join("\n")).not.toContain(KEY);
  });
});
