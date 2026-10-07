import type { ClientConversation, ClientMemory, ClientMessage } from "./types";

/** A failed API call. When the server saved the user's message before failing, it is attached. */
export class ApiFailure extends Error {
  constructor(
    readonly kind: string,
    message: string,
    readonly status: number,
    readonly conversationId?: string,
    readonly userMessage?: ClientMessage,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiFailure("NETWORK", "Could not reach the ANNA server. Is it running?", 0);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiFailure(
      body?.error?.kind ?? "INTERNAL",
      body?.error?.message ?? `Request failed (${response.status}).`,
      response.status,
      body?.conversationId,
      body?.userMessage,
    );
  }
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  listConversations: () => request<{ conversations: ClientConversation[] }>("/api/conversations"),
  getConversation: (id: string) =>
    request<{ conversation: ClientConversation; messages: ClientMessage[] }>(`/api/conversations/${encodeURIComponent(id)}`),
  chat: (conversationId: string | undefined, text: string, selectedOption?: boolean) =>
    request<{ conversationId: string; userMessage: ClientMessage; assistantMessage: ClientMessage }>(
      "/api/chat",
      json("POST", { conversationId, text, selectedOption: selectedOption || undefined }),
    ),
  retryReply: (conversationId: string) =>
    request<{ conversationId: string; assistantMessage: ClientMessage }>(
      `/api/conversations/${encodeURIComponent(conversationId)}/reply`,
      { method: "POST" },
    ),
  listMemories: () => request<{ memories: ClientMemory[] }>("/api/memories"),
  editMemory: (id: string, statement: string) =>
    request<{ memory: ClientMemory }>(`/api/memories/${encodeURIComponent(id)}`, json("PATCH", { statement })),
  deleteMemory: (id: string) => request<{ deleted: true }>(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" }),
  saveTimezone: (timezone: string) => request<{ timezone: string }>("/api/settings/timezone", json("PUT", { timezone })),
};
