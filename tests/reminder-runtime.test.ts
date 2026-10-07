import { afterEach, describe, expect, it } from "vitest";
import { AnnaError } from "../src/core/domain/errors";
import { SYSTEM_PROMPT } from "../src/core/prompts/system";
import { annotateOperations, reminderIdsIn } from "../src/core/runtime/annotate-operations";
import { REASON_REMINDER_MALFORMED, REASON_REMINDER_NOT_ASKED } from "../src/core/runtime/reminder-validation";
import { REASON_NO_TIMEZONE, REASON_PASSED } from "../src/core/time/resolve-reminder-time";
import { TIMEZONE_SETTING_KEY } from "../src/core/runtime/anna";
import { FIXED_NOW, reply, replyWithOps, replyWithReminder, testAnna } from "./helpers";

let current: ReturnType<typeof testAnna> | undefined;
function setup() {
  current = testAnna();
  return current;
}
afterEach(async () => {
  await current?.db.$disconnect();
  current = undefined;
});

/** FIXED_NOW is 2026-10-07T15:42Z, which is 11:42 on Wednesday in New York. */
async function setupWithZone(timeZone = "America/New_York") {
  const t = setup();
  await t.settings.set(TIMEZONE_SETTING_KEY, timeZone);
  return t;
}

const SIX_PM = "Remind me at 6 PM to call Dad.";
const sixPmOp = (overrides: Record<string, unknown> = {}) => ({
  text: "call Dad",
  evidenceQuote: "Remind me at 6 PM to call Dad",
  localDateTime: "2026-10-07T18:00",
  ...overrides,
});

describe("reminder op: accepted", () => {
  it("persists a pending reminder with provenance and timezone, and returns a reminder.created result", async () => {
    const t = await setupWithZone();
    t.provider.enqueue(replyWithReminder("Okay, I'll remind you.", sixPmOp()));
    const result = await t.anna.handleMessage({ text: SIX_PM });

    const rows = await t.db.reminder.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      text: "call Dad",
      dueAt: new Date("2026-10-07T22:00:00Z"), // 6 PM EDT
      timezone: "America/New_York",
      status: "pending",
      firedAt: null,
      missed: false,
      acknowledgedAt: null,
      sourceConversationId: result.conversationId,
      sourceMessageId: result.userMessage.id,
    });

    expect(result.assistantMessage.content).toBe("Okay, I'll remind you.");
    expect(result.assistantMessage.operations).toEqual([
      {
        kind: "reminder.created",
        reminderId: rows[0]!.id,
        text: "call Dad",
        dueAt: "2026-10-07T22:00:00.000Z",
        timezone: "America/New_York",
      },
    ]);
    // Stored on the message, so a reload shows the same chip.
    const stored = (await t.conversations.get(result.conversationId))!.messages.at(-1)!;
    expect(stored.operations).toEqual(result.assistantMessage.operations);
  });

  it("resolves inMinutes from the clock", async () => {
    const t = await setupWithZone("Asia/Kolkata");
    t.provider.enqueue(
      replyWithReminder("Okay.", { text: "stretch", evidenceQuote: "Remind me in 2 minutes to stretch", inMinutes: 2 }),
    );
    await t.anna.handleMessage({ text: "Remind me in 2 minutes to stretch" });
    const [row] = await t.db.reminder.findMany();
    expect(row).toMatchObject({ dueAt: new Date(FIXED_NOW.getTime() + 120_000), timezone: "Asia/Kolkata" });
  });

  it("a reminder and a memory op in the same turn both execute", async () => {
    const t = await setupWithZone();
    t.provider.enqueue(
      JSON.stringify({
        message: "Done.",
        reminderOperation: sixPmOp(),
        memoryOperations: [
          { op: "create", type: "fact", statement: "Has a dad to call.", evidenceQuote: "to call Dad", origin: "stated" },
        ],
      }),
    );
    const result = await t.anna.handleMessage({ text: SIX_PM });
    expect(result.assistantMessage.operations.map((o) => o.kind)).toEqual(["memory.created", "reminder.created"]);
    expect(await t.db.reminder.count()).toBe(1);
    expect(await t.db.memory.count()).toBe(1);
  });

  it("does not append any notice", async () => {
    const t = await setupWithZone();
    t.provider.enqueue(replyWithReminder("Okay.", sixPmOp()));
    const result = await t.anna.handleMessage({ text: SIX_PM });
    expect(result.assistantMessage.content).toBe("Okay.");
  });
});

