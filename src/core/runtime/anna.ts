import { ANNA_RESPONSE_JSON_SCHEMA } from "../domain/anna-response";
import { AnnaError, ReplyFailedError } from "../domain/errors";
import type { Message } from "../domain/types";
import { normalizeTimeZone } from "../domain/timezone";
import type { LLMProvider, LLMRequest } from "../llm/provider";
import type { ConversationRepository, SettingsRepository } from "../ports";
import { DEFAULT_TIMEZONE, buildSystemPrompt } from "./context";
import { fallbackReply, parseAnnaResponse } from "./parse-reply";

export const HISTORY_LIMIT = 20;
export const TITLE_MAX_LENGTH = 60;
export const TIMEZONE_SETTING_KEY = "timezone";

export interface AnnaDeps {
  provider: LLMProvider;
  conversations: ConversationRepository;
  settings: SettingsRepository;
  clock: () => Date;
}

export interface HandleMessageInput {
  conversationId?: string;
  text: string;
}

export interface HandleMessageResult {
  conversationId: string;
  userMessage: Message;
  assistantMessage: Message;
}

export interface Anna {
  handleMessage(input: HandleMessageInput): Promise<HandleMessageResult>;
  generateReply(conversationId: string): Promise<Message>;
}

export function createAnna(deps: AnnaDeps): Anna {
  const { provider, conversations, settings, clock } = deps;

  async function generateReply(conversationId: string): Promise<Message> {
    const history = await conversations.recentMessages(conversationId, HISTORY_LIMIT);
    const latest = history[history.length - 1];
    if (!latest) throw new AnnaError("NOT_FOUND", "Conversation not found.");
    if (latest.role !== "user") {
      throw new AnnaError("REPLY_NOT_NEEDED", "The latest message is not from the user, so there is nothing to reply to.");
    }

    // The window can start mid-conversation on an assistant turn. Providers differ in
    // whether they accept that, so always start from the first user message.
    const firstUser = history.findIndex((m) => m.role === "user");
    const request: LLMRequest = {
      system: buildSystemPrompt(clock(), await currentTimeZone()),
      messages: history.slice(firstUser).map((m) => ({ role: m.role, content: m.content })),
      jsonSchema: ANNA_RESPONSE_JSON_SCHEMA,
    };

    // Provider errors (LLMError) propagate untouched. Only invalid output is retried.
    let rawText = "";
    let reply: string | null = null;
    for (let attempt = 0; attempt < 2 && reply === null; attempt++) {
      rawText = (await provider.generate(request)).text;
      reply = parseAnnaResponse(rawText)?.message ?? null;
    }

    const assistantMessage = await conversations.appendMessage({
      conversationId,
      role: "assistant",
      content: reply ?? fallbackReply(rawText),
    });
    await conversations.touch(conversationId);
    return assistantMessage;
  }

  async function handleMessage(input: HandleMessageInput): Promise<HandleMessageResult> {
    const text = input.text.trim();
    if (!text) throw new AnnaError("INVALID_INPUT", "Message is empty.");

    let conversationId = input.conversationId;
    if (conversationId === undefined) {
      conversationId = (await conversations.create({ title: makeTitle(text) })).id;
    } else if (!(await conversations.get(conversationId))) {
      throw new AnnaError("NOT_FOUND", "Conversation not found.");
    }

    const userMessage = await conversations.appendMessage({ conversationId, role: "user", content: text });
    await conversations.touch(conversationId);

    try {
      const assistantMessage = await generateReply(conversationId);
      return { conversationId, userMessage, assistantMessage };
    } catch (cause) {
      throw new ReplyFailedError(conversationId, userMessage, cause);
    }
  }

  async function currentTimeZone(): Promise<string> {
    const saved = await settings.get(TIMEZONE_SETTING_KEY);
    return (saved && normalizeTimeZone(saved)) || DEFAULT_TIMEZONE;
  }

  return { handleMessage, generateReply };
}

function makeTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_LENGTH);
}
