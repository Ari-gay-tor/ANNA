import { afterEach, describe, expect, it } from "vitest";
import { AnnaError } from "../src/core/domain/errors";
import { annotateOperations } from "../src/core/runtime/annotate-operations";
import { executeMemoryDecisions } from "../src/core/runtime/memory-execution";
import { REASON_NOT_SAID, REASON_PATTERN, REASON_TOO_MANY } from "../src/core/runtime/memory-validation";
import { ANNA_RESPONSE_JSON_SCHEMA } from "../src/core/domain/anna-response";
import { reply, replyWithOps, testAnna } from "./helpers";

let current: ReturnType<typeof testAnna> | undefined;
function setup() {
  current = testAnna();
  return current;
}
afterEach(async () => {
  await current?.db.$disconnect();
  current = undefined;
});

const createOp = (overrides: Record<string, unknown> = {}) => ({
  op: "create",
  type: "preference",
  statement: "Dislikes being given giant plans.",
  evidenceQuote: "I hate being given giant plans",
  origin: "stated",
  ...overrides,
});

async function savedMessages(t: ReturnType<typeof testAnna>, conversationId: string) {
  return (await t.conversations.get(conversationId))!.messages;
}

describe("memory.create", () => {
  it("persists with provenance: conversation id, the user message's id, and the quote", async () => {
    const t = setup();
    t.provider.enqueue(replyWithOps("Got it.", [createOp({ confidence: 0.1 })]));
    const result = await t.anna.handleMessage({ text: "Remember that I hate being given giant plans." });

    const rows = await t.memories.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "preference",
      statement: "Dislikes being given giant plans.",
      origin: "stated",
      confidence: 0.9, // the model's 0.1 is ignored for stated
      evidenceQuote: "I hate being given giant plans",
      sourceConversationId: result.conversationId,
      sourceMessageId: result.userMessage.id,
    });

    expect(result.assistantMessage.content).toBe("Got it.");
    expect(result.assistantMessage.operations).toEqual([
      { kind: "memory.created", memoryId: rows[0]!.id, type: "preference", statement: "Dislikes being given giant plans." },
    ]);
    // Stored on the message, so a reload shows the same chips.
    const stored = (await savedMessages(t, result.conversationId)).at(-1)!;
    expect(stored.operations).toEqual(result.assistantMessage.operations);
    expect((await savedMessages(t, result.conversationId))[0]!.operations).toEqual([]);
  });

  it("stores an inferred memory with capped confidence", async () => {
    const t = setup();
    t.provider.enqueue(
      replyWithOps("Okay.", [
        createOp({ type: "fact", origin: "inferred", statement: "Is a student.", evidenceQuote: "my exam tomorrow", confidence: 0.95 }),
      ]),
    );
    await t.anna.handleMessage({ text: "I need to study for my exam tomorrow" });
    expect(await t.memories.list()).toMatchObject([{ origin: "inferred", confidence: 0.6 }]);
  });

  it("a turn with no operations stores no operations JSON", async () => {
    const t = setup();
    t.provider.enqueue(reply("Hello."));
    await t.anna.handleMessage({ text: "hi there" });
    const row = await t.db.message.findFirst({ where: { role: "assistant" } });
    expect(row?.operations).toBeNull();
    expect(await t.db.memory.count()).toBe(0);
  });
});

