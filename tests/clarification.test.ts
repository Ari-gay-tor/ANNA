import { describe, expect, it } from "vitest";
import { AnnaResponseSchema, ANNA_RESPONSE_JSON_SCHEMA } from "../src/core/domain/anna-response";
import { parseStoredClarification } from "../src/core/domain/clarification";
import type { Message } from "../src/core/domain/types";
import {
  composeClarificationContent,
  normalizeClarification,
  toLLMMessages,
} from "../src/core/runtime/clarification";
import { parseAnnaResponse } from "../src/core/runtime/parse-reply";

const norm = (question: string, options?: string[]) => normalizeClarification({ question, options });

describe("normalizeClarification", () => {
  it("appends exactly one 'Not sure' after the model's options", () => {
    expect(norm("What are you stuck on?", ["Applications", "Interviews"])).toEqual({
      question: "What are you stuck on?",
      options: ["Applications", "Interviews", "Not sure"],
    });
  });

  it.each([
    "Not sure",
    "NOT SURE.",
    "I'm not sure",
    "I’m not sure",
    "im not sure",
    "unsure",
    "I don't know",
    "i dont know",
    "Don't know!",
    "idk",
    "IDK?",
    "  not sure  ",
  ])("replaces the model's %j with a single 'Not sure'", (variant) => {
    const result = norm("q?", ["A", variant, "B"])!;
    expect(result.options).toEqual(["A", "B", "Not sure"]);
    expect(result.options.filter((o) => o === "Not sure")).toHaveLength(1);
  });

  it("drops every not-sure variant, even several at once", () => {
    expect(norm("q?", ["Not sure", "I'm not sure", "idk", "Unsure"])!.options).toEqual(["Not sure"]);
  });

  it("does not treat longer phrases that merely contain 'not sure' as variants", () => {
    expect(norm("q?", ["Not sure how to start"])!.options).toEqual(["Not sure how to start", "Not sure"]);
  });

  it("keeps at most 4 model options, so at most 5 in total", () => {
    const result = norm("q?", ["A", "B", "C", "D", "E", "F"])!;
    expect(result.options).toEqual(["A", "B", "C", "D", "Not sure"]);
    expect(result.options).toHaveLength(5);
  });

  it("removes duplicates case-insensitively and keeps the first spelling", () => {
    expect(norm("q?", ["Applications", "applications", "APPLICATIONS", "Interviews"])!.options).toEqual([
      "Applications",
      "Interviews",
      "Not sure",
    ]);
  });

  it("trims options and drops empty ones", () => {
    expect(norm("q?", ["  A  ", "", "   ", "B"])!.options).toEqual(["A", "B", "Not sure"]);
  });

  it("removes duplicates and variants before applying the 4-option cap", () => {
    expect(norm("q?", ["A", "a", "Not sure", "B", "C", "D", "E"])!.options).toEqual(["A", "B", "C", "D", "Not sure"]);
  });

  it("empty or missing options give just 'Not sure'", () => {
    expect(norm("q?", [])!.options).toEqual(["Not sure"]);
    expect(norm("q?", undefined)!.options).toEqual(["Not sure"]);
    expect(norm("q?", ["", "  "])!.options).toEqual(["Not sure"]);
  });

  it("returns null when the question is empty after trimming", () => {
    expect(norm("", ["A"])).toBeNull();
    expect(norm("   \n ", ["A"])).toBeNull();
  });

  it("trims the question", () => {
    expect(norm("  What now?  ")!.question).toBe("What now?");
  });
});

