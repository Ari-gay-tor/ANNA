import { afterEach, describe, expect, it } from "vitest";
import { fireDueReminders } from "../src/core/runtime/fire-due-reminders";
import { createGuardedTick } from "../src/server/reminder-poller";
import { FIXED_NOW, testAnna } from "./helpers";

let current: ReturnType<typeof testAnna> | undefined;
function setup() {
  current = testAnna();
  return current;
}
afterEach(async () => {
  await current?.db.$disconnect();
  current = undefined;
});

const NOW = FIXED_NOW;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ahead = (ms: number) => new Date(NOW.getTime() + ms);

const make = (t: ReturnType<typeof testAnna>, dueAt: Date, text = "x") =>
  t.reminders.create({ text, dueAt, timezone: "UTC", sourceConversationId: null, sourceMessageId: null });

describe("fireDueReminders", () => {
  it("two concurrent calls fire a reminder exactly once", async () => {
    const t = setup();
    const r = await make(t, ago(10 * SECOND));

    const [a, b] = await Promise.all([
      fireDueReminders({ reminders: t.reminders, now: NOW }),
      fireDueReminders({ reminders: t.reminders, now: NOW }),
    ]);
    expect([...a, ...b]).toEqual([r.id]);

    const row = await t.reminders.get(r.id);
    expect(row).toMatchObject({ status: "fired", firedAt: NOW, missed: false, acknowledgedAt: null });
  });

  it("many overlapping ticks still fire each reminder once", async () => {
    const t = setup();
    const ids = [(await make(t, ago(SECOND))).id, (await make(t, ago(2 * SECOND))).id, (await make(t, ago(3 * SECOND))).id];
    const results = await Promise.all(Array.from({ length: 6 }, () => fireDueReminders({ reminders: t.reminders, now: NOW })));
    expect(results.flat().sort()).toEqual([...ids].sort());
  });

  it("a second call after the first fires nothing", async () => {
    const t = setup();
    await make(t, ago(SECOND));
    expect(await fireDueReminders({ reminders: t.reminders, now: NOW })).toHaveLength(1);
    expect(await fireDueReminders({ reminders: t.reminders, now: new Date(NOW.getTime() + MINUTE) })).toEqual([]);
  });

  it("a cancelled reminder never fires", async () => {
    const t = setup();
    const r = await make(t, ago(MINUTE));
    expect(await t.reminders.cancel(r.id)).toBe(true);
    expect(await fireDueReminders({ reminders: t.reminders, now: NOW })).toEqual([]);
    expect((await t.reminders.get(r.id))?.status).toBe("cancelled");
    expect((await t.reminders.get(r.id))?.firedAt).toBeNull();
  });

  it("a reminder overdue by 10 minutes fires with missed=true", async () => {
    const t = setup();
    const r = await make(t, ago(10 * MINUTE));
    expect(await fireDueReminders({ reminders: t.reminders, now: NOW })).toEqual([r.id]);
    expect(await t.reminders.get(r.id)).toMatchObject({ status: "fired", missed: true, firedAt: NOW });
  });

  it("a reminder overdue by 30 seconds fires with missed=false", async () => {
    const t = setup();
    const r = await make(t, ago(30 * SECOND));
    await fireDueReminders({ reminders: t.reminders, now: NOW });
    expect(await t.reminders.get(r.id)).toMatchObject({ status: "fired", missed: false });
  });

  it("missed means more than 2 minutes late: exactly 2 minutes is not missed, 2 minutes 1 ms is", async () => {
    const t = setup();
    const exact = await make(t, ago(2 * MINUTE));
    const over = await make(t, ago(2 * MINUTE + 1));
    await fireDueReminders({ reminders: t.reminders, now: NOW });
    expect((await t.reminders.get(exact.id))?.missed).toBe(false);
    expect((await t.reminders.get(over.id))?.missed).toBe(true);
  });

  it("a reminder due exactly now fires", async () => {
    const t = setup();
    const r = await make(t, NOW);
    expect(await fireDueReminders({ reminders: t.reminders, now: NOW })).toEqual([r.id]);
  });

  it("a future reminder is untouched", async () => {
    const t = setup();
    const r = await make(t, ahead(MINUTE));
    expect(await fireDueReminders({ reminders: t.reminders, now: NOW })).toEqual([]);
    expect(await t.reminders.get(r.id)).toMatchObject({ status: "pending", firedAt: null, missed: false });
  });

  it("fires the due ones and leaves the future ones in the same pass", async () => {
    const t = setup();
    const due = await make(t, ago(5 * SECOND));
    const future = await make(t, ahead(5 * SECOND));
    expect(await fireDueReminders({ reminders: t.reminders, now: NOW })).toEqual([due.id]);
    expect((await t.reminders.get(future.id))?.status).toBe("pending");
  });

  it("an already-fired reminder keeps its original firedAt and missed", async () => {
    const t = setup();
    const r = await make(t, ago(10 * MINUTE));
    await fireDueReminders({ reminders: t.reminders, now: ago(9 * MINUTE) }); // fired 1 minute late: missed=false
    await fireDueReminders({ reminders: t.reminders, now: NOW });
    expect(await t.reminders.get(r.id)).toMatchObject({ missed: false, firedAt: ago(9 * MINUTE) });
  });
});

