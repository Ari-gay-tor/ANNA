import type { Feedback as DbFeedback, PrismaClient } from "@prisma/client";
import { AnnaError } from "../core/domain/errors";
import { parseStoredOperations, type OperationResult } from "../core/domain/memory";

export const NOTE_MAX_LENGTH = 1000;

export interface ContextTurn {
  role: "user" | "assistant";
  content: string;
}

/** A flagged ANNA reply with the text captured when it was flagged, so it survives the conversation being deleted. */
export interface FeedbackItem {
  id: string;
  messageId: string;
  conversationId: string;
  note: string;
  /** The flagged ANNA reply. */
  replyText: string;
  /** The user message right before it ("" if there was none). */
  userText: string;
  /** Up to 2 messages before the reply, oldest first. Includes the user message above. */
  context: ContextTurn[];
  operations: OperationResult[];
  createdAt: Date;
}

export interface FeedbackRepository {
  /**
   * Flags an ANNA reply. One flag per message: flagging it again keeps the original text and only replaces the note
   * when a new one is given. `created` says whether a row was added.
   * Throws NOT_FOUND for an unknown message and INVALID_INPUT for a message that is not an ANNA reply.
   */
  create(input: { messageId: string; note: string }): Promise<{ item: FeedbackItem; created: boolean }>;
  /** Newest first. */
  list(): Promise<FeedbackItem[]>;
  /** True if a row was deleted. */
  delete(id: string): Promise<boolean>;
  /** Which of these messages are flagged. */
  flaggedMessageIds(messageIds: readonly string[]): Promise<Set<string>>;
}

export class PrismaFeedbackRepository implements FeedbackRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: { messageId: string; note: string }): Promise<{ item: FeedbackItem; created: boolean }> {
    const note = input.note.trim().slice(0, NOTE_MAX_LENGTH);
    const existing = await this.db.feedback.findFirst({ where: { messageId: input.messageId } });
    if (existing) {
      const row = note && note !== existing.note ? await this.db.feedback.update({ where: { id: existing.id }, data: { note } }) : existing;
      return { item: toItem(row), created: false };
    }

    const message = await this.db.message.findUnique({ where: { id: input.messageId } });
    if (!message) throw new AnnaError("NOT_FOUND", "Message not found.");
    if (message.role !== "assistant") throw new AnnaError("INVALID_INPUT", "Only ANNA's replies can be flagged.");

    const before = await this.db.message.findMany({
      where: { conversationId: message.conversationId, createdAt: { lt: message.createdAt } },
      orderBy: { createdAt: "desc" },
      take: 2,
    });
    const context: ContextTurn[] = before.reverse().map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
    const userText = [...context].reverse().find((turn) => turn.role === "user")?.content ?? "";

    const row = await this.db.feedback.create({
      data: {
        messageId: message.id,
        conversationId: message.conversationId,
        note,
        replyText: message.content,
        userText,
        contextJson: JSON.stringify(context),
        operations: message.operations,
      },
    });
    return { item: toItem(row), created: true };
  }

  async list(): Promise<FeedbackItem[]> {
    const rows = await this.db.feedback.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    return rows.map(toItem);
  }

  async delete(id: string): Promise<boolean> {
    const { count } = await this.db.feedback.deleteMany({ where: { id } });
    return count > 0;
  }

  async flaggedMessageIds(messageIds: readonly string[]): Promise<Set<string>> {
    if (messageIds.length === 0) return new Set();
    const rows = await this.db.feedback.findMany({ where: { messageId: { in: [...messageIds] } }, select: { messageId: true } });
    return new Set(rows.map((r) => r.messageId));
  }
}

function toItem(row: DbFeedback): FeedbackItem {
  return {
    id: row.id,
    messageId: row.messageId,
    conversationId: row.conversationId,
    note: row.note,
    replyText: row.replyText,
    userText: row.userText,
    context: parseContext(row.contextJson),
    operations: parseStoredOperations(row.operations),
    createdAt: row.createdAt,
  };
}

function parseContext(raw: string): ContextTurn[] {
  try {
    const json: unknown = JSON.parse(raw);
    if (!Array.isArray(json)) return [];
    return json.flatMap((item) => {
      const turn = item as Partial<ContextTurn> | null;
      return turn && typeof turn.content === "string" && (turn.role === "user" || turn.role === "assistant")
        ? [{ role: turn.role, content: turn.content }]
        : [];
    });
  } catch {
    return [];
  }
}
