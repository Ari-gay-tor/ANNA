// Proves the eval plumbing (seeding, fixed clock, turns, per-turn checks, pacing, early stop, report) with the fake provider.
import { afterEach, describe, expect, it } from "vitest";
import { instrument } from "../evals/instrument";
import { buildReport, describeProviderChain, median, reportStamp } from "../evals/report";
import { runAll } from "../evals/run-all";
import { runCase } from "../evals/run-case";
import { EvalCaseSchema, type EvalCase } from "../evals/types";
import { FakeProvider } from "../src/core/llm/fake";
import { LLMError } from "../src/core/llm/provider";
import { NOT_SURE_HINT } from "../src/core/runtime/turn-guidance";
import { freshDb, reply, replyWithClarification, replyWithOps, replyWithReminder } from "./helpers";
import type { PrismaClient } from "@prisma/client";

const open: PrismaClient[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((db) => db.$disconnect()));
});
function db(): PrismaClient {
  const client = freshDb();
  open.push(client);
  return client;
}
const makeDb = () => {
  const client = freshDb();
  return { db: client, dispose: () => client.$disconnect() };
};

function evalCase(overrides: Partial<EvalCase> & { id?: string }): EvalCase {
  return EvalCaseSchema.parse({
    id: "case",
    category: "test",
    description: "A test case for the eval plumbing.",
    good: "Does the right thing.",
    turns: [{ text: "Hello there." }],
    checks: { expectOps: [] },
    ...overrides,
  });
}

