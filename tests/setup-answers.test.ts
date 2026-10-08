// The first-run "About you" answers: validation (zod) and the memories they become (pure functions in src/core/domain/setup.ts).
import { describe, expect, it } from "vitest";
import { MAX_STATEMENT_LENGTH } from "../src/core/domain/memory";
import {
  EMPTY_SETUP_ANSWERS,
  SETUP_LIMITS,
  SetupAnswersSchema,
  TROUBLE_CHIPS,
  setupAnswersToMemories,
  type SetupAnswers,
} from "../src/core/domain/setup";

const answers = (overrides: Partial<SetupAnswers> = {}): SetupAnswers => ({ ...EMPTY_SETUP_ANSWERS, ...overrides });

describe("setupAnswersToMemories", () => {
  it("empty answers create nothing", () => {
    expect(setupAnswersToMemories(EMPTY_SETUP_ANSWERS)).toEqual([]);
    expect(setupAnswersToMemories(answers({ name: "", workingOn: "", troubles: [], troubleOther: "", answerStyle: "none" }))).toEqual([]);
  });

  it("name -> a preference", () => {
    expect(setupAnswersToMemories(answers({ name: "Ari" }))).toEqual([
      { slot: "name", type: "preference", statement: "Prefers to be called Ari.", evidenceQuote: "Ari" },
    ]);
  });

  it("answer style -> a preference; the evidence is the option label; 'No preference' creates nothing", () => {
    expect(setupAnswersToMemories(answers({ answerStyle: "short" }))).toEqual([
      { slot: "answerStyle", type: "preference", statement: "Prefers short answers, one step at a time.", evidenceQuote: "Short, one step at a time" },
    ]);
    expect(setupAnswersToMemories(answers({ answerStyle: "detailed" }))).toEqual([
      { slot: "answerStyle", type: "preference", statement: "Prefers answers with a bit more detail.", evidenceQuote: "A bit more detail" },
    ]);
    expect(setupAnswersToMemories(answers({ answerStyle: "none" }))).toEqual([]);
  });

  it("working on -> a goal", () => {
    expect(setupAnswersToMemories(answers({ workingOn: "finishing my thesis, job hunting" }))).toEqual([
      {
        slot: "workingOn",
        type: "goal",
        statement: "Currently working on: finishing my thesis, job hunting.",
        evidenceQuote: "finishing my thesis, job hunting",
      },
    ]);
  });

  it("trip-ups -> one pattern, chips in shown order, lowercase, evidence is the chosen labels", () => {
    expect(setupAnswersToMemories(answers({ troubles: ["getting-started", "making-decisions"] }))).toEqual([
      {
        slot: "troubles",
        type: "pattern",
        statement: "Says they tend to get stuck on: getting started, making decisions.",
        evidenceQuote: "Getting started, Making decisions",
      },
    ]);
  });

  it("the 'something else' text is included with chips, and on its own when no chip is chosen", () => {
    const [withChips] = setupAnswersToMemories(answers({ troubles: ["staying-focused"], troubleOther: "emails" }));
    expect(withChips?.statement).toBe("Says they tend to get stuck on: staying focused, emails.");
    expect(withChips?.evidenceQuote).toBe("Staying focused, emails");
    const [alone] = setupAnswersToMemories(answers({ troubleOther: "phone calls" }));
    expect(alone).toMatchObject({ type: "pattern", statement: "Says they tend to get stuck on: phone calls.", evidenceQuote: "phone calls" });
  });

  it("a typed full stop is not doubled", () => {
    const drafts = setupAnswersToMemories(answers({ name: "Ari.", workingOn: "my thesis...", troubleOther: "calls." }));
    expect(drafts.map((d) => d.statement)).toEqual([
      "Prefers to be called Ari.",
      "Currently working on: my thesis.",
      "Says they tend to get stuck on: calls.",
    ]);
  });

  it("answers made only of full stops create nothing", () => {
    expect(setupAnswersToMemories(answers({ name: "...", workingOn: ".", troubleOther: ". ." }))).toEqual([]);
  });

  it("everything at once: the four kinds in a fixed order", () => {
    const drafts = setupAnswersToMemories(
      answers({ name: "Ari", answerStyle: "short", workingOn: "thesis", troubles: ["remembering"], troubleOther: "mornings" }),
    );
    expect(drafts.map((d) => [d.slot, d.type])).toEqual([
      ["name", "preference"],
      ["answerStyle", "preference"],
      ["workingOn", "goal"],
      ["troubles", "pattern"],
    ]);
  });

  it("the longest possible answers still fit in a memory", () => {
    const longest = SetupAnswersSchema.parse({
      name: "n".repeat(SETUP_LIMITS.name),
      answerStyle: "detailed",
      workingOn: "w".repeat(SETUP_LIMITS.workingOn),
      troubles: TROUBLE_CHIPS.map((c) => c.id),
      troubleOther: "o".repeat(SETUP_LIMITS.troubleOther),
    });
    for (const draft of setupAnswersToMemories(longest)) expect(draft.statement.length).toBeLessThanOrEqual(MAX_STATEMENT_LENGTH);
  });
});

