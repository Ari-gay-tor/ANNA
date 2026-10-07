import type { Memory, MemoryOrigin, MemoryType, OperationResult } from "../domain/memory";
import type { Conversation, ConversationWithMessages, Message, Role } from "../domain/types";

export interface ConversationRepository {
  create(input: { title: string }): Promise<Conversation>;
  /** Most recently active first (ordered by updatedAt, which `touch` bumps). */
  list(): Promise<Conversation[]>;
  get(id: string): Promise<ConversationWithMessages | null>;
  appendMessage(input: {
    conversationId: string;
    role: Role;
    content: string;
    operations?: OperationResult[];
  }): Promise<Message>;
  /** The last `limit` messages, oldest first. */
  recentMessages(conversationId: string, limit: number): Promise<Message[]>;
  /** Bump the conversation's updatedAt. */
  touch(conversationId: string): Promise<void>;
}

export interface SettingsRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface NewMemory {
  type: MemoryType;
  statement: string;
  confidence: number;
  origin: MemoryOrigin;
  evidenceQuote: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
}

/** Fields that may change on an existing memory. `type` is deliberately absent: it never changes. */
export interface MemoryPatch {
  statement?: string;
  confidence?: number;
  origin?: MemoryOrigin;
  evidenceQuote?: string | null;
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
}

export interface MemoryRepository {
  /** Every memory, newest first (by createdAt). */
  list(): Promise<Memory[]>;
  get(id: string): Promise<Memory | null>;
  create(input: NewMemory): Promise<Memory>;
  /** Throws if the memory does not exist. */
  update(id: string, patch: MemoryPatch): Promise<Memory>;
  /** True if a memory was deleted, false if it did not exist. */
  delete(id: string): Promise<boolean>;
}
