import type { OperationResult } from "../domain/memory";
import type { Message } from "../domain/types";

/** An operation result as the API returns it: created/updated ones say whether the memory still exists. */
export type AnnotatedOperation = OperationResult | (Extract<OperationResult, { kind: "memory.created" | "memory.updated" }> & { exists: boolean });

export type AnnotatedMessage = Omit<Message, "operations"> & { operations: AnnotatedOperation[] };

/** Adds `exists` to each memory.created / memory.updated op, so chips can show "Forgotten" after a delete. */
export function annotateOperations(messages: readonly Message[], existingMemoryIds: ReadonlySet<string>): AnnotatedMessage[] {
  return messages.map((message) => ({
    ...message,
    operations: message.operations.map((op): AnnotatedOperation =>
      op.kind === "memory.created" || op.kind === "memory.updated"
        ? { ...op, exists: existingMemoryIds.has(op.memoryId) }
        : op,
    ),
  }));
}
