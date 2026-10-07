// The wording the banner uses. Plain functions so they can be tested without a browser.

import { formatReminderDue, formatTimeOfDay, isSameLocalDay } from "../core/time/format-reminder-time";
import type { ClientReminder } from "./types";

/** "You asked me to remind you to call Dad." */
export function reminderMessage(reminder: Pick<ClientReminder, "text">): string {
  return `You asked me to remind you to ${reminder.text.replace(/[.!?]+$/, "")}.`;
}

/** "This was due at 6:00 PM, while ANNA wasn't running." (with the day when it was not today) */
export function missedMessage(reminder: Pick<ClientReminder, "dueAt" | "timezone">, now: Date): string {
  const due = new Date(reminder.dueAt);
  const when = isSameLocalDay(due, now, reminder.timezone) ? formatTimeOfDay(due, reminder.timezone) : formatReminderDue(due, reminder.timezone, now);
  return `This was due at ${when}, while ANNA wasn't running.`;
}
