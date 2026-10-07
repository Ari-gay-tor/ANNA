import type { Message } from "./types";

export type AnnaErrorKind =
  /** Conversation does not exist. */
  | "NOT_FOUND"
  /** generateReply was called but the latest message is not from the user. */
  | "REPLY_NOT_NEEDED"
  /** Caller passed unusable input (e.g. empty text). */
  | "INVALID_INPUT"
  /** The thing exists but is not in a state that allows this action (e.g. cancelling a reminder that already fired). */
  | "CONFLICT";

export class AnnaError extends Error {
  constructor(
    readonly kind: AnnaErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AnnaError";
  }
}

/**
 * handleMessage saved the user's message but could not produce a reply.
 * `cause` is the underlying LLMError (or an unexpected error). The conversation id
 * and user message are attached so the UI can offer Retry without losing them.
 */
export class ReplyFailedError extends Error {
  constructor(
    readonly conversationId: string,
    readonly userMessage: Message,
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : "Could not generate a reply.");
    this.name = "ReplyFailedError";
  }
}
