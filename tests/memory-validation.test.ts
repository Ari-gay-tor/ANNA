import { describe, expect, it } from "vitest";
import type { MemoryOperation } from "../src/core/domain/memory";
import {
  REASON_NOT_SAID,
  REASON_PATTERN,
  REASON_TOO_LONG,
  REASON_TOO_MANY,
  REASON_UNKNOWN_MEMORY,
  normalizeText,
  validateMemoryOps,
  type ValidateMemoryOpsInput,
} from "../src/core/runtime/memory-validation";

const MESSAGE = "Remember that I hate being given giant plans.";

function create(overrides: Partial<Extract<MemoryOperation, { op: "create" }>> = {}): MemoryOperation {
  return {
    op: "create",
    type: "preference",
    statement: "Dislikes being given giant plans.",
    evidenceQuote: "I hate being given giant plans",
    origin: "stated",
    ...overrides,
  };
}

function run(ops: MemoryOperation[], overrides: Partial<ValidateMemoryOpsInput> = {}) {
  return validateMemoryOps({ ops, userMessage: MESSAGE, contextMemories: [], existingStatements: [], ...overrides });
}

describe("validateMemoryOps: quote rule", () => {
  it("accepts a quote that appears in the user message", () => {
    expect(run([create()])[0]).toMatchObject({ status: "accepted", statement: "Dislikes being given giant plans." });
  });

  it("rejects a quote that is not in the user message", () => {
    const [decision] = run([create({ evidenceQuote: "I love giant plans and big lists" })]);
    expect(decision).toMatchObject({ status: "rejected", origin: "stated", reason: REASON_NOT_SAID });
  });

  it("rejects a quote shorter than 8 characters after normalization, even though it is in the message", () => {
    // "plans" and "hate" are in the message but are under 8 characters.
    expect(run([create({ evidenceQuote: "plans" })])[0]).toMatchObject({ status: "rejected", reason: REASON_NOT_SAID });
    // Padding with punctuation and spaces must not get past the minimum: this is 4 characters once normalized.
    expect(run([create({ evidenceQuote: "  ...hate!!!  " })])[0]).toMatchObject({ status: "rejected", reason: REASON_NOT_SAID });
  });

  it("accepts a quote of exactly 8 characters and rejects 7", () => {
    expect(normalizeText("giant pl")).toHaveLength(8);
    expect(run([create({ evidenceQuote: "giant pl" })])[0]).toMatchObject({ status: "accepted" });
    expect(run([create({ evidenceQuote: "giant p" })])[0]).toMatchObject({ status: "rejected" });
  });

  it("matches despite curly quotes, case, extra spaces, and surrounding punctuation", () => {
    const decisions = validateMemoryOps({
      ops: [
        create({ evidenceQuote: "  “I   HATE being\n given  giant plans.” " }),
        create({ evidenceQuote: "I’m   allergic to  peanuts", statement: "Allergic to peanuts." }),
      ],
      userMessage: "Remember: I'm allergic to peanuts, and I  hate being given giant plans!",
      contextMemories: [],
      existingStatements: [],
    });
    expect(decisions.map((d) => d.status)).toEqual(["accepted", "accepted"]);
  });

  it("normalizeText is idempotent and trims surrounding punctuation only", () => {
    expect(normalizeText("“It’s   fine.”")).toBe("it's fine");
    expect(normalizeText(normalizeText("“It’s   fine.”"))).toBe("it's fine");
    expect(normalizeText("a, b")).toBe("a, b");
  });

  it("applies the quote rule to updates too", () => {
    const [decision] = run([{ op: "update", memoryId: "m1", statement: "x", evidenceQuote: "something never said here" }], {
      contextMemories: [{ id: "m1" }],
    });
    expect(decision).toMatchObject({ status: "rejected", origin: "stated", reason: REASON_NOT_SAID });
  });
});

describe("validateMemoryOps: statement rule", () => {
  it("rejects a statement over 300 characters, accepts exactly 300", () => {
    expect(run([create({ statement: "x".repeat(301) })])[0]).toMatchObject({ status: "rejected", reason: REASON_TOO_LONG });
    expect(run([create({ statement: "x".repeat(300) })])[0]).toMatchObject({ status: "accepted" });
  });

  it("rejects an empty or whitespace-only statement", () => {
    expect(run([create({ statement: "   " })])[0]).toMatchObject({ status: "rejected" });
  });

  it("stores the trimmed statement", () => {
    expect(run([create({ statement: "  Likes tea.  " })])[0]).toMatchObject({ status: "accepted", statement: "Likes tea." });
  });
});

