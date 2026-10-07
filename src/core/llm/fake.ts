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

/** Typing a message that contains this word makes the canned reply a clarification (for trying the option buttons offline). */
export const FAKE_CLARIFY_TRIGGER = "clarify";

function cannedReply(request: LLMRequest): string {
  const last = [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  if (last.toLowerCase().includes(FAKE_CLARIFY_TRIGGER)) {
    return JSON.stringify({
      message: "",
      clarification: { question: "What are you stuck on?", options: ["Finding opportunities", "Applications", "Interview preparation", "Something else"] },
    });
  }
  const snippet = last.length > 80 ? `${last.slice(0, 80)}...` : last;
  return JSON.stringify({ message: `(fake provider) You said: ${snippet}` });
}
