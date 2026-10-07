import { z } from "zod";
import { ClarificationSchema } from "./clarification";
import { MemoryOperationSchema } from "./memory";
import { ReminderOperationJsonShape, ReminderOperationSchema } from "./reminder";

const AnnaResponseObject = z.object({
  message: z.string().trim(),
  clarification: ClarificationSchema.optional(),
  memoryOperations: z.array(MemoryOperationSchema).optional(),
  // Plain shape here: the "exactly one of localDateTime / inMinutes" rule is enforced when the reply is parsed, not in the provider schema.
  reminderOperation: ReminderOperationJsonShape.optional(),
});

/**
 * What the model must return: a message, plus an optional clarification, optional memory operations and an optional
 * reminder operation (proposals only; the runtime decides). The message may be empty only when a clarification carries the question.
 */
export const AnnaResponseSchema = AnnaResponseObject.extend({ reminderOperation: ReminderOperationSchema.optional() }).refine((r) => r.message.length > 0 || r.clarification !== undefined, {
  message: "message must not be empty unless clarification is present",
  path: ["message"],
});

export type AnnaResponse = z.infer<typeof AnnaResponseSchema>;

/**
 * JSON Schema handed to the provider. `$schema` is dropped because Gemini's schema field does not take it.
 * Built from the plain object: the "non-empty unless clarification" rule is enforced by the parser, not the schema.
 */
export const ANNA_RESPONSE_JSON_SCHEMA: object = (() => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(AnnaResponseObject) as Record<string, unknown>;
  // zod adds safe-integer minimum/maximum to .int(); the provider schema only needs "integer", and the runtime checks the range.
  const inMinutes = (schema as { properties?: { reminderOperation?: { properties?: { inMinutes?: Record<string, unknown> } } } })
    .properties?.reminderOperation?.properties?.inMinutes;
  if (inMinutes) {
    delete inMinutes.minimum;
    delete inMinutes.maximum;
  }
  return schema;
})();