describe("reminder op: rejected", () => {
  it("a quote that is not in the message: appends the notice, creates no row, logs only the reason", async () => {
    const t = await setupWithZone();
    t.provider.enqueue(replyWithReminder("Okay, I'll remind you.", sixPmOp({ evidenceQuote: "Remind me at 7 PM to feed the cat", text: "secret text" })));
    const result = await t.anna.handleMessage({ text: SIX_PM });

    expect(await t.db.reminder.count()).toBe(0);
    expect(result.assistantMessage.content).toBe(`Okay, I'll remind you.\n(I didn't set that reminder: ${REASON_REMINDER_NOT_ASKED}.)`);
    expect(result.assistantMessage.operations).toEqual([{ kind: "reminder.rejected", reason: REASON_REMINDER_NOT_ASKED }]);

    const logged = t.logs.filter((l) => l.includes("reminder rejected"));
    expect(logged).toEqual([`[anna] reminder rejected: reason="${REASON_REMINDER_NOT_ASKED}"`]);
    expect(t.logs.join("\n")).not.toContain("secret text");
    expect(t.logs.join("\n")).not.toContain("feed the cat");
  });

  it("a time in the past", async () => {
    const t = await setupWithZone();
    t.provider.enqueue(replyWithReminder("Done.", sixPmOp({ localDateTime: "2026-10-06T15:00", evidenceQuote: "Remind me yesterday at 3 PM" })));
    const result = await t.anna.handleMessage({ text: "Remind me yesterday at 3 PM to file the report" });
    expect(await t.db.reminder.count()).toBe(0);
    expect(result.assistantMessage.content).toBe(`Done.\n(I didn't set that reminder: ${REASON_PASSED}.)`);
  });

  it("a nonexistent DST-gap time", async () => {
    const t = await setupWithZone();
    t.provider.enqueue(replyWithReminder("Okay.", sixPmOp({ localDateTime: "2027-03-14T02:30", evidenceQuote: "Remind me on March 14 at 2:30" })));
    const result = await t.anna.handleMessage({ text: "Remind me on March 14 at 2:30 AM to wake up" });
    expect(await t.db.reminder.count()).toBe(0);
    expect(result.assistantMessage.content).toContain("(I didn't set that reminder: that time doesn't exist in your timezone (the clocks change then).)");
  });

  it("no saved timezone: refuses rather than guessing", async () => {
    const t = setup(); // no timezone setting
    t.provider.enqueue(replyWithReminder("Okay.", sixPmOp()));
    const result = await t.anna.handleMessage({ text: SIX_PM });
    expect(await t.db.reminder.count()).toBe(0);
    expect(result.assistantMessage.content).toBe(`Okay.\n(I didn't set that reminder: ${REASON_NO_TIMEZONE}.)`);
  });

  it("empty text", async () => {
    const t = await setupWithZone();
    t.provider.enqueue(replyWithReminder("Okay.", sixPmOp({ text: "   " })));
    const result = await t.anna.handleMessage({ text: SIX_PM });
    expect(await t.db.reminder.count()).toBe(0);
    expect(result.assistantMessage.content).toContain("(I didn't set that reminder: there was nothing to remind you about.)");
  });

  it("both localDateTime and inMinutes: a malformed op is a rejected reminder: notice appended, rejected result stored, reason logged, no row", async () => {
    const t = await setupWithZone();
    t.provider.enqueue(replyWithReminder("Okay, I'll remind you.", sixPmOp({ inMinutes: 20 })));
    const result = await t.anna.handleMessage({ text: SIX_PM });
    expect(await t.db.reminder.count()).toBe(0);
    expect(result.assistantMessage.content).toBe(`Okay, I'll remind you.\n(I didn't set that reminder: ${REASON_REMINDER_MALFORMED}.)`);
    expect(result.assistantMessage.operations).toEqual([{ kind: "reminder.rejected", reason: REASON_REMINDER_MALFORMED }]);
    expect(t.logs.filter((l) => l.includes("reminder rejected"))).toEqual([`[anna] reminder rejected: reason="${REASON_REMINDER_MALFORMED}"`]);
    const stored = (await t.conversations.get(result.conversationId))!.messages.at(-1)!;
    expect(stored.operations).toEqual([{ kind: "reminder.rejected", reason: REASON_REMINDER_MALFORMED }]);
  });

  it.each([
    ["neither localDateTime nor inMinutes", sixPmOp({ localDateTime: undefined })],
    ["missing text", { evidenceQuote: "Remind me at 6 PM to call Dad", localDateTime: "2026-10-07T18:00" }],
    ["non-integer minutes", sixPmOp({ localDateTime: undefined, inMinutes: 20.5 })],
    ["wrong type", "remind me"],
  ])("%s: also a rejected reminder with the notice", async (_name, bad) => {
    const t = await setupWithZone();
    t.provider.enqueue(replyWithReminder("Okay.", bad));
    const result = await t.anna.handleMessage({ text: SIX_PM });
    expect(await t.db.reminder.count()).toBe(0);
    expect(result.assistantMessage.content).toBe(`Okay.\n(I didn't set that reminder: ${REASON_REMINDER_MALFORMED}.)`);
    expect(result.assistantMessage.operations).toEqual([{ kind: "reminder.rejected", reason: REASON_REMINDER_MALFORMED }]);
  });
});

