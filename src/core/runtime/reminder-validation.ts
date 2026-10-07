// Pure rules deciding whether the runtime will set a model-proposed reminder (spec §13, §25).
// No database. The clock is passed in.

import { MAX_REMINDER_TEXT_LENGTH, type ReminderOperation } from "../domain/reminder";
import { resolveReminderTime } from "../time/resolve-reminder-time";
import { MIN_QUOTE_LENGTH, normalizeText } from "./memory-validation";

export const REASON_REMINDER_NO_TEXT = "there was nothing to remind you about";
export const REASON_REMINDER_TOO_LONG = `the reminder was longer than ${MAX_REMINDER_TEXT_LENGTH} characters`;
export const REASON_REMINDER_NOT_ASKED = "I couldn't match it to something you asked";
export const REASON_REMINDER_MALFORMED = "I couldn't read the reminder's time or text";

export interface ValidateReminderOpInput {
  op: ReminderOperation;
  /** The user's latest message. The quote must come from here. */
  userMessage: string;
  /** The saved timezone setting, or undefined when none is saved. */
  timeZone: string | undefined;
  now: Date;
}

export type ReminderDecision =
  | {
      status: "accepted";
      /** Trimmed. */
      text: string;
      /** The model's quote, trimmed. */
      evidenceQuote: string;
      dueAt: Date;
      timezone: string;
    }
  | { status: "rejected"; reason: string };

export function validateReminderOp(input: ValidateReminderOpInput): ReminderDecision {
  const { op, userMessage, timeZone, now } = input;
  const reject = (reason: string): ReminderDecision => ({ status: "rejected", reason });

  const text = op.text.trim();
  if (!text) return reject(REASON_REMINDER_NO_TEXT);
  if (text.length > MAX_REMINDER_TEXT_LENGTH) return reject(REASON_REMINDER_TOO_LONG);

  const quote = normalizeText(op.evidenceQuote);
  if (quote.length < MIN_QUOTE_LENGTH || !normalizeText(userMessage).includes(quote)) return reject(REASON_REMINDER_NOT_ASKED);

  const time = resolveReminderTime({ localDateTime: op.localDateTime, inMinutes: op.inMinutes, timeZone, now });
  if (!time.ok) return reject(time.reason);

  // resolveReminderTime only succeeds with a valid zone, so `timeZone` is defined here.
  return { status: "accepted", text, evidenceQuote: op.evidenceQuote.trim(), dueAt: time.dueAt, timezone: timeZone as string };
}
