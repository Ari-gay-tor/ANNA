import { z } from "zod";

/** What the model must return. Slice 1: a message only. */
export const AnnaResponseSchema = z.object({
  message: z.string().trim().min(1),
});

export type AnnaResponse = z.infer<typeof AnnaResponseSchema>;

/** JSON Schema handed to the provider. `$schema` is dropped because Gemini's schema field does not take it. */
export const ANNA_RESPONSE_JSON_SCHEMA: object = (() => {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(AnnaResponseSchema) as Record<string, unknown>;
  return schema;
})();
