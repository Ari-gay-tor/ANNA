// Carries out the decision from reminder-validation. Only an accepted reminder touches the database.

import type { OperationResult } from "../domain/memory";
import type { ReminderRepository } from "../ports";
import type { ReminderDecision } from "./reminder-validation";

export interface ReminderExecutionInput {
  decision: ReminderDecision;
  reminders: ReminderRepository;
  /** The user message the request came from. Becomes the provenance of the reminder. */
  source: { conversationId: string; messageId: string };
  log: (line: string) => void;
}

export interface ReminderExecutionOutput {
  /** Stored on the assistant message's `operations`. */
  results: OperationResult[];
  /** Lines to append to the reply. A reminder request is always explicit, so a rejection always gets one. */
  notices: string[];
}

export function reminderRejectionNotice(reason: string): string {
  return `(I didn't set that reminder: ${reason}.)`;
}

export async function executeReminderDecision(input: ReminderExecutionInput): Promise<ReminderExecutionOutput> {
  const { decision, reminders, source, log } = input;

  if (decision.status === "rejected") {
    // Never the reminder text or quote: the reason is enough to debug.
    log(`[anna] reminder rejected: reason="${decision.reason}"`);
    return {
      results: [{ kind: "reminder.rejected", reason: decision.reason }],
      notices: [reminderRejectionNotice(decision.reason)],
    };
  }

  const created = await reminders.create({
    text: decision.text,
    dueAt: decision.dueAt,
    timezone: decision.timezone,
    sourceConversationId: source.conversationId,
    sourceMessageId: source.messageId,
  });
  return {
    results: [
      {
        kind: "reminder.created",
        reminderId: created.id,
        text: created.text,
        dueAt: created.dueAt.toISOString(),
        timezone: created.timezone,
      },
    ],
    notices: [],
  };
}
