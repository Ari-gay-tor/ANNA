import { afterEach, describe, expect, it } from "vitest";
import { AnnaError, ReplyFailedError } from "../src/core/domain/errors";
import { LLMError } from "../src/core/llm/provider";
import { FALLBACK_REPLY } from "../src/core/runtime/parse-reply";
import { FIXED_NOW, reply, testAnna } from "./helpers";

let current: ReturnType<typeof testAnna> | undefined;
function setup(options?: Parameters<typeof testAnna>[0]) {
  current = testAnna(options);
  return current;
}
afterEach(async () => {
  await current?.db.$disconnect();
  current = undefined;
});

async function messagesOf(t: ReturnType<typeof testAnna>, conversationId: string) {
  return (await t.conversations.get(conversationId))!.messages;
}

describe("handleMessage", () => {
  it("round trip saves exactly 2 messages, in order, and creates the conversation", async () => {
    const t = setup();
    t.provider.enqueue(reply("Hello there."));
    const result = await t.anna.handleMessage({ text: "  hi anna  " });

    expect(result.userMessage).toMatchObject({ role: "user", content: "hi anna" });
    expect(result.assistantMessage).toMatchObject({ role: "assistant", content: "Hello there." });
    expect(result.userMessage.conversationId).toBe(result.conversationId);

    const conversation = (await t.conversations.get(result.conversationId))!;
    expect(conversation.title).toBe("hi anna");
    expect(conversation.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "hi anna"],
      ["assistant", "Hello there."],
    ]);
    expect(await t.db.message.count()).toBe(2);
    expect(t.provider.calls).toHaveLength(1);
  });

  it("truncates the title to 60 characters", async () => {
    const t = setup();
    const { conversationId } = await t.anna.handleMessage({ text: "x".repeat(100) });
    expect((await t.conversations.get(conversationId))!.title).toBe("x".repeat(60));
  });

  it("continues an existing conversation without creating another", async () => {
    const t = setup();
    const first = await t.anna.handleMessage({ text: "one" });
    await t.anna.handleMessage({ conversationId: first.conversationId, text: "two" });
    expect(await t.db.conversation.count()).toBe(1);
    expect(await messagesOf(t, first.conversationId)).toHaveLength(4);
  });

  it("rejects an unknown conversation and writes nothing", async () => {
    const t = setup();
    await expect(t.anna.handleMessage({ conversationId: "nope", text: "hi" })).rejects.toMatchObject({ kind: "NOT_FOUND" });
    expect(await t.db.message.count()).toBe(0);
    expect(t.provider.calls).toHaveLength(0);
  });

  it("rejects empty text and writes nothing", async () => {
    const t = setup();
    await expect(t.anna.handleMessage({ text: "   " })).rejects.toBeInstanceOf(AnnaError);
    expect(await t.db.conversation.count()).toBe(0);
  });

  it("provider failure keeps the user message, writes no assistant message, and throws a typed error", async () => {
    const t = setup();
    t.provider.enqueue(new LLMError("UNAVAILABLE", "boom", 503));
    const error = await t.anna.handleMessage({ text: "hello" }).catch((e) => e);

    expect(error).toBeInstanceOf(ReplyFailedError);
    expect(error.cause).toBeInstanceOf(LLMError);
    expect(error.cause.kind).toBe("UNAVAILABLE");
    expect(error.userMessage).toMatchObject({ role: "user", content: "hello" });

    const messages = await messagesOf(t, error.conversationId);
    expect(messages.map((m) => m.role)).toEqual(["user"]);
    expect(await t.db.message.count({ where: { role: "assistant" } })).toBe(0);
  });
});

