// How a provider failure becomes the error card text (src/server/http.ts), and the server log line for a missing key.
import { describe, expect, it } from "vitest";
import { ReplyFailedError } from "../src/core/domain/errors";
import { LLMError } from "../src/core/llm/provider";
import { KEY_MISSING_MESSAGE, KEY_REJECTED_MESSAGE, errorResponse } from "../src/server/http";
import { createProvider } from "../src/server/providers";

async function bodyOf(error: unknown) {
  const response = errorResponse(error);
  return { status: response.status, body: await response.json() };
}

describe("errorResponse for a Gemini key problem", () => {
  it("a rejected key says the key is not working, points to Settings, and carries the settings action", async () => {
    const { status, body } = await bodyOf(new LLMError("CONFIG", "Gemini rejected the API key. Check GEMINI_API_KEY.", 400));
    expect(status).toBe(500);
    expect(body.error).toEqual({ kind: "CONFIG", message: "ANNA's Gemini key isn't working. Update it in Settings.", action: "settings" });
    expect(KEY_REJECTED_MESSAGE).toBe("ANNA's Gemini key isn't working. Update it in Settings.");
  });

  it("a missing key says so, also pointing to Settings", async () => {
    const { body } = await bodyOf(new LLMError("CONFIG", "GEMINI_API_KEY is not set. Set it up in ANNA's Settings."));
    expect(body.error).toEqual({ kind: "CONFIG", message: KEY_MISSING_MESSAGE, action: "settings" });
  });

  it("the message never names an environment variable or a file", async () => {
    for (const message of ["Gemini rejected the API key. Check GEMINI_API_KEY.", "GEMINI_API_KEY is not set."]) {
      const { body } = await bodyOf(new LLMError("CONFIG", message));
      expect(body.error.message).not.toMatch(/GEMINI_API_KEY|\.env|config\.env/);
    }
  });

  it("holds when the user's message was saved first (the Retry card)", async () => {
    const failed = new ReplyFailedError("c1", { id: "m1" } as never, new LLMError("CONFIG", "Gemini rejected the API key. Check GEMINI_API_KEY.", 403));
    const { body } = await bodyOf(failed);
    expect(body.error).toMatchObject({ kind: "CONFIG", message: KEY_REJECTED_MESSAGE, action: "settings" });
    expect(body.conversationId).toBe("c1");
  });

  it("also works when the error comes from another copy of the core modules (same name, not the same class)", async () => {
    class LLMError extends Error {
      name = "LLMError";
      constructor(
        readonly kind: string,
        message: string,
      ) {
        super(message);
      }
    }
    class ReplyFailedError extends Error {
      name = "ReplyFailedError";
      constructor(
        readonly conversationId: string,
        readonly userMessage: unknown,
        readonly cause: unknown,
      ) {
        super("x");
      }
    }
    const { body } = await bodyOf(new ReplyFailedError("c9", { id: "m9" }, new LLMError("CONFIG", "Gemini rejected the API key. Check GEMINI_API_KEY.")));
    expect(body.error).toMatchObject({ kind: "CONFIG", message: KEY_REJECTED_MESSAGE, action: "settings" });
    expect(body.conversationId).toBe("c9");
  });

  it("other CONFIG errors, and other kinds, keep their own text and carry no action", async () => {
    const config = await bodyOf(new LLMError("CONFIG", "GEMINI_TIMEOUT_MS must be a positive whole number of milliseconds (got \"x\")."));
    expect(config.body.error.action).toBeUndefined();
    const down = await bodyOf(new LLMError("UNAVAILABLE", "Gemini API error (503)", 503));
    expect(down.body.error).toEqual({ kind: "UNAVAILABLE", message: "Gemini API error (503)" });
    const quota = await bodyOf(new LLMError("RATE_LIMITED", "Gemini quota or rate limit reached.", 429));
    expect(quota.status).toBe(429);
    expect(quota.body.error.action).toBeUndefined();
  });
});

describe("the server log line for a missing key", () => {
  function logFor(env: Record<string, string>): string {
    const lines: string[] = [];
    createProvider({ ANNA_PROVIDER: "gemini", ...env }, (line) => lines.push(line));
    return lines.join("\n");
  }

  it("in tester mode it does not mention .env; it says to use Settings", () => {
    const log = logFor({ ANNA_DATA_DIR: "C:\\Users\\Someone\\AppData\\Local\\ANNA" });
    expect(log).toContain("GEMINI_API_KEY is not set");
    expect(log).toContain("Set it up in ANNA's Settings");
    expect(log).not.toMatch(/\.env/);
  });

  it("in dev mode it still says Settings first, and may name .env", () => {
    const log = logFor({});
    expect(log).toContain("Set it up in ANNA's Settings");
  });
});
