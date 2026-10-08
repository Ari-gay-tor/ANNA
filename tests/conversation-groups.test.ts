import { describe, expect, it } from "vitest";
import { groupConversations } from "../src/components/conversation-groups";
import { greetingFor } from "../src/components/greeting";

// Local-time constructors on purpose: the grouping is by the viewer's local calendar day, so these hold in any timezone.
const NOW = new Date(2026, 9, 8, 15, 30); // Thu 8 Oct 2026, 3:30 pm local
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const chat = (id: string, updatedAt: string) => ({ id, updatedAt });

function labelsOf(chats: ReturnType<typeof chat>[], now = NOW) {
  return groupConversations(chats, now).map((g) => [g.label, g.items.map((c) => c.id)]);
}

describe("groupConversations", () => {
  it("puts each conversation in Today, Yesterday, Previous 7 days or Older by its local day", () => {
    const chats = [
      chat("today-morning", at(2026, 10, 8, 0, 5)),
      chat("yesterday-evening", at(2026, 10, 7, 23, 59)),
      chat("two-days", at(2026, 10, 6, 9)),
      chat("seven-days", at(2026, 10, 1, 0, 0)),
      chat("eight-days", at(2026, 9, 30, 23, 59)),
      chat("old", at(2026, 7, 1)),
    ];
    expect(labelsOf(chats)).toEqual([
      ["Today", ["today-morning"]],
      ["Yesterday", ["yesterday-evening"]],
      ["Previous 7 days", ["two-days", "seven-days"]],
      ["Older", ["eight-days", "old"]],
    ]);
  });

  it("splits on local midnight, to the minute", () => {
    expect(labelsOf([chat("a", at(2026, 10, 8, 0, 0)), chat("b", at(2026, 10, 7, 23, 59))])).toEqual([
      ["Today", ["a"]],
      ["Yesterday", ["b"]],
    ]);
  });

  it("leaves out empty groups and keeps the input order inside a group", () => {
    const chats = [chat("newer", at(2026, 10, 8, 14)), chat("older", at(2026, 10, 8, 9))];
    expect(labelsOf(chats)).toEqual([["Today", ["newer", "older"]]]);
    expect(groupConversations([], NOW)).toEqual([]);
  });

  it("counts a date in the future (clock skew) as Today", () => {
    expect(labelsOf([chat("future", at(2026, 10, 9, 8))])).toEqual([["Today", ["future"]]]);
  });

  it("crosses month and year boundaries by calendar day", () => {
    const newYear = new Date(2027, 0, 1, 10, 0);
    expect(
      labelsOf([chat("a", at(2026, 12, 31, 20)), chat("b", at(2026, 12, 25, 12)), chat("c", at(2026, 12, 24, 12))], newYear),
    ).toEqual([
      ["Yesterday", ["a"]],
      ["Previous 7 days", ["b"]],
      ["Older", ["c"]],
    ]);
  });

  it("accepts Date objects as well as ISO strings", () => {
    expect(groupConversations([{ updatedAt: new Date(2026, 9, 8, 1) }], NOW)[0]?.label).toBe("Today");
  });
});

describe("greetingFor", () => {
  const hour = (h: number) => greetingFor(new Date(2026, 9, 8, h, 0));
  it("follows the local clock", () => {
    expect([hour(0), hour(5), hour(11)]).toEqual(["Good morning", "Good morning", "Good morning"]);
    expect([hour(12), hour(17)]).toEqual(["Good afternoon", "Good afternoon"]);
    expect([hour(18), hour(23)]).toEqual(["Good evening", "Good evening"]);
  });
});
