import { describe, expect, it } from "vitest";
import { normalizeTimeZone } from "../src/core/domain/timezone";

describe("normalizeTimeZone", () => {
  it.each([
    ["America/New_York", "America/New_York"],
    ["america/new_york", "America/New_York"],
    ["Asia/Kolkata", "Asia/Kolkata"],
    ["UTC", "UTC"],
    ["utc", "UTC"],
    ["  Europe/London ", "Europe/London"],
  ])("accepts %j as %j", (input, expected) => {
    expect(normalizeTimeZone(input)).toBe(expected);
  });

  it.each(["", "   ", "Not/AZone", "+05:30", "-08:00", "5", "Mars/Olympus", "EST5EDTX"])("rejects %j", (input) => {
    expect(normalizeTimeZone(input)).toBeNull();
  });
});
