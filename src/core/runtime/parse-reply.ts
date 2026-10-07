import { z } from "zod";
import { ClarificationSchema, type Clarification } from "../domain/clarification";
import { MemoryOperationSchema, type MemoryOperation } from "../domain/memory";
import { ReminderOperationSchema, type ReminderOperation } from "../domain/reminder";
import { normalizeClarification } from "./clarification";

export const FALLBACK_REPLY = "Sorry — I had trouble forming a reply. Could you say that again?";

export interface ParsedReply {
  /** May be empty only when `clarification` is set. */
  message: string;
  /** The normalized clarification (options cleaned, "Not sure" appended), or null if there was none or it was malformed. */
  clarification: Clarification | null;
  /** True when the model sent a clarification that was malformed and thrown away. The reply itself is kept. */
  droppedClarification: boolean;
  /** Memory proposals that matched the schema. Whether they are allowed is decided later by the runtime. */
  memoryOperations: MemoryOperation[];
  /** How many proposals were malformed and thrown away. The reply itself is kept. */
  droppedOperations: number;
  /** The reminder proposal if it matched the schema (including "exactly one of localDateTime / inMinutes"). Whether it is allowed is decided later. */
  reminderOperation: ReminderOperation | null;
  /** True when the model sent a reminder operation that was malformed and thrown away. The reply itself is kept. */
  droppedReminder: boolean;
}

// Loose on purpose: only `message` must be a string for parsing to continue. The clarification and each op are checked on their own.
const ReplyEnvelopeSchema = z.object({
  message: z.string().trim(),
  clarification: z.unknown().optional(),
  memoryOperations: z.unknown().optional(),
  reminderOperation: z.unknown().optional(),
});

/**
 * Parses raw model text. Returns null if there is no usable reply: no `message`, or an empty one with no valid clarification.
 * Malformed memory ops and a malformed clarification are dropped, not fatal.
 */
export function parseAnnaResponse(text: string): ParsedReply | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const envelope = ReplyEnvelopeSchema.safeParse(json);
  if (!envelope.success) return null;

  const { message, clarification: proposedClarification, memoryOperations: proposed, reminderOperation: proposedReminder } = envelope.data;

  let clarification: Clarification | null = null;
  let droppedClarification = false;
  if (proposedClarification !== undefined && proposedClarification !== null) {
    const shape = ClarificationSchema.safeParse(proposedClarification);
    clarification = shape.success ? normalizeClarification(shape.data) : null;
    droppedClarification = clarification === null;
  }
  // The same rule as AnnaResponseSchema (kept in sync by a test): an empty message is only acceptable when a clarification carries the question.
  if (!message && !clarification) return null;

  const { memoryOperations, droppedOperations } = parseMemoryOperations(proposed);
  const { reminderOperation, droppedReminder } = parseReminderOperation(proposedReminder);
  return { message, clarification, droppedClarification, memoryOperations, droppedOperations, reminderOperation, droppedReminder };
}

function parseReminderOperation(proposed: unknown): { reminderOperation: ReminderOperation | null; droppedReminder: boolean } {
  if (proposed === undefined || proposed === null) return { reminderOperation: null, droppedReminder: false };
  // Some models send null for an optional field they are not using; that means "absent".
  const cleaned =
    typeof proposed === "object" && !Array.isArray(proposed)
      ? Object.fromEntries(Object.entries(proposed).filter(([, value]) => value !== null))
      : proposed;
  const op = ReminderOperationSchema.safeParse(cleaned);
  return op.success ? { reminderOperation: op.data, droppedReminder: false } : { reminderOperation: null, droppedReminder: true };
}

function parseMemoryOperations(proposed: unknown): { memoryOperations: MemoryOperation[]; droppedOperations: number } {
  if (proposed === undefined || proposed === null) return { memoryOperations: [], droppedOperations: 0 };
  if (!Array.isArray(proposed)) return { memoryOperations: [], droppedOperations: 1 };

  const memoryOperations: MemoryOperation[] = [];
  let droppedOperations = 0;
  for (const item of proposed) {
    const op = MemoryOperationSchema.safeParse(item);
    if (op.success) memoryOperations.push(op.data);
    else droppedOperations++;
  }
  return { memoryOperations, droppedOperations };
}

/** Plain-text reply used when the model never produced valid JSON. */
export function fallbackReply(rawText: string): string {
  const text = rawText.trim();
  return text && !looksLikeJson(text) ? text : FALLBACK_REPLY;
}

function looksLikeJson(text: string): boolean {
  return text.startsWith("{") || text.startsWith("[") || text.startsWith("```");
}
