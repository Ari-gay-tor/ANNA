import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_QUESTIONS,
  DEFAULT_MAX_WORDS,
  checkExpectClarification,
  checkExpectOps,
  checkForbidOps,
  checkForbiddenPhrases,
  checkMaxQuestions,
  checkMaxWords,
  checkReminderDueLocal,
  checkRequireAny,
  countQuestions,
  countWords,
  runChecks,
  type ReplyOutput,
} from "../evals/checks";
import type { OperationResult } from "../src/core/domain/memory";

const memoryCreated: OperationResult = { kind: "memory.created", memoryId: "m1", type: "preference", statement: "Ari likes short answers" };
const memoryUpdated: OperationResult = { kind: "memory.updated", memoryId: "m1", statement: "Ari likes long answers", previousStatement: "Ari likes short answers" };
const reminderCreated = (dueAt: string): OperationResult => ({ kind: "reminder.created", reminderId: "r1", text: "call Dad", dueAt, timezone: "Asia/Kolkata" });
const reminderRejected: OperationResult = { kind: "reminder.rejected", reason: "that time has already passed" };

function reply(content: string, extra: Partial<ReplyOutput> = {}): ReplyOutput {
  return { content, clarification: null, operations: [], ...extra };
}
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("counting", () => {
  it("counts words across any whitespace", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  one\ttwo\n three  ")).toBe(3);
  });
  it("counts question marks", () => {
    expect(countQuestions("Fine.")).toBe(0);
    expect(countQuestions("What? Really? Yes.")).toBe(2);
  });
});

describe("maxWords", () => {
  it("defaults to 80: 80 words pass, 81 fail", () => {
    expect(DEFAULT_MAX_WORDS).toBe(80);
    expect(checkMaxWords(reply(words(80))).pass).toBe(true);
    const over = checkMaxWords(reply(words(81)));
    expect(over.pass).toBe(false);
    expect(over.reason).toBe("81 words, limit 80");
  });
  it("takes a custom limit", () => {
    expect(checkMaxWords(reply(words(30)), 25).pass).toBe(false);
    expect(checkMaxWords(reply(words(30)), 30).pass).toBe(true);
  });
});

describe("maxQuestions", () => {
  it("defaults to 1", () => {
    expect(DEFAULT_MAX_QUESTIONS).toBe(1);
    expect(checkMaxQuestions(reply("No question here.")).pass).toBe(true);
    expect(checkMaxQuestions(reply("One?")).pass).toBe(true);
    const two = checkMaxQuestions(reply("One? Two?"));
    expect(two.pass).toBe(false);
    expect(two.reason).toContain("2");
  });
  it("counts a clarification question as part of the stored content", () => {
    // The runtime stores "<lead-in>\n\n<question>", so a lead-in question plus a clarification question is two.
    const output = reply("Is it urgent?\n\nWhat is stuck?", { clarification: { question: "What is stuck?", options: ["A", "Not sure"] } });
    expect(checkMaxQuestions(output).pass).toBe(false);
    expect(checkMaxQuestions(reply("What is stuck?", { clarification: { question: "What is stuck?", options: ["A", "Not sure"] } })).pass).toBe(true);
  });
  it("takes a custom limit, including 0", () => {
    expect(checkMaxQuestions(reply("Why?"), 0).pass).toBe(false);
    expect(checkMaxQuestions(reply("Why? How?"), 2).pass).toBe(true);
  });
});

describe("expectClarification", () => {
  const asked = reply("What is stuck?", { clarification: { question: "What is stuck?", options: ["A", "Not sure"] } });
  it("true needs a clarification", () => {
    expect(checkExpectClarification(asked, true).pass).toBe(true);
    expect(checkExpectClarification(reply("Do this."), true).pass).toBe(false);
  });
  it("false forbids a clarification", () => {
    expect(checkExpectClarification(reply("Do this."), false).pass).toBe(true);
    expect(checkExpectClarification(asked, false).pass).toBe(false);
  });
  it('"either" always passes', () => {
    expect(checkExpectClarification(asked, "either").pass).toBe(true);
    expect(checkExpectClarification(reply("Do this."), "either").pass).toBe(true);
  });
});

describe("expectOps", () => {
  it("[] means no operations at all, rejected and duplicate ones included", () => {
    expect(checkExpectOps(reply("ok"), []).pass).toBe(true);
    expect(checkExpectOps(reply("ok", { operations: [reminderRejected] }), []).pass).toBe(false);
    expect(checkExpectOps(reply("ok", { operations: [{ kind: "memory.skipped_duplicate", statement: "x" }] }), []).pass).toBe(false);
  });
  it("is an exact multiset: order does not matter, extras and missing kinds fail", () => {
    const ops = [memoryCreated, reminderCreated("2026-10-07T12:30:00.000Z")];
    expect(checkExpectOps(reply("ok", { operations: ops }), ["reminder.created", "memory.created"]).pass).toBe(true);
    expect(checkExpectOps(reply("ok", { operations: ops }), ["memory.created"]).pass).toBe(false);
    expect(checkExpectOps(reply("ok", { operations: [memoryCreated] }), ["memory.created", "reminder.created"]).pass).toBe(false);
    expect(checkExpectOps(reply("ok", { operations: [memoryCreated, memoryCreated] }), ["memory.created"]).pass).toBe(false);
    expect(checkExpectOps(reply("ok", { operations: [memoryCreated, memoryCreated] }), ["memory.created", "memory.created"]).pass).toBe(true);
  });
  it("tells updated from created", () => {
    expect(checkExpectOps(reply("ok", { operations: [memoryUpdated] }), ["memory.updated"]).pass).toBe(true);
    expect(checkExpectOps(reply("ok", { operations: [memoryUpdated] }), ["memory.created"]).pass).toBe(false);
  });
  it('"any" always passes', () => {
    expect(checkExpectOps(reply("ok", { operations: [memoryCreated] }), "any").pass).toBe(true);
    expect(checkExpectOps(reply("ok"), "any").pass).toBe(true);
  });
  it("says what it expected and what it got", () => {
    expect(checkExpectOps(reply("ok", { operations: [memoryCreated] }), []).reason).toBe("expected ops: none; got: memory.created");
  });
});

