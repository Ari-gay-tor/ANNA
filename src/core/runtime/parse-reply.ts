import { z } from "zod";
import { AnnaResponseSchema } from "../domain/anna-response";
import { MemoryOperationSchema, type MemoryOperation } from "../domain/memory";

export const FALLBACK_REPLY = "Sorry — I had trouble forming a reply. Could you say that again?";

export interface ParsedReply {
  message: string;
  /** Memory proposals that matched the schema. Whether they are allowed is decided later by the runtime. */
  memoryOperations: MemoryOperation[];
  /** How many proposals were malformed and thrown away. The reply itself is kept. */
  droppedOperations: number;
}

// Loose on purpose: only `message` must be valid for the reply to survive. Each op is checked on its own.
const ReplyEnvelopeSchema = z.object({
  message: AnnaResponseSchema.shape.message,
  memoryOperations: z.unknown().optional(),
});

/** Parses raw model text. Returns null if there is no usable `message`; malformed memory ops are dropped, not fatal. */
export function parseAnnaResponse(text: string): ParsedReply | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const envelope = ReplyEnvelopeSchema.safeParse(json);
  if (!envelope.success) return null;

  const { message, memoryOperations: proposed } = envelope.data;
  if (proposed === undefined || proposed === null) return { message, memoryOperations: [], droppedOperations: 0 };
  if (!Array.isArray(proposed)) return { message, memoryOperations: [], droppedOperations: 1 };

  const memoryOperations: MemoryOperation[] = [];
  let droppedOperations = 0;
  for (const item of proposed) {
    const op = MemoryOperationSchema.safeParse(item);
    if (op.success) memoryOperations.push(op.data);
    else droppedOperations++;
  }
  return { message, memoryOperations, droppedOperations };
}

/** Plain-text reply used when the model never produced valid JSON. */
export function fallbackReply(rawText: string): string {
  const text = rawText.trim();
  return text && !looksLikeJson(text) ? text : FALLBACK_REPLY;
}

function looksLikeJson(text: string): boolean {
  return text.startsWith("{") || text.startsWith("[") || text.startsWith("```");
}
