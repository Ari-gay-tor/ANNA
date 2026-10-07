// Shape of evals/cases.json. Strict on purpose: a typo in a check name must fail loudly, not silently skip the check.

import { z } from "zod";
import { MEMORY_ORIGINS, MEMORY_TYPES } from "../src/core/domain/memory";

export const OP_KINDS = [
  "memory.created",
  "memory.updated",
  "memory.rejected",
  "memory.skipped_duplicate",
  "reminder.created",
  "reminder.rejected",
] as const;
export type OpKind = (typeof OP_KINDS)[number];

const OpKindSchema = z.enum(OP_KINDS);

export const ChecksSchema = z.strictObject({
  /** Word limit for the stored reply. Default 80. */
  maxWords: z.number().int().positive().optional(),
  /** Limit on "?" characters in the stored reply (a clarification question counts). Default 1. */
  maxQuestions: z.number().int().min(0).optional(),
  expectClarification: z.union([z.boolean(), z.literal("either")]).optional(),
  /** Exact multiset of op kinds, or "any". */
  expectOps: z.union([z.array(OpKindSchema), z.literal("any")]).optional(),
  forbidOps: z.array(OpKindSchema).optional(),
  /** Case-insensitive substrings that must not appear in the reply. */
  forbiddenPhrases: z.array(z.string().min(1)).optional(),
  /** At least one of these case-insensitive substrings must appear in the reply. */
  requireAny: z.array(z.string().min(1)).optional(),
  /** Expected local "YYYY-MM-DD HH:mm" of the reminder that was created, in the case's timezone. */
  reminderDueLocal: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/).optional(),
});
export type Checks = z.infer<typeof ChecksSchema>;

const SeedMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1),
  /** Assistant messages only. "Not sure" is appended the same way the runtime does it. */
  clarification: z.strictObject({ question: z.string().min(1), options: z.array(z.string()) }).optional(),
  /** User messages only: the message came from a tapped option button. */
  selectedOption: z.boolean().optional(),
});
export type SeedMessage = z.infer<typeof SeedMessageSchema>;

const SeedMemorySchema = z.strictObject({
  type: z.enum(MEMORY_TYPES),
  statement: z.string().min(1),
  origin: z.enum(MEMORY_ORIGINS),
});
export type SeedMemory = z.infer<typeof SeedMemorySchema>;

export const SeedSchema = z.strictObject({
  /** IANA zone, saved as the user's timezone. Default "Asia/Kolkata". */
  timezone: z.string().min(1).optional(),
  memories: z.array(SeedMemorySchema).optional(),
  /** Earlier messages in the same conversation the turns continue. */
  messages: z.array(SeedMessageSchema).optional(),
  /** Other, older conversations (their messages are saved; memories are only what `memories` lists). */
  priorConversations: z.array(z.strictObject({ messages: z.array(SeedMessageSchema).min(1) })).optional(),
});
export type Seed = z.infer<typeof SeedSchema>;

const TurnSchema = z.strictObject({
  text: z.string().min(1),
  /** The text came from a tapped option button. */
  selectedOption: z.boolean().optional(),
  /** Checks for this turn. The case's own `checks` always apply to the last turn. */
  checks: ChecksSchema.optional(),
});
export type EvalTurn = z.infer<typeof TurnSchema>;

export const EvalCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  category: z.string().min(1),
  description: z.string().min(1),
  /** One sentence: what a good reply does, from the spec. */
  good: z.string().min(1),
  seed: SeedSchema.optional(),
  /** Local "YYYY-MM-DDTHH:mm" in the case's timezone. Default 2026-10-07T10:00. */
  now: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
  turns: z.array(TurnSchema).min(1),
  checks: ChecksSchema,
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const CasesFileSchema = z.array(EvalCaseSchema).superRefine((cases, ctx) => {
  const seen = new Set<string>();
  cases.forEach((c, index) => {
    if (seen.has(c.id)) ctx.addIssue({ code: "custom", message: `duplicate case id "${c.id}"`, path: [index, "id"] });
    seen.add(c.id);
  });
});

export const DEFAULT_TIMEZONE = "Asia/Kolkata";
export const DEFAULT_NOW_LOCAL = "2026-10-07T10:00";
