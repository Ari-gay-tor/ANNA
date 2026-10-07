import { afterEach, describe, expect, it } from "vitest";
import { missedMessage, reminderMessage } from "../src/components/reminder-text";
import { TIMEZONE_SETTING_KEY } from "../src/core/runtime/anna";
import { testAnna } from "./helpers";

describe("banner wording", () => {
  it("says what the user asked for", () => {
    expect(reminderMessage({ text: "call Dad" })).toBe("You asked me to remind you to call Dad.");
    expect(reminderMessage({ text: "call Dad." })).toBe("You asked me to remind you to call Dad.");
  });

  it("the missed line names the due time in the reminder's own timezone", () => {
    const now = new Date("2026-10-07T23:30:00Z"); // 7:30 PM in New York
    expect(missedMessage({ dueAt: "2026-10-07T22:00:00.000Z", timezone: "America/New_York" }, now)).toBe(
      "This was due at 6:00 PM, while ANNA wasn't running.",
    );
  });

  it("the missed line names the day when it was not today", () => {
    const now = new Date("2026-10-08T15:00:00Z"); // Thursday morning in New York
    expect(missedMessage({ dueAt: "2026-10-07T22:00:00.000Z", timezone: "America/New_York" }, now)).toBe(
      "This was due at Wed Oct 7, 6:00 PM, while ANNA wasn't running.",
    );
  });
});

describe("fake provider reminder mode (offline UI work)", () => {
  let current: ReturnType<typeof testAnna> | undefined;
  afterEach(async () => {
    await current?.db.$disconnect();
    current = undefined;
  });

  it("a message containing 'remind' sets a reminder N minutes out, with the text after ' to '", async () => {
    current = testAnna();
    await current.settings.set(TIMEZONE_SETTING_KEY, "UTC");
    const result = await current.anna.handleMessage({ text: "Remind me in 5 minutes to stretch." });
    const [row] = await current.db.reminder.findMany();
    expect(row).toMatchObject({ text: "stretch", status: "pending" });
    expect(row!.dueAt.getTime()).toBe(new Date("2026-10-07T15:47:00Z").getTime());
    expect(result.assistantMessage.operations).toMatchObject([{ kind: "reminder.created", text: "stretch" }]);
  });

  it("without 'in N minutes' it is 60 minutes out", async () => {
    current = testAnna();
    await current.settings.set(TIMEZONE_SETTING_KEY, "UTC");
    await current.anna.handleMessage({ text: "remind me about the report" });
    const [row] = await current.db.reminder.findMany();
    expect(row!.dueAt).toEqual(new Date("2026-10-07T16:42:00Z"));
  });
});
