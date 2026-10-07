import { LLMError, type LLMProvider, type LLMRequest, type LLMResponse } from "./provider";

export interface NamedProvider {
  name: string;
  provider: LLMProvider;
}

/**
 * Tries providers in order. Moves to the next only when the failure says "this provider cannot
 * serve us right now": UNAVAILABLE or RATE_LIMITED. CONFIG, BLOCKED and BAD_RESPONSE stop the
 * chain, so a misconfiguration (even in a later provider) stays visible instead of being masked.
 * If every provider fails, the last error surfaces.
 */
export class FallbackProvider implements LLMProvider {
  constructor(
    private readonly providers: NamedProvider[],
    /** Called when a provider is skipped, e.g. to log it. Must not throw. */
    private readonly onSkip?: (skipped: { name: string; error: LLMError }) => void,
  ) {
    if (providers.length === 0) throw new LLMError("CONFIG", "No LLM providers configured.");
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    for (const [index, { name, provider }] of this.providers.entries()) {
      try {
        return await provider.generate(request);
      } catch (error) {
        const isLast = index === this.providers.length - 1;
        const movable = error instanceof LLMError && (error.kind === "UNAVAILABLE" || error.kind === "RATE_LIMITED");
        if (!movable || isLast) throw error;
        this.onSkip?.({ name, error });
      }
    }
    throw new LLMError("CONFIG", "No LLM providers configured."); // unreachable: constructor rejects an empty list
  }
}
