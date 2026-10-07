import type { Clarification } from "../domain/clarification";
import type { Memory, MemoryOrigin, MemoryType, OperationResult } from "../domain/memory";
import type { Reminder } from "../domain/reminder";
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
    clarification?: Clarification | null;
    selectedOption?: boolean;
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

export interface NewReminder {
  text: string;
  dueAt: Date;
  timezone: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
}

export interface ReminderRepository {
  /** Creates a pending reminder. */
  create(input: NewReminder): Promise<Reminder>;
  get(id: string): Promise<Reminder | null>;
  /** Every pending reminder, soonest due first. */
  listPending(): Promise<Reminder[]>;
  /** Fired reminders (by firedAt) and cancelled ones (by dueAt) since `since`, newest first. */
  listRecent(since: Date): Promise<Reminder[]>;
  /** Fired and not yet dismissed, oldest first. */
  listFiredUnacknowledged(): Promise<Reminder[]>;
  /** Pending to cancelled. True only if this call changed it. */
  cancel(id: string): Promise<boolean>;
  /** Pending to fired, as one conditional update. True only if this call changed it, so a reminder fires at most once. */
  markFired(id: string, firedAt: Date, missed: boolean): Promise<boolean>;
  /** Marks a fired reminder as dismissed. True only if this call changed it. */
  acknowledge(id: string, at: Date): Promise<boolean>;
}