describe("SetupAnswersSchema", () => {
  it("an empty object is fine: every field is optional", () => {
    expect(SetupAnswersSchema.parse({})).toEqual({ name: "", answerStyle: "none", workingOn: "", troubles: [], troubleOther: "" });
  });

  it("trims, and turns newlines and repeated spaces into one space", () => {
    const parsed = SetupAnswersSchema.parse({ name: "  Ari \n Sam ", workingOn: "line one\r\nline   two\n", troubleOther: "\t a \n\n b " });
    expect(parsed).toMatchObject({ name: "Ari Sam", workingOn: "line one line two", troubleOther: "a b" });
  });

  it("enforces the length limits (after trimming)", () => {
    expect(SetupAnswersSchema.safeParse({ name: "x".repeat(SETUP_LIMITS.name) }).success).toBe(true);
    expect(SetupAnswersSchema.safeParse({ name: `  ${"x".repeat(SETUP_LIMITS.name)}  ` }).success).toBe(true);
    expect(SetupAnswersSchema.safeParse({ name: "x".repeat(SETUP_LIMITS.name + 1) }).success).toBe(false);
    expect(SetupAnswersSchema.safeParse({ workingOn: "x".repeat(SETUP_LIMITS.workingOn + 1) }).success).toBe(false);
    expect(SetupAnswersSchema.safeParse({ troubleOther: "x".repeat(SETUP_LIMITS.troubleOther + 1) }).success).toBe(false);
  });

  it("the error says which limit", () => {
    const result = SetupAnswersSchema.safeParse({ name: "x".repeat(41) });
    expect(result.success ? "" : result.error.issues[0]?.message).toBe("Your name can be at most 40 characters.");
  });

  it("rejects an unknown chip value, and a wrong type", () => {
    expect(SetupAnswersSchema.safeParse({ troubles: ["getting-started", "being-late"] }).success).toBe(false);
    expect(SetupAnswersSchema.safeParse({ troubles: ["Getting started"] }).success).toBe(false); // the id, not the label
    expect(SetupAnswersSchema.safeParse({ troubles: "getting-started" }).success).toBe(false);
    expect(SetupAnswersSchema.safeParse({ name: 42 }).success).toBe(false);
  });

  it("rejects an unknown answer style and unknown fields", () => {
    expect(SetupAnswersSchema.safeParse({ answerStyle: "verbose" }).success).toBe(false);
    expect(SetupAnswersSchema.safeParse({ nickname: "x" }).success).toBe(false);
  });

  it("chips come back in shown order, once each", () => {
    const parsed = SetupAnswersSchema.parse({ troubles: ["staying-focused", "getting-started", "staying-focused"] });
    expect(parsed.troubles).toEqual(["getting-started", "staying-focused"]);
  });
});