describe("rejections", () => {
  it("rejects an op whose quote comes from the assistant's previous message, not the user's", async () => {
    const t = setup();
    t.provider.enqueue(reply("Your project deadline is Friday the ninth."));
    const first = await t.anna.handleMessage({ text: "hello" });

    t.provider.enqueue(
      replyWithOps("Noted.", [
        createOp({ type: "fact", statement: "Deadline is 2026-10-09.", evidenceQuote: "project deadline is Friday the ninth" }),
      ]),
    );
    const second = await t.anna.handleMessage({ conversationId: first.conversationId, text: "ok, thanks" });

    expect(await t.db.memory.count()).toBe(0);
    expect(second.assistantMessage.operations).toEqual([
      { kind: "memory.rejected", origin: "stated", reason: REASON_NOT_SAID },
    ]);
  });

  it("a stated rejection appends exactly one line to the reply; an inferred rejection appends nothing", async () => {
    const t = setup();
    t.provider.enqueue(replyWithOps("Okay.", [createOp({ origin: "stated", evidenceQuote: "something the user never typed" })]));
    const stated = await t.anna.handleMessage({ text: "Remember that I hate being given giant plans." });
    expect(stated.assistantMessage.content).toBe(`Okay.\n(I didn't save that: ${REASON_NOT_SAID}.)`);

    t.provider.enqueue(
      replyWithOps("Sure.", [createOp({ type: "fact", origin: "inferred", evidenceQuote: "something the user never typed" })]),
    );
    const inferred = await t.anna.handleMessage({ text: "Remember that I hate being given giant plans." });
    expect(inferred.assistantMessage.content).toBe("Sure.");
    expect(inferred.assistantMessage.operations).toEqual([
      { kind: "memory.rejected", origin: "inferred", reason: REASON_NOT_SAID },
    ]);
    expect(await t.db.memory.count()).toBe(0);
  });

  it("logs a rejection as one line with reason and type, never the statement or quote", async () => {
    const t = setup();
    t.provider.enqueue(
      replyWithOps("Sure.", [
        createOp({
          type: "pattern",
          origin: "inferred",
          statement: "SECRET-STATEMENT-TEXT",
          evidenceQuote: "I hate being given giant plans",
        }),
      ]),
    );
    await t.anna.handleMessage({ text: "I hate being given giant plans" });
    const lines = t.logs.filter((l) => l.includes("memory op rejected"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("type=pattern");
    expect(lines[0]).toContain(REASON_PATTERN);
    expect(t.logs.join("\n")).not.toContain("SECRET-STATEMENT-TEXT");
    expect(t.logs.join("\n")).not.toContain("giant plans");
  });

  it("rejects the 4th op and keeps the first three", async () => {
    const t = setup();
    const ops = [1, 2, 3, 4].map((n) => createOp({ statement: `Dislikes giant plans, take ${n}.` }));
    t.provider.enqueue(replyWithOps("Done.", ops));
    const result = await t.anna.handleMessage({ text: "Remember that I hate being given giant plans." });

    expect(await t.db.memory.count()).toBe(3);
    expect(result.assistantMessage.content).toBe(`Done.\n(I didn't save that: ${REASON_TOO_MANY}.)`);
    expect(result.assistantMessage.operations.map((o) => o.kind)).toEqual([
      "memory.created",
      "memory.created",
      "memory.created",
      "memory.rejected",
    ]);
  });

  it("skips an exact duplicate: no new row, a skipped_duplicate result, no appended line", async () => {
    const t = setup();
    t.provider.enqueue(replyWithOps("Got it.", [createOp()]), replyWithOps("Got it again.", [createOp()]));
    await t.anna.handleMessage({ text: "Remember that I hate being given giant plans." });
    const again = await t.anna.handleMessage({ text: "Remember that I hate being given giant plans." });

    expect(await t.db.memory.count()).toBe(1);
    expect(again.assistantMessage.content).toBe("Got it again.");
    expect(again.assistantMessage.operations).toEqual([
      { kind: "memory.skipped_duplicate", statement: "Dislikes being given giant plans." },
    ]);
  });
});

describe("memory.update", () => {
  it("changes the statement, records previousStatement, and sets stated / 0.9 with the new provenance", async () => {
    const t = setup();
    const old = await t.memories.create({
      type: "preference",
      statement: "Prefers short answers.",
      confidence: 0.6,
      origin: "inferred",
      evidenceQuote: "old quote",
      sourceConversationId: "old-conversation",
      sourceMessageId: "old-message",
    });
    t.provider.enqueue(
      replyWithOps("Updated.", [
        {
          op: "update",
          memoryId: old.id,
          statement: "Prefers long explanations when learning something new.",
          evidenceQuote: "I actually prefer long explanations when I'm learning something new",
        },
      ]),
    );
    const result = await t.anna.handleMessage({
      text: "You got that wrong. I actually prefer long explanations when I'm learning something new.",
    });

    // The memory was in this turn's prompt, with its id.
    expect(t.provider.calls[0]!.system).toContain(`[${old.id}]`);

    expect(await t.db.memory.count()).toBe(1);
    expect(await t.memories.get(old.id)).toMatchObject({
      statement: "Prefers long explanations when learning something new.",
      origin: "stated",
      confidence: 0.9,
      type: "preference",
      evidenceQuote: "I actually prefer long explanations when I'm learning something new",
      sourceConversationId: result.conversationId,
      sourceMessageId: result.userMessage.id,
    });
    expect(result.assistantMessage.operations).toEqual([
      {
        kind: "memory.updated",
        memoryId: old.id,
        statement: "Prefers long explanations when learning something new.",
        previousStatement: "Prefers short answers.",
      },
    ]);
  });

  it("rejects an update of a memory that was not in the prompt (hallucinated id) and leaves the database alone", async () => {
    const t = setup();
    t.provider.enqueue(
      replyWithOps("Fixed.", [
        { op: "update", memoryId: "made-up-id", statement: "Whatever.", evidenceQuote: "I actually prefer long explanations" },
      ]),
    );
    const result = await t.anna.handleMessage({ text: "I actually prefer long explanations." });
    expect(await t.db.memory.count()).toBe(0);
    expect(result.assistantMessage.content).toContain("(I didn't save that:");
  });

  it("an update op that finds its memory gone at execution time is rejected as stated", async () => {
    const t = setup();
    const outcome = await executeMemoryDecisions({
      decisions: [
        {
          status: "accepted",
          op: { op: "update", memoryId: "gone", statement: "New.", evidenceQuote: "some real quote" },
          statement: "New.",
          evidenceQuote: "some real quote",
          origin: "stated",
          confidence: 0.9,
        },
      ],
      memories: t.memories,
      source: { conversationId: "c", messageId: "m" },
      log: () => {},
    });
    expect(outcome.results).toEqual([{ kind: "memory.rejected", origin: "stated", reason: "that memory no longer exists" }]);
    expect(outcome.notices).toEqual(["(I didn't save that: that memory no longer exists.)"]);
  });
});

describe("malformed model output", () => {
  it("drops a malformed op but saves the reply, and still runs the valid ops next to it", async () => {
    const t = setup();
    t.provider.enqueue(
      replyWithOps("Here you go.", [
        { op: "create", type: "not-a-type", statement: "x", evidenceQuote: "y", origin: "stated" },
        { op: "delete", memoryId: "abc" },
        "not even an object",
        createOp({ statement: "Valid one." }),
      ]),
    );
    const result = await t.anna.handleMessage({ text: "Remember that I hate being given giant plans." });

    expect(t.provider.calls).toHaveLength(1); // no retry: the message was fine
    expect(result.assistantMessage.content).toBe("Here you go.");
    expect(await t.memories.list()).toMatchObject([{ statement: "Valid one." }]);
    expect(result.assistantMessage.operations.map((o) => o.kind)).toEqual(["memory.created"]);
    expect(t.logs).toContain("[anna] dropped 3 malformed memory op(s)");
  });

  it("memoryOperations that is not an array is dropped; the reply survives", async () => {
    const t = setup();
    t.provider.enqueue(JSON.stringify({ message: "Fine.", memoryOperations: "save everything" }));
    const result = await t.anna.handleMessage({ text: "hello" });
    expect(result.assistantMessage.content).toBe("Fine.");
    expect(await t.db.memory.count()).toBe(0);
  });

  it("memoryOperations: null is treated as none", async () => {
    const t = setup();
    t.provider.enqueue(JSON.stringify({ message: "Fine.", memoryOperations: null }));
    const result = await t.anna.handleMessage({ text: "hello" });
    expect(result.assistantMessage.content).toBe("Fine.");
    expect(t.logs.filter((l) => l.includes("dropped"))).toEqual([]);
  });

  it("the model cannot delete: a delete op is just dropped", async () => {
    const t = setup();
    const saved = await t.memories.create({
      type: "fact",
      statement: "Keep me.",
      confidence: 0.9,
      origin: "stated",
      evidenceQuote: null,
      sourceConversationId: null,
      sourceMessageId: null,
    });
    t.provider.enqueue(replyWithOps("Forgot it.", [{ op: "delete", memoryId: saved.id }]));
    await t.anna.handleMessage({ text: "forget that please" });
    expect(await t.memories.get(saved.id)).not.toBeNull();
  });
});

describe("JSON schema sent to the provider", () => {
  it("describes memoryOperations as an optional array of create/update ops and uses only keywords Gemini documents", async () => {
    const t = setup();
    await t.anna.handleMessage({ text: "hi" });
    const schema = t.provider.calls[0]!.jsonSchema as Record<string, any>;
    expect(schema).toBe(ANNA_RESPONSE_JSON_SCHEMA);
    expect(schema.required).toEqual(["message"]);
    const variants = schema.properties.memoryOperations.items.oneOf as Array<Record<string, any>>;
    expect(variants.map((v) => v.properties.op.enum)).toEqual([["create"], ["update"]]);
    expect(JSON.stringify(schema)).not.toContain('"const"');
    expect(JSON.stringify(schema)).not.toContain("$schema");
  });
});

describe("MemoryService (Memory page edits)", () => {
  it("edit sets origin edited and confidence 1.0, trims, and keeps provenance", async () => {
    const t = setup();
    const saved = await t.memories.create({
      type: "goal",
      statement: "Ship ANNA.",
      confidence: 0.9,
      origin: "stated",
      evidenceQuote: "I want to ship ANNA",
      sourceConversationId: "conv-1",
      sourceMessageId: "msg-1",
    });
    const edited = await t.memoryService.edit(saved.id, "  Ship ANNA V0 by 2026-11-01.  ");
    expect(edited).toMatchObject({
      statement: "Ship ANNA V0 by 2026-11-01.",
      origin: "edited",
      confidence: 1,
      type: "goal",
      evidenceQuote: "I want to ship ANNA",
      sourceConversationId: "conv-1",
      sourceMessageId: "msg-1",
    });
  });

  it("rejects empty and over-long edits, and unknown ids", async () => {
    const t = setup();
    const saved = await t.memories.create({
      type: "fact",
      statement: "A fact.",
      confidence: 0.9,
      origin: "stated",
      evidenceQuote: null,
      sourceConversationId: null,
      sourceMessageId: null,
    });
    await expect(t.memoryService.edit(saved.id, "   ")).rejects.toMatchObject({ kind: "INVALID_INPUT" });
    await expect(t.memoryService.edit(saved.id, "x".repeat(301))).rejects.toMatchObject({ kind: "INVALID_INPUT" });
    await expect(t.memoryService.edit("nope", "text")).rejects.toMatchObject({ kind: "NOT_FOUND" });
    expect((await t.memories.get(saved.id))!.statement).toBe("A fact.");
  });

  it("remove deletes, and deleting again is NOT_FOUND", async () => {
    const t = setup();
    const saved = await t.memories.create({
      type: "fact",
      statement: "A fact.",
      confidence: 0.9,
      origin: "stated",
      evidenceQuote: null,
      sourceConversationId: null,
      sourceMessageId: null,
    });
    await t.memoryService.remove(saved.id);
    expect(await t.memories.list()).toEqual([]);
    const error = await t.memoryService.remove(saved.id).catch((e) => e);
    expect(error).toBeInstanceOf(AnnaError);
    expect(error.kind).toBe("NOT_FOUND");
  });
});

describe("annotateOperations (GET /api/conversations/[id])", () => {
  it("adds exists to created/updated ops, so a deleted memory shows as forgotten", async () => {
    const t = setup();
    t.provider.enqueue(replyWithOps("Got it.", [createOp()]));
    const result = await t.anna.handleMessage({ text: "Remember that I hate being given giant plans." });
    const [created] = await t.memories.list();

    const before = annotateOperations((await savedMessages(t, result.conversationId)), new Set((await t.memories.list()).map((m) => m.id)));
    expect(before.at(-1)!.operations).toEqual([expect.objectContaining({ kind: "memory.created", exists: true })]);

    await t.memoryService.remove(created!.id);
    const after = annotateOperations((await savedMessages(t, result.conversationId)), new Set((await t.memories.list()).map((m) => m.id)));
    expect(after.at(-1)!.operations).toEqual([expect.objectContaining({ kind: "memory.created", exists: false })]);
  });

  it("leaves rejected and duplicate results without an exists flag", () => {
    const now = new Date();
    const [message] = annotateOperations(
      [
        {
          id: "m",
          conversationId: "c",
          role: "assistant",
          content: "x",
          clarification: null,
          selectedOption: false,
          createdAt: now,
          operations: [
            { kind: "memory.rejected", origin: "stated", reason: "r" },
            { kind: "memory.skipped_duplicate", statement: "s" },
            { kind: "memory.updated", memoryId: "gone", statement: "n", previousStatement: "o" },
          ],
        },
      ],
      new Set(["other"]),
    );
    expect(message!.operations).toEqual([
      { kind: "memory.rejected", origin: "stated", reason: "r" },
      { kind: "memory.skipped_duplicate", statement: "s" },
      { kind: "memory.updated", memoryId: "gone", statement: "n", previousStatement: "o", exists: false },
    ]);
  });
});
