import { ANNA_RESPONSE_JSON_SCHEMA } from "../domain/anna-response";
import { AnnaError, ReplyFailedError } from "../domain/errors";
import type { Clarification } from "../domain/clarification";
import type { Message } from "../domain/types";
import { normalizeTimeZone } from "../domain/timezone";
import type { LLMProvider, LLMRequest } from "../llm/provider";
import type { OperationResult } from "../domain/memory";
import type { ConversationRepository, MemoryRepository, ReminderRepository, SettingsRepository } from "../ports";
import { composeClarificationContent, toLLMMessages } from "./clarification";
import { DEFAULT_TIMEZONE, buildSystemPrompt } from "./context";
import { executeMemoryDecisions } from "./memory-execution";
import { selectContextMemories } from "./memory-retrieval";
import { validateMemoryOps } from "./memory-validation";
import { executeReminderDecision } from "./reminder-execution";
import { REASON_REMINDER_MALFORMED, validateReminderOp, type ReminderDecision } from "./reminder-validation";
import { fallbackReply, parseAnnaResponse, type ParsedReply } from "./parse-reply";
import { turnGuidanceHints } from "./turn-guidance";

export const HISTORY_LIMIT = 20;
export const TITLE_MAX_LENGTH = 60;
export const TIMEZONE_SETTING_KEY = "timezone";

export interface AnnaDeps {
  provider: LLMProvider;
  conversations: ConversationRepository;
  settings: SettingsRepository;
  memories: MemoryRepository;
  reminders: ReminderRepository;
  clock: () => Date;
  /** One-line diagnostics (never message or memory content). Defaults to silent. */
  log?: (line: string) => void;
}

export interface HandleMessageInput {
  conversationId?: string;
  text: string;
  /** True when the text is a tapped option button rather than typed. Stored on the user message. */
  selectedOption?: boolean;
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
  const { provider, conversations, settings, memories, reminders, clock } = deps;
  const log = deps.log ?? (() => {});

  async function generateReply(conversationId: string): Promise<Message> {
    const history = await conversations.recentMessages(conversationId, HISTORY_LIMIT);
    const latest = history[history.length - 1];
    if (!latest) throw new AnnaError("NOT_FOUND", "Conversation not found.");
    if (latest.role !== "user") {
      throw new AnnaError("REPLY_NOT_NEEDED", "The latest message is not from the user, so there is nothing to reply to.");
    }

    // All saved memories, so the duplicate check sees everything; only the selected ones go into the prompt.
    const savedMemories = await memories.list();
    const contextMemories = selectContextMemories(savedMemories, latest.content);

    // The window can start mid-conversation on an assistant turn. Providers differ in
    // whether they accept that, so always start from the first user message.
    const firstUser = history.findIndex((m) => m.role === "user");
    const request: LLMRequest = {
      system: buildSystemPrompt(clock(), await currentTimeZone(), contextMemories, turnGuidanceHints(history)),
      // Annotated copies for the model only; the stored messages are not changed.
      messages: toLLMMessages(history.slice(firstUser)),
      jsonSchema: ANNA_RESPONSE_JSON_SCHEMA,
    };

    // Provider errors (LLMError) propagate untouched. Only invalid output is retried.
    let rawText = "";
    let parsed: ParsedReply | null = null;
    for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
      rawText = (await provider.generate(request)).text;
      parsed = parseAnnaResponse(rawText);
    }

    let content = fallbackReply(rawText);
    let operations: OperationResult[] = [];
    let clarification: Clarification | null = null;
    if (parsed) {
      if (parsed.droppedClarification) log("[anna] dropped a malformed clarification");
      if (parsed.droppedOperations > 0) log(`[anna] dropped ${parsed.droppedOperations} malformed memory op(s)`);
      // Validation is pure; execution only runs what validation accepted. The model never touches the database.
      const decisions = validateMemoryOps({
        ops: parsed.memoryOperations,
        userMessage: latest.content,
        contextMemories,
        existingStatements: savedMemories.map((m) => m.statement),
      });
      const outcome = await executeMemoryDecisions({
        decisions,
        memories,
        source: { conversationId, messageId: latest.id },
        log,
      });
      // A reminderOperation that was present but malformed is a rejected reminder, not a silent drop: the model's message
      // may say it is set, so the user must be told it is not. Only an absent or null reminderOperation means "no reminder".
      let reminderDecision: ReminderDecision | null = null;
      if (parsed.reminderOperation) {
        reminderDecision = validateReminderOp({
          op: parsed.reminderOperation,
          userMessage: latest.content,
          timeZone: await savedTimeZone(),
          now: clock(),
        });
      } else if (parsed.droppedReminder) {
        reminderDecision = { status: "rejected", reason: REASON_REMINDER_MALFORMED };
      }
      clarification = parsed.clarification;
      const text = clarification ? composeClarificationContent(parsed.message, clarification.question) : parsed.message;
      const reminderOutcome = reminderDecision
        ? await executeReminderDecision({
            decision: reminderDecision,
            reminders,
            source: { conversationId, messageId: latest.id },
            log,
            now: clock(),
            modelText: text,
          })
        : { results: [], notices: [] };
      content = [text, ...outcome.notices, ...reminderOutcome.notices].join("\n");
      operations = [...outcome.results, ...reminderOutcome.results];
    }

    const assistantMessage = await conversations.appendMessage({
      conversationId,
      role: "assistant",
      content,
      operations,
      clarification,
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

    const userMessage = await conversations.appendMessage({
      conversationId,
      role: "user",
      content: text,
      selectedOption: input.selectedOption ?? false,
    });
    await conversations.touch(conversationId);

    try {
      const assistantMessage = await generateReply(conversationId);
      return { conversationId, userMessage, assistantMessage };
    } catch (cause) {
      throw new ReplyFailedError(conversationId, userMessage, cause);
    }
  }

  /** The saved timezone, or undefined when none is saved (reminders refuse to guess one). */
  async function savedTimeZone(): Promise<string | undefined> {
    const saved = await settings.get(TIMEZONE_SETTING_KEY);
    return (saved && normalizeTimeZone(saved)) || undefined;
  }

  async function currentTimeZone(): Promise<string> {
    return (await savedTimeZone()) ?? DEFAULT_TIMEZONE;
  }

  return { handleMessage, generateReply };
}

function makeTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_LENGTH);
}
