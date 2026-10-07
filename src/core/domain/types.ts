import type { OperationResult } from "./memory";

export type Role = "user" | "assistant";

export interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  /** Results of the operations the runtime executed for this turn (chips). Empty for user messages. */
  operations: OperationResult[];
  createdAt: Date;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}