describe("validateMemoryOps: per-turn limit", () => {
  it("accepts the first 3 and rejects the 4th and later", () => {
    const ops = [1, 2, 3, 4, 5].map((n) => create({ statement: `Plan dislike number ${n}.` }));
    const decisions = run(ops);
    expect(decisions.map((d) => d.status)).toEqual(["accepted", "accepted", "accepted", "rejected", "rejected"]);
    expect(decisions[3]).toMatchObject({ reason: REASON_TOO_MANY });
  });
});

describe("validateMemoryOps: update rule", () => {
  const update = (memoryId: string): MemoryOperation => ({
    op: "update",
    memoryId,
    statement: "Prefers long explanations when learning.",
    evidenceQuote: "hate being given giant plans",
  });

  it("rejects an update of an id that was not in this turn's context", () => {
    const [decision] = run([update("m-other")], { contextMemories: [{ id: "m1" }] });
    expect(decision).toMatchObject({ status: "rejected", origin: "stated", reason: REASON_UNKNOWN_MEMORY });
  });

  it("accepts an update of an id that was in context, as stated with confidence 0.9", () => {
    const [decision] = run([update("m1")], { contextMemories: [{ id: "m1" }] });
    expect(decision).toMatchObject({ status: "accepted", origin: "stated", confidence: 0.9 });
  });
});

describe("validateMemoryOps: patterns", () => {
  it("rejects an inferred pattern and accepts a stated one", () => {
    const [inferred] = run([create({ type: "pattern", origin: "inferred" })]);
    expect(inferred).toMatchObject({ status: "rejected", origin: "inferred", reason: REASON_PATTERN });
    const [stated] = run([create({ type: "pattern", origin: "stated" })]);
    expect(stated).toMatchObject({ status: "accepted", origin: "stated" });
  });

  it("allows inferred ops of other types", () => {
    expect(run([create({ type: "fact", origin: "inferred" })])[0]).toMatchObject({ status: "accepted", origin: "inferred" });
  });
});

describe("validateMemoryOps: duplicates", () => {
  it("skips an exact duplicate of a saved statement, ignoring case, spacing and trailing punctuation", () => {
    const [decision] = run([create({ statement: "dislikes  BEING given giant plans" })], {
      existingStatements: ["Dislikes being given giant plans."],
    });
    expect(decision).toMatchObject({ status: "skipped_duplicate", statement: "dislikes  BEING given giant plans" });
  });

  it("skips the second of two identical proposals in the same turn", () => {
    expect(run([create(), create()]).map((d) => d.status)).toEqual(["accepted", "skipped_duplicate"]);
  });

  it("a duplicate with a bad quote is rejected, not silently skipped", () => {
    const [decision] = run([create({ evidenceQuote: "never said this at all" })], {
      existingStatements: ["Dislikes being given giant plans."],
    });
    expect(decision).toMatchObject({ status: "rejected" });
  });

  it("different wording is not a duplicate", () => {
    const [decision] = run([create({ statement: "Does not like giant plans." })], {
      existingStatements: ["Dislikes being given giant plans."],
    });
    expect(decision).toMatchObject({ status: "accepted" });
  });
});

describe("validateMemoryOps: confidence is set by the runtime", () => {
  it("stated is 0.9 even when the model sends 0.2 or 1.0", () => {
    expect(run([create({ origin: "stated", confidence: 0.2 })])[0]).toMatchObject({ confidence: 0.9 });
    expect(run([create({ origin: "stated", confidence: 1 })])[0]).toMatchObject({ confidence: 0.9 });
  });

  it("inferred is capped at 0.6, defaults to 0.5, and keeps lower model values", () => {
    const decide = (confidence?: number) => run([create({ origin: "inferred", confidence })])[0];
    expect(decide(0.99)).toMatchObject({ confidence: 0.6 });
    expect(decide(undefined)).toMatchObject({ confidence: 0.5 });
    expect(decide(0.3)).toMatchObject({ confidence: 0.3 });
    expect(decide(-2)).toMatchObject({ confidence: 0 });
  });
});
