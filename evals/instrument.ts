// Wraps a provider to pace calls and record what each call did (which model answered, how long it took).

import type { LLMProvider, LLMRequest, LLMResponse } from "../src/core/llm/provider";

export interface CallRecord {
  /** The model that answered. Undefined when the call failed. */
  model?: string;
  /** Time spent inside the provider, not counting the pacing wait. */
  ms: number;
  ok: boolean;
}

export interface InstrumentedProvider extends LLMProvider {
  /** Calls made since the last drain, oldest first. */
  drain(): CallRecord[];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `delayMs` is the minimum gap between the end of one call and the start of the next (the first call never waits).
 * Errors are recorded and rethrown unchanged.
 */
export function instrument(inner: LLMProvider, delayMs: number): InstrumentedProvider {
  let pending: CallRecord[] = [];
  let lastEnded: number | null = null;

  return {
    async generate(request: LLMRequest): Promise<LLMResponse> {
      if (lastEnded !== null && delayMs > 0) {
        const wait = lastEnded + delayMs - Date.now();
        if (wait > 0) await sleep(wait);
      }
      const start = Date.now();
      try {
        const response = await inner.generate(request);
        pending.push({ model: response.model, ms: Date.now() - start, ok: true });
        return response;
      } catch (error) {
        pending.push({ ms: Date.now() - start, ok: false });
        throw error;
      } finally {
        lastEnded = Date.now();
      }
    },
    drain() {
      const records = pending;
      pending = [];
      return records;
    },
  };
}
