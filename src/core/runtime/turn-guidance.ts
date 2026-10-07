// Per-turn hints the runtime adds to the system prompt, decided from the conversation so far. Pure.

import type { Message } from "../domain/types";
import { NOT_SURE_LABEL } from "./clarification";

export const CLARIFICATION_LIMIT = 2;

export const LIMIT_HINT = `You have asked ${CLARIFICATION_LIMIT} clarifying questions in a row. Do not ask another. Give your best answer now and state your assumptions in one line.`;

export const NOT_SURE_HINT =
  "The user tapped 'Not sure'. Don't ask them to rephrase or explain. Narrow it down yourself: offer your best guesses as options, or ask an easier either/or question.";

export const TURN_GUIDANCE_HEADER = "Turn guidance:";

/** Assistant clarifications in a row, counting back from the newest assistant message until one has none. */
export function consecutiveClarifications(history: readonly Message[]): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i]!;
    if (message.role !== "assistant") continue;
    if (!message.clarification) break;
    count++;
  }
  return count;
}

/** Hints for the turn about to be generated. `history` is oldest first and ends with the user message being answered. */
export function turnGuidanceHints(history: readonly Message[]): string[] {
  const hints: string[] = [];
  if (consecutiveClarifications(history) >= CLARIFICATION_LIMIT) hints.push(LIMIT_HINT);

  const latest = history[history.length - 1];
  if (latest?.role === "user" && latest.selectedOption && latest.content.trim().toLowerCase() === NOT_SURE_LABEL.toLowerCase()) {
    hints.push(NOT_SURE_HINT);
  }
  return hints;
}

/** The prompt section, or null when there is nothing to say. */
export function buildTurnGuidanceSection(hints: readonly string[]): string | null {
  return hints.length === 0 ? null : [TURN_GUIDANCE_HEADER, ...hints.map((h) => `- ${h}`)].join("\n");
}
