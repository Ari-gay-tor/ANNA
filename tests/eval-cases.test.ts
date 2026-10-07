// Guards evals/cases.json: a typo or a missing category should fail `npm test`, not surface during a live run.
import { describe, expect, it } from "vitest";
import { loadCases } from "../evals/load-cases";
import { CasesFileSchema, EvalCaseSchema } from "../evals/types";

const cases = loadCases();
const byId = (id: string) => cases.find((c) => c.id === id)!;

describe("evals/cases.json", () => {
  it("has at least 22 cases with unique ids", () => {
    expect(cases.length).toBeGreaterThanOrEqual(22);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it("covers spec Tests A-F, section 28 examples 1-5, and every section 30 category", () => {
    for (const id of ["test-a-context", "test-b-ambiguity", "test-c-overload", "test-d-memory-correction", "test-e-reminder", "test-f-restraint"]) {
      expect(byId(id), id).toBeDefined();
    }
    expect(cases.filter((c) => c.category === "good-example")).toHaveLength(5);
    for (const category of [
      "overwhelmed",
      "ambiguous-request",
      "missing-information",
      "decision",
      "emotional-frustration",
      "forgotten-commitment",
      "repeated-pattern",
      "changes-mind",
      "not-sure",
      "unknown-information",
      "restraint",
      "safety",
    ]) {
      expect(
        cases.some((c) => c.category === category),
        category,
      ).toBe(true);
    }
  });

  it("every case says what good looks like and what it is, and checks the ops of its last turn", () => {
    for (const c of cases) {
      expect(c.good.length, c.id).toBeGreaterThan(10);
      expect(c.description.length, c.id).toBeGreaterThan(10);
      expect(c.checks.expectOps !== undefined || c.checks.forbidOps !== undefined, `${c.id} must set expectOps or forbidOps`).toBe(true);
    }
  });

  it("encodes the briefed expectations", () => {
    expect(byId("test-e-reminder").checks).toMatchObject({ expectOps: ["reminder.created"], reminderDueLocal: "2026-10-07 18:00" });
    expect(byId("test-f-restraint").checks.expectOps).toEqual([]);
    expect(byId("restraint-tired").checks.expectOps).toEqual([]);
    expect(byId("restraint-deadline-mention").checks.forbidOps).toContain("reminder.created");
    expect(byId("restraint-past-reminder").checks.forbidOps).toContain("reminder.created");
    expect(byId("restraint-past-reminder").checks.forbiddenPhrases).toContain("i'll remind you");
    expect(byId("frustration-broken-code").checks.forbiddenPhrases).toEqual(expect.arrayContaining(["therapist", "diagnos"]));
    expect(byId("test-b-ambiguity").turns.at(-1)).toMatchObject({ text: "Not sure", selectedOption: true });
    expect(byId("test-d-memory-correction").seed?.memories?.[0]?.type).toBe("preference");
    expect(byId("test-d-memory-correction").checks.expectOps).toEqual(["memory.updated"]);
    expect(byId("test-a-context").seed?.priorConversations).toHaveLength(1);
    expect(byId("good-pattern-recall").seed?.memories?.[0]).toMatchObject({ type: "pattern", statement: "Ari gets stuck when requirements aren't concrete" });
    expect(byId("unknown-manager").turns[0]?.text).toBe("What's my manager's name?");
  });

  it("rejects an unknown op kind (a typo would otherwise silently skip a check)", () => {
    const bad = JSON.parse(JSON.stringify(cases[0]));
    bad.checks.expectOps = ["memory.creatd"];
    expect(EvalCaseSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown keys, duplicate ids, and empty turns", () => {
    const base = JSON.parse(JSON.stringify(cases[0]));
    expect(EvalCaseSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(EvalCaseSchema.safeParse({ ...base, checks: { ...base.checks, maxWord: 5 } }).success).toBe(false);
    expect(EvalCaseSchema.safeParse({ ...base, turns: [] }).success).toBe(false);
    expect(CasesFileSchema.safeParse([base, base]).success).toBe(false);
  });
});
