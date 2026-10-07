import { describe, expect, it } from "vitest";
import { formatReminderDue, formatTimeOfDay, isSameLocalDay } from "../src/core/time/format-reminder-time";
import {
  REASON_BAD_MINUTES,
  REASON_NO_TIMEZONE,
  REASON_NONEXISTENT_TIME,
  REASON_PASSED,
  REASON_TOO_FAR,
  REASON_UNREADABLE_TIME,
  resolveReminderTime,
} from "../src/core/time/resolve-reminder-time";

const NOW = new Date("2026-10-07T15:42:00Z");

function ok(result: ReturnType<typeof resolveReminderTime>): string {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.dueAt.toISOString();
}

describe("resolveReminderTime: localDateTime", () => {
  it("America/New_York 2026-11-01T01:30 happens twice (fall back); takes the earlier instant", () => {
    // 01:30 EDT = 05:30Z (first); 01:30 EST = 06:30Z (second).
    expect(ok(resolveReminderTime({ localDateTime: "2026-11-01T01:30", timeZone: "America/New_York", now: NOW }))).toBe("2026-11-01T05:30:00.000Z");
  });

  it("times either side of the fall-back hour are unambiguous", () => {
    expect(ok(resolveReminderTime({ localDateTime: "2026-11-01T00:30", timeZone: "America/New_York", now: NOW }))).toBe("2026-11-01T04:30:00.000Z");
    expect(ok(resolveReminderTime({ localDateTime: "2026-11-01T02:30", timeZone: "America/New_York", now: NOW }))).toBe("2026-11-01T07:30:00.000Z");
  });

  it("America/New_York 2027-03-14T02:30 does not exist (spring forward); rejected", () => {
    const result = resolveReminderTime({ localDateTime: "2027-03-14T02:30", timeZone: "America/New_York", now: NOW });
    expect(result).toEqual({ ok: false, reason: "that time doesn't exist in your timezone (the clocks change then)" });
    expect(REASON_NONEXISTENT_TIME).toBe("that time doesn't exist in your timezone (the clocks change then)");
  });

  it("the times just outside the gap are fine", () => {
    expect(ok(resolveReminderTime({ localDateTime: "2027-03-14T01:59", timeZone: "America/New_York", now: NOW }))).toBe("2027-03-14T06:59:00.000Z");
    expect(ok(resolveReminderTime({ localDateTime: "2027-03-14T03:00", timeZone: "America/New_York", now: NOW }))).toBe("2027-03-14T07:00:00.000Z");
  });

  it("Asia/Kolkata 2026-10-08T18:00 is 12:30Z", () => {
    expect(ok(resolveReminderTime({ localDateTime: "2026-10-08T18:00", timeZone: "Asia/Kolkata", now: NOW }))).toBe("2026-10-08T12:30:00.000Z");
  });

  it("UTC", () => {
    expect(ok(resolveReminderTime({ localDateTime: "2026-10-08T18:00", timeZone: "UTC", now: NOW }))).toBe("2026-10-08T18:00:00.000Z");
  });

  it("rejects a time in the past", () => {
    expect(resolveReminderTime({ localDateTime: "2026-10-07T15:00", timeZone: "UTC", now: NOW })).toEqual({ ok: false, reason: REASON_PASSED });
    expect(resolveReminderTime({ localDateTime: "2026-10-06T15:00", timeZone: "UTC", now: NOW })).toEqual({ ok: false, reason: "that time has already passed" });
  });

  it("rejects a time 20 s from now; the cutoff is 30 s", () => {
    const at = (nowIso: string) => resolveReminderTime({ localDateTime: "2026-10-07T15:42", timeZone: "UTC", now: new Date(nowIso) });
    expect(at("2026-10-07T15:41:40Z")).toEqual({ ok: false, reason: REASON_PASSED }); // +20 s
    expect(at("2026-10-07T15:41:30Z")).toEqual({ ok: false, reason: REASON_PASSED }); // exactly +30 s
    expect(at("2026-10-07T15:41:29Z").ok).toBe(true); // +31 s
  });

  it("rejects more than 365 days ahead; exactly 365 days is allowed", () => {
    // 2026-10-07T15:42Z + 365 days = 2027-10-07T15:42Z (2027 is not a leap year).
    expect(ok(resolveReminderTime({ localDateTime: "2027-10-07T15:42", timeZone: "UTC", now: NOW }))).toBe("2027-10-07T15:42:00.000Z");
    expect(resolveReminderTime({ localDateTime: "2027-10-07T15:43", timeZone: "UTC", now: NOW })).toEqual({ ok: false, reason: REASON_TOO_FAR });
    expect(resolveReminderTime({ localDateTime: "2027-10-08T15:42", timeZone: "UTC", now: NOW })).toEqual({ ok: false, reason: "that's more than a year away" }); // 366 days
  });

  it.each(["tomorrow at 6", "2026-10-08 18:00", "2026-10-08T18:00:00", "2026-10-08T18:00Z", "2026-10-08T1800", "2026-10-8T18:00", "2026-02-30T18:00", "2026-10-08T25:00", " 2026-10-08T18:00", "", "6 PM"])(
    "rejects the malformed string %j",
    (text) => {
      expect(resolveReminderTime({ localDateTime: text, timeZone: "UTC", now: NOW })).toEqual({ ok: false, reason: REASON_UNREADABLE_TIME });
    },
  );

  it.each([undefined, "", "Not/AZone", "+05:30", "local"])("rejects a missing or invalid timezone (%j)", (timeZone) => {
    expect(resolveReminderTime({ localDateTime: "2026-10-08T18:00", timeZone, now: NOW })).toEqual({ ok: false, reason: REASON_NO_TIMEZONE });
    expect(REASON_NO_TIMEZONE).toBe("I don't know your timezone yet");
  });
});

