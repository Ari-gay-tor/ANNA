import { AnnaResponseSchema, type AnnaResponse } from "../domain/anna-response";

export const FALLBACK_REPLY = "Sorry — I had trouble forming a reply. Could you say that again?";

/** Parses and validates raw model text. Returns null if it is not a valid AnnaResponse. */
export function parseAnnaResponse(text: string): AnnaResponse | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const result = AnnaResponseSchema.safeParse(json);
  return result.success ? result.data : null;
}

/** Plain-text reply used when the model never produced valid JSON. */
export function fallbackReply(rawText: string): string {
  const text = rawText.trim();
  return text && !looksLikeJson(text) ? text : FALLBACK_REPLY;
}

function looksLikeJson(text: string): boolean {
  return text.startsWith("{") || text.startsWith("[") || text.startsWith("```");
}
