import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getConversation } from "../src/app/api/conversations/[id]/route";
import { DELETE as deleteFeedback } from "../src/app/api/feedback/[id]/route";
import { GET as exportFeedback } from "../src/app/api/feedback/export/route";
import { GET as listFeedback, POST as flag } from "../src/app/api/feedback/route";
import { NOTE_MAX_LENGTH, type FeedbackItem, type FeedbackRepository } from "../src/data/feedback-repository";
import type { Services } from "../src/server/anna";
import { describeOperation, exportFileName, localDate, renderFeedbackExport } from "../src/server/feedback-export";
import { APP_VERSION } from "../src/server/version";
import { testAnna } from "./helpers";

const globalForServices = globalThis as unknown as { __annaServices?: Services };

let t: ReturnType<typeof testAnna>;
beforeEach(() => {
  t = testAnna();
  globalForServices.__annaServices = {
    anna: t.anna,
    conversations: t.conversations,
    settings: t.settings,
    memories: t.memories,
    memoryService: t.memoryService,
    onboarding: t.onboarding,
    reminders: t.reminders,
    reminderService: t.reminderService,
    feedback: t.feedback,
  };
});
afterEach(async () => {
  delete globalForServices.__annaServices;
  await t.db.$disconnect();
});

/** user1, anna1, user2, anna2, user3, anna3 (anna3 carries a memory and a reminder result). */
async function seed(title = "Plan my day") {
  const conversation = await t.conversations.create({ title });
  const add = (role: "user" | "assistant", content: string, operations?: Parameters<typeof t.conversations.appendMessage>[0]["operations"]) =>
    t.conversations.appendMessage({ conversationId: conversation.id, role, content, operations });
  const u1 = await add("user", "I have too much to do");
  const a1 = await add("assistant", "What is the most urgent thing?");
  const u2 = await add("user", "The report, and calling the bank");
  const a2 = await add("assistant", "Start with the report.\nThen the bank.");
  const u3 = await add("user", "remind me at 6 to call the bank");
  const a3 = await add("assistant", "Done, I will remind you.", [
    { kind: "memory.created", memoryId: "m1", type: "preference", statement: "Prefers short answers" },
    { kind: "reminder.created", reminderId: "r1", text: "call the bank", dueAt: "2026-10-08T12:30:00.000Z", timezone: "Asia/Kolkata" },
  ]);
  return { conversation, u1, a1, u2, a2, u3, a3 };
}

const local = { host: "127.0.0.1:3737" };
const post = (body: unknown) =>
  flag(new Request("http://127.0.0.1:3737/api/feedback", { method: "POST", headers: { "content-type": "application/json", ...local }, body: JSON.stringify(body) }));
const del = (id: string) =>
  deleteFeedback(new Request(`http://127.0.0.1:3737/api/feedback/${id}`, { method: "DELETE", headers: local }), { params: Promise.resolve({ id }) });
const exportIt = (headers: Record<string, string> = local) => exportFeedback(new Request("http://127.0.0.1:3737/api/feedback/export", { headers }));

