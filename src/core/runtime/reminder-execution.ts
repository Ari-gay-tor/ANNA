// Carries out the decision from reminder-validation. Only an accepted reminder touches the database.

import type { OperationResult } from "../domain/memory";
import type { ReminderRepository } from "../ports";
import { formatReminderDue } from "../time/format-reminder-time";
import { normalizeText } from "./memory-validation";
import type { ReminderDecision } from "./reminder-validation";

/** At most this many "earlier reminder is still set" lines are added to one reply. */
export const MAX_STILL_SET_NOTICES = 2;

export interface ReminderExecutionInput {
  decision: ReminderDecision;
  reminders: ReminderRepository;
  /** The user message the request came from. Becomes the provenance of the reminder. */
  source: { conversationId: string; messageId: string };
  log: (line: string) => void;
  /** The runtime clock, used to format the times in the "still set" notices. */
  now: Date;
  /** The model's reply text. When it already says the earlier reminder is still set, no notice is added. */
  modelText: string;
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

export function stillSetNotice(text: string, when: string): string {
  return `(Your earlier reminder to ${text} at ${when} is still set. Cancel it on the Reminders page if you don't need it.)`;
}

/** True when the model's reply already tells the user an earlier reminder remains. Simple, case-insensitive. */
export function mentionsStillSet(modelText: string): boolean {
  const lower = modelText.toLowerCase();
  return lower.includes("still set") || lower.includes("reminders page");
}

export async function executeReminderDecision(input: ReminderExecutionInput): Promise<ReminderExecutionOutput> {
  const { decision, reminders, source, log, now, modelText } = input;

  if (decision.status === "rejected") {
    // Never the reminder text or quote: the reason is enough to debug.
    log(`[anna] reminder rejected: reason="${decision.reason}"`);
    return {
      results: [{ kind: "reminder.rejected", reason: decision.reason }],
      notices: [reminderRejectionNotice(decision.reason)],
    };
  }

  // Checked before creating, so the new reminder cannot match itself. V0 has no edit or cancel from chat, so a
  // "change the time" request leaves the old reminder pending; the user must be told, whatever the model said.
  const notices: string[] = [];
  if (!mentionsStillSet(modelText)) {
    const key = normalizeText(decision.text);
    const earlier = (await reminders.listPending()).filter((r) => normalizeText(r.text) === key);
    for (const r of earlier.slice(0, MAX_STILL_SET_NOTICES)) {
      notices.push(stillSetNotice(r.text, formatReminderDue(r.dueAt, r.timezone, now)));
    }
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
    notices,
  };
}