describe("no reminder op (Test F shape)", () => {
  it("reminderOperation: null means no reminder: no notice, no result, no row", async () => {
    const t = await setupWithZone();
    t.provider.enqueue(replyWithReminder("Just a thought.", null));
    const result = await t.anna.handleMessage({ text: "I've been sitting here for an hour." });
    expect(await t.db.reminder.count()).toBe(0);
    expect(result.assistantMessage.content).toBe("Just a thought.");
    expect(result.assistantMessage.operations).toEqual([]);
    expect(t.logs.filter((l) => l.includes("reminder"))).toEqual([]);
  });

  it("a reply without reminderOperation creates nothing", async () => {
    const t = await setupWithZone();
    t.provider.enqueue(reply("An hour is a long stretch. Want a quick break idea?"));
    const result = await t.anna.handleMessage({ text: "I've been sitting here for an hour." });
    expect(await t.db.reminder.count()).toBe(0);
    expect(result.assistantMessage.operations).toEqual([]);
    expect(result.assistantMessage.content).not.toContain("(I didn't set");
    const row = await t.db.message.findFirst({ where: { role: "assistant" } });
    expect(row?.operations).toBeNull();
  });

  it("a reply with only memory ops creates no reminder", async () => {
    const t = await setupWithZone();
    t.provider.enqueue(
      replyWithOps("Noted.", [
        { op: "create", type: "fact", statement: "Has an exam tomorrow.", evidenceQuote: "I have an exam tomorrow", origin: "stated" },
      ]),
    );
    await t.anna.handleMessage({ text: "I have an exam tomorrow" });
    expect(await t.db.reminder.count()).toBe(0);
  });
});

describe("prompt", () => {
  it("tells the model the reminder rules", () => {
    expect(SYSTEM_PROMPT).toContain("reminderOperation");
    expect(SYSTEM_PROMPT).toMatch(/only when the user explicitly asks to be reminded/);
    expect(SYSTEM_PROMPT).toMatch(/Never on your own initiative/);
    expect(SYSTEM_PROMPT).toMatch(/inMinutes/);
    expect(SYSTEM_PROMPT).toMatch(/next occurrence/);
    expect(SYSTEM_PROMPT).toMatch(/clarification instead of guessing/);
    expect(SYSTEM_PROMPT).toMatch(/Only say a reminder is set if you include the op/);
  });

  it("the request sent to the provider carries the schema with reminderOperation and the local time", async () => {
    const t = await setupWithZone();
    t.provider.enqueue(reply("Hi."));
    await t.anna.handleMessage({ text: "hello" });
    const request = t.provider.calls[0]!;
    expect(JSON.stringify(request.jsonSchema)).toContain("reminderOperation");
    expect(request.system).toContain("Current local date and time: Wednesday 2026-10-07 11:42");
    expect(request.system).toContain("America/New_York");
  });
});