describe("ReminderRepository", () => {
  it("cancel on a fired reminder returns false and changes nothing", async () => {
    const t = setup();
    const r = await make(t, ago(SECOND));
    await t.reminders.markFired(r.id, NOW, false);
    expect(await t.reminders.cancel(r.id)).toBe(false);
    expect((await t.reminders.get(r.id))?.status).toBe("fired");
  });

  it("cancel on a pending reminder returns true once, then false; unknown id is false", async () => {
    const t = setup();
    const r = await make(t, ahead(MINUTE));
    expect(await t.reminders.cancel(r.id)).toBe(true);
    expect(await t.reminders.cancel(r.id)).toBe(false);
    expect(await t.reminders.cancel("nope")).toBe(false);
  });

  it("markFired on a cancelled or already fired reminder returns false", async () => {
    const t = setup();
    const c = await make(t, ago(SECOND));
    await t.reminders.cancel(c.id);
    expect(await t.reminders.markFired(c.id, NOW, false)).toBe(false);

    const f = await make(t, ago(SECOND));
    expect(await t.reminders.markFired(f.id, NOW, false)).toBe(true);
    expect(await t.reminders.markFired(f.id, NOW, true)).toBe(false);
    expect((await t.reminders.get(f.id))?.missed).toBe(false);
  });

  it("acknowledge only changes a fired, unacknowledged reminder", async () => {
    const t = setup();
    const r = await make(t, ago(SECOND));
    expect(await t.reminders.acknowledge(r.id, NOW)).toBe(false); // still pending
    await t.reminders.markFired(r.id, NOW, false);
    expect(await t.reminders.acknowledge(r.id, NOW)).toBe(true);
    expect(await t.reminders.acknowledge(r.id, ahead(MINUTE))).toBe(false);
    expect((await t.reminders.get(r.id))?.acknowledgedAt).toEqual(NOW);
  });

  it("listPending is ordered by dueAt ascending and holds only pending reminders", async () => {
    const t = setup();
    const b = await make(t, ahead(2 * MINUTE));
    const a = await make(t, ahead(MINUTE));
    const gone = await make(t, ahead(3 * MINUTE));
    await t.reminders.cancel(gone.id);
    expect((await t.reminders.listPending()).map((r) => r.id)).toEqual([a.id, b.id]);
  });

  it("listFiredUnacknowledged returns fired reminders until they are acknowledged", async () => {
    const t = setup();
    const first = await make(t, ago(2 * MINUTE));
    const second = await make(t, ago(MINUTE));
    await make(t, ahead(MINUTE)); // pending: not listed
    await t.reminders.markFired(second.id, ago(30 * SECOND), false);
    await t.reminders.markFired(first.id, ago(60 * SECOND), false);
    expect((await t.reminders.listFiredUnacknowledged()).map((r) => r.id)).toEqual([first.id, second.id]);
    await t.reminders.acknowledge(first.id, NOW);
    expect((await t.reminders.listFiredUnacknowledged()).map((r) => r.id)).toEqual([second.id]);
  });

  it("create stores provenance and starts pending", async () => {
    const t = setup();
    const r = await t.reminders.create({
      text: "call Dad",
      dueAt: ahead(MINUTE),
      timezone: "Asia/Kolkata",
      sourceConversationId: "c1",
      sourceMessageId: "m1",
    });
    expect(await t.reminders.get(r.id)).toMatchObject({
      status: "pending",
      timezone: "Asia/Kolkata",
      sourceConversationId: "c1",
      sourceMessageId: "m1",
      missed: false,
    });
    expect(await t.reminders.get("nope")).toBeNull();
  });
});

describe("createGuardedTick", () => {
  it("skips a tick while the previous one is still running", async () => {
    let started = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const tick = createGuardedTick(
      async () => {
        started++;
        await gate;
      },
      () => {},
    );

    const first = tick();
    await tick(); // skipped
    await tick(); // skipped
    expect(started).toBe(1);
    release();
    await first;
    await tick();
    expect(started).toBe(2);
  });

  it("logs an error and keeps going instead of throwing", async () => {
    const logs: string[] = [];
    let calls = 0;
    const tick = createGuardedTick(
      async () => {
        calls++;
        if (calls === 1) throw new Error("db is locked");
      },
      (line) => logs.push(line),
    );

    await expect(tick()).resolves.toBeUndefined();
    expect(logs).toEqual(["[anna] reminder poller error: db is locked"]);
    await tick(); // the in-flight flag was released after the failure
    expect(calls).toBe(2);
  });
});