describe("flagging a reply (repository)", () => {
  it("stores the note, the ids, and a snapshot of the reply, the user message before it, and the 2 turns before", async () => {
    const s = await seed();
    const { item, created } = await t.feedback.create({ messageId: s.a3.id, note: "  I needed one clear time, not a list  " });
    expect(created).toBe(true);
    expect(item).toMatchObject({
      messageId: s.a3.id,
      conversationId: s.conversation.id,
      note: "I needed one clear time, not a list",
      replyText: "Done, I will remind you.",
      userText: "remind me at 6 to call the bank",
    });
    expect(item.id).toBeTruthy();
    expect(item.createdAt).toBeInstanceOf(Date);
    expect(item.context).toEqual([
      { role: "assistant", content: "Start with the report.\nThen the bank." },
      { role: "user", content: "remind me at 6 to call the bank" },
    ]);
    expect(item.operations.map((o) => o.kind)).toEqual(["memory.created", "reminder.created"]);
  });

  it("a note is optional, and the first reply has only one turn before it", async () => {
    const s = await seed();
    const { item } = await t.feedback.create({ messageId: s.a1.id, note: "" });
    expect(item.note).toBe("");
    expect(item.userText).toBe("I have too much to do");
    expect(item.context).toEqual([{ role: "user", content: "I have too much to do" }]);
  });

  it("a very long note is cut at the limit", async () => {
    const s = await seed();
    const { item } = await t.feedback.create({ messageId: s.a1.id, note: "x".repeat(NOTE_MAX_LENGTH + 500) });
    expect(item.note).toHaveLength(NOTE_MAX_LENGTH);
  });

  it("flagging the same reply twice keeps one row and the first snapshot; a new note replaces the note", async () => {
    const s = await seed();
    const first = await t.feedback.create({ messageId: s.a2.id, note: "first" });
    const again = await t.feedback.create({ messageId: s.a2.id, note: "better note" });
    const blank = await t.feedback.create({ messageId: s.a2.id, note: "" });
    expect([first.created, again.created, blank.created]).toEqual([true, false, false]);
    expect(blank.item.id).toBe(first.item.id);
    expect(blank.item.note).toBe("better note");
    expect(await t.feedback.list()).toHaveLength(1);
  });

  it("only ANNA's replies can be flagged, and the message must exist", async () => {
    const s = await seed();
    await expect(t.feedback.create({ messageId: s.u1.id, note: "" })).rejects.toMatchObject({ kind: "INVALID_INPUT" });
    await expect(t.feedback.create({ messageId: "nope", note: "" })).rejects.toMatchObject({ kind: "NOT_FOUND" });
  });

  it("lists newest first, deletes, and says which messages are flagged", async () => {
    const s = await seed();
    const one = await t.feedback.create({ messageId: s.a1.id, note: "one" });
    await new Promise((r) => setTimeout(r, 5));
    const two = await t.feedback.create({ messageId: s.a3.id, note: "two" });
    expect((await t.feedback.list()).map((i) => i.note)).toEqual(["two", "one"]);
    expect(await t.feedback.flaggedMessageIds([s.a1.id, s.a2.id, s.a3.id])).toEqual(new Set([s.a1.id, s.a3.id]));
    expect(await t.feedback.flaggedMessageIds([])).toEqual(new Set());

    expect(await t.feedback.delete(one.item.id)).toBe(true);
    expect(await t.feedback.delete(one.item.id)).toBe(false);
    expect((await t.feedback.list()).map((i) => i.id)).toEqual([two.item.id]);
  });
});

