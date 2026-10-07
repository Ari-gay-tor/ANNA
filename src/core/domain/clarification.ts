import { z } from "zod";

/** What the model may propose: one question and optional answer options. The runtime normalizes the options. */
export const ClarificationSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).optional(),
});

export type ClarificationProposal = z.infer<typeof ClarificationSchema>;

/** What the runtime stores on an assistant message (Message.clarification) and the UI renders. `options` always ends with "Not sure". */
export const StoredClarificationSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string()),
});

export type Clarification = z.infer<typeof StoredClarificationSchema>;

/** Parses stored clarification JSON. Anything unreadable yields null rather than an error. */
export function parseStoredClarification(raw: string | null): Clarification | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = StoredClarificationSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
