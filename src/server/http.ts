// Shared helpers for route handlers: body parsing and error-to-JSON mapping.

import type { z } from "zod";
import { AnnaError, ReplyFailedError, type AnnaErrorKind } from "../core/domain/errors";
import { LLMError, type LLMErrorKind } from "../core/llm/provider";

const LLM_STATUS: Record<LLMErrorKind, number> = {
  UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  BLOCKED: 422,
  BAD_RESPONSE: 502,
  CONFIG: 500,
};

const ANNA_STATUS: Record<AnnaErrorKind, number> = {
  NOT_FOUND: 404,
  REPLY_NOT_NEEDED: 409,
  INVALID_INPUT: 400,
};

/** Thrown by parseBody; mapped to a 400. */
export class InvalidRequestError extends Error {}

export async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new InvalidRequestError("Request body must be valid JSON.");
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw new InvalidRequestError(`${where}${issue?.message ?? "Invalid request body."}`);
  }
  return result.data;
}

/**
 * Maps any thrown value to `{ error: { kind, message } }`.
 * If a user message was saved before the failure, `conversationId` and `userMessage` are included
 * so the client can show Retry against the right conversation.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof ReplyFailedError) {
    const { status, kind, message } = describe(error.cause);
    return Response.json(
      { error: { kind, message }, conversationId: error.conversationId, userMessage: error.userMessage },
      { status },
    );
  }
  const { status, kind, message } = describe(error);
  return Response.json({ error: { kind, message } }, { status });
}

function describe(error: unknown): { status: number; kind: string; message: string } {
  if (error instanceof LLMError) return { status: LLM_STATUS[error.kind], kind: error.kind, message: error.message };
  if (error instanceof AnnaError) return { status: ANNA_STATUS[error.kind], kind: error.kind, message: error.message };
  if (error instanceof InvalidRequestError) return { status: 400, kind: "INVALID_REQUEST", message: error.message };
  console.error("Unexpected error:", error instanceof Error ? error.message : error);
  return { status: 500, kind: "INTERNAL", message: "Something went wrong on the server." };
}
