import type { Message as DbMessage, PrismaClient } from "@prisma/client";
import type { Conversation, ConversationWithMessages, Message, Role } from "../core/domain/types";
import { parseStoredClarification, type Clarification } from "../core/domain/clarification";
import { parseStoredOperations, type OperationResult } from "../core/domain/memory";
import type { ConversationRepository } from "../core/ports";

export class PrismaConversationRepository implements ConversationRepository {
  constructor(private readonly db: PrismaClient) {}

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