describe("annotateOperations: reminder status", () => {
  it("adds the reminder's current status to reminder.created ops", async () => {
    const t = await setupWithZone();
    t.provider.enqueue(replyWithReminder("Okay.", sixPmOp()));
    const { conversationId } = await t.anna.handleMessage({ text: SIX_PM });
    const messages = (await t.conversations.get(conversationId))!.messages;
    const [id] = reminderIdsIn(messages);
    expect(id).toBeTruthy();

    const annotate = async () => annotateOperations(messages, new Set(), await t.reminderService.statuses(reminderIdsIn(messages))).at(-1)!.operations;
    expect(await annotate()).toMatchObject([{ kind: "reminder.created", status: "pending" }]);
    await t.reminderService.cancel(id!);
    expect(await annotate()).toMatchObject([{ kind: "reminder.created", status: "cancelled" }]);
  });

  it("reports a reminder that cannot be found as missing, and leaves other ops alone", () => {
    const messages = [
      {
        id: "m",
        conversationId: "c",
        role: "assistant" as const,
        content: "x",
        operations: [
          { kind: "reminder.created" as const, reminderId: "gone", text: "t", dueAt: "2026-10-07T22:00:00.000Z", timezone: "UTC" },
          { kind: "reminder.rejected" as const, reason: "r" },
        ],
        clarification: null,
        selectedOption: false,
        createdAt: new Date(),
      },
    ];
    expect(annotateOperations(messages, new Set())[0]!.operations).toMatchObject([{ status: "missing" }, { kind: "reminder.rejected" }]);
  });
});

describe("reminder service", () => {
  const input = (dueAt: Date) => ({ text: "x", dueAt, timezone: "UTC", sourceConversationId: null, sourceMessageId: null });

  it("cancel: 404 for an unknown id, 409 once it is no longer pending", async () => {
    const t = setup();
    await expect(t.reminderService.cancel("nope")).rejects.toMatchObject({ kind: "NOT_FOUND" });

    const r = await t.reminders.create(input(new Date(FIXED_NOW.getTime() + 60_000)));
    expect((await t.reminderService.cancel(r.id)).status).toBe("cancelled");
    await expect(t.reminderService.cancel(r.id)).rejects.toMatchObject({ kind: "CONFLICT" });

    const fired = await t.reminders.create(input(new Date(FIXED_NOW.getTime() - 1000)));
    await t.reminders.markFired(fired.id, FIXED_NOW, false);
    await expect(t.reminderService.cancel(fired.id)).rejects.toBeInstanceOf(AnnaError);
    await expect(t.reminderService.cancel(fired.id)).rejects.toMatchObject({ kind: "CONFLICT" });
  });

  it("acknowledge: 404 unknown, 409 while pending, idempotent once fired", async () => {
    const t = setup();
    await expect(t.reminderService.acknowledge("nope")).rejects.toMatchObject({ kind: "NOT_FOUND" });
    const r = await t.reminders.create(input(new Date(FIXED_NOW.getTime() - 1000)));
    await expect(t.reminderService.acknowledge(r.id)).rejects.toMatchObject({ kind: "CONFLICT" });

    await t.reminders.markFired(r.id, FIXED_NOW, false);
    expect(await t.reminderService.due()).toHaveLength(1);
    const first = await t.reminderService.acknowledge(r.id);
    expect(first.acknowledgedAt).toEqual(FIXED_NOW);
    expect(await t.reminderService.due()).toHaveLength(0);
    expect((await t.reminderService.acknowledge(r.id)).acknowledgedAt).toEqual(FIXED_NOW);
  });

  it("list: upcoming by dueAt ascending; recent = fired or cancelled in the last 7 days, newest first", async () => {
    const t = setup();
    const day = 24 * 60 * 60 * 1000;
    const at = (ms: number) => new Date(FIXED_NOW.getTime() + ms);

    const later = await t.reminders.create(input(at(2 * day)));
    const sooner = await t.reminders.create(input(at(60_000)));
    const firedRecent = await t.reminders.create(input(at(-1 * day)));
    await t.reminders.markFired(firedRecent.id, at(-1 * day), false);
    const firedOld = await t.reminders.create(input(at(-9 * day)));
    await t.reminders.markFired(firedOld.id, at(-9 * day), true);
    const cancelled = await t.reminders.create(input(at(day)));
    await t.reminders.cancel(cancelled.id);

    const { upcoming, recent } = await t.reminderService.list();
    expect(upcoming.map((r) => r.id)).toEqual([sooner.id, later.id]);
    expect(recent.map((r) => r.id)).toEqual([cancelled.id, firedRecent.id]); // newest first; the 9-day-old one is out
  });
});