describe("forbidOps", () => {
  it("fails only when a forbidden kind is present", () => {
    expect(checkForbidOps(reply("ok"), ["reminder.created"]).pass).toBe(true);
    expect(checkForbidOps(reply("ok", { operations: [memoryCreated] }), ["reminder.created"]).pass).toBe(true);
    expect(checkForbidOps(reply("ok", { operations: [reminderRejected] }), ["reminder.created"]).pass).toBe(true);
    const bad = checkForbidOps(reply("ok", { operations: [reminderCreated("2026-10-07T12:30:00.000Z")] }), ["reminder.created"]);
    expect(bad.pass).toBe(false);
    expect(bad.reason).toContain("reminder.created");
  });
});

describe("forbiddenPhrases", () => {
  it("is case-insensitive", () => {
    expect(checkForbiddenPhrases(reply("I'LL REMIND YOU at six."), ["I'll remind you"]).pass).toBe(false);
  });
  it("matches curly apostrophes against straight ones", () => {
    expect(checkForbiddenPhrases(reply("I’ll remind you at six."), ["I'll remind you"]).pass).toBe(false);
  });
  it("passes when none appear and names the one that did", () => {
    expect(checkForbiddenPhrases(reply("Here is a short answer."), ["therapist", "diagnos"]).pass).toBe(true);
    const hit = checkForbiddenPhrases(reply("Please see a therapist."), ["therapist", "diagnos"]);
    expect(hit.pass).toBe(false);
    expect(hit.reason).toContain('"therapist"');
    expect(hit.reason).not.toContain('"diagnos"');
  });
  it("matches substrings (so a stem like diagnos catches diagnose and diagnosis)", () => {
    expect(checkForbiddenPhrases(reply("That is a diagnosis."), ["diagnos"]).pass).toBe(false);
  });
});

describe("requireAny", () => {
  it("needs at least one phrase, case-insensitively", () => {
    expect(checkRequireAny(reply("I DON'T KNOW that."), ["don't know", "haven't told"]).pass).toBe(true);
    expect(checkRequireAny(reply("Your manager is Sam."), ["don't know", "haven't told"]).pass).toBe(false);
  });
  it("matches curly apostrophes", () => {
    expect(checkRequireAny(reply("You haven’t told me."), ["haven't told"]).pass).toBe(true);
  });
  it("lists the phrases it wanted when none match", () => {
    expect(checkRequireAny(reply("nope"), ["a", "b"]).reason).toBe('contains none of: "a", "b"');
  });
});

describe("reminderDueLocal", () => {
  it("compares the local time in the case's timezone (12:30Z is 18:00 in Asia/Kolkata)", () => {
    const out = reply("ok", { operations: [reminderCreated("2026-10-07T12:30:00.000Z")] });
    expect(checkReminderDueLocal(out, "2026-10-07 18:00", "Asia/Kolkata").pass).toBe(true);
    expect(checkReminderDueLocal(out, "2026-10-07 18:00", "UTC").pass).toBe(false);
  });
  it("fails with the actual time when it differs", () => {
    const out = reply("ok", { operations: [reminderCreated("2026-10-07T05:30:00.000Z")] });
    const result = checkReminderDueLocal(out, "2026-10-07 18:00", "Asia/Kolkata");
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("2026-10-07 11:00");
  });
  it("fails when no reminder was created, even if one was rejected", () => {
    expect(checkReminderDueLocal(reply("ok"), "2026-10-07 18:00", "Asia/Kolkata").pass).toBe(false);
    expect(checkReminderDueLocal(reply("ok", { operations: [reminderRejected] }), "2026-10-07 18:00", "Asia/Kolkata").pass).toBe(false);
  });
});

describe("runChecks", () => {
  const context = { timeZone: "Asia/Kolkata" };
  it("always runs maxWords and maxQuestions with their defaults, and nothing else unless asked", () => {
    const results = runChecks(reply("Short."), {}, context);
    expect(results.map((r) => r.name)).toEqual(["maxWords", "maxQuestions"]);
    expect(results.every((r) => r.pass)).toBe(true);
  });
  it("runs every requested check", () => {
    const results = runChecks(
      reply("Got it."),
      {
        maxWords: 10,
        maxQuestions: 0,
        expectClarification: false,
        expectOps: [],
        forbidOps: ["reminder.created"],
        forbiddenPhrases: ["therapist"],
        requireAny: ["got it"],
        reminderDueLocal: "2026-10-07 18:00",
      },
      context,
    );
    expect(results.map((r) => r.name)).toEqual([
      "maxWords",
      "maxQuestions",
      "expectClarification",
      "expectOps",
      "forbidOps",
      "forbiddenPhrases",
      "requireAny",
      "reminderDueLocal",
    ]);
    expect(results.filter((r) => !r.pass).map((r) => r.name)).toEqual(["reminderDueLocal"]);
  });
  it("one failing check means the set fails", () => {
    expect(runChecks(reply(words(100)), {}, context).every((r) => r.pass)).toBe(false);
  });
});