describe("composeClarificationContent", () => {
  it("joins the message and the question with a blank line", () => {
    expect(composeClarificationContent("Okay.", "What are you stuck on?")).toBe("Okay.\n\nWhat are you stuck on?");
  });

  it("uses just the question when the message is empty", () => {
    expect(composeClarificationContent("", "What are you stuck on?")).toBe("What are you stuck on?");
  });

  it("removes a question sentence from the message, so the question appears once", () => {
    const message = "Internships can mean a lot. What are you stuck on?";
    expect(composeClarificationContent(message, "What are you stuck on?")).toBe(
      "Internships can mean a lot.\n\nWhat are you stuck on?",
    );
  });

  it("removes a reworded question from the message (live test-f-restraint reply)", () => {
    const content = composeClarificationContent(
      "What kind of thing are you trying to tackle right now?",
      "What kind of task are you trying to tackle?",
    );
    expect(content).toBe("What kind of task are you trying to tackle?");
    expect(content.match(/\?/g)).toHaveLength(1);
  });

  it("keeps a statement and drops the question in the same message", () => {
    expect(composeClarificationContent("That sounds like a lot. What matters most today?", "Which one is due first?")).toBe(
      "That sounds like a lot.\n\nWhich one is due first?",
    );
  });

  it("keeps several statements and drops every question sentence", () => {
    expect(composeClarificationContent("Okay! Is it urgent? Let's narrow it down. Or not?", "Which one is due first?")).toBe(
      "Okay! Let's narrow it down.\n\nWhich one is due first?",
    );
  });

  it("gives the question alone when the message is only a question", () => {
    expect(composeClarificationContent("What are you doing?", "What are you stuck on?")).toBe("What are you stuck on?");
  });

  it("leaves a message with no question unchanged", () => {
    const message = "Okay.  Internships have\na few moving parts!";
    expect(composeClarificationContent(message, "What are you stuck on?")).toBe(`${message}\n\nWhat are you stuck on?`);
  });
});

describe("AnnaResponseSchema", () => {
  it("accepts an empty message when a clarification is present", () => {
    expect(AnnaResponseSchema.safeParse({ message: "", clarification: { question: "What are you stuck on?" } }).success).toBe(true);
  });

  it("rejects an empty or blank message without a clarification", () => {
    expect(AnnaResponseSchema.safeParse({ message: "" }).success).toBe(false);
    expect(AnnaResponseSchema.safeParse({ message: "   " }).success).toBe(false);
  });

  it("accepts a normal message with or without options", () => {
    expect(AnnaResponseSchema.safeParse({ message: "Hi" }).success).toBe(true);
    expect(AnnaResponseSchema.safeParse({ message: "Hi", clarification: { question: "q", options: ["a"] } }).success).toBe(true);
  });

  it("rejects a malformed clarification", () => {
    expect(AnnaResponseSchema.safeParse({ message: "Hi", clarification: { options: ["a"] } }).success).toBe(false);
    expect(AnnaResponseSchema.safeParse({ message: "Hi", clarification: { question: "q", options: "a" } }).success).toBe(false);
  });
});

describe("response JSON schema sent to providers", () => {
  const schema = ANNA_RESPONSE_JSON_SCHEMA as { required?: string[]; properties: Record<string, unknown> };

  it("describes clarification as an optional object with a required question and optional string options", () => {
    expect(schema.required).toEqual(["message"]);
    expect(schema.properties.clarification).toEqual({
      type: "object",
      properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } },
      required: ["question"],
      additionalProperties: false,
    });
  });

  it("does not require a non-empty message (the parser enforces that) and avoids keywords Gemini does not document", () => {
    expect(schema.properties.message).toEqual({ type: "string" });
    const text = JSON.stringify(schema);
    for (const keyword of ['"const"', '"$schema"', '"$ref"', '"minLength"']) expect(text).not.toContain(keyword);
  });
});

