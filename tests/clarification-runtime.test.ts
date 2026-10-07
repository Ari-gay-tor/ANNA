import { afterEach, describe, expect, it } from "vitest";
import { annotateOperations } from "../src/core/runtime/annotate-operations";
import { FALLBACK_REPLY } from "../src/core/runtime/parse-reply";
import { LIMIT_HINT, NOT_SURE_HINT, TURN_GUIDANCE_HEADER } from "../src/core/runtime/turn-guidance";
import { reply, replyWithClarification, testAnna } from "./helpers";

let current: ReturnType<typeof testAnna> | undefined;
function setup() {
  current = testAnna();
  return current;
}
afterEach(async () => {
  await current?.db.$disconnect();
  current = undefined;
});

const QUESTION = "What are you stuck on?";
const clarification = (overrides: Record<string, unknown> = {}) => ({
  question: QUESTION,
  options: ["Finding opportunities", "Applications", "Interview preparation", "Something else"],
  ...overrides,
});

describe("storing a reply with a clarification", () => {
  it("content is the message and the question joined by a blank line", async () => {
    const t = setup();
    t.provider.enqueue(replyWithClarification("Internships have a few moving parts.", clarification()));
    const { assistantMessage } = await t.anna.handleMessage({ text: "I need to deal with my internship." });
    expect(assistantMessage.content).toBe(`Internships have a few moving parts.\n\n${QUESTION}`);
  });

  it("an empty message leaves just the question", async () => {
    const t = setup();
    t.provider.enqueue(replyWithClarification("", clarification()));
    const { assistantMessage } = await t.anna.handleMessage({ text: "internship" });
    expect(assistantMessage.content).toBe(QUESTION);
  });

  it("does not show the question twice when the message already contains it (the message copy is removed)", async () => {
    const t = setup();
    t.provider.enqueue(replyWithClarification(`Okay. ${QUESTION}`, clarification()));
    const { assistantMessage } = await t.anna.handleMessage({ text: "internship" });
    expect(assistantMessage.content).toBe(`Okay.\n\n${QUESTION}`);
    expect(assistantMessage.content.match(/stuck on/g)).toHaveLength(1);
  });

  it("stores the normalized clarification JSON on the assistant message and returns it on reload", async () => {
    const t = setup();
    t.provider.enqueue(
      replyWithClarification("", { question: ` ${QUESTION} `, options: ["Applications", "applications", "I'm not sure", "Interviews", "A", "B", "C"] }),
    );
    const { assistantMessage, conversationId } = await t.anna.handleMessage({ text: "internship" });

    const expected = { question: QUESTION, options: ["Applications", "Interviews", "A", "B", "Not sure"] };
    expect(assistantMessage.clarification).toEqual(expected);
    const row = await t.db.message.findFirst({ where: { role: "assistant" } });
    expect(JSON.parse(row!.clarification!)).toEqual(expected);

    const reloaded = (await t.conversations.get(conversationId))!.messages;
    expect(reloaded.map((m) => m.clarification)).toEqual([null, expected]);
  });

  it("a plain reply stores no clarification", async () => {
    const t = setup();
    t.provider.enqueue(reply("Hello."));
    const { assistantMessage } = await t.anna.handleMessage({ text: "hi" });
    expect(assistantMessage.clarification).toBeNull();
    expect((await t.db.message.findFirst({ where: { role: "assistant" } }))!.clarification).toBeNull();
  });

  it("memory ops still run, and their notices come after the question", async () => {
    const t = setup();
    const op = { op: "create", type: "preference", statement: "Dislikes giant plans.", evidenceQuote: "I hate giant plans", origin: "stated" };
    t.provider.enqueue(replyWithClarification("Got it.", clarification(), { memoryOperations: [op] }));
    const { assistantMessage } = await t.anna.handleMessage({ text: "Remember that I hate giant plans, and I need to sort out my internship" });

    expect(await t.memories.list()).toMatchObject([{ statement: "Dislikes giant plans." }]);
    expect(assistantMessage.operations).toMatchObject([{ kind: "memory.created" }]);
    expect(assistantMessage.clarification?.question).toBe(QUESTION);
    expect(assistantMessage.content).toBe(`Got it.\n\n${QUESTION}`);
  });

  it("a rejected 'stated' memory op still appends its notice after the question", async () => {
    const t = setup();
    const op = { op: "create", type: "fact", statement: "X.", evidenceQuote: "not in the message", origin: "stated" };
    t.provider.enqueue(replyWithClarification("", clarification(), { memoryOperations: [op] }));
    const { assistantMessage } = await t.anna.handleMessage({ text: "internship" });
    expect(await t.memories.list()).toEqual([]);
    expect(assistantMessage.content.startsWith(`${QUESTION}\n`)).toBe(true);
    expect(assistantMessage.content.length).toBeGreaterThan(QUESTION.length + 1);
  });
});

