// The optional "About you" answers from first-run setup (Slice 9): their shape, validation, and the memories they become.
// Pure. The UI shows the form, the API validates with SetupAnswersSchema, and nothing here trusts either of them.

import { z } from "zod";
import type { MemoryType } from "./memory";

export const ANSWER_STYLES = ["short", "detailed", "none"] as const;
export type AnswerStyle = (typeof ANSWER_STYLES)[number];

/** The "What tends to trip you up?" chips, in the order they are shown and stored. */
export const TROUBLE_CHIPS = [
  { id: "getting-started", label: "Getting started" },
  { id: "too-many-things", label: "Too many things at once" },
  { id: "making-decisions", label: "Making decisions" },
  { id: "remembering", label: "Remembering things" },
  { id: "staying-focused", label: "Staying focused" },
] as const;
export type TroubleId = (typeof TROUBLE_CHIPS)[number]["id"];
const TROUBLE_IDS = TROUBLE_CHIPS.map((c) => c.id) as [TroubleId, ...TroubleId[]];

export const ANSWER_STYLE_LABELS: Record<AnswerStyle, string> = {
  short: "Short, one step at a time",
  detailed: "A bit more detail",
  none: "No preference",
};

export const SETUP_LIMITS = { name: 40, workingOn: 200, troubleOther: 100 } as const;

/** Newlines and runs of whitespace become one space; the ends are trimmed. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function singleLine(max: number, what: string) {
  return z
    .string()
    .transform(collapse)
    .pipe(z.string().max(max, `${what} can be at most ${max} characters.`))
    .default("");
}

/** What the API accepts. Every field is optional; unknown fields and unknown chip values are rejected. */
export const SetupAnswersSchema = z
  .object({
    name: singleLine(SETUP_LIMITS.name, "Your name"),
    answerStyle: z.enum(ANSWER_STYLES).default("none"),
    workingOn: singleLine(SETUP_LIMITS.workingOn, "What you are working on"),
    troubles: z
      .array(z.enum(TROUBLE_IDS))
      .max(TROUBLE_CHIPS.length)
      .default([])
      // Shown order, no repeats.
      .transform((chosen) => TROUBLE_IDS.filter((id) => chosen.includes(id))),
    troubleOther: singleLine(SETUP_LIMITS.troubleOther, "That"),
  })
  .strict();

export type SetupAnswers = z.infer<typeof SetupAnswersSchema>;

export const EMPTY_SETUP_ANSWERS: SetupAnswers = SetupAnswersSchema.parse({});

/** Which answer a memory came from. Re-running setup compares answers slot by slot. */
export const SETUP_SLOTS = ["name", "answerStyle", "workingOn", "troubles"] as const;
export type SetupSlot = (typeof SETUP_SLOTS)[number];

export interface SetupMemoryDraft {
  slot: SetupSlot;
  type: MemoryType;
  statement: string;
  /** The user's own answer text, or the label of the option they chose. */
  evidenceQuote: string;
}

/** A sentence ends with one full stop, however the person typed it. */
function withoutTrailingStop(text: string): string {
  return text.replace(/[.\s]+$/, "");
}

/** The memories these answers become. Empty answers create nothing, and "No preference" creates nothing. */
export function setupAnswersToMemories(answers: SetupAnswers): SetupMemoryDraft[] {
  const drafts: SetupMemoryDraft[] = [];

  const name = withoutTrailingStop(answers.name);
  if (name) drafts.push({ slot: "name", type: "preference", statement: `Prefers to be called ${name}.`, evidenceQuote: answers.name });

  if (answers.answerStyle === "short") {
    drafts.push({
      slot: "answerStyle",
      type: "preference",
      statement: "Prefers short answers, one step at a time.",
      evidenceQuote: ANSWER_STYLE_LABELS.short,
    });
  } else if (answers.answerStyle === "detailed") {
    drafts.push({
      slot: "answerStyle",
      type: "preference",
      statement: "Prefers answers with a bit more detail.",
      evidenceQuote: ANSWER_STYLE_LABELS.detailed,
    });
  }

  const workingOn = withoutTrailingStop(answers.workingOn);
  if (workingOn) {
    drafts.push({ slot: "workingOn", type: "goal", statement: `Currently working on: ${workingOn}.`, evidenceQuote: answers.workingOn });
  }

  const chosen = TROUBLE_CHIPS.filter((chip) => answers.troubles.includes(chip.id)).map((chip) => chip.label);
  const other = withoutTrailingStop(answers.troubleOther);
  const parts = [...chosen.map((label) => label.toLowerCase()), ...(other ? [other] : [])];
  if (parts.length > 0) {
    drafts.push({
      slot: "troubles",
      type: "pattern",
      statement: `Says they tend to get stuck on: ${parts.join(", ")}.`,
      evidenceQuote: [...chosen, ...(answers.troubleOther ? [answers.troubleOther] : [])].join(", "),
    });
  }
  return drafts;
}