describe("parseAnnaResponse and clarification", () => {
  const json = (value: unknown) => JSON.stringify(value);

  it("accepts an empty message with a valid clarification, and normalizes it", () => {
    const parsed = parseAnnaResponse(json({ message: "", clarification: { question: " Which one? ", options: ["A", "not sure"] } }));
    expect(parsed).toMatchObject({
      message: "",
      clarification: { question: "Which one?", options: ["A", "Not sure"] },
      droppedClarification: false,
    });
  });

  it("rejects an empty message without a clarification (so the runtime retries, then falls back)", () => {
    expect(parseAnnaResponse(json({ message: "" }))).toBeNull();
    expect(parseAnnaResponse(json({ message: "  ", memoryOperations: [] }))).toBeNull();
    expect(parseAnnaResponse(json({ message: "", clarification: null }))).toBeNull();
  });

  it("drops a malformed clarification, keeps the reply and the memory ops", () => {
    const op = { op: "create", type: "fact", statement: "S", evidenceQuote: "q", origin: "stated" };
    const malformed = [{ options: ["A"] }, { question: 5 }, { question: "q", options: "A" }, { question: "q", options: [1, 2] }, "text", [], 7];
    for (const bad of malformed) {
      const parsed = parseAnnaResponse(json({ message: "Hello", clarification: bad, memoryOperations: [op] }));
      expect(parsed).toMatchObject({ message: "Hello", clarification: null, droppedClarification: true });
      expect(parsed?.memoryOperations).toEqual([op]);
    }
  });

  it("treats a clarification whose question is blank as malformed", () => {
    const parsed = parseAnnaResponse(json({ message: "Hello", clarification: { question: "  ", options: ["A"] } }));
    expect(parsed).toMatchObject({ message: "Hello", clarification: null, droppedClarification: true });
  });

  it("an empty message with a malformed clarification is invalid", () => {
    expect(parseAnnaResponse(json({ message: "", clarification: { question: 5 } }))).toBeNull();
  });

  it("a missing or null clarification is not a drop", () => {
    expect(parseAnnaResponse(json({ message: "Hi" }))).toMatchObject({ clarification: null, droppedClarification: false });
    expect(parseAnnaResponse(json({ message: "Hi", clarification: null }))).toMatchObject({
      clarification: null,
      droppedClarification: false,
    });
  });

  it("agrees with AnnaResponseSchema on whether an empty message is acceptable", () => {
    const cases = [
      { message: "" },
      { message: "Hi" },
      { message: "", clarification: { question: "q" } },
      { message: "", clarification: { question: 5 } },
    ];
    for (const value of cases) {
      expect(parseAnnaResponse(json(value)) !== null).toBe(AnnaResponseSchema.safeParse(value).success);
    }
  });
});

describe("parseStoredClarification", () => {
  it("round-trips valid JSON and returns null for anything unreadable", () => {
    const value = { question: "q?", options: ["A", "Not sure"] };
    expect(parseStoredClarification(JSON.stringify(value))).toEqual(value);
    expect(parseStoredClarification(null)).toBeNull();
    expect(parseStoredClarification("{nope")).toBeNull();
    expect(parseStoredClarification('{"question":""}')).toBeNull();
  });
});

describe("toLLMMessages", () => {
  const base = { id: "m", conversationId: "c", operations: [], createdAt: new Date(0) };
  const assistant = (content: string, clarification: Message["clarification"] = null): Message => ({
    ...base,
    role: "assistant",
    content,
    clarification,
    selectedOption: false,
  });
  const user = (content: string, selectedOption = false): Message => ({
    ...base,
    role: "user",
    content,
    clarification: null,
    selectedOption,
  });

  it("annotates a clarification with its options and a tapped option, leaving the rest untouched", () => {
    const history = [
      user("I need to deal with my internship."),
      assistant("What are you stuck on?", { question: "What are you stuck on?", options: ["Applications", "Interviews", "Not sure"] }),
      user("Applications", true),
      assistant("Okay."),
    ];
    expect(toLLMMessages(history)).toEqual([
      { role: "user", content: "I need to deal with my internship." },
      { role: "assistant", content: "What are you stuck on?\n(Options offered: Applications / Interviews / Not sure)" },
      { role: "user", content: "(Tapped option) Applications" },
      { role: "assistant", content: "Okay." },
    ]);
  });

  it("does not mutate its input", () => {
    const history = [assistant("Q?", { question: "Q?", options: ["A", "Not sure"] }), user("A", true)];
    toLLMMessages(history);
    expect(history[0]!.content).toBe("Q?");
    expect(history[1]!.content).toBe("A");
  });
});
