// Scripted fake provider. Tests enqueue responses or errors; with an empty queue it
// answers with a valid canned AnnaResponse (used by ANNA_PROVIDER=fake for offline UI work).

import type { LLMProvider, LLMRequest, LLMResponse } from "./provider";

export type FakeScriptItem = string | Error | ((request: LLMRequest) => string);

export class FakeProvider implements LLMProvider {
  /** Every request received, in order. */
  readonly calls: LLMRequest[] = [];
  private readonly queue: FakeScriptItem[];

  constructor(script: FakeScriptItem[] = []) {
    this.queue = [...script];
  }

  enqueue(...items: FakeScriptItem[]): this {
    this.queue.push(...items);
    return this;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    this.calls.push(request);
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    const text = typeof next === "function" ? next(request) : (next ?? cannedReply(request));
    return { text, model: "fake" };
  }
}

function cannedReply(request: LLMRequest): string {
  const last = [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const snippet = last.length > 80 ? `${last.slice(0, 80)}...` : last;
  return JSON.stringify({ message: `(fake provider) You said: ${snippet}` });
}
