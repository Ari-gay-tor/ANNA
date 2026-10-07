import { z } from "zod";

export const REMINDER_STATUSES = ["pending", "fired", "cancelled"] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const MAX_REMINDER_TEXT_LENGTH = 200;
export const MIN_REMINDER_MINUTES = 1;
export const MAX_REMINDER_MINUTES = 10080; // 7 days

export interface Reminder {
  id: string;
  text: string;
  /** UTC instant. */
  dueAt: Date;
  /** IANA zone the time was resolved in; the UI formats the time in it. */
  timezone: string;
  status: ReminderStatus;
  firedAt: Date | null;
  /** True when the reminder fired more than 2 minutes late (the app was not running). */
  missed: boolean;
  acknowledgedAt: Date | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: Date;
}

/** A reminder is "missed" when it fires more than this long after it was due. */
export const MISSED_AFTER_MS = 2 * 60 * 1000;

/** What the model may propose. Exactly one of localDateTime / inMinutes must be present (checked by the refinement, not the provider schema). */
const ReminderOperationShape = z.object({
  text: z.string(),
  evidenceQuote: z.string(),
  /** Wall-clock time in the user's timezone, "YYYY-MM-DDTHH:mm". */
  localDateTime: z.string().optional(),
  /** Whole minutes from now. */
  inMinutes: z.number().int().optional(),
});

/** The provider-facing shape (no refinement, so the JSON Schema stays plain). */
export const ReminderOperationJsonShape = ReminderOperationShape;

export const ReminderOperationSchema = ReminderOperationShape.refine(
  (op) => (op.localDateTime !== undefined) !== (op.inMinutes !== undefined),
  { message: "exactly one of localDateTime or inMinutes is required" },
);

export type ReminderOperation = z.infer<typeof ReminderOperationSchema>;

// What the runtime stores on Message.operations (alongside the memory results). The UI renders chips from these.
export const ReminderCreatedResultSchema = z.object({
  kind: z.literal("reminder.created"),
  reminderId: z.string(),
  text: z.string(),
  /** ISO 8601 UTC. */
  dueAt: z.string(),
  timezone: z.string(),
});

export const ReminderRejectedResultSchema = z.object({
  kind: z.literal("reminder.rejected"),
  reason: z.string(),
});
