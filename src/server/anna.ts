// Composition root: reads env once and wires the runtime to Prisma and an LLM provider.

import { FakeProvider } from "../core/llm/fake";
import { GeminiProvider } from "../core/llm/gemini";
import { LLMError, type LLMProvider, type LLMRequest, type LLMResponse } from "../core/llm/provider";
import type { ConversationRepository, SettingsRepository } from "../core/ports";
import { createAnna, type Anna } from "../core/runtime/anna";
import { PrismaConversationRepository } from "../data/conversation-repository";
import { getPrisma } from "../data/prisma";
import { PrismaSettingsRepository } from "../data/settings-repository";

export interface Services {
  anna: Anna;
  conversations: ConversationRepository;
  settings: SettingsRepository;
}

const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const DEFAULT_GEMINI_FALLBACKS = "gemini-3.5-flash,gemini-3.5-flash-lite";

/** Reports a configuration problem at reply time (so the UI can show it) instead of crashing at startup. */
class MisconfiguredProvider implements LLMProvider {
  constructor(private readonly error: LLMError) {}
  async generate(_request: LLMRequest): Promise<LLMResponse> {
    throw this.error;
  }
}

export function createProvider(env: Record<string, string | undefined>): LLMProvider {
  const name = (env.ANNA_PROVIDER ?? "gemini").trim().toLowerCase() || "gemini";
  if (name === "fake") return new FakeProvider();
  if (name !== "gemini") {
    return new MisconfiguredProvider(new LLMError("CONFIG", `Unknown ANNA_PROVIDER "${name}". Use "gemini" or "fake".`));
  }
  try {
    return new GeminiProvider({
      apiKey: env.GEMINI_API_KEY ?? "",
      model: env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
      fallbackModels: env.GEMINI_FALLBACK_MODELS ?? DEFAULT_GEMINI_FALLBACKS,
    });
  } catch (error) {
    if (error instanceof LLMError) {
      const hint = error.message.includes("GEMINI_API_KEY") ? " Add it to .env and restart the server, or set ANNA_PROVIDER=fake." : "";
      return new MisconfiguredProvider(new LLMError("CONFIG", `${error.message}${hint}`));
    }
    throw error;
  }
}

const globalForServices = globalThis as unknown as { __annaServices?: Services };

/** One set of services per process, reused across Next dev hot reloads. */
export function getServices(): Services {
  if (!globalForServices.__annaServices) {
    const db = getPrisma();
    const conversations = new PrismaConversationRepository(db);
    const settings = new PrismaSettingsRepository(db);
    const anna = createAnna({ provider: createProvider(process.env), conversations, settings, clock: () => new Date() });
    globalForServices.__annaServices = { anna, conversations, settings };
  }
  return globalForServices.__annaServices;
}
