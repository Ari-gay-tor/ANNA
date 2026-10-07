import { describe, expect, it } from "vitest";
import type { Message } from "../src/core/domain/types";
import { buildSystemPrompt } from "../src/core/runtime/context";
import {
  LIMIT_HINT,
  NOT_SURE_HINT,
  TURN_GUIDANCE_HEADER,
  buildTurnGuidanceSection,
  consecutiveClarifications,
  turnGuidanceHints,
} from "../src/core/runtime/turn-guidance";

const base = { id: "m", conversationId: "c", operations: [], createdAt: new Date(0) };
const ask = (): Message => ({
  ...base,
  role: "assistant",
  content: "Which one?",
  clarification: { question: "Which one?", options: ["A", "Not sure"] },
  selectedOption: false,
});
const answer = (): Message => ({ ...base, role: "assistant", content: "Here you go.", clarification: null, selectedOption: false });
const user = (content = "ok", selectedOption = false): Message => ({
  ...base,
  role: "user",
  content,
  clarification: null,
  selectedOption,
});

describe("clarification limit hint", () => {
  it("is absent with 0 clarifications", () => {
    expect(turnGuidanceHints([user("hi")])).toEqual([]);
    expect(turnGuidanceHints([user("hi"), answer(), user("more")])).toEqual([]);
  });

  it("is absent with 1 clarification", () => {
    expect(consecutiveClarifications([user("hi"), ask(), user("A", true)])).toBe(1);
    expect(turnGuidanceHints([user("hi"), ask(), user("A", true)])).toEqual([]);
  });

  it("appears at 2 consecutive clarifications", () => {
    const history = [user("hi"), ask(), user("A", true), ask(), user("B", true)];
    expect(consecutiveClarifications(history)).toBe(2);
    expect(turnGuidanceHints(history)).toEqual([LIMIT_HINT]);
  });

  it("still appears at 3 or more", () => {
    const history = [user("hi"), ask(), user("a"), ask(), user("b"), ask(), user("c")];
    expect(turnGuidanceHints(history)).toEqual([LIMIT_HINT]);
  });

  it("an assistant answer without a clarification resets the count", () => {
    const history = [user("hi"), ask(), user("a"), ask(), user("b"), answer(), user("c"), ask(), user("d")];
    expect(consecutiveClarifications(history)).toBe(1);
    expect(turnGuidanceHints(history)).toEqual([]);
  });

  it("counts only the run ending at the newest assistant message, not older runs", () => {
    const history = [user("hi"), ask(), user("a"), ask(), user("b"), answer(), user("c")];
    expect(consecutiveClarifications(history)).toBe(0);
    expect(turnGuidanceHints(history)).toEqual([]);
  });

  it("has the exact wording from the brief", () => {
    expect(LIMIT_HINT).toBe(
      "You have asked 2 clarifying questions in a row. Do not ask another. Give your best answer now and state your assumptions in one line.",
    );
  });
});

describe("'Not sure' hint", () => {
  it("appears when the latest user message is a tapped 'Not sure'", () => {
    expect(turnGuidanceHints([user("hi"), ask(), user("Not sure", true)])).toEqual([NOT_SURE_HINT]);
  });

  it("does not appear when 'not sure' was typed (selectedOption false)", () => {
    expect(turnGuidanceHints([user("hi"), ask(), user("not sure", false)])).toEqual([]);
    expect(turnGuidanceHints([user("hi"), ask(), user("Not sure", false)])).toEqual([]);
  });

  it("does not appear for another tapped option", () => {
    expect(turnGuidanceHints([user("hi"), ask(), user("Applications", true)])).toEqual([]);
  });

  it("only looks at the latest message", () => {
    expect(turnGuidanceHints([user("hi"), ask(), user("Not sure", true), answer(), user("thanks")])).toEqual([]);
  });

  it("has the exact wording from the brief", () => {
    expect(NOT_SURE_HINT).toBe(
      "The user tapped 'Not sure'. Don't ask them to rephrase or explain. Narrow it down yourself: offer your best guesses as options, or ask an easier either/or question.",
    );
  });
});

describe("both hints", () => {
  it("are both present, limit first", () => {
    const history = [user("hi"), ask(), user("A", true), ask(), user("Not sure", true)];
    expect(turnGuidanceHints(history)).toEqual([LIMIT_HINT, NOT_SURE_HINT]);
  });
});

describe("the prompt section", () => {
  const now = new Date("2026-10-07T15:42:00Z");

  it("is omitted when there are no hints", () => {
    expect(buildTurnGuidanceSection([])).toBeNull();
    expect(buildSystemPrompt(now, "UTC", [], [])).not.toContain(TURN_GUIDANCE_HEADER);
    expect(buildSystemPrompt(now, "UTC")).not.toContain(TURN_GUIDANCE_HEADER);
  });

  it("lists the hints under 'Turn guidance:' in order, after the rest of the prompt", () => {
    const system = buildSystemPrompt(now, "UTC", [], [LIMIT_HINT, NOT_SURE_HINT]);
    expect(system).toContain(`${TURN_GUIDANCE_HEADER}\n- ${LIMIT_HINT}\n- ${NOT_SURE_HINT}`);
    expect(system.indexOf(TURN_GUIDANCE_HEADER)).toBeGreaterThan(system.indexOf("What you know about the user"));
    expect(system.indexOf(LIMIT_HINT)).toBeLessThan(system.indexOf(NOT_SURE_HINT));
  });
});
