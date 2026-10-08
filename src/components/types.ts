// Shapes the API returns (dates arrive as ISO strings).

import type { Clarification } from "@/core/domain/clarification";
import type { MemoryOrigin, MemorySourceKind, MemoryType, OperationResult } from "@/core/domain/memory";
import type { ReminderStatus } from "@/core/domain/reminder";
import type { SetupAnswers } from "@/core/domain/setup";

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
  /** True when the user flagged this reply as "Not helpful". Absent on a reply that was just generated. */
  flagged?: boolean;
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
  /** "setup" for a memory made from the first-run "About you" answers; null (older rows) means chat. */
  sourceKind: MemorySourceKind | null;
  /** Whether the source conversation still exists. Absent on a memory returned by an edit; keep the value you already have. */
  sourceExists?: boolean;
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

/** A flagged ANNA reply as the Feedback page lists it. */
export interface ClientFeedback {
  id: string;
  messageId: string;
  conversationId: string;
  /** Whether the conversation still exists. The text below was captured when the reply was flagged, so it is shown either way. */
  conversationExists: boolean;
  note: string;
  replyText: string;
  userText: string;
  createdAt: string;
}

/** GET /api/settings/key: never the key itself, only its last 4 characters. */
export interface KeyStatus {
  /** True when no usable provider key is set, so the Setup screen shows. */
  required: boolean;
  configured: boolean;
  last4: string | null;
  mode: "tester" | "dev";
  dataDir: string | null;
  version: string;
}

export interface KeySaved {
  saved: true;
  status: "valid" | "quota";
  message?: string;
  configured: boolean;
  last4: string | null;
}

/** GET /api/onboarding. */
export interface OnboardingStatus {
  completed: boolean;
  needsKey: boolean;
  answers: SetupAnswers | null;
}

/** POST /api/onboarding/answers. */
export interface AnswersSaved {
  answers: SetupAnswers;
  /** How many memories these answers describe (the Done step mentions the Memory page when it is above 0). */
  memoryCount: number;
}
