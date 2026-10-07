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

/** Lowercase, punctuation and spacing flattened, so "What are you stuck on?" matches "what are you stuck on". */
function flatten(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The assistant text shown and stored: the message, then the question after a blank line unless the message already says it. */
export function composeClarificationContent(message: string, question: string): string {
  const lead = message.trim();
  if (!lead) return question;
  const flatQuestion = flatten(question);
  if (flatQuestion && flatten(lead).includes(flatQuestion)) return lead;
  return `${lead}\n\n${question}`;
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