describe("the feedback routes", () => {
  it("POST creates (201), a repeat is 200, and a bad request is a 400/404", async () => {
    const s = await seed();
    const created = await post({ messageId: s.a2.id, note: "too long" });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body).toMatchObject({ created: true, feedback: { messageId: s.a2.id, note: "too long" } });
    expect((await post({ messageId: s.a2.id })).status).toBe(200);
    expect((await post({ note: "no id" })).status).toBe(400);
    expect((await post({ messageId: s.a2.id, note: "x".repeat(NOTE_MAX_LENGTH + 1) })).status).toBe(400);
    expect((await post({ messageId: "missing" })).status).toBe(404);
    expect((await post({ messageId: s.u1.id })).status).toBe(400);
  });

  it("GET lists the flagged items with their text, the version, and whether the conversation still exists", async () => {
    const s = await seed();
    await post({ messageId: s.a3.id, note: "needed one time" });
    const body = await (await listFeedback()).json();
    expect(body.version).toBe(APP_VERSION);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      messageId: s.a3.id,
      conversationId: s.conversation.id,
      conversationExists: true,
      note: "needed one time",
      replyText: "Done, I will remind you.",
      userText: "remind me at 6 to call the bank",
    });
    expect(typeof body.items[0].createdAt).toBe("string");

    await t.conversations.delete(s.conversation.id);
    const after = await (await listFeedback()).json();
    expect(after.items[0]).toMatchObject({ conversationExists: false, replyText: "Done, I will remind you." });
  });

  it("DELETE removes an item, and a second delete is a 404", async () => {
    const s = await seed();
    const id = (await (await post({ messageId: s.a1.id })).json()).feedback.id as string;
    expect((await del(id)).status).toBe(200);
    expect((await del(id)).status).toBe(404);
    expect((await (await listFeedback()).json()).items).toEqual([]);
  });

  it("GET /api/conversations/[id] marks flagged replies", async () => {
    const s = await seed();
    await post({ messageId: s.a2.id });
    const response = await getConversation(new Request("http://127.0.0.1/x"), { params: Promise.resolve({ id: s.conversation.id }) });
    const { messages } = (await response.json()) as { messages: Array<{ id: string; flagged: boolean }> };
    expect(messages.filter((m) => m.flagged).map((m) => m.id)).toEqual([s.a2.id]);
  });

  it("opening a conversation still works if the feedback table cannot be read (a database that has not been migrated yet)", async () => {
    const s = await seed();
    const unreadable: FeedbackRepository = {
      create: (input) => t.feedback.create(input),
      list: () => t.feedback.list(),
      delete: (id) => t.feedback.delete(id),
      flaggedMessageIds: async () => Promise.reject(new Error("no such table: Feedback")),
    };
    const original = console.error;
    console.error = () => {};
    globalForServices.__annaServices = {
      ...globalForServices.__annaServices!,
      feedback: unreadable,
    };
    try {
      const response = await getConversation(new Request("http://127.0.0.1/x"), { params: Promise.resolve({ id: s.conversation.id }) });
      expect(response.status).toBe(200);
      const { messages } = (await response.json()) as { messages: Array<{ flagged: boolean }> };
      expect(messages).toHaveLength(6);
      expect(messages.every((m) => m.flagged === false)).toBe(true);
    } finally {
      console.error = original;
    }
  });
});

