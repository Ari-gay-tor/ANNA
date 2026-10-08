// Saving the setup answers: MemoryService.saveSetupAnswers (provenance, re-runs, chat memories untouched) and the OnboardingService settings.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPTY_SETUP_ANSWERS, SetupAnswersSchema, type SetupAnswers } from "../src/core/domain/setup";
import { ONBOARDING_ANSWERS_KEY, ONBOARDING_COMPLETED_KEY, USER_NAME_KEY } from "../src/core/runtime/onboarding-service";
import { testAnna } from "./helpers";

let t: ReturnType<typeof testAnna>;
beforeEach(() => {
  t = testAnna();
});
afterEach(async () => {
  await t.db.$disconnect();
});

const answers = (overrides: Partial<SetupAnswers> = {}): SetupAnswers => ({ ...EMPTY_SETUP_ANSWERS, ...overrides });
const FULL = answers({ name: "Ari", answerStyle: "short", workingOn: "my thesis", troubles: ["getting-started"], troubleOther: "emails" });

async function chatMemory(statement = "Likes tea.") {
  return t.memories.create({
    type: "preference",
    statement,
    confidence: 0.9,
    origin: "stated",
    evidenceQuote: statement,
    sourceConversationId: "c1",
    sourceMessageId: "m1",
  });
}

describe("MemoryService.saveSetupAnswers", () => {
  it("creates stated memories at confidence 0.9 with sourceKind setup, no conversation, and the user's own text as the quote", async () => {
    const { created } = await t.memoryService.saveSetupAnswers(FULL);
    expect(created).toHaveLength(4);
    for (const memory of created) {
      expect(memory).toMatchObject({ origin: "stated", confidence: 0.9, sourceKind: "setup", sourceConversationId: null, sourceMessageId: null });
      expect(memory.evidenceQuote).toBeTruthy();
    }
    const stored = await t.memoryService.list();
    expect(stored.map((m) => m.statement).sort()).toEqual(
      [
        "Currently working on: my thesis.",
        "Prefers short answers, one step at a time.",
        "Prefers to be called Ari.",
        "Says they tend to get stuck on: getting started, emails.",
      ].sort(),
    );
    expect(stored.find((m) => m.statement.startsWith("Says they"))).toMatchObject({ type: "pattern", origin: "stated", evidenceQuote: "Getting started, emails" });
    expect(stored.find((m) => m.statement.startsWith("Currently"))).toMatchObject({ type: "goal" });
  });

  it("empty answers create nothing", async () => {
    expect(await t.memoryService.saveSetupAnswers(EMPTY_SETUP_ANSWERS)).toEqual({ created: [], removed: 0 });
    expect(await t.memoryService.list()).toEqual([]);
  });

  it("a re-run replaces the memories it made, when the answers changed", async () => {
    await t.memoryService.saveSetupAnswers(FULL);
    const next = { ...FULL, name: "Sam", workingOn: "a job search" };
    const { created, removed } = await t.memoryService.saveSetupAnswers(next, FULL);
    expect(removed).toBe(2);
    expect(created.map((m) => m.statement).sort()).toEqual(["Currently working on: a job search.", "Prefers to be called Sam."]);
    const statements = (await t.memoryService.list()).map((m) => m.statement);
    expect(statements).toHaveLength(4);
    expect(statements).not.toContain("Prefers to be called Ari.");
    expect(statements).toContain("Prefers short answers, one step at a time."); // unchanged: left as it was
  });

  it("a re-run with no earlier answers on record replaces every untouched setup memory", async () => {
    await t.memoryService.saveSetupAnswers(FULL);
    const { created, removed } = await t.memoryService.saveSetupAnswers(answers({ name: "Sam" }), null);
    expect(removed).toBe(4);
    expect(created).toHaveLength(1);
    expect((await t.memoryService.list()).map((m) => m.statement)).toEqual(["Prefers to be called Sam."]);
  });

  it("clearing an answer removes its memory", async () => {
    await t.memoryService.saveSetupAnswers(FULL);
    await t.memoryService.saveSetupAnswers({ ...FULL, workingOn: "" }, FULL);
    expect((await t.memoryService.list()).map((m) => m.statement)).not.toContain("Currently working on: my thesis.");
    expect(await t.memoryService.list()).toHaveLength(3);
  });

  it("a memory the user edited is kept when the answer changes, and the new answer is saved beside it", async () => {
    const { created } = await t.memoryService.saveSetupAnswers(FULL);
    const nameMemory = created.find((m) => m.statement.startsWith("Prefers to be called"))!;
    const edited = await t.memoryService.edit(nameMemory.id, "Prefers to be called A.");
    expect(edited).toMatchObject({ origin: "edited", sourceKind: "setup" });

    await t.memoryService.saveSetupAnswers({ ...FULL, name: "Sam", workingOn: "something else" }, FULL);
    const statements = (await t.memoryService.list()).map((m) => m.statement);
    expect(statements).toContain("Prefers to be called A."); // kept
    expect(statements).toContain("Prefers to be called Sam.");
    expect(statements).toContain("Currently working on: something else.");
    expect(statements).not.toContain("Currently working on: my thesis.");
  });

  it("a memory the user edited is kept, and not duplicated, when its answer did not change", async () => {
    const { created } = await t.memoryService.saveSetupAnswers(FULL);
    const nameMemory = created.find((m) => m.statement.startsWith("Prefers to be called"))!;
    await t.memoryService.edit(nameMemory.id, "Prefers to be called A.");
    await t.memoryService.saveSetupAnswers({ ...FULL, workingOn: "other" }, FULL);
    const names = (await t.memoryService.list()).filter((m) => m.statement.startsWith("Prefers to be called"));
    expect(names.map((m) => m.statement)).toEqual(["Prefers to be called A."]);
  });

  it("without earlier answers on record an edited setup memory is still kept", async () => {
    const { created } = await t.memoryService.saveSetupAnswers(answers({ name: "Ari", workingOn: "thesis" }));
    await t.memoryService.edit(created[0]!.id, "Edited by hand.");
    await t.memoryService.saveSetupAnswers(answers({ name: "Sam" }), null);
    const statements = (await t.memoryService.list()).map((m) => m.statement).sort();
    expect(statements).toEqual(["Edited by hand.", "Prefers to be called Sam."]);
  });

  it("never touches chat memories, whether or not they look similar", async () => {
    const plain = await chatMemory("Likes tea.");
    const similar = await chatMemory("Prefers to be called Ari.");
    const { created } = await t.memoryService.saveSetupAnswers(answers({ name: "Ari", workingOn: "thesis" }));
    expect(created.map((m) => m.statement)).toEqual(["Currently working on: thesis."]); // the name is already saved from chat
    await t.memoryService.saveSetupAnswers(answers({ name: "Sam" }), null);
    const left = await t.memories.list();
    expect(left.find((m) => m.id === plain.id)).toMatchObject({ statement: "Likes tea.", sourceKind: null, sourceConversationId: "c1" });
    expect(left.find((m) => m.id === similar.id)).toBeTruthy();
  });

  it("a memory deleted by the user does not come back when that answer is unchanged", async () => {
    const { created } = await t.memoryService.saveSetupAnswers(FULL);
    await t.memoryService.remove(created.find((m) => m.statement.startsWith("Prefers to be called"))!.id);
    await t.memoryService.saveSetupAnswers(FULL, FULL);
    expect((await t.memoryService.list()).some((m) => m.statement.startsWith("Prefers to be called"))).toBe(false);
  });
});