describe("runCase", () => {
  it("seeds timezone, memories, history and a separate prior conversation, and fixes the clock at 10:00 local by default", async () => {
    const client = db();
    const fake = new FakeProvider([reply("Done.")]);
    const c = evalCase({
      seed: {
        timezone: "Asia/Kolkata",
        memories: [{ type: "fact", statement: "Ari is working on a project called Halcyon", origin: "stated" }],
        messages: [
          { role: "user", content: "I keep putting off my thesis." },
          { role: "assistant", content: "What's the hardest part?", clarification: { question: "What's the hardest part?", options: ["Starting", "Focus"] } },
        ],
        priorConversations: [{ messages: [{ role: "user", content: "An older chat about lunch." }, { role: "assistant", content: "Noted." }] }],
      },
    });
    const result = await runCase(c, { db: client, provider: instrument(fake, 0) });

    expect(result.status).toBe("pass");
    expect(result.nowLocal).toBe("2026-10-07 10:00");
    const request = fake.calls[0]!;
    expect(request.system).toContain("Wednesday 2026-10-07 10:00");
    expect(request.system).toContain("User timezone (IANA): Asia/Kolkata");
    expect(request.system).toContain("Ari is working on a project called Halcyon");
    // History is the seeded same-conversation messages plus the new turn; the older conversation is not sent.
    expect(request.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(request.messages[1]!.content).toContain("(Options offered: Starting / Focus / Not sure)");
    expect(JSON.stringify(request.messages)).not.toContain("lunch");
    expect(await client.conversation.count()).toBe(2);
    expect(await client.memory.count()).toBe(1);
  });

  it("defaults the timezone to Asia/Kolkata and honours a clock override and a different zone", async () => {
    const a = new FakeProvider([reply("ok")]);
    const first = await runCase(evalCase({}), { db: db(), provider: instrument(a, 0) });
    expect(first.timeZone).toBe("Asia/Kolkata");
    expect(a.calls[0]!.system).toContain("User timezone (IANA): Asia/Kolkata");

    const b = new FakeProvider([reply("ok")]);
    const second = await runCase(evalCase({ now: "2026-03-14T01:30", seed: { timezone: "America/New_York" } }), { db: db(), provider: instrument(b, 0) });
    expect(second.nowLocal).toBe("2026-03-14 01:30");
    expect(b.calls[0]!.system).toContain("Saturday 2026-03-14 01:30");
    expect(b.calls[0]!.system).toContain("America/New_York");
  });

  it("sends tapped options as selectedOption and applies the case checks to the last turn only", async () => {
    const fake = new FakeProvider([
      replyWithClarification("", { question: "What part?", options: ["Finding one", "Applications"] }),
      reply("Let's guess: is it finding one or applying?"),
    ]);
    const c = evalCase({
      turns: [{ text: "I need to deal with my internship." }, { text: "Not sure", selectedOption: true }],
      checks: { expectClarification: false, expectOps: [] },
    });
    const result = await runCase(c, { db: db(), provider: instrument(fake, 0) });

    expect(result.status).toBe("pass");
    expect(result.turns).toHaveLength(2);
    expect(result.turns[0]!.checks).toBeNull(); // turn 1 had no checks of its own
    expect(result.turns[0]!.reply?.clarification?.options.at(-1)).toBe("Not sure");
    expect(result.turns[1]!.selectedOption).toBe(true);
    expect(fake.calls[1]!.messages.at(-1)!.content).toBe("(Tapped option) Not sure");
    expect(fake.calls[1]!.system).toContain(NOT_SURE_HINT);
    expect(result.checks.every((check) => check.turn === 2)).toBe(true);
  });

  it("checks earlier turns that carry their own checks, and a failure there fails the case", async () => {
    const fake = new FakeProvider([reply("No question asked."), reply("Fine.")]);
    const c = evalCase({
      turns: [{ text: "First message.", checks: { expectClarification: true } }, { text: "Second message." }],
    });
    const result = await runCase(c, { db: db(), provider: instrument(fake, 0) });
    expect(result.status).toBe("fail");
    const failed = result.checks.filter((check) => !check.pass);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ name: "expectClarification", turn: 1 });
  });

  it("runs real runtime validation: a reminder lands on the fixed clock's day and is checked in the case's timezone", async () => {
    const text = "Remind me at 6 PM to call Dad.";
    const fake = new FakeProvider([
      replyWithReminder("Okay, I'll remind you.", { text: "call Dad", evidenceQuote: text, localDateTime: "2026-10-07T18:00" }),
    ]);
    const c = evalCase({
      turns: [{ text }],
      checks: { expectOps: ["reminder.created"], reminderDueLocal: "2026-10-07 18:00", expectClarification: false },
    });
    const result = await runCase(c, { db: db(), provider: instrument(fake, 0) });
    expect(result.checks.filter((check) => !check.pass)).toEqual([]);
    expect(result.status).toBe("pass");
  });

  it("reports a rejected reminder as an op (the runtime, not the model, decides)", async () => {
    const text = "Remind me yesterday at 3 PM to file the report.";
    const fake = new FakeProvider([replyWithReminder("Sure.", { text: "file the report", evidenceQuote: text, localDateTime: "2026-10-06T15:00" })]);
    const c = evalCase({ turns: [{ text }], checks: { forbidOps: ["reminder.created"] } });
    const result = await runCase(c, { db: db(), provider: instrument(fake, 0) });
    expect(result.status).toBe("pass");
    expect(result.turns[0]!.reply?.operations.map((op) => op.kind)).toEqual(["reminder.rejected"]);
  });

  it("memory ops go through the real validator: an update of a seeded memory is accepted", async () => {
    const fake = new FakeProvider([
      (request) => {
        const id = /\[([^\]]+)\] \(preference/.exec(request.system)?.[1] ?? "missing";
        return replyWithOps("Got it.", [
          { op: "update", memoryId: id, statement: "Ari prefers long explanations when learning", evidenceQuote: "I actually prefer long explanations" },
        ]);
      },
    ]);
    const c = evalCase({
      seed: { memories: [{ type: "preference", statement: "Ari prefers short, concise answers", origin: "stated" }] },
      turns: [{ text: "You got that wrong. I actually prefer long explanations when I'm learning something new." }],
      checks: { expectOps: ["memory.updated"] },
    });
    const result = await runCase(c, { db: db(), provider: instrument(fake, 0) });
    expect(result.status).toBe("pass");
  });

  it("records a provider error as an error status, keeps earlier turns, and does not send later ones", async () => {
    const fake = new FakeProvider([reply("First reply."), new LLMError("RATE_LIMITED", "quota")]);
    const c = evalCase({ turns: [{ text: "one" }, { text: "two" }, { text: "three" }] });
    const result = await runCase(c, { db: db(), provider: instrument(fake, 0) });

    expect(result.status).toBe("error");
    expect(result.turns).toHaveLength(2);
    expect(result.turns[1]!.error).toEqual({ kind: "RATE_LIMITED", message: "quota" });
    expect(result.turns[1]!.reply).toBeNull();
    expect(fake.calls).toHaveLength(2);
  });

  it("records the model, call count and a latency for each turn (an invalid-JSON retry is two calls)", async () => {
    const fake = new FakeProvider(["not json at all", reply("Second try worked.")]);
    const result = await runCase(evalCase({}), { db: db(), provider: instrument(fake, 0) });
    expect(result.turns[0]).toMatchObject({ calls: 2, model: "fake", words: 3 });
    expect(result.turns[0]!.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("instrument", () => {
  it("waits at least delayMs between calls, but not before the first", async () => {
    const provider = instrument(new FakeProvider([reply("a"), reply("b")]), 60);
    const request = { system: "s", messages: [{ role: "user" as const, content: "x" }] };
    const t0 = Date.now();
    await provider.generate(request);
    expect(Date.now() - t0).toBeLessThan(50);
    const t1 = Date.now();
    await provider.generate(request);
    expect(Date.now() - t1).toBeGreaterThanOrEqual(55);
    expect(provider.drain()).toHaveLength(2);
    expect(provider.drain()).toHaveLength(0);
  });

  it("records a failed call and rethrows the same error", async () => {
    const error = new LLMError("UNAVAILABLE", "down");
    const provider = instrument(new FakeProvider([error]), 0);
    await expect(provider.generate({ system: "s", messages: [] })).rejects.toBe(error);
    expect(provider.drain()).toEqual([expect.objectContaining({ ok: false })]);
  });
});

describe("runAll", () => {
  const three = [evalCase({ id: "one" }), evalCase({ id: "two" }), evalCase({ id: "three" })];
  const rateLimited = () => new LLMError("RATE_LIMITED", "quota exhausted");

  it("runs every case in order, each on its own database", async () => {
    const fake = new FakeProvider();
    const done: string[] = [];
    const summary = await runAll({ cases: three, provider: fake, delayMs: 0, makeDb, onCaseDone: (r) => done.push(r.case.id) });
    expect(summary.results.map((r) => r.case.id)).toEqual(["one", "two", "three"]);
    expect(done).toEqual(["one", "two", "three"]);
    expect(summary.notRun).toEqual([]);
    expect(summary.stoppedReason).toBeNull();
    expect(fake.calls).toHaveLength(3);
  });

  it("stops after 2 RATE_LIMITED errors in a row and lists what was not run", async () => {
    const cases = [...three, evalCase({ id: "four" })];
    const fake = new FakeProvider([rateLimited(), rateLimited()]);
    const summary = await runAll({ cases, provider: fake, delayMs: 0, makeDb });
    expect(summary.results.map((r) => [r.case.id, r.status])).toEqual([
      ["one", "error"],
      ["two", "error"],
    ]);
    expect(summary.notRun).toEqual(["three", "four"]);
    expect(summary.stoppedReason).toContain("2 RATE_LIMITED errors in a row");
    expect(fake.calls).toHaveLength(2);
  });

  it("a success between two RATE_LIMITED errors resets the count", async () => {
    const fake = new FakeProvider([rateLimited(), reply("fine"), rateLimited()]);
    const summary = await runAll({ cases: three, provider: fake, delayMs: 0, makeDb });
    expect(summary.results.map((r) => r.status)).toEqual(["error", "pass", "error"]);
    expect(summary.stoppedReason).toBeNull();
  });

  it("stops at once on a CONFIG error (no key), since every case would fail the same way", async () => {
    const fake = new FakeProvider([new LLMError("CONFIG", "GEMINI_API_KEY is not set.")]);
    const summary = await runAll({ cases: three, provider: fake, delayMs: 0, makeDb });
    expect(summary.results).toHaveLength(1);
    expect(summary.notRun).toEqual(["two", "three"]);
    expect(summary.stoppedReason).toContain("misconfigured");
  });

  it("does not stop on other provider errors", async () => {
    const fake = new FakeProvider([new LLMError("UNAVAILABLE", "busy"), reply("ok"), reply("ok")]);
    const summary = await runAll({ cases: three, provider: fake, delayMs: 0, makeDb });
    expect(summary.results.map((r) => r.status)).toEqual(["error", "pass", "pass"]);
  });
});

describe("report", () => {
  const passing = evalCase({ id: "passes", category: "alpha", good: "Says hi." });
  const failing = evalCase({
    id: "fails",
    category: "beta",
    good: "Never rambles.",
    turns: [{ text: "Hello there." }],
    checks: { expectOps: ["memory.created"], forbiddenPhrases: ["rambling"] },
  });
  const when = new Date(2026, 9, 7, 15, 30);
  const meta = { date: when, providerChain: "gemini (m1 -> m2)", delayMs: 4000, only: null, totalCases: 2 };

  async function summaryOf(cases: EvalCase[], script: ConstructorParameters<typeof FakeProvider>[0]) {
    return runAll({ cases, provider: new FakeProvider(script), delayMs: 0, makeDb });
  }

  it("has the header: date, provider chain, models, pass count, per-category rate, latency", async () => {
    const summary = await summaryOf([passing, failing], [reply("Hi."), reply("Some rambling answer.")]);
    const report = buildReport(summary, meta);
    expect(report).toContain("# ANNA behavior eval, 2026-10-07 15:30");
    expect(report).toContain("- Provider chain: gemini (m1 -> m2)");
    expect(report).toContain("- Models that answered: fake");
    expect(report).toContain("- Passed: **1/2** (50%)");
    expect(report).toContain("| alpha | 1 | 1 | 100% |");
    expect(report).toContain("| beta | 0 | 1 | 0% |");
    expect(report).toMatch(/- Latency per reply .*: median \d+ ms, max \d+ ms, over 2 replies/);
    expect(report).toContain("- Cases run: 2 of 2");
  });

  it("lists failed cases first and shows transcript, checks with marks and reasons, stats and an empty reviewer line", async () => {
    const summary = await summaryOf([passing, failing], [reply("Hi."), reply("Some rambling answer.")]);
    const report = buildReport(summary, meta);
    expect(report.indexOf("`fails`")).toBeLessThan(report.indexOf("`passes`"));
    expect(report).toContain("### ❌ FAIL `fails` (beta)");
    expect(report).toContain("### ✅ PASS `passes` (alpha)");
    expect(report).toContain("Good looks like: Never rambles.");
    expect(report).toContain("> Hello there.");
    expect(report).toContain("> Some rambling answer.");
    expect(report).toContain("(3 words,");
    expect(report).toContain("model fake");
    expect(report).toContain("Ops: none");
    expect(report).toContain("- ✅ maxWords: 3 words, limit 80");
    expect(report).toContain("- ❌ expectOps: expected ops: memory.created; got: none");
    expect(report).toContain('- ❌ forbiddenPhrases: contains: "rambling"');
    expect(report.match(/^Reviewer notes:$/gm)).toHaveLength(2);
  });

  it("shows clarification options and ops in the transcript", async () => {
    const text = "Remind me at 6 PM to call Dad.";
    const asking = evalCase({ id: "asks", category: "gamma", turns: [{ text: "Help." }], checks: { expectClarification: true, expectOps: [] } });
    const reminding = evalCase({ id: "reminds", category: "gamma", turns: [{ text }], checks: { expectOps: ["reminder.created"] } });
    const summary = await summaryOf(
      [asking, reminding],
      [
        replyWithClarification("", { question: "What is stuck?", options: ["Writing", "Starting"] }),
        replyWithReminder("Okay.", { text: "call Dad", evidenceQuote: text, localDateTime: "2026-10-07T18:00" }),
      ],
    );
    const report = buildReport(summary, { ...meta, totalCases: 2 });
    expect(report).toContain("Clarification question: What is stuck?");
    expect(report).toContain("Options: Writing | Starting | Not sure");
    expect(report).toContain('- reminder.created "call Dad" due 2026-10-07 18:00 Asia/Kolkata');
  });

  it("marks a partial run and lists the cases that did not run", async () => {
    const summary = await summaryOf(
      [passing, failing, evalCase({ id: "never" })],
      [new LLMError("RATE_LIMITED", "quota"), new LLMError("RATE_LIMITED", "quota")],
    );
    const report = buildReport(summary, { ...meta, totalCases: 3 });
    expect(report).toContain("**PARTIAL RUN.");
    expect(report).toContain("- Passed: **0/2** (0%)");
    expect(report).toContain("- Cases run: 2 of 3; not run: never");
    expect(report).toContain("❌ ERROR (RATE_LIMITED)");
    expect(report).toContain("Provider error RATE_LIMITED: quota");
    expect(report).toContain("- Models that answered: none");
  });

  it("notes an EVAL_ONLY subset", async () => {
    const summary = await summaryOf([passing], [reply("Hi.")]);
    expect(buildReport(summary, { ...meta, only: ["passes"], totalCases: 1 })).toContain("(subset: EVAL_ONLY=passes)");
  });

  it("names the report file by local date and time, and the median is right", () => {
    expect(reportStamp(new Date(2026, 9, 7, 9, 5))).toBe("2026-10-07-0905");
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([1, 9, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(3);
  });

  it("describes the provider chain without any key", () => {
    const env = { ANNA_PROVIDER: "gemini,openai-compatible", GEMINI_API_KEY: "secret-key", GEMINI_MODEL: "g-1", GEMINI_FALLBACK_MODELS: "g-2, g-3", OPENAI_COMPAT_MODEL: "llama" };
    const chain = describeProviderChain(env);
    expect(chain).toBe("gemini (g-1 -> g-2 -> g-3) -> openai-compatible (llama)");
    expect(chain).not.toContain("secret");
    expect(describeProviderChain({ ANNA_PROVIDER: "fake" })).toBe("fake");
  });
});
