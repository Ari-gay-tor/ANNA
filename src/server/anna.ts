// Composition root: reads env once and wires the runtime to Prisma and an LLM provider.

import type { MemoryRepository, ReminderRepository, SettingsRepository } from "../core/ports";
import { createAnna, type Anna } from "../core/runtime/anna";
import { createMemoryService, type MemoryService } from "../core/runtime/memory-service";
import { createReminderService, type ReminderService } from "../core/runtime/reminder-service";
import { PrismaConversationRepository, type ManagedConversationRepository } from "../data/conversation-repository";
import { PrismaFeedbackRepository, type FeedbackRepository } from "../data/feedback-repository";
import { PrismaMemoryRepository } from "../data/memory-repository";
import { getPrisma } from "../data/prisma";
import { PrismaReminderRepository } from "../data/reminder-repository";
import { PrismaSettingsRepository } from "../data/settings-repository";
import { createProvider, withReplyLogging } from "./providers";

export interface Services {
  anna: Anna;
  conversations: ManagedConversationRepository;
  settings: SettingsRepository;
  memories: MemoryRepository;
  memoryService: MemoryService;
  reminders: ReminderRepository;
  reminderService: ReminderService;
  feedback: FeedbackRepository;
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
    const reminders = new PrismaReminderRepository(db);
    const clock = () => new Date();
    const provider = withReplyLogging(createProvider(process.env, log), log);
    const anna = createAnna({ provider, conversations, settings, memories, reminders, clock, log });
    globalForServices.__annaServices = {
      anna,
      conversations,
      settings,
      memories,
      memoryService: createMemoryService(memories),
      reminders,
      reminderService: createReminderService(reminders, clock),
      feedback: new PrismaFeedbackRepository(db),
    };
  }
  return globalForServices.__annaServices;
}

/**
 * Forgets the cached services, so the next getServices() reads the environment again. Used after a new API key is saved,
 * so it takes effect without a restart. The Prisma client is kept: it does not depend on the key.
 */
export function resetServices(): void {
  delete globalForServices.__annaServices;
}
