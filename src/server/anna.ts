// Composition root: reads env once and wires the runtime to Prisma and an LLM provider.

import type { ConversationRepository, MemoryRepository, SettingsRepository } from "../core/ports";
import { createAnna, type Anna } from "../core/runtime/anna";
import { createMemoryService, type MemoryService } from "../core/runtime/memory-service";
import { PrismaConversationRepository } from "../data/conversation-repository";
import { PrismaMemoryRepository } from "../data/memory-repository";
import { getPrisma } from "../data/prisma";
import { PrismaSettingsRepository } from "../data/settings-repository";
import { createProvider, withReplyLogging } from "./providers";

export interface Services {
  anna: Anna;
  conversations: ConversationRepository;
  settings: SettingsRepository;
  memories: MemoryRepository;
  memoryService: MemoryService;
}

const log = (line: string) => console.log(line);

const globalForServices = globalThis as unknown as { __annaServices?: Services };

/** One set of services per process, reused across Next dev hot reloads. */
export function getServices(): Services {
  if (!globalForServices.__annaServices) {
    const db = getPrisma();
    const conversations = new PrismaConversationRepository(db);
    const settings = new PrismaSettingsRepository(db);
    const memories = new PrismaMemoryRepository(db);
    const provider = withReplyLogging(createProvider(process.env, log), log);
    const anna = createAnna({ provider, conversations, settings, memories, clock: () => new Date(), log });
    globalForServices.__annaServices = { anna, conversations, settings, memories, memoryService: createMemoryService(memories) };
  }
  return globalForServices.__annaServices;
}
