import type { Reminder as DbReminder, PrismaClient } from "@prisma/client";
import { REMINDER_STATUSES, type Reminder } from "../core/domain/reminder";
import type { NewReminder, ReminderRepository } from "../core/ports";

export class PrismaReminderRepository implements ReminderRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: NewReminder): Promise<Reminder> {
    return toReminder(await this.db.reminder.create({ data: { ...input, status: "pending" } }));
  }

  async get(id: string): Promise<Reminder | null> {
    const row = await this.db.reminder.findUnique({ where: { id } });
    return row && toReminder(row);
  }

  async listPending(): Promise<Reminder[]> {
    const rows = await this.db.reminder.findMany({ where: { status: "pending" }, orderBy: [{ dueAt: "asc" }, { id: "asc" }] });
    return rows.map(toReminder);
  }

  async listRecent(since: Date): Promise<Reminder[]> {
    // There is no cancelledAt column, so a cancelled reminder is "recent" by its due time.
    const rows = await this.db.reminder.findMany({
      where: { OR: [{ status: "fired", firedAt: { gte: since } }, { status: "cancelled", dueAt: { gte: since } }] },
      orderBy: [{ dueAt: "desc" }, { id: "desc" }],
    });
    return rows.map(toReminder);
  }

  async listFiredUnacknowledged(): Promise<Reminder[]> {
    const rows = await this.db.reminder.findMany({
      where: { status: "fired", acknowledgedAt: null },
      orderBy: [{ firedAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toReminder);
  }

  async cancel(id: string): Promise<boolean> {
    const { count } = await this.db.reminder.updateMany({ where: { id, status: "pending" }, data: { status: "cancelled" } });
    return count > 0;
  }

  async markFired(id: string, firedAt: Date, missed: boolean): Promise<boolean> {
    const { count } = await this.db.reminder.updateMany({
      where: { id, status: "pending" },
      data: { status: "fired", firedAt, missed },
    });
    return count > 0;
  }

  async acknowledge(id: string, at: Date): Promise<boolean> {
    const { count } = await this.db.reminder.updateMany({
      where: { id, status: "fired", acknowledgedAt: null },
      data: { acknowledgedAt: at },
    });
    return count > 0;
  }
}

/** The status column is a plain string; an unreadable value is a corrupt row, so fail loudly rather than guess. */
function toReminder(row: DbReminder): Reminder {
  const status = REMINDER_STATUSES.find((s) => s === row.status);
  if (!status) throw new Error(`Reminder ${row.id} has an unknown status.`);
  return { ...row, status };
}