describe("generateReply", () => {
  it("retry after a failure produces exactly 1 assistant message and no duplicate user message", async () => {
    const t = setup();
    t.provider.enqueue(new LLMError("RATE_LIMITED", "slow down", 429), reply("Back again."));
    const failure = await t.anna.handleMessage({ text: "hello" }).catch((e) => e);
    const id = failure.conversationId as string;

    const assistant = await t.anna.generateReply(id);
    expect(assistant).toMatchObject({ role: "assistant", content: "Back again." });
    expect((await messagesOf(t, id)).map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("throws when the latest message is from the assistant, and writes nothing", async () => {
    const t = setup();
    const { conversationId } = await t.anna.handleMessage({ text: "hello" });
    const callsBefore = t.provider.calls.length;

    await expect(t.anna.generateReply(conversationId)).rejects.toMatchObject({ kind: "REPLY_NOT_NEEDED" });
    expect(await messagesOf(t, conversationId)).toHaveLength(2);
    expect(t.provider.calls).toHaveLength(callsBefore);
  });

  it("throws NOT_FOUND for an unknown conversation", async () => {
    const t = setup();
    await expect(t.anna.generateReply("missing")).rejects.toMatchObject({ kind: "NOT_FOUND" });
  });

  it("invalid JSON: calls the provider twice, then saves a plain-text fallback", async () => {
    const t = setup();
    t.provider.enqueue("this is not json {", "still not json");
    const { assistantMessage } = await t.anna.handleMessage({ text: "hello" });

    expect(t.provider.calls).toHaveLength(2);
    expect(assistantMessage.content).toBe("still not json");
    expect(await t.db.message.count({ where: { role: "assistant" } })).toBe(1);
  });

  it("invalid first answer, valid second: uses the second without fallback", async () => {
    const t = setup();
    t.provider.enqueue("garbage", reply("Recovered."));
    const { assistantMessage } = await t.anna.handleMessage({ text: "hello" });
    expect(t.provider.calls).toHaveLength(2);
    expect(assistantMessage.content).toBe("Recovered.");
  });

  it("JSON-looking or schema-invalid output falls back to the apology line", async () => {
    const t = setup();
    t.provider.enqueue('{"message": ""}', '{"wrong": true}');
    const { assistantMessage } = await t.anna.handleMessage({ text: "hello" });
    expect(t.provider.calls).toHaveLength(2);
    expect(assistantMessage.content).toBe(FALLBACK_REPLY);
  });

  it("does not retry provider errors on the second attempt (propagates immediately)", async () => {
    const t = setup();
    t.provider.enqueue("garbage", new LLMError("UNAVAILABLE", "down", 503));
    const error = await t.anna.handleMessage({ text: "hello" }).catch((e) => e);
    expect(error).toBeInstanceOf(ReplyFailedError);
    expect(t.provider.calls).toHaveLength(2);
    expect(await t.db.message.count({ where: { role: "assistant" } })).toBe(0);
  });

  it("sends only the last 20 messages, oldest first, with the JSON schema", async () => {
    const t = setup();
    const { conversationId } = await t.anna.handleMessage({ text: "m0" });
    for (let i = 1; i <= 15; i++) await t.anna.handleMessage({ conversationId, text: `m${i}` });
    const request = t.provider.calls.at(-1)!;

    // The last-20 window starts on an assistant turn, which is dropped, leaving 19.
    expect(request.messages).toHaveLength(19);
    expect(request.messages.at(-1)).toEqual({ role: "user", content: "m15" });
    expect(request.jsonSchema).toMatchObject({ type: "object", required: ["message"] });
  });

  it("never starts the history with an assistant message, and keeps the latest user message last", async () => {
    const t = setup();
    const conversation = await t.conversations.create({ title: "t" });
    // 21 alternating messages starting with user: u0 a1 u2 ... u20. The last-20 window starts at a1 (assistant).
    for (let i = 0; i <= 20; i++) {
      await t.conversations.appendMessage({
        conversationId: conversation.id,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `msg${i}`,
      });
    }
    expect((await t.conversations.recentMessages(conversation.id, 20))[0]!.role).toBe("assistant"); // precondition

    await t.anna.generateReply(conversation.id);
    const { messages } = t.provider.calls[0]!;
    expect(messages[0]).toEqual({ role: "user", content: "msg2" });
    expect(messages.at(-1)).toEqual({ role: "user", content: "msg20" });
    expect(messages).toHaveLength(19);
  });
});

describe("context block", () => {
  it("contains the saved timezone and the injected clock time in that zone", async () => {
    const t = setup(); // clock fixed at 2026-10-07T15:42:00Z
    await t.settings.set("timezone", "Asia/Kolkata");
    await t.anna.handleMessage({ text: "what time is it?" });

    const system = t.provider.calls[0]!.system;
    expect(system).toContain("Asia/Kolkata");
    expect(system).toContain("Wednesday 2026-10-07 21:12"); // 15:42Z is 21:12 in IST (+05:30)
    expect(system).toContain("You are ANNA.");
    expect(system).toContain("Respond only with JSON matching the schema.");
  });

  it("defaults to UTC when no timezone is saved", async () => {
    const t = setup();
    await t.anna.handleMessage({ text: "hi" });
    const system = t.provider.calls[0]!.system;
    expect(system).toContain("User timezone (IANA): UTC");
    expect(system).toContain("Wednesday 2026-10-07 15:42");
    expect(FIXED_NOW.toISOString()).toBe("2026-10-07T15:42:00.000Z");
  });

  it("falls back to UTC if the saved timezone is garbage", async () => {
    const t = setup();
    await t.settings.set("timezone", "Not/AZone");
    await t.anna.handleMessage({ text: "hi" });
    expect(t.provider.calls[0]!.system).toContain("User timezone (IANA): UTC");
  });
});
