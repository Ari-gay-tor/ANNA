import type { Conversation, ConversationWithMessages, Message, Role } from "../domain/types";

export interface ConversationRepository {
  create(input: { title: string }): Promise<Conversation>;
  /** Most recently active first (ordered by updatedAt, which `touch` bumps). */
  list(): Promise<Conversation[]>;
  get(id: string): Promise<ConversationWithMessages | null>;
  appendMessage(input: { conversationId: string; role: Role; content: string }): Promise<Message>;
  /** The last `limit` messages, oldest first. */
  recentMessages(conversationId: string, limit: number): Promise<Message[]>;
  /** Bump the conversation's updatedAt. */
  touch(conversationId: string): Promise<void>;
}

export interface SettingsRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}
