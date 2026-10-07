// What the user (not the model) may do with reminders from the UI.

import { AnnaError } from "../domain/errors";
import type { Reminder, ReminderStatus } from "../domain/reminder";
import type { ReminderRepository } from "../ports";

export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface ReminderList {
  /** Pending, soonest first. */
  upcoming: Reminder[];
  /** Fired or cancelled in the last 7 days, newest first. */
  recent: Reminder[];
}

export interface ReminderService {
  list(): Promise<ReminderList>;
  /** NOT_FOUND if unknown, CONFLICT if it is not pending any more. */
  cancel(id: string): Promise<Reminder>;
  /** Fired and not yet dismissed. */
  due(): Promise<Reminder[]>;
  /** NOT_FOUND if unknown, CONFLICT if it has not fired. Dismissing twice is fine. */
  acknowledge(id: string): Promise<Reminder>;
  /** Current status per id, for chips. Unknown ids are left out. */
  statuses(ids: readonly string[]): Promise<Map<string, ReminderStatus>>;
}

export function createReminderService(reminders: ReminderRepository, clock: () => Date): ReminderService {
  async function getOrThrow(id: string): Promise<Reminder> {
    const reminder = await reminders.get(id);
    if (!reminder) throw new AnnaError("NOT_FOUND", "Reminder not found.");
    return reminder;
  }

  return {
    async list() {
      const [upcoming, recent] = await Promise.all([
        reminders.listPending(),
        reminders.listRecent(new Date(clock().getTime() - RECENT_WINDOW_MS)),
      ]);
      return { upcoming, recent };
    },

    async cancel(id) {
      await getOrThrow(id);
      // The conditional update decides: it may have fired or been cancelled since the read above.
      if (!(await reminders.cancel(id))) throw new AnnaError("CONFLICT", "That reminder is no longer pending.");
      return getOrThrow(id);
    },

    due: () => reminders.listFiredUnacknowledged(),

    async acknowledge(id) {
      const reminder = await getOrThrow(id);
      if (reminder.status !== "fired") throw new AnnaError("CONFLICT", "That reminder has not fired yet.");
      await reminders.acknowledge(id, clock());
      return getOrThrow(id);
    },

    async statuses(ids) {
      const found = await Promise.all([...new Set(ids)].map((id) => reminders.get(id)));
      return new Map(found.flatMap((r) => (r ? [[r.id, r.status] as const] : [])));
    },
  };
}
