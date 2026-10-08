// Shared helpers for route handlers: body parsing and error-to-JSON mapping.

import { z } from "zod";
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
  CONFLICT: 409,
};

export const KEY_MISSING_MESSAGE = "ANNA doesn't have a Gemini key yet. Add one in Settings.";
export const KEY_REJECTED_MESSAGE = "ANNA's Gemini key isn't working. Update it in Settings.";

/** Tells the screen to offer a link to Settings next to the message. */
export type ErrorAction = "settings";

// `instanceof` is not enough here: Next can load the core modules more than once (the instrumentation hook that starts the
// reminder poller builds the services, a route handler maps their errors), and then a class from one copy is not an
// instance of the other. The error's own name is the same in every copy.
function isNamed<T extends Error>(error: unknown, name: string, ctor: abstract new (...args: never[]) => T): error is T {
  return error instanceof ctor || (error instanceof Error && error.name === name);
}

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

const IdParams = z.object({ id: z.string().min(1).max(100) });

/** Validates the `[id]` route param. Mapped to a 400 when unusable. */
export async function parseParams(params: Promise<{ id: string }>): Promise<{ id: string }> {
  const result = IdParams.safeParse(await params);
  if (!result.success) throw new InvalidRequestError("id: a valid id is required.");
  return result.data;
}

/**
 * Maps any thrown value to `{ error: { kind, message } }`.
 * If a user message was saved before the failure, `conversationId` and `userMessage` are included
 * so the client can show Retry against the right conversation.
 */
export function errorResponse(error: unknown): Response {
  if (isNamed(error, "ReplyFailedError", ReplyFailedError)) {
    const { status, kind, message, action } = describe(error.cause);
    return Response.json(
      { error: { kind, message, action }, conversationId: error.conversationId, userMessage: error.userMessage },
      { status },
    );
  }
  const { status, kind, message, action } = describe(error);
  return Response.json({ error: { kind, message, action } }, { status });
}

/**
 * A CONFIG failure about the Gemini key (missing, or rejected by Google) becomes a message the person can act on, with a
 * link to Settings. The provider's own text names an environment variable, which means nothing to a tester.
 */
function geminiKeyProblem(error: LLMError): string | null {
  if (error.kind !== "CONFIG" || !error.message.includes("GEMINI_API_KEY")) return null;
  return error.message.includes("not set") ? KEY_MISSING_MESSAGE : KEY_REJECTED_MESSAGE;
}

function describe(error: unknown): { status: number; kind: string; message: string; action?: ErrorAction } {
  if (isNamed(error, "LLMError", LLMError)) {
    const keyProblem = geminiKeyProblem(error);
    if (keyProblem) return { status: LLM_STATUS[error.kind], kind: error.kind, message: keyProblem, action: "settings" };
    return { status: LLM_STATUS[error.kind], kind: error.kind, message: error.message };
  }
  if (isNamed(error, "AnnaError", AnnaError)) return { status: ANNA_STATUS[error.kind], kind: error.kind, message: error.message };
  if (error instanceof InvalidRequestError) return { status: 400, kind: "INVALID_REQUEST", message: error.message };
  console.error("Unexpected error:", error instanceof Error ? error.message : error);
  return { status: 500, kind: "INTERNAL", message: "Something went wrong on the server." };
}
