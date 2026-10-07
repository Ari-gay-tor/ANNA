// Pure rules deciding which model-proposed memory operations the runtime will execute.
// No database, no clock. The model proposes; this file decides (spec §25, PLAN Slice 2).

import {
  INFERRED_CONFIDENCE_CAP,
  INFERRED_DEFAULT_CONFIDENCE,
  MAX_STATEMENT_LENGTH,
  STATED_CONFIDENCE,
  type MemoryOperation,
  type MemoryOrigin,
} from "../domain/memory";

export const MAX_MEMORY_OPS_PER_TURN = 3;
export const MIN_QUOTE_LENGTH = 8;

export const REASON_NOT_SAID = "not something you said";
export const REASON_PATTERN = "patterns need more evidence than one message";
export const REASON_NO_STATEMENT = "there was nothing to save";
export const REASON_TOO_LONG = `it was longer than ${MAX_STATEMENT_LENGTH} characters`;
export const REASON_TOO_MANY = `I can only save ${MAX_MEMORY_OPS_PER_TURN} things per message`;
export const REASON_UNKNOWN_MEMORY = "I couldn't find that memory to change";

/** Lowercase, curly quotes to straight, whitespace collapsed, surrounding punctuation trimmed. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "");
}

export interface ValidateMemoryOpsInput {
  /** Well-formed proposals, in the order the model gave them. */
  ops: readonly MemoryOperation[];
  /** The user's latest message. Quotes must come from here, not from earlier turns or the assistant. */
  userMessage: string;
  /** Memories that were in this turn's prompt. An update may only target one of these. */
  contextMemories: readonly { id: string }[];
  /** Statements of every saved memory (not only those in context), for the exact-duplicate check. */
  existingStatements: readonly string[];
}

export type MemoryOpDecision =
  | {
      status: "accepted";
      op: MemoryOperation;
      /** Trimmed. */
      statement: string;
      /** The model's quote, trimmed (not the normalized form). */
      evidenceQuote: string;
      origin: MemoryOrigin;
      /** Set by the runtime; the model's number is never used for stated ops. */
      confidence: number;
    }
  | { status: "rejected"; op: MemoryOperation; origin: "stated" | "inferred"; reason: string }
  | { status: "skipped_duplicate"; op: MemoryOperation; statement: string };

/** One decision per input op, in the same order. */
export function validateMemoryOps(input: ValidateMemoryOpsInput): MemoryOpDecision[] {
  const message = normalizeText(input.userMessage);
  const contextIds = new Set(input.contextMemories.map((m) => m.id));
  const seen = new Set(input.existingStatements.map(normalizeText));

  return input.ops.map((op, index): MemoryOpDecision => {
    const origin = op.op === "create" ? op.origin : "stated";
    const reject = (reason: string): MemoryOpDecision => ({ status: "rejected", op, origin, reason });

    if (index >= MAX_MEMORY_OPS_PER_TURN) return reject(REASON_TOO_MANY);

    const statement = op.statement.trim();
    if (!statement) return reject(REASON_NO_STATEMENT);
    if (statement.length > MAX_STATEMENT_LENGTH) return reject(REASON_TOO_LONG);

    const quote = normalizeText(op.evidenceQuote);
    if (quote.length < MIN_QUOTE_LENGTH || !message.includes(quote)) return reject(REASON_NOT_SAID);

    if (op.op === "update" && !contextIds.has(op.memoryId)) return reject(REASON_UNKNOWN_MEMORY);
    if (op.op === "create" && op.type === "pattern" && op.origin !== "stated") return reject(REASON_PATTERN);

    const normalizedStatement = normalizeText(statement);
    if (seen.has(normalizedStatement)) return { status: "skipped_duplicate", op, statement };
    seen.add(normalizedStatement);

    return {
      status: "accepted",
      op,
      statement,
      evidenceQuote: op.evidenceQuote.trim(),
      origin,
      confidence: op.op === "create" ? confidenceFor(op.origin, op.confidence) : STATED_CONFIDENCE,
    };
  });
}

function confidenceFor(origin: "stated" | "inferred", modelValue: number | undefined): number {
  if (origin === "stated") return STATED_CONFIDENCE;
  const proposed = Number.isFinite(modelValue) ? (modelValue as number) : INFERRED_DEFAULT_CONFIDENCE;
  return Math.max(0, Math.min(proposed, INFERRED_CONFIDENCE_CAP));
}
