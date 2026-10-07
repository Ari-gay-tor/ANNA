// Shapes the API returns (dates arrive as ISO strings).

import type { Clarification } from "@/core/domain/clarification";
import type { MemoryOrigin, MemoryType, OperationResult } from "@/core/domain/memory";
import type { ReminderStatus } from "@/core/domain/reminder";

/**
 * What GET /api/conversations/[id] returns: created/updated memory ops also say whether the memory still exists,
 * and reminder.created ops say the reminder's current status. Both are absent on a reply that was just generated.
 */
export type ClientOperation = OperationResult & { exists?: boolean; status?: ReminderStatus | "missing" };

export interface ClientMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  /** Absent on optimistic (not yet saved) messages. */
  operations?: ClientOperation[];
  /** The question and option buttons offered with an assistant reply. Absent on optimistic messages. */
  clarification?: Clarification | null;
  /** True when a user message was sent by tapping an option. */
  selectedOption?: boolean;
  createdAt: string;
}

export interface ClientMemory {
  id: string;
  type: MemoryType;
  statement: string;
  confidence: number;
  origin: MemoryOrigin;
  evidenceQuote: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** A reminder as the API returns it (dates arrive as ISO strings). */
export interface ClientReminder {
  id: string;
  text: string;
  dueAt: string;
  timezone: string;
  status: ReminderStatus;
  firedAt: string | null;
  missed: boolean;
  acknowledgedAt: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
}
