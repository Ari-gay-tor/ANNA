import { copyFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "../src/data/prisma";
import { PrismaConversationRepository } from "../src/data/conversation-repository";
import { PrismaMemoryRepository } from "../src/data/memory-repository";
import { PrismaSettingsRepository } from "../src/data/settings-repository";
import { FakeProvider } from "../src/core/llm/fake";
import { createAnna } from "../src/core/runtime/anna";
import { createMemoryService } from "../src/core/runtime/memory-service";

const TEMPLATE_DIR = join(process.cwd(), "node_modules", ".anna-test");

/** A private copy of the migrated template database. */
export function freshDb(): PrismaClient {
  const file = join(TEMPLATE_DIR, `${randomUUID()}.db`);
  copyFileSync(join(TEMPLATE_DIR, "template.db"), file);
  return createPrismaClient(`file:${file.replace(/\\/g, "/")}`);
}

export const FIXED_NOW = new Date("2026-10-07T15:42:00Z");

/** Anna wired to a temp DB and a scripted fake provider, with a fixed clock. */
export function testAnna(options: { now?: Date } = {}) {
  const logs: string[] = [];
  const db = freshDb();
  const provider = new FakeProvider();
  const conversations = new PrismaConversationRepository(db);
  const settings = new PrismaSettingsRepository(db);
  const memories = new PrismaMemoryRepository(db);
  const now = options.now ?? FIXED_NOW;
  const anna = createAnna({ provider, conversations, settings, memories, clock: () => now, log: (line) => logs.push(line) });
  return { db, provider, conversations, settings, memories, memoryService: createMemoryService(memories), anna, logs };
}

export const reply = (message: string) => JSON.stringify({ message });

/** A model reply carrying memory operations. */
export const replyWithOps = (message: string, memoryOperations: unknown[]) => JSON.stringify({ message, memoryOperations });

/** A model reply carrying a clarification (and optionally other top-level fields such as memoryOperations). */
export const replyWithClarification = (message: string, clarification: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ message, clarification, ...extra });
