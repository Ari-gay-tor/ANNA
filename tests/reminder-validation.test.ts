import { describe, expect, it } from "vitest";
import { ANNA_RESPONSE_JSON_SCHEMA, AnnaResponseSchema } from "../src/core/domain/anna-response";
import { MAX_REMINDER_TEXT_LENGTH } from "../src/core/domain/reminder";
import { parseAnnaResponse } from "../src/core/runtime/parse-reply";
import {
  REASON_REMINDER_NOT_ASKED,
  REASON_REMINDER_NO_TEXT,
  REASON_REMINDER_TOO_LONG,
  validateReminderOp,
} from "../src/core/runtime/reminder-validation";
import { REASON_NO_TIMEZONE, REASON_PASSED } from "../src/core/time/resolve-reminder-time";

const NOW = new Date("2026-10-07T15:42:00Z");
const MESSAGE = "Remind me at 6 PM to call Dad.";

const op = (overrides: Record<string, unknown> = {}) => ({
  text: "call Dad",
  evidenceQuote: "Remind me at 6 PM to call Dad",
  localDateTime: "2026-10-07T18:00",
  ...overrides,
});

const validate = (overrides: Record<string, unknown> = {}, input: { userMessage?: string; timeZone?: string | undefined } = {}) =>
  validateReminderOp({
    op: op(overrides) as never,
    userMessage: input.userMessage ?? MESSAGE,
    timeZone: "timeZone" in input ? input.timeZone : "America/New_York",
    now: NOW,
  });

describe("validateReminderOp", () => {
  it("accepts a good op and resolves the time in the saved timezone", () => {
    const decision = validate();
    expect(decision).toEqual({
      status: "accepted",
      text: "call Dad",
      evidenceQuote: "Remind me at 6 PM to call Dad",
      dueAt: new Date("2026-10-07T22:00:00Z"),
      timezone: "America/New_York",
    });
  });

  it("trims the text and the quote", () => {
    const decision = validate({ text: "  call Dad \n", evidenceQuote: "  Remind me at 6 PM to call Dad " });
    expect(decision).toMatchObject({ status: "accepted", text: "call Dad", evidenceQuote: "Remind me at 6 PM to call Dad" });
  });

  it("rejects a quote that is not in the user message", () => {
    expect(validate({ evidenceQuote: "Remind me at 7 PM to call Mom" })).toEqual({ status: "rejected", reason: REASON_REMINDER_NOT_ASKED });
  });

  it("rejects a quote shorter than 8 characters, even when it is in the message", () => {
    expect(validate({ evidenceQuote: "call Da" })).toEqual({ status: "rejected", reason: REASON_REMINDER_NOT_ASKED });
  });

  it("matches the quote with the same normalization as memory ops (case, whitespace, surrounding punctuation)", () => {
    const decision = validate({ evidenceQuote: "remind  me at 6 pm to call dad" }, { userMessage: "Remind me at 6 PM to call Dad!" });
    expect(decision.status).toBe("accepted");
  });

  it("takes the quote from the message it is given (the current user message), not from anywhere else", () => {
    expect(validate({ evidenceQuote: "remind me yesterday please" }, { userMessage: "ok" }).status).toBe("rejected");
  });

  it.each(["", "   ", "\n\t"])("rejects empty text %j", (text) => {
    expect(validate({ text })).toEqual({ status: "rejected", reason: REASON_REMINDER_NO_TEXT });
  });

  it("allows 200 characters of text and rejects 201", () => {
    expect(validate({ text: "x".repeat(MAX_REMINDER_TEXT_LENGTH) }).status).toBe("accepted");
    expect(validate({ text: "x".repeat(MAX_REMINDER_TEXT_LENGTH + 1) })).toEqual({ status: "rejected", reason: REASON_REMINDER_TOO_LONG });
    // Whitespace around the text does not count toward the limit.
    expect(validate({ text: ` ${"x".repeat(MAX_REMINDER_TEXT_LENGTH)} ` }).status).toBe("accepted");
  });

  it("rejects a time that has passed, with the resolver's reason", () => {
    expect(validate({ localDateTime: "2026-10-07T09:00" })).toEqual({ status: "rejected", reason: REASON_PASSED });
  });

  it("rejects when no timezone is saved", () => {
    expect(validate({}, { timeZone: undefined })).toEqual({ status: "rejected", reason: REASON_NO_TIMEZONE });
  });

  it("works with inMinutes", () => {
    const decision = validate({ localDateTime: undefined, inMinutes: 20 });
    expect(decision).toMatchObject({ status: "accepted", dueAt: new Date("2026-10-07T16:02:00Z") });
  });
});