describe("existing memories (from before sourceKind)", () => {
  it("read back with sourceKind null, which means chat", async () => {
    const memory = await chatMemory();
    expect(memory.sourceKind).toBeNull();
    await t.db.$executeRawUnsafe(`UPDATE "Memory" SET "sourceKind" = NULL`);
    expect((await t.memories.get(memory.id))?.sourceKind).toBeNull();
  });
});

describe("OnboardingService", () => {
  it("starts not completed, with no answers", async () => {
    expect(await t.onboarding.state()).toEqual({ completed: false, answers: null });
  });

  it("complete and reset toggle onboarding.completedAt", async () => {
    await t.onboarding.complete();
    expect(await t.settings.get(ONBOARDING_COMPLETED_KEY)).toBe("2026-10-07T15:42:00.000Z");
    expect((await t.onboarding.state()).completed).toBe(true);
    await t.onboarding.reset();
    expect(await t.settings.get(ONBOARDING_COMPLETED_KEY)).toBeNull();
    expect((await t.onboarding.state()).completed).toBe(false);
  });

  it("saving answers stores them as JSON, stores the name, and makes the memories", async () => {
    const result = await t.onboarding.saveAnswers(FULL);
    expect(result).toMatchObject({ created: 4, removed: 0, memoryCount: 4 });
    expect(JSON.parse((await t.settings.get(ONBOARDING_ANSWERS_KEY))!)).toEqual(FULL);
    expect(await t.settings.get(USER_NAME_KEY)).toBe("Ari");
    expect(await t.onboarding.userName()).toBe("Ari");
    expect((await t.onboarding.state()).answers).toEqual(FULL);
  });

  it("running again with the saved answers as the base: unchanged answers are left alone, changed ones replaced", async () => {
    await t.onboarding.saveAnswers(FULL);
    const result = await t.onboarding.saveAnswers({ ...FULL, answerStyle: "detailed" });
    expect(result).toMatchObject({ created: 1, removed: 1 });
    const statements = (await t.memoryService.list()).map((m) => m.statement);
    expect(statements).toContain("Prefers answers with a bit more detail.");
    expect(statements).not.toContain("Prefers short answers, one step at a time.");
    expect(statements).toHaveLength(4);
  });

  it("an empty name removes the stored name", async () => {
    await t.onboarding.saveAnswers(FULL);
    await t.onboarding.saveAnswers({ ...FULL, name: "" });
    expect(await t.settings.get(USER_NAME_KEY)).toBeNull();
    expect(await t.onboarding.userName()).toBeNull();
  });

  it("unreadable saved answers count as none", async () => {
    await t.settings.set(ONBOARDING_ANSWERS_KEY, "{not json");
    expect((await t.onboarding.state()).answers).toBeNull();
    await t.settings.set(ONBOARDING_ANSWERS_KEY, JSON.stringify({ troubles: ["nope"] }));
    expect((await t.onboarding.state()).answers).toBeNull();
    await t.settings.set(ONBOARDING_ANSWERS_KEY, JSON.stringify(SetupAnswersSchema.parse({ name: "Ari" })));
    expect((await t.onboarding.state()).answers?.name).toBe("Ari");
  });
});
