// What the user (not the model) may do to saved memories from the Memory page.

import { AnnaError } from "../domain/errors";
import { EDITED_CONFIDENCE, MAX_STATEMENT_LENGTH, STATED_CONFIDENCE, type Memory } from "../domain/memory";
import { SETUP_SLOTS, setupAnswersToMemories, type SetupAnswers, type SetupMemoryDraft } from "../domain/setup";
import type { MemoryRepository } from "../ports";

export interface MemoryService {
  list(): Promise<Memory[]>;
  /** Sets origin "edited" and confidence 1.0. The source conversation, message and quote are kept. */
  edit(id: string, statement: string): Promise<Memory>;
  remove(id: string): Promise<void>;
  /**
   * Turns the first-run "About you" answers into memories (origin stated, confidence 0.9, sourceKind "setup").
   * Re-running replaces earlier setup memories the user has not touched; ones they edited are kept, and chat memories are never touched.
   * `previous` is the answers saved last time: an answer that did not change leaves its memory alone, edited or not.
   * Without it, every untouched setup memory is replaced.
   */
  saveSetupAnswers(answers: SetupAnswers, previous?: SetupAnswers | null): Promise<{ created: Memory[]; removed: number }>;
}

function bySlot(drafts: SetupMemoryDraft[]): Map<string, SetupMemoryDraft> {
  return new Map(drafts.map((d) => [d.slot, d]));
}

export function createMemoryService(memories: MemoryRepository): MemoryService {
  return {
    list: () => memories.list(),

    async edit(id, statement) {
      const trimmed = statement.trim();
      if (!trimmed) throw new AnnaError("INVALID_INPUT", "A memory cannot be empty.");
      if (trimmed.length > MAX_STATEMENT_LENGTH) {
        throw new AnnaError("INVALID_INPUT", `A memory can be at most ${MAX_STATEMENT_LENGTH} characters.`);
      }
      if (!(await memories.get(id))) throw new AnnaError("NOT_FOUND", "Memory not found.");
      return memories.update(id, { statement: trimmed, origin: "edited", confidence: EDITED_CONFIDENCE });
    },

    async remove(id) {
      if (!(await memories.delete(id))) throw new AnnaError("NOT_FOUND", "Memory not found.");
    },

    async saveSetupAnswers(answers, previous = null) {
      const next = bySlot(setupAnswersToMemories(answers));
      const before = previous ? bySlot(setupAnswersToMemories(previous)) : null;
      // Only setup memories the user has not edited may be replaced.
      let replaceable = (await memories.list()).filter((m) => m.sourceKind === "setup" && m.origin === "stated");
      let removed = 0;
      const drop = async (match: (m: Memory) => boolean) => {
        for (const memory of replaceable.filter(match)) {
          if (await memories.delete(memory.id)) removed++;
        }
        replaceable = replaceable.filter((m) => !match(m));
      };

      if (!before) await drop(() => true);
      const toCreate: SetupMemoryDraft[] = [];
      for (const slot of SETUP_SLOTS) {
        const now = next.get(slot);
        const was = before?.get(slot);
        if (before && now && was && now.statement === was.statement) continue; // not changed: leave its memory as it is
        if (was) await drop((m) => m.statement === was.statement);
        if (now) toCreate.push(now);
      }

      // Not twice: skip a statement that is already saved (a kept edited one, or one from chat).
      const saved = new Set((await memories.list()).map((m) => m.statement.trim().toLowerCase()));
      const created: Memory[] = [];
      for (const draft of toCreate) {
        if (saved.has(draft.statement.toLowerCase())) continue;
        created.push(
          await memories.create({
            type: draft.type,
            statement: draft.statement,
            confidence: STATED_CONFIDENCE,
            origin: "stated",
            evidenceQuote: draft.evidenceQuote,
            sourceConversationId: null,
            sourceMessageId: null,
            sourceKind: "setup",
          }),
        );
      }
      return { created, removed };
    },
  };
}
