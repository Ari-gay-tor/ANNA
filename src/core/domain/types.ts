import type { Clarification } from "./clarification";
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
  /** The question and option buttons ANNA offered with this reply. Null on user messages and plain replies. */
  clarification: Clarification | null;
  /** True when the user message came from tapping an option rather than typing. */
  selectedOption: boolean;
  createdAt: Date;
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[];
}
