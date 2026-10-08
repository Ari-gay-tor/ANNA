import type { Message as DbMessage, PrismaClient } from "@prisma/client";
import type { Conversation, ConversationWithMessages, Message, Role } from "../core/domain/types";
import { parseStoredClarification, type Clarification } from "../core/domain/clarification";
import { parseStoredOperations, type OperationResult } from "../core/domain/memory";
import type { ConversationRepository } from "../core/ports";

/**
 * What the Conversations API needs beyond the core port (rename, delete, existence checks).
 * Kept here, not in src/core/ports, because the runtime never renames or deletes conversations.
 */
export interface ManagedConversationRepository extends ConversationRepository {
  /** Changes the title only; updatedAt is kept, so the chat stays where it is in the sidebar. Null if the conversation does not exist. */
  rename(id: string, title: string): Promise<Conversation | null>;
  /** Deletes the conversation and its messages. True if it existed. Memories and reminders made from it are left alone. */
  delete(id: string): Promise<boolean>;
  /** Which of these ids are still conversations. */
  existingIds(ids: readonly string[]): Promise<Set<string>>;
}

export class PrismaConversationRepository implements ManagedConversationRepository {
  constructor(private readonly db: PrismaClient) {}

  async rename(id: string, title: string): Promise<Conversation | null> {
    const current = await this.db.conversation.findUnique({ where: { id }, select: { updatedAt: true } });
    if (!current) return null;
    // @updatedAt would bump on any update; passing the old value keeps it, so renaming does not reorder the sidebar.
    return this.db.conversation.update({ where: { id }, data: { title, updatedAt: current.updatedAt } });
  }

  async delete(id: string): Promise<boolean> {
    const { count } = await this.db.conversation.deleteMany({ where: { id } }); // messages cascade
    return count > 0;
  }

  async existingIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db.conversation.findMany({ where: { id: { in: [...ids] } }, select: { id: true } });
    return new Set(rows.map((r) => r.id));
  }

  async create(input: { title: string }): Promise<Conversation> {
    return this.db.conversation.create({ data: { title: input.title } });
  }

  async list(): Promise<Conversation[]> {
    return this.db.conversation.findMany({ orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }] });
  }

  async get(id: string): Promise<ConversationWithMessages | null> {
    const row = await this.db.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    return row && { ...row, messages: row.messages.map(toMessage) };
  }

  async appendMessage(input: {
    conversationId: string;
    role: Role;
    content: string;
    operations?: OperationResult[];
    clarification?: Clarification | null;
    selectedOption?: boolean;
  }): Promise<Message> {
    // createdAt is the ordering key. Force it to be strictly increasing within a
    // conversation so two messages written in the same millisecond keep their order.
    return this.db.$transaction(async (tx) => {
      const last = await tx.message.findFirst({
        where: { conversationId: input.conversationId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const createdAt = new Date(Math.max(Date.now(), (last?.createdAt.getTime() ?? 0) + 1));
      const { operations, clarification, selectedOption, ...fields } = input;
      const storedOperations = operations && operations.length > 0 ? JSON.stringify(operations) : null;
      const storedClarification = clarification ? JSON.stringify(clarification) : null;
      return toMessage(
        await tx.message.create({
          data: {
            ...fields,
            operations: storedOperations,
            clarification: storedClarification,
            selectedOption: selectedOption ?? false,
            createdAt,
          },
        }),
      );
    });
  }

  async recentMessages(conversationId: string, limit: number): Promise<Message[]> {
    const rows = await this.db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.reverse().map(toMessage);
  }

  async touch(conversationId: string): Promise<void> {
    await this.db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  }
}

function toMessage(row: DbMessage): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    operations: parseStoredOperations(row.operations),
    clarification: parseStoredClarification(row.clarification),
    selectedOption: row.selectedOption,
    createdAt: row.createdAt,
  };
}