describe("resolveReminderTime: inMinutes", () => {
  it("accepts 20 and adds it to now", () => {
    expect(ok(resolveReminderTime({ inMinutes: 20, timeZone: "UTC", now: NOW }))).toBe("2026-10-07T16:02:00.000Z");
  });

  it("accepts the limits 1 and 10080", () => {
    expect(ok(resolveReminderTime({ inMinutes: 1, timeZone: "UTC", now: NOW }))).toBe("2026-10-07T15:43:00.000Z");
    expect(ok(resolveReminderTime({ inMinutes: 10080, timeZone: "UTC", now: NOW }))).toBe("2026-10-14T15:42:00.000Z");
  });

  it.each([0, 10081, -5, 1.5, Number.NaN])("rejects %s", (minutes) => {
    expect(resolveReminderTime({ inMinutes: minutes, timeZone: "UTC", now: NOW })).toEqual({ ok: false, reason: REASON_BAD_MINUTES });
  });

  it("still needs a timezone", () => {
    expect(resolveReminderTime({ inMinutes: 20, timeZone: undefined, now: NOW })).toEqual({ ok: false, reason: REASON_NO_TIMEZONE });
  });

  it("with neither field there is nothing to resolve", () => {
    expect(resolveReminderTime({ timeZone: "UTC", now: NOW }).ok).toBe(false);
  });
});

describe("formatReminderDue", () => {
  // 2026-10-07T15:42Z is 11:42 on Wednesday in New York.
  const ny = "America/New_York";
  it("says Today, Tomorrow, or weekday + date, in the reminder's own timezone", () => {
    expect(formatReminderDue(new Date("2026-10-07T22:00:00Z"), ny, NOW)).toBe("Today 6:00 PM");
    expect(formatReminderDue(new Date("2026-10-08T22:00:00Z"), ny, NOW)).toBe("Tomorrow 6:00 PM");
    expect(formatReminderDue(new Date("2026-10-09T22:00:00Z"), ny, NOW)).toBe("Fri Oct 9, 6:00 PM");
    expect(formatReminderDue(new Date("2027-01-02T22:00:00Z"), ny, NOW)).toBe("Sat Jan 2 2027, 5:00 PM");
  });

  it("uses the zone's day, not UTC's: 01:00Z tomorrow is still today evening in New York", () => {
    expect(formatReminderDue(new Date("2026-10-08T01:00:00Z"), ny, NOW)).toBe("Today 9:00 PM");
  });

  it("formats in a zone whose offset has a half hour", () => {
    expect(formatReminderDue(new Date("2026-10-08T12:30:00Z"), "Asia/Kolkata", NOW)).toBe("Tomorrow 6:00 PM");
  });

  it("time of day uses a plain space before AM/PM", () => {
    expect(formatTimeOfDay(new Date("2026-10-07T22:05:00Z"), ny)).toBe("6:05 PM");
  });

  it("isSameLocalDay compares days in the zone", () => {
    expect(isSameLocalDay(new Date("2026-10-08T01:00:00Z"), NOW, ny)).toBe(true);
    expect(isSameLocalDay(new Date("2026-10-08T01:00:00Z"), NOW, "UTC")).toBe(false);
  });
});