describe("malformed or empty replies", () => {
  it("a malformed clarification is dropped and logged; the reply and the memory ops survive", async () => {
    const t = setup();
    const op = { op: "create", type: "preference", statement: "Dislikes giant plans.", evidenceQuote: "I hate giant plans", origin: "stated" };
    t.provider.enqueue(replyWithClarification("Sure thing.", { options: ["A", "B"] }, { memoryOperations: [op] }));
    const { assistantMessage } = await t.anna.handleMessage({ text: "Remember that I hate giant plans" });

    expect(t.provider.calls).toHaveLength(1);
    expect(assistantMessage.content).toBe("Sure thing.");
    expect(assistantMessage.clarification).toBeNull();
    expect(assistantMessage.operations).toMatchObject([{ kind: "memory.created" }]);
    expect(await t.memories.list()).toHaveLength(1);
    expect(t.logs).toContain("[anna] dropped a malformed clarification");
  });

  it("an empty message without a clarification is invalid: retried once, then the fallback reply", async () => {
    const t = setup();
    t.provider.enqueue(reply(""), reply("  "));
    const { assistantMessage } = await t.anna.handleMessage({ text: "hi" });
    expect(t.provider.calls).toHaveLength(2);
    expect(assistantMessage.content).toBe(FALLBACK_REPLY);
    expect(assistantMessage.clarification).toBeNull();
  });

  it("an empty message with a malformed clarification is also invalid; a valid second answer is used", async () => {
    const t = setup();
    t.provider.enqueue(replyWithClarification("", { question: 5 }), replyWithClarification("", clarification()));
    const { assistantMessage } = await t.anna.handleMessage({ text: "hi" });
    expect(t.provider.calls).toHaveLength(2);
    expect(assistantMessage.content).toBe(QUESTION);
    expect(assistantMessage.clarification?.options.at(-1)).toBe("Not sure");
  });
});

describe("selectedOption", () => {
  it("is stored on the user message when a tapped option is sent", async () => {
    const t = setup();
    t.provider.enqueue(replyWithClarification("", clarification()), reply("Okay, applications."));
    const first = await t.anna.handleMessage({ text: "internship" });
    const second = await t.anna.handleMessage({ conversationId: first.conversationId, text: "Applications", selectedOption: true });

    expect(second.userMessage.selectedOption).toBe(true);
    const rows = await t.db.message.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.role, r.selectedOption])).toEqual([
      ["user", false],
      ["assistant", false],
      ["user", true],
      ["assistant", false],
    ]);
  });

  it("defaults to false when omitted", async () => {
    const t = setup();
    const { userMessage } = await t.anna.handleMessage({ text: "hello" });
    expect(userMessage.selectedOption).toBe(false);
  });
});

describe("history sent to the model", () => {
  it("annotates clarifications and tapped options in the request only; stored content is unchanged", async () => {
    const t = setup();
    t.provider.enqueue(replyWithClarification("Let's narrow it down.", clarification()), reply("Applications it is."));
    const first = await t.anna.handleMessage({ text: "I need to deal with my internship." });
    await t.anna.handleMessage({ conversationId: first.conversationId, text: "Applications", selectedOption: true });

    const sent = t.provider.calls[1]!.messages;
    const storedAssistant = `Let's narrow it down.\n\n${QUESTION}`;
    expect(sent).toEqual([
      { role: "user", content: "I need to deal with my internship." },
      {
        role: "assistant",
        content: `${storedAssistant}\n(Options offered: Finding opportunities / Applications / Interview preparation / Something else / Not sure)`,
      },
      { role: "user", content: "(Tapped option) Applications" },
    ]);

    const stored = (await t.conversations.get(first.conversationId))!.messages;
    expect(stored.map((m) => m.content)).toEqual([
      "I need to deal with my internship.",
      storedAssistant,
      "Applications",
      "Applications it is.",
    ]);
  });

  it("a typed message after a clarification is sent as typed", async () => {
    const t = setup();
    t.provider.enqueue(replyWithClarification("", clarification()), reply("Okay."));
    const first = await t.anna.handleMessage({ text: "internship" });
    await t.anna.handleMessage({ conversationId: first.conversationId, text: "Applications" });
    expect(t.provider.calls[1]!.messages.at(-1)).toEqual({ role: "user", content: "Applications" });
  });
});

