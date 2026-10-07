import { afterEach, describe, expect, it, vi } from "vitest";
import { runReminderTick } from "../src/server/reminder-poller";
import type { FiredReminder, ReminderNotifier } from "../src/server/toast-notifier";
import { FIXED_NOW, testAnna } from "./helpers";

let current: ReturnType<typeof testAnna> | undefined;
afterEach(async () => {
  await current?.db.$disconnect();
  current = undefined;
});

const NOW = FIXED_NOW;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const make = (t: ReturnType<typeof testAnna>, dueAt: Date, text: string) =>
  t.reminders.create({ text, dueAt, timezone: "UTC", sourceConversationId: null, sourceMessageId: null });

function recordingNotifier() {
  const calls: FiredReminder[] = [];
  const notifier: ReminderNotifier = { notify: async (r) => void calls.push(r) };
  return { calls, notifier };
}

describe("runReminderTick notifications", () => {
  it("a fired reminder calls the notifier once with its text and missed=false", async () => {
    current = testAnna();
    const r = await make(current, ago(10_000), "call Dad");
    const { calls, notifier } = recordingNotifier();

    await runReminderTick({ reminders: current.reminders, notifier, log: () => {}, now: NOW });

    expect(calls).toEqual([{ id: r.id, text: "call Dad", dueAt: r.dueAt, timezone: "UTC", missed: false }]);
  });

  it("a reminder fired late arrives with missed=true", async () => {
    current = testAnna();
    const r = await make(current, ago(10 * 60_000), "stretch");
    const { calls, notifier } = recordingNotifier();

    await runReminderTick({ reminders: current.reminders, notifier, log: () => {}, now: NOW });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: r.id, text: "stretch", missed: true });
  });

  it("notifies once per reminder: a second tick, or a future reminder, calls nothing", async () => {
    current = testAnna();
    await make(current, ago(1000), "a");
    await make(current, new Date(NOW.getTime() + 60_000), "later");
    const { calls, notifier } = recordingNotifier();

    await runReminderTick({ reminders: current.reminders, notifier, log: () => {}, now: NOW });
    await runReminderTick({ reminders: current.reminders, notifier, log: () => {}, now: NOW });

    expect(calls.map((c) => c.text)).toEqual(["a"]);
  });

  it("a cancelled reminder is never notified", async () => {
    current = testAnna();
    const r = await make(current, ago(1000), "nope");
    await current.reminders.cancel(r.id);
    const { calls, notifier } = recordingNotifier();
    await runReminderTick({ reminders: current.reminders, notifier, log: () => {}, now: NOW });
    expect(calls).toEqual([]);
  });

  it("a notifier that throws is logged on one line, does not stop the next reminder, and the reminder stays fired", async () => {
    current = testAnna();
    const first = await make(current, ago(2000), "first");
    const second = await make(current, ago(1000), "second");
    const notify = vi.fn(async (r: FiredReminder) => {
      if (r.text === "first") throw new Error("powershell is missing");
    });
    const logs: string[] = [];

    await expect(runReminderTick({ reminders: current.reminders, notifier: { notify }, log: (l) => logs.push(l), now: NOW })).resolves.toBeUndefined();

    expect(notify).toHaveBeenCalledTimes(2);
    expect(logs).toContain(`[anna] desktop notification failed for reminder ${first.id}: powershell is missing`);
    expect(logs.filter((l) => l.includes("notification failed"))).toHaveLength(1);
    expect((await current.reminders.get(first.id))?.status).toBe("fired");
    expect((await current.reminders.get(second.id))?.status).toBe("fired");
  });
});