describe("Export for Ari", () => {
  it("is a Markdown download named anna-feedback-<date>.md", async () => {
    const s = await seed();
    await post({ messageId: s.a3.id });
    const response = await exportIt();
    expect(response.headers.get("content-type")).toMatch(/^text\/markdown/);
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="anna-feedback-${localDate(new Date())}.md"`);
  });

  it("holds the flagged reply, the 2 turns before it, its operations, the note and the app version", async () => {
    const s = await seed();
    await post({ messageId: s.a3.id, note: "I needed ONE time, not a list" });
    const text = await (await exportIt()).text();

    expect(text).toContain(`App version: ${APP_VERSION}`);
    expect(text).toContain("Flagged items: 1");
    expect(text).toContain("What user asked: remind me at 6 to call the bank");
    expect(text).toContain("What ANNA did: Done, I will remind you.");
    expect(text).toContain('  - Saved to memory (preference): "Prefers short answers"');
    expect(text).toContain('  - Set a reminder: "call the bank" at 2026-10-08T12:30:00.000Z (Asia/Kolkata)');
    expect(text).toContain("What user actually needed: I needed ONE time, not a list");
    expect(text).toContain("Failure category:\nDesired behavior:");
    // The 2 turns before, with the multi-line reply indented so it cannot look like structure.
    expect(text).toContain("  ANNA: Start with the report.\n  Then the bank.");
    expect(text).toContain("  You: remind me at 6 to call the bank");
    // Not earlier turns.
    expect(text).not.toContain("The report, and calling the bank");
    expect(text).not.toContain("I have too much to do");
  });

  it("includes only flagged items: no other conversation, no memory, no unflagged reply", async () => {
    const s = await seed();
    const other = await seed("Something private");
    await t.conversations.appendMessage({ conversationId: other.conversation.id, role: "user", content: "UNRELATED-PRIVATE-MESSAGE" });
    await t.memoryService.list(); // memories exist but must never be read by the export
    await t.memories.create({
      type: "fact",
      statement: "SECRET-MEMORY-STATEMENT",
      confidence: 0.9,
      origin: "stated",
      evidenceQuote: null,
      sourceConversationId: null,
      sourceMessageId: null,
    });
    await post({ messageId: s.a1.id, note: "n" });

    const text = await (await exportIt()).text();
    expect(text).toContain("What ANNA did: What is the most urgent thing?");
    expect(text).not.toContain("UNRELATED-PRIVATE-MESSAGE");
    expect(text).not.toContain("SECRET-MEMORY-STATEMENT");
    expect(text).not.toContain("Start with the report"); // an unflagged reply in the same conversation
    expect(text).not.toContain("Something private");
  });

  it("still exports a flagged item after its conversation was deleted, with the text captured when it was flagged", async () => {
    const s = await seed();
    await post({ messageId: s.a3.id, note: "kept" });
    expect(await t.conversations.delete(s.conversation.id)).toBe(true);
    const text = await (await exportIt()).text();
    expect(text).toContain("What user asked: remind me at 6 to call the bank");
    expect(text).toContain("What ANNA did: Done, I will remind you.");
    expect(text).toContain("What user actually needed: kept");
    expect(text).toContain("  ANNA: Start with the report.\n  Then the bank.");
    expect(text).toContain('Saved to memory (preference): "Prefers short answers"');
  });

  it("nothing flagged: a short file that says so", async () => {
    const text = await (await exportIt()).text();
    expect(text).toContain("Flagged items: 0");
    expect(text).toContain("Nothing was flagged.");
  });

  it("answers only requests for this PC", async () => {
    expect((await exportIt({ host: "anna.example.com" })).status).toBe(403);
    expect((await exportIt({ ...local, origin: "https://evil.example" })).status).toBe(403);
  });

  it("a deleted item is not exported", async () => {
    const s = await seed();
    const id = (await (await post({ messageId: s.a1.id })).json()).feedback.id as string;
    await del(id);
    expect(await (await exportIt()).text()).toContain("Nothing was flagged.");
  });
});

describe("renderFeedbackExport", () => {
  const item: FeedbackItem = {
    id: "f1",
    messageId: "m1",
    conversationId: "c1",
    note: "",
    replyText: "Line one\n\n### Not a heading\nLast",
    userText: "",
    context: [],
    operations: [],
    createdAt: new Date(2026, 9, 8, 14, 5),
  };
  const now = new Date(2026, 9, 9, 9, 30);

  it("leaves what is not known blank, in the failure-modes.md field order", () => {
    const text = renderFeedbackExport([item], { version: "0.2.0", now });
    const order = ["User situation:", "What user asked:", "What ANNA did:", "What user actually needed:", "Failure category:", "Desired behavior:"].map((label) => text.indexOf(label));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("### 2026-10-08: Line one");
    expect(text).toContain("\nWhat user asked:\n");
    expect(text).toContain("\nWhat user actually needed:\n");
    expect(text).toContain("Exported: 2026-10-09 09:30");
    expect(text).toContain("Flagged: 2026-10-08 14:05");
  });

  it("indents the later lines of a multi-line value, so pasted text cannot make a heading or a divider", () => {
    const text = renderFeedbackExport([item], { version: "0.2.0", now });
    expect(text).toContain("What ANNA did: Line one\n\n  ### Not a heading\n  Last");
    expect(text.split("\n").filter((line) => line.startsWith("###"))).toHaveLength(1);
  });

  it("names the file by local date", () => {
    expect(exportFileName(new Date(2026, 0, 5, 23, 59))).toBe("anna-feedback-2026-01-05.md");
  });

  it("describes every kind of operation in one line", () => {
    const lines = [
      describeOperation({ kind: "memory.updated", memoryId: "m", statement: "new", previousStatement: "old" }),
      describeOperation({ kind: "memory.rejected", origin: "inferred", reason: "too vague" }),
      describeOperation({ kind: "memory.skipped_duplicate", statement: "dup" }),
      describeOperation({ kind: "reminder.rejected", reason: "time is in the past" }),
    ];
    expect(lines).toEqual([
      'Updated a memory: "new" (was "old")',
      "Memory not saved: too vague",
      'Memory already saved: "dup"',
      "Reminder not set: time is in the past",
    ]);
    expect(lines.every((line) => !line.includes("\n"))).toBe(true);
  });
});
