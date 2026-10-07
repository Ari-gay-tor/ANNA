// Chooses which saved memories go into the prompt. Pure; no embeddings, just keyword overlap (PLAN Slice 2).

import type { Memory, MemoryType } from "../domain/memory";

export const MAX_CONTEXT_MEMORIES = 60;

/** Prompt order: most useful for shaping a reply first. */
const TYPE_ORDER: readonly MemoryType[] = ["preference", "goal", "commitment", "fact", "pattern"];

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "with", "that", "this", "have", "has", "was", "were",
  "will", "would", "can", "could", "should", "what", "when", "where", "which", "who", "how", "why", "from", "into",
  "about", "just", "than", "then", "them", "they", "their", "there", "its", "our", "out", "all", "any", "get", "got",
  "did", "does", "been", "being", "some", "very", "also", "like", "want", "need", "know", "think", "make",
]);

/** Type order first, then newest (createdAt) first, then id for a stable result. */
export function compareMemories(a: Memory, b: Memory): number {
  return (
    TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
    b.createdAt.getTime() - a.createdAt.getTime() ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

/** Lowercase word tokens of 3+ characters, minus stopwords. */
export function keywordsOf(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(tokens.filter((t) => t.length >= 3 && !STOPWORDS.has(t)));
}

/**
 * Up to `limit` memories for the prompt, in prompt order. All of them when there are `limit` or fewer;
 * otherwise the `limit` with the most keyword overlap with the user's message (ties: type, then recency).
 */
export function selectContextMemories(memories: readonly Memory[], userMessage: string, limit = MAX_CONTEXT_MEMORIES): Memory[] {
  if (memories.length <= limit) return [...memories].sort(compareMemories);

  const wanted = keywordsOf(userMessage);
  const scored = memories.map((memory) => {
    let score = 0;
    for (const word of keywordsOf(memory.statement)) if (wanted.has(word)) score++;
    return { memory, score };
  });
  scored.sort((a, b) => b.score - a.score || compareMemories(a.memory, b.memory));
  return scored
    .slice(0, limit)
    .map((s) => s.memory)
    .sort(compareMemories);
}
