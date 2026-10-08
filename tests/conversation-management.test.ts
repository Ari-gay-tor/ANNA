import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as listMemories } from "../src/app/api/memories/route";
import { DELETE, PATCH } from "../src/app/api/conversations/[id]/route";
import type { Services } from "../src/server/anna";
import { testAnna } from "./helpers";

type Harness = ReturnType<typeof testAnna>;
const globalForServices = globalThis as unknown as { __annaServices?: Services };

let t: Harness;
beforeEach(() => {
  t = testAnna();
  // The routes read the process-wide services; point them at this test's temp database.
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

async function seedConversation(title = "A chat") {
  const conversation = await t.conversations.create({ title });
  await t.conversations.appendMessage({ conversationId: conversation.id, role: "user", content: "hello" });
  await t.conversations.appendMessage({ conversationId: conversation.id, role: "assistant", content: "hi there" });
  return conversation;
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown) =>
  PATCH(
    new Request(`http://localhost/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    context(id),
  );
const del = (id: string) => DELETE(new Request(`http://localhost/api/conversations/${id}`, { method: "DELETE" }), context(id));

describe("PrismaConversationRepository.rename", () => {
  it("changes the title, keeps the messages and does not move the conversation in the list", async () => {
    const older = await seedConversation("Older");
    await new Promise((r) => setTimeout(r, 15));
    const newer = await seedConversation("Newer");

    const renamed = await t.conversations.rename(older.id, "Renamed");
    expect(renamed?.title).toBe("Renamed");
    expect(renamed?.updatedAt.getTime()).toBe(older.updatedAt.getTime()); // @updatedAt would have bumped it
    expect((await t.conversations.get(older.id))?.messages).toHaveLength(2);
    expect((await t.conversations.list()).map((c) => c.id)).toEqual([newer.id, older.id]);
  });

  it("returns null for an unknown id", async () => {
    expect(await t.conversations.rename("nope", "x")).toBeNull();
  });
});

describe("PrismaConversationRepository.delete", () => {
  it("removes the conversation and its messages, and nothing else", async () => {
    const doomed = await seedConversation("Doomed");
    const kept = await seedConversation("Kept");

    expect(await t.conversations.delete(doomed.id)).toBe(true);

    expect(await t.conversations.get(doomed.id)).toBeNull();
    expect(await t.db.message.count({ where: { conversationId: doomed.id } })).toBe(0);
    expect(await t.db.message.count({ where: { conversationId: kept.id } })).toBe(2);
    expect(await t.conversations.delete(doomed.id)).toBe(false); // already gone
  });

  it("leaves the memories and reminders made from it, with their source ids intact", async () => {
    const conversation = await seedConversation();
    const memory = await t.memories.create({
      type: "preference",
      statement: "Likes short answers.",
      confidence: 0.9,
      origin: "stated",
      evidenceQuote: "keep it short",
      sourceConversationId: conversation.id,
      sourceMessageId: null,
    });
    const reminder = await t.reminders.create({
      text: "call Dad",
      dueAt: new Date("2026-10-08T22:00:00Z"),
      timezone: "America/Toronto",
      sourceConversationId: conversation.id,
      sourceMessageId: null,
    });

    await t.conversations.delete(conversation.id);

    expect((await t.memories.get(memory.id))?.sourceConversationId).toBe(conversation.id);
    expect((await t.reminders.get(reminder.id))?.sourceConversationId).toBe(conversation.id);
    expect((await t.reminders.get(reminder.id))?.status).toBe("pending");
  });

  it("existingIds says which conversations are still there", async () => {
    const a = await seedConversation("a");
    const b = await seedConversation("b");
    await t.conversations.delete(b.id);
    expect(await t.conversations.existingIds([a.id, b.id, "never-existed"])).toEqual(new Set([a.id]));
    expect(await t.conversations.existingIds([])).toEqual(new Set());
  });
});

describe("PATCH /api/conversations/[id]", () => {
  it("renames, trimming the title", async () => {
    const c = await seedConversation();
    const response = await patch(c.id, { title: "  Job search  " });
    expect(response.status).toBe(200);
    expect((await response.json()).conversation.title).toBe("Job search");
    expect((await t.conversations.get(c.id))?.title).toBe("Job search");
  });

  it("accepts exactly 60 characters", async () => {
    const c = await seedConversation();
    expect((await patch(c.id, { title: "x".repeat(60) })).status).toBe(200);
  });

  it("answers 400 for an empty or whitespace-only title, and leaves the title alone", async () => {
    const c = await seedConversation("Keep me");
    for (const title of ["", "   "]) {
      const response = await patch(c.id, { title });
      expect(response.status).toBe(400);
      expect((await response.json()).error.kind).toBe("INVALID_REQUEST");
    }
    expect((await t.conversations.get(c.id))?.title).toBe("Keep me");
  });

  it("answers 400 for 61 characters", async () => {
    const c = await seedConversation("Keep me");
    const response = await patch(c.id, { title: "x".repeat(61) });
    expect(response.status).toBe(400);
    expect((await t.conversations.get(c.id))?.title).toBe("Keep me");
  });

  it("answers 400 for a missing title, a non-string title and a body that is not JSON", async () => {
    const c = await seedConversation();
    expect((await patch(c.id, {})).status).toBe(400);
    expect((await patch(c.id, { title: 5 })).status).toBe(400);
    expect((await patch(c.id, "not json")).status).toBe(400);
  });

  it("answers 404 for an unknown conversation", async () => {
    const response = await patch("does-not-exist", { title: "Anything" });
    expect(response.status).toBe(404);
    expect((await response.json()).error.kind).toBe("NOT_FOUND");
  });
});

describe("DELETE /api/conversations/[id]", () => {
  it("deletes the conversation and its messages", async () => {
    const c = await seedConversation();
    const response = await del(c.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(await t.conversations.get(c.id)).toBeNull();
    expect(await t.db.message.count()).toBe(0);
  });

  it("answers 404 for an unknown conversation, and for one that was already deleted", async () => {
    expect((await del("does-not-exist")).status).toBe(404);
    const c = await seedConversation();
    await del(c.id);
    expect((await del(c.id)).status).toBe(404);
  });
});

describe("GET /api/memories: sourceExists", () => {
  it("is true while the source conversation exists and false after it is deleted, with the memory kept", async () => {
    const c = await seedConversation();
    const base = { type: "fact", confidence: 0.9, origin: "stated", evidenceQuote: null, sourceMessageId: null } as const;
    const fromChat = await t.memories.create({ ...base, statement: "From a chat.", sourceConversationId: c.id });
    const fromNowhere = await t.memories.create({ ...base, statement: "No source.", sourceConversationId: null });

    const before = (await (await listMemories()).json()).memories as Array<{ id: string; sourceExists: boolean; sourceConversationId: string | null }>;
    expect(before.find((m) => m.id === fromChat.id)?.sourceExists).toBe(true);
    expect(before.find((m) => m.id === fromNowhere.id)?.sourceExists).toBe(false);

    await del(c.id);

    const after = (await (await listMemories()).json()).memories as typeof before;
    const survivor = after.find((m) => m.id === fromChat.id);
    expect(survivor).toMatchObject({ sourceExists: false, sourceConversationId: c.id });
  });
});
