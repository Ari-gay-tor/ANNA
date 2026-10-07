// What the user (not the model) may do to saved memories from the Memory page.

import { AnnaError } from "../domain/errors";
import { EDITED_CONFIDENCE, MAX_STATEMENT_LENGTH, type Memory } from "../domain/memory";
import type { MemoryRepository } from "../ports";

export interface MemoryService {
  list(): Promise<Memory[]>;
  /** Sets origin "edited" and confidence 1.0. The source conversation, message and quote are kept. */
  edit(id: string, statement: string): Promise<Memory>;
  remove(id: string): Promise<void>;
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
  };
}
