// Carries out the decisions from memory-validation. Only accepted ops touch the database.

import type { OperationResult } from "../domain/memory";
import type { MemoryRepository } from "../ports";
import type { MemoryOpDecision } from "./memory-validation";

export const REASON_MEMORY_GONE = "that memory no longer exists";

export interface MemoryExecutionInput {
  decisions: readonly MemoryOpDecision[];
  memories: MemoryRepository;
  /** The user message the proposals came from. Becomes the provenance of anything created or changed. */
  source: { conversationId: string; messageId: string };
  log: (line: string) => void;
}

export interface MemoryExecutionOutput {
  /** Stored on the assistant message's `operations`. */
  results: OperationResult[];
  /** Lines to append to the reply: one per rejected stated op. */
  notices: string[];
}

export function statedRejectionNotice(reason: string): string {
  return `(I didn't save that: ${reason}.)`;
}

export async function executeMemoryDecisions(input: MemoryExecutionInput): Promise<MemoryExecutionOutput> {
  const { decisions, memories, source, log } = input;
  const results: OperationResult[] = [];
  const notices: string[] = [];

  const reject = (op: MemoryOpDecision["op"], origin: "stated" | "inferred", reason: string) => {
    results.push({ kind: "memory.rejected", origin, reason });
    // Never the statement or quote: the reason and the kind of op are enough to debug.
    log(`[anna] memory op rejected: op=${op.op} type=${op.op === "create" ? op.type : "-"} origin=${origin} reason="${reason}"`);
    if (origin === "stated") notices.push(statedRejectionNotice(reason));
  };

  for (const decision of decisions) {
    if (decision.status === "rejected") {
      reject(decision.op, decision.origin, decision.reason);
      continue;
    }
    if (decision.status === "skipped_duplicate") {
      results.push({ kind: "memory.skipped_duplicate", statement: decision.statement });
      continue;
    }

    const { op } = decision;
    if (op.op === "create") {
      const created = await memories.create({
        type: op.type,
        statement: decision.statement,
        confidence: decision.confidence,
        origin: decision.origin,
        evidenceQuote: decision.evidenceQuote,
        sourceConversationId: source.conversationId,
        sourceMessageId: source.messageId,
      });
      results.push({ kind: "memory.created", memoryId: created.id, type: created.type, statement: created.statement });
    } else {
      // The memory may have been deleted since the prompt was built.
      const existing = await memories.get(op.memoryId);
      if (!existing) {
        reject(op, "stated", REASON_MEMORY_GONE);
        continue;
      }
      const updated = await memories.update(op.memoryId, {
        statement: decision.statement,
        origin: decision.origin,
        confidence: decision.confidence,
        evidenceQuote: decision.evidenceQuote,
        sourceConversationId: source.conversationId,
        sourceMessageId: source.messageId,
      });
      results.push({
        kind: "memory.updated",
        memoryId: updated.id,
        statement: updated.statement,
        previousStatement: existing.statement,
      });
    }
  }
  return { results, notices };
}
