// /api/onboarding: the status (never a key), the answers, complete and reset, and the local-only guard.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "../src/app/api/onboarding/route";
import { POST as postAnswers } from "../src/app/api/onboarding/answers/route";
import { POST as postComplete } from "../src/app/api/onboarding/complete/route";
import { POST as postReset } from "../src/app/api/onboarding/reset/route";
import { ONBOARDING_COMPLETED_KEY, USER_NAME_KEY } from "../src/core/runtime/onboarding-service";
import type { Services } from "../src/server/anna";
import { testAnna } from "./helpers";

const globalForServices = globalThis as unknown as { __annaServices?: Services };
const VARS = ["GEMINI_API_KEY", "ANNA_PROVIDER", "ANNA_DATA_DIR"] as const;
const saved: Partial<Record<(typeof VARS)[number], string | undefined>> = {};

let t: ReturnType<typeof testAnna>;
beforeEach(() => {
  for (const name of VARS) saved[name] = process.env[name];
  t = testAnna();
  // After testAnna(): creating the Prisma client reads the project's .env into process.env, which may hold a real key.
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANNA_PROVIDER;
  delete process.env.ANNA_DATA_DIR;
  globalForServices.__annaServices = {
    anna: t.anna,
    conversations: t.conversations,
    settings: t.settings,
    memories: t.memories,
    memoryService: t.memoryService,
    onboarding: t.onboarding,
    reminders: t.reminders,
    reminderService: t.reminderService,
    feedback: t.feedback,
  };
});
afterEach(async () => {
  for (const name of VARS) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  delete globalForServices.__annaServices;
  await t.db.$disconnect();
});

const BASE = "http://127.0.0.1:3737/api/onboarding";
const local = { host: "127.0.0.1:3737" };
const get = (headers: Record<string, string> = {}) => GET(new Request(BASE, { headers: { ...local, ...headers } }));
const post = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  handler(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: { ...local, "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("GET /api/onboarding", () => {
  it("first open: not completed, a key is needed, no answers", async () => {
    const body = await (await get()).json();
    expect(body).toEqual({ completed: false, needsKey: true, answers: null });
  });

  it("with a key configured needsKey is false, and the key is never in the response", async () => {
    const key = "AIzaSyFakeGoodKey_0123456789abcdEFGH";
    process.env.GEMINI_API_KEY = key;
    const text = await (await get()).text();
    expect(JSON.parse(text)).toMatchObject({ needsKey: false });
    expect(text).not.toContain(key);
    expect(text).not.toContain(key.slice(-4));
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["answers", "completed", "needsKey"]);
  });

  it("a fake provider needs no key", async () => {
    process.env.ANNA_PROVIDER = "fake";
    expect((await (await get()).json()).needsKey).toBe(false);
  });

  it("returns the saved answers (to pre-fill setup) and the completed state", async () => {
    await post(postAnswers, "/answers", { name: "Ari", troubles: ["making-decisions"] });
    await post(postComplete, "/complete", {});
    const body = await (await get()).json();
    expect(body.completed).toBe(true);
    expect(body.answers).toEqual({ name: "Ari", answerStyle: "none", workingOn: "", troubles: ["making-decisions"], troubleOther: "" });
  });
});

describe("POST /api/onboarding/complete and /reset", () => {
  it("complete sets the setting and reset clears it", async () => {
    expect(await t.settings.get(ONBOARDING_COMPLETED_KEY)).toBeNull();
    const done = await post(postComplete, "/complete", {});
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ completed: true });
    expect(await t.settings.get(ONBOARDING_COMPLETED_KEY)).not.toBeNull();
    expect((await (await get()).json()).completed).toBe(true);

    const reset = await post(postReset, "/reset", {});
    expect(await reset.json()).toEqual({ completed: false });
    expect(await t.settings.get(ONBOARDING_COMPLETED_KEY)).toBeNull();
    expect((await (await get()).json()).completed).toBe(false);
  });

  it("reset keeps the saved answers and the memories", async () => {
    await post(postAnswers, "/answers", { name: "Ari", workingOn: "thesis" });
    await post(postComplete, "/complete", {});
    await post(postReset, "/reset", {});
    expect((await (await get()).json()).answers.name).toBe("Ari");
    expect(await t.memoryService.list()).toHaveLength(2);
  });
});

describe("POST /api/onboarding/answers", () => {
  it("validates, saves the answers, the name setting and the memories (source setup)", async () => {
    const response = await post(postAnswers, "/answers", {
      name: "  Ari\n",
      answerStyle: "short",
      workingOn: "my thesis",
      troubles: ["getting-started"],
      troubleOther: "emails",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ answers: { name: "Ari" }, created: 4, memoryCount: 4 });
    expect(await t.settings.get(USER_NAME_KEY)).toBe("Ari");
    const memories = await t.memoryService.list();
    expect(memories).toHaveLength(4);
    expect(memories.every((m) => m.sourceKind === "setup" && m.origin === "stated" && m.confidence === 0.9)).toBe(true);
  });

  it("an empty body is fine and creates nothing", async () => {
    const response = await post(postAnswers, "/answers", {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ created: 0, memoryCount: 0 });
  });

  it.each([
    [{ name: "x".repeat(41) }],
    [{ workingOn: "x".repeat(201) }],
    [{ troubleOther: "x".repeat(101) }],
    [{ troubles: ["not-a-chip"] }],
    [{ answerStyle: "loud" }],
    [{ extra: 1 }],
    ["not json"],
  ])("rejects %j with a 400 and saves nothing", async (body) => {
    const response = await post(postAnswers, "/answers", body);
    expect(response.status).toBe(400);
    expect((await response.json()).error.kind).toBe("INVALID_REQUEST");
    expect(await t.memoryService.list()).toEqual([]);
  });
});

describe("the local-only guard", () => {
  it("GET rejects a request from another host or site", async () => {
    expect((await get({ host: "anna.example.com" })).status).toBe(403);
    expect((await get({ origin: "https://evil.example" })).status).toBe(403);
    expect((await get({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await get({ host: "localhost:3737", origin: "http://localhost:3737" })).status).toBe(200);
  });

  it.each([
    ["/answers", postAnswers, { name: "Mallory" }],
    ["/complete", postComplete, {}],
    ["/reset", postReset, {}],
  ] as const)("POST %s rejects a cross-origin request, a foreign host, and a non-JSON body, and changes nothing", async (path, handler, body) => {
    await t.settings.set(ONBOARDING_COMPLETED_KEY, "2026-10-07T00:00:00.000Z");
    expect((await post(handler, path, body, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(handler, path, body, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post(handler, path, body, { host: "anna.example.com" })).status).toBe(403);
    expect((await post(handler, path, body, { "content-type": "text/plain" })).status).toBe(403);
    expect(await t.settings.get(ONBOARDING_COMPLETED_KEY)).toBe("2026-10-07T00:00:00.000Z");
    expect(await t.memoryService.list()).toEqual([]);
    expect(await t.settings.get(USER_NAME_KEY)).toBeNull();
  });
});
