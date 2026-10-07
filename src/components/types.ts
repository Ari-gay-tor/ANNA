// Shapes the API returns (dates arrive as ISO strings).

import type { Clarification } from "@/core/domain/clarification";
import type { MemoryOrigin, MemoryType, OperationResult } from "@/core/domain/memory";

/** What GET /api/conversations/[id] returns: created/updated ops also say whether the memory still exists. */
export type ClientOperation = OperationResult & { exists?: boolean };

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