describe("turn guidance in the system prompt", () => {
  it("has no 'Turn guidance:' section on an ordinary turn", async () => {
    const t = setup();
    await t.anna.handleMessage({ text: "hello" });
    expect(t.provider.calls[0]!.system).not.toContain(TURN_GUIDANCE_HEADER);
  });

  it("adds the limit hint on the turn after two clarifications in a row, and not before", async () => {
    const t = setup();
    t.provider.enqueue(replyWithClarification("", clarification()), replyWithClarification("", clarification({ question: "Which part?" })), reply("Best guess."));
    const first = await t.anna.handleMessage({ text: "internship" });
    const second = await t.anna.handleMessage({ conversationId: first.conversationId, text: "Applications", selectedOption: true });
    await t.anna.handleMessage({ conversationId: second.conversationId, text: "Resume", selectedOption: true });

    expect(t.provider.calls[1]!.system).not.toContain(LIMIT_HINT); // only one clarification so far
    expect(t.provider.calls[2]!.system).toContain(`${TURN_GUIDANCE_HEADER}\n- ${LIMIT_HINT}`);
    expect(t.provider.calls[2]!.system).not.toContain(NOT_SURE_HINT);
  });

  it("adds the 'Not sure' hint after a tapped 'Not sure', but not after a typed one", async () => {
    const t = setup();
    t.provider.enqueue(replyWithClarification("", clarification()), reply("Narrowing."), replyWithClarification("", clarification()), reply("Fine."));
    const a = await t.anna.handleMessage({ text: "internship" });
    await t.anna.handleMessage({ conversationId: a.conversationId, text: "Not sure", selectedOption: true });
    expect(t.provider.calls[1]!.system).toContain(NOT_SURE_HINT);

    const b = await t.anna.handleMessage({ text: "internship again" });
    await t.anna.handleMessage({ conversationId: b.conversationId, text: "not sure" });
    expect(t.provider.calls[3]!.system).not.toContain(NOT_SURE_HINT);
  });
});

describe("API shape", () => {
  it("annotateOperations keeps clarification on assistant messages and selectedOption on user messages", async () => {
    const t = setup();
    t.provider.enqueue(replyWithClarification("", clarification()), reply("Okay."));
    const first = await t.anna.handleMessage({ text: "internship" });
    await t.anna.handleMessage({ conversationId: first.conversationId, text: "Applications", selectedOption: true });

    const { messages } = (await t.conversations.get(first.conversationId))!;
    const body = JSON.parse(JSON.stringify(annotateOperations(messages, new Set())));
    expect(body[1].clarification).toEqual({ question: QUESTION, options: [...clarification().options, "Not sure"] });
    expect(body[0].selectedOption).toBe(false);
    expect(body[2].selectedOption).toBe(true);
    expect(body[3].clarification).toBeNull();
  });
});

describe("fake provider canned mode", () => {
  it("returns a clarification when the message contains 'clarify', and a plain echo otherwise", async () => {
    const t = setup();
    const withOptions = await t.anna.handleMessage({ text: "please clarify my internship" });
    expect(withOptions.assistantMessage.clarification?.options.at(-1)).toBe("Not sure");
    expect(withOptions.assistantMessage.content).toBe("What are you stuck on?");

    const plain = await t.anna.handleMessage({ text: "hello" });
    expect(plain.assistantMessage.clarification).toBeNull();
  });
});

describe("a reworded question in the message", () => {
  it("shows one question when the message asks a different version of it (live test-f-restraint reply)", async () => {
    const t = setup();
    t.provider.enqueue(
      replyWithClarification(
        "What kind of thing are you trying to tackle right now?",
        clarification({ question: "What kind of task are you trying to tackle?" }),
      ),
    );
    const { assistantMessage } = await t.anna.handleMessage({ text: "I have so much to do." });
    expect(assistantMessage.content).toBe("What kind of task are you trying to tackle?");
    expect(assistantMessage.content.match(/\?/g)).toHaveLength(1);
  });
});