describe("parseAnnaResponse: reminderOperation", () => {
  const reply = (reminderOperation: unknown) => JSON.stringify({ message: "Okay.", reminderOperation });

  it("keeps a well-formed op with localDateTime", () => {
    const parsed = parseAnnaResponse(reply(op()));
    expect(parsed?.reminderOperation).toEqual(op());
    expect(parsed?.droppedReminder).toBe(false);
  });

  it("keeps a well-formed op with inMinutes", () => {
    const parsed = parseAnnaResponse(reply(op({ localDateTime: undefined, inMinutes: 20 })));
    expect(parsed?.reminderOperation).toMatchObject({ inMinutes: 20 });
  });

  it("no reminderOperation means none, and nothing dropped", () => {
    const parsed = parseAnnaResponse(JSON.stringify({ message: "Hi." }));
    expect(parsed).toMatchObject({ reminderOperation: null, droppedReminder: false });
  });

  it("drops an op with both localDateTime and inMinutes, and keeps the reply", () => {
    const parsed = parseAnnaResponse(reply(op({ inMinutes: 20 })));
    expect(parsed).toMatchObject({ message: "Okay.", reminderOperation: null, droppedReminder: true });
  });

  it("drops an op with neither", () => {
    const parsed = parseAnnaResponse(reply(op({ localDateTime: undefined })));
    expect(parsed).toMatchObject({ message: "Okay.", reminderOperation: null, droppedReminder: true });
  });

  it("treats null for the unused field as absent", () => {
    const parsed = parseAnnaResponse(reply(op({ inMinutes: null })));
    expect(parsed).toMatchObject({ reminderOperation: op(), droppedReminder: false });
  });

  it.each([
    ["missing text", { evidenceQuote: "Remind me at 6 PM", localDateTime: "2026-10-07T18:00" }],
    ["missing quote", { text: "call Dad", localDateTime: "2026-10-07T18:00" }],
    ["non-integer minutes", op({ localDateTime: undefined, inMinutes: 20.5 })],
    ["string minutes", op({ localDateTime: undefined, inMinutes: "20" })],
    ["a number for localDateTime", op({ localDateTime: 1800 })],
    ["an array", [op()]],
    ["a string", "remind me"],
    ["a number", 5],
  ])("drops a malformed op: %s", (_name, bad) => {
    const parsed = parseAnnaResponse(reply(bad));
    expect(parsed).toMatchObject({ message: "Okay.", reminderOperation: null, droppedReminder: true });
  });

  it("a malformed reminder does not disturb memory ops", () => {
    const parsed = parseAnnaResponse(
      JSON.stringify({
        message: "Okay.",
        reminderOperation: { nope: true },
        memoryOperations: [{ op: "create", type: "fact", statement: "Has a dad.", evidenceQuote: "call Dad now", origin: "stated" }],
      }),
    );
    expect(parsed?.memoryOperations).toHaveLength(1);
    expect(parsed?.droppedReminder).toBe(true);
  });
});

describe("provider schema for reminderOperation", () => {
  const schema = (ANNA_RESPONSE_JSON_SCHEMA as { properties: { reminderOperation: { type: string; required: string[]; properties: Record<string, unknown> } } })
    .properties.reminderOperation;

  it("is a plain object schema: no oneOf/anyOf/const/not, integer minutes without huge bounds", () => {
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["text", "evidenceQuote"]);
    expect(Object.keys(schema.properties).sort()).toEqual(["evidenceQuote", "inMinutes", "localDateTime", "text"]);
    expect(schema.properties.inMinutes).toEqual({ type: "integer" });
    const json = JSON.stringify(schema);
    for (const word of ['"oneOf"', '"anyOf"', '"allOf"', '"const"', '"not"', '"$ref"']) expect(json).not.toContain(word);
  });

  it("the full response schema enforces exactly-one too (kept in sync with the parser)", () => {
    expect(AnnaResponseSchema.safeParse({ message: "x", reminderOperation: op() }).success).toBe(true);
    expect(AnnaResponseSchema.safeParse({ message: "x", reminderOperation: op({ inMinutes: 5 }) }).success).toBe(false);
  });
});
