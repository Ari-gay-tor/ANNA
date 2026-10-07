// Composition root: reads env once and wires the runtime to Prisma and an LLM provider.

import type { ConversationRepository, SettingsRepository } from "../core/ports";
import { createAnna, type Anna } from "../core/runtime/anna";
import { PrismaConversationRepository } from "../data/conversation-repository";
import { getPrisma } from "../data/prisma";
import { PrismaSettingsRepository } from "../data/settings-repository";
import { createProvider, withReplyLogging } from "./providers";

export interface Services {
  anna: Anna;
  conversations: ConversationRepository;
  settings: SettingsRepository;
}

const log = (line: string) => console.log(line);

const globalForServices = globalThis as unknown as { __annaServices?: Services };

/** One set of services per process, reused across Next dev hot reloads. */
export function getServices(): Services {
  if (!globalForServices.__annaServices) {
    const db = getPrisma();
    const conversations = new PrismaConversationRepository(db);
    const settings = new PrismaSettingsRepository(db);
    const provider = withReplyLogging(createProvider(process.env, log), log);
    const anna = createAnna({ provider, conversations, settings, clock: () => new Date() });
    globalForServices.__annaServices = { anna, conversations, settings };
  }
  return globalForServices.__annaServices;
}
