import type { OperationResult } from "../domain/memory";
import type { ReminderStatus } from "../domain/reminder";
import type { Message } from "../domain/types";

type MemoryChipOperation = Extract<OperationResult, { kind: "memory.created" | "memory.updated" }>;
type ReminderChipOperation = Extract<OperationResult, { kind: "reminder.created" }>;

/**
 * An operation result as the API returns it: created/updated memories say whether the memory still exists,
 * and created reminders say their current status ("missing" if the row cannot be found).
 */
export type AnnotatedOperation =
  | OperationResult
  | (MemoryChipOperation & { exists: boolean })
  | (ReminderChipOperation & { status: ReminderStatus | "missing" });

export type AnnotatedMessage = Omit<Message, "operations"> & { operations: AnnotatedOperation[] };

/** Ids of every reminder that a message's chips point at. */
export function reminderIdsIn(messages: readonly Message[]): string[] {
  return messages.flatMap((m) => m.operations.flatMap((op) => (op.kind === "reminder.created" ? [op.reminderId] : [])));
}

/**
 * Adds `exists` to each memory.created / memory.updated op (so chips can show "Forgotten" after a delete)
 * and `status` to each reminder.created op (so chips can show "Cancelled" or "Done").
 */
export function annotateOperations(
  messages: readonly Message[],
  existingMemoryIds: ReadonlySet<string>,
  reminderStatuses: ReadonlyMap<string, ReminderStatus> = new Map(),
): AnnotatedMessage[] {
  return messages.map((message) => ({
    ...message,
    operations: message.operations.map((op): AnnotatedOperation => {
      if (op.kind === "memory.created" || op.kind === "memory.updated") return { ...op, exists: existingMemoryIds.has(op.memoryId) };
      if (op.kind === "reminder.created") return { ...op, status: reminderStatuses.get(op.reminderId) ?? "missing" };
      return op;
    }),
  }));
}
