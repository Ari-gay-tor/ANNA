// Fires pending reminders whose time has come. The poller calls this every tick.

import { MISSED_AFTER_MS } from "../domain/reminder";
import type { ReminderRepository } from "../ports";

export interface FireDueRemindersInput {
  reminders: ReminderRepository;
  now: Date;
}

/**
 * Marks every pending reminder with dueAt <= now as fired; `missed` when it is more than 2 minutes late.
 * markFired is a conditional update (status = pending), so two overlapping calls fire each reminder once:
 * the loser's update changes nothing and its id is left out of the result.
 * Returns the ids this call fired.
 */
export async function fireDueReminders(input: FireDueRemindersInput): Promise<string[]> {
  const { reminders, now } = input;
  const fired: string[] = [];
  for (const reminder of await reminders.listPending()) {
    if (reminder.dueAt.getTime() > now.getTime()) continue;
    const missed = now.getTime() - reminder.dueAt.getTime() > MISSED_AFTER_MS;
    if (await reminders.markFired(reminder.id, now, missed)) fired.push(reminder.id);
  }
  return fired;
}
