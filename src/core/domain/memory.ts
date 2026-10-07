import { z } from "zod";

export const MEMORY_TYPES = ["fact", "preference", "goal", "commitment", "pattern"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_ORIGINS = ["stated", "inferred", "edited"] as const;
export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

export const MAX_STATEMENT_LENGTH = 300;

/** Confidence is set by the runtime and never trusted from the model. */
export const STATED_CONFIDENCE = 0.9;
export const INFERRED_CONFIDENCE_CAP = 0.6;
export const INFERRED_DEFAULT_CONFIDENCE = 0.5;
export const EDITED_CONFIDENCE = 1.0;

export interface Memory {
  id: string;
  type: MemoryType;
  statement: string;
  confidence: number;
  origin: MemoryOrigin;
  evidenceQuote: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** High at 0.85 and above, Medium at 0.6 and above, otherwise Low. */
export function confidenceLabel(confidence: number): "High" | "Medium" | "Low" {
  if (confidence >= 0.85) return "High";
  if (confidence >= 0.6) return "Medium";
  return "Low";
}

// What the model may propose. The model never deletes memories.
// `op` is a one-value enum, not z.literal: Gemini's responseJsonSchema documents `enum` but not `const`.
export const MemoryCreateOpSchema = z.object({
  op: z.enum(["create"]),
  type: z.enum(MEMORY_TYPES),
  statement: z.string(),
  evidenceQuote: z.string(),
  origin: z.enum(["stated", "inferred"]),
  confidence: z.number().optional(),
});

export const MemoryUpdateOpSchema = z.object({
  op: z.enum(["update"]),
  memoryId: z.string(),
  statement: z.string(),
  evidenceQuote: z.string(),
});

export const MemoryOperationSchema = z.discriminatedUnion("op", [MemoryCreateOpSchema, MemoryUpdateOpSchema]);

export type MemoryOperation = z.infer<typeof MemoryOperationSchema>;
export type MemoryCreateOp = z.infer<typeof MemoryCreateOpSchema>;
export type MemoryUpdateOp = z.infer<typeof MemoryUpdateOpSchema>;

// What the runtime stores on Message.operations after a turn. The UI renders chips from these.
export const OperationResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("memory.created"), memoryId: z.string(), type: z.enum(MEMORY_TYPES), statement: z.string() }),
  z.object({
    kind: z.literal("memory.updated"),
    memoryId: z.string(),
    statement: z.string(),
    previousStatement: z.string(),
  }),
  z.object({ kind: z.literal("memory.rejected"), origin: z.enum(["stated", "inferred"]), reason: z.string() }),
  z.object({ kind: z.literal("memory.skipped_duplicate"), statement: z.string() }),
]);

export type OperationResult = z.infer<typeof OperationResultSchema>;

/** Parses stored operations JSON. Anything unreadable yields no operations rather than an error. */
export function parseStoredOperations(raw: string | null): OperationResult[] {
  if (!raw) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(json)) return [];
  return json.flatMap((item) => {
    const parsed = OperationResultSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
