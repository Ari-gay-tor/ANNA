import { copyFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "../src/data/prisma";
import { PrismaConversationRepository } from "../src/data/conversation-repository";
import { PrismaSettingsRepository } from "../src/data/settings-repository";
import { FakeProvider } from "../src/core/llm/fake";
import { createAnna } from "../src/core/runtime/anna";

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
  const db = freshDb();
  const provider = new FakeProvider();
  const conversations = new PrismaConversationRepository(db);
  const settings = new PrismaSettingsRepository(db);
  const now = options.now ?? FIXED_NOW;
  const anna = createAnna({ provider, conversations, settings, clock: () => now });
  return { db, provider, conversations, settings, anna };
}

export const reply = (message: string) => JSON.stringify({ message });
