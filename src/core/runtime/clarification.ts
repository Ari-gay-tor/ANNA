// Pure helpers for clarification: normalizing the model's options, composing the stored message text,
// and annotating history for the model. Nothing here touches the database.

import type { Clarification, ClarificationProposal } from "../domain/clarification";
import type { Message } from "../domain/types";
import type { LLMMessage } from "../llm/provider";

export const NOT_SURE_LABEL = "Not sure";
export const MAX_CLARIFICATION_OPTIONS = 4;

/** Compared lowercase, with curly apostrophes straightened and trailing punctuation removed. */
const NOT_SURE_VARIANTS: ReadonlySet<string> = new Set([
  "not sure",
  "i'm not sure",
  "im not sure",
  "unsure",
  "i don't know",
  "i dont know",
  "don't know",
  "idk",
]);

function isNotSureVariant(option: string): boolean {
  const key = option
    .replace(/[‘’]/g, "'")
    .replace(/[\s.,;:!?…]+$/u, "")
    .toLowerCase();
  return NOT_SURE_VARIANTS.has(key);
}

/**
 * Cleans the model's clarification: trims the question (null if nothing is left), and rebuilds the options as
 * at most 4 distinct model options followed by exactly one "Not sure".
 */
export function normalizeClarification(raw: ClarificationProposal): Clarification | null {
  const question = raw.question.trim();
  if (!question) return null;

  const seen = new Set<string>();
  const options: string[] = [];
  for (const candidate of raw.options ?? []) {
    const option = candidate.trim();
    if (!option || isNotSureVariant(option)) continue;
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(option);
  }
  return { question, options: [...options.slice(0, MAX_CLARIFICATION_OPTIONS), NOT_SURE_LABEL] };
}

/** Splits on ".", "!" or "?" followed by whitespace or the end, keeping the punctuation with its sentence. */
function splitSentences(text: string): string[] {
  return text.match(/.*?[.!?]+(?=\s|$)|.+$/gs)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

/**
 * The assistant text shown and stored when a clarification is present. The clarification carries the question, so
 * every sentence ending in "?" is removed from the message (the model sometimes rephrases the question there, and
 * exact-match dedupe misses that). What remains, if anything, leads; then the question after a blank line.
 * A message with no question sentence is kept exactly as written.
 */
export function composeClarificationContent(message: string, question: string): string {
  const trimmed = message.trim();
  const sentences = splitSentences(trimmed);
  const kept = sentences.filter((sentence) => !/\?[!?.]*$/.test(sentence));
  const lead = kept.length === sentences.length ? trimmed : kept.join(" ");
  return lead ? `${lead}\n\n${question}` : question;
}

/** Maps stored messages to what the model sees. Stored content is never changed; only this request copy is annotated. */
export function toLLMMessages(messages: readonly Message[]): LLMMessage[] {
  return messages.map((m) => {
    if (m.role === "assistant" && m.clarification) {
      return { role: m.role, content: `${m.content}\n(Options offered: ${m.clarification.options.join(" / ")})` };
    }
    if (m.role === "user" && m.selectedOption) return { role: m.role, content: `(Tapped option) ${m.content}` };
    return { role: m.role, content: m.content };
  });
}
