// Runs one eval case: seeds a temp database, sends the turns through the real runtime, and checks the last turn.

import type { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import { PrismaConversationRepository } from "../src/data/conversation-repository";
import { PrismaMemoryRepository } from "../src/data/memory-repository";
import { PrismaReminderRepository } from "../src/data/reminder-repository";
import { PrismaSettingsRepository } from "../src/data/settings-repository";
import { EDITED_CONFIDENCE, INFERRED_DEFAULT_CONFIDENCE, STATED_CONFIDENCE, type MemoryOrigin } from "../src/core/domain/memory";
import { ReplyFailedError } from "../src/core/domain/errors";
import { LLMError } from "../src/core/llm/provider";
import { normalizeClarification } from "../src/core/runtime/clarification";
import { TIMEZONE_SETTING_KEY, createAnna } from "../src/core/runtime/anna";
import type { ConversationRepository } from "../src/core/ports";
import { countWords, runChecks, type CheckResult, type ReplyOutput } from "./checks";
import type { InstrumentedProvider } from "./instrument";
import { DEFAULT_NOW_LOCAL, DEFAULT_TIMEZONE, type Checks, type EvalCase, type SeedMessage } from "./types";

export interface TurnRecord {
  /** 1-based. */
  turn: number;
  text: string;
  selectedOption: boolean;
  /** The reply, or null when the provider failed. */
  reply: ReplyOutput | null;
  error: { kind: string; message: string } | null;
  /** Time spent in provider calls for this turn (a retry on invalid JSON counts), not counting pacing waits. */
  latencyMs: number;
  /** Provider calls made for this turn. */
  calls: number;
  model: string | null;
  words: number | null;
  /** Null when this turn was not checked. */
  checks: CheckResult[] | null;
}

export type CaseStatus = "pass" | "fail" | "error";

export interface CaseResult {
  case: EvalCase;
  status: CaseStatus;
  timeZone: string;
  /** The fixed clock, as local "YYYY-MM-DD HH:mm". */
  nowLocal: string;
  turns: TurnRecord[];
  /** Every check of every checked turn, in order. */
  checks: CheckResult[];
}

export interface RunCaseDeps {
  db: PrismaClient;
  /** Already paced and recording; see instrument(). */
  provider: InstrumentedProvider;
}

const NOW_FORMAT = "yyyy-MM-dd'T'HH:mm";

function fixedClock(c: EvalCase, timeZone: string): Date {
  const local = c.now ?? DEFAULT_NOW_LOCAL;
  const parsed = DateTime.fromFormat(local, NOW_FORMAT, { zone: timeZone });
  if (!parsed.isValid) throw new Error(`Case ${c.id}: cannot read now="${local}" in ${timeZone} (${parsed.invalidExplanation ?? "invalid"}).`);
  return parsed.toJSDate();
}

function confidenceFor(origin: MemoryOrigin): number {
  if (origin === "stated") return STATED_CONFIDENCE;
  if (origin === "edited") return EDITED_CONFIDENCE;
  return INFERRED_DEFAULT_CONFIDENCE;
}

async function seedMessages(conversations: ConversationRepository, conversationId: string, messages: readonly SeedMessage[]): Promise<void> {
  for (const m of messages) {
    await conversations.appendMessage({
      conversationId,
      role: m.role,
      content: m.content,
      clarification: m.clarification ? normalizeClarification(m.clarification) : null,
      selectedOption: m.selectedOption ?? false,
    });
  }
}

export async function runCase(c: EvalCase, deps: RunCaseDeps): Promise<CaseResult> {
  const { db, provider } = deps;
  const timeZone = c.seed?.timezone ?? DEFAULT_TIMEZONE;
  const now = fixedClock(c, timeZone);

  const conversations = new PrismaConversationRepository(db);
  const settings = new PrismaSettingsRepository(db);
  const memories = new PrismaMemoryRepository(db);
  const reminders = new PrismaReminderRepository(db);

  await settings.set(TIMEZONE_SETTING_KEY, timeZone);
  for (const m of c.seed?.memories ?? []) {
    await memories.create({
      type: m.type,
      statement: m.statement,
      confidence: confidenceFor(m.origin),
      origin: m.origin,
      evidenceQuote: null,
      sourceConversationId: null,
      sourceMessageId: null,
    });
  }
  for (const prior of c.seed?.priorConversations ?? []) {
    const first = prior.messages[0]!;
    const conversation = await conversations.create({ title: first.content.slice(0, 60) });
    await seedMessages(conversations, conversation.id, prior.messages);
  }

  let conversationId: string | undefined;
  if (c.seed?.messages && c.seed.messages.length > 0) {
    conversationId = (await conversations.create({ title: c.seed.messages[0]!.content.slice(0, 60) })).id;
    await seedMessages(conversations, conversationId, c.seed.messages);
  }

  // Seeding does not call the provider, but start the recording clean anyway.
  provider.drain();
  const anna = createAnna({ provider, conversations, settings, memories, reminders, clock: () => now });

  const turns: TurnRecord[] = [];
  const checks: CheckResult[] = [];
  let errored = false;

  for (const [index, turn] of c.turns.entries()) {
    const isLast = index === c.turns.length - 1;
    const record: TurnRecord = {
      turn: index + 1,
      text: turn.text,
      selectedOption: turn.selectedOption ?? false,
      reply: null,
      error: null,
      latencyMs: 0,
      calls: 0,
      model: null,
      words: null,
      checks: null,
    };

    try {
      const handled = await anna.handleMessage({ conversationId, text: turn.text, selectedOption: turn.selectedOption });
      conversationId = handled.conversationId;
      record.reply = {
        content: handled.assistantMessage.content,
        clarification: handled.assistantMessage.clarification,
        operations: handled.assistantMessage.operations,
      };
      record.words = countWords(record.reply.content);
    } catch (cause) {
      const underlying = cause instanceof ReplyFailedError ? cause.cause : cause;
      record.error =
        underlying instanceof LLMError
          ? { kind: underlying.kind, message: underlying.message }
          : { kind: "UNEXPECTED", message: underlying instanceof Error ? underlying.message : String(underlying) };
      errored = true;
    }

    const calls = provider.drain();
    record.calls = calls.length;
    record.latencyMs = calls.reduce((sum, call) => sum + call.ms, 0);
    record.model = [...calls].reverse().find((call) => call.model)?.model ?? null;

    const turnChecks: Checks | undefined = isLast ? c.checks : turn.checks;
    if (record.reply && turnChecks) {
      const labelled = c.turns.length > 1;
      record.checks = runChecks(record.reply, turnChecks, { timeZone }).map((r) => (labelled ? { ...r, turn: index + 1 } : r));
      checks.push(...record.checks);
    }
    turns.push(record);
    if (errored) break; // later turns depend on this reply
  }

  const status: CaseStatus = errored ? "error" : checks.every((r) => r.pass) ? "pass" : "fail";
  return { case: c, status, timeZone, nowLocal: DateTime.fromJSDate(now, { zone: timeZone }).toFormat("yyyy-MM-dd HH:mm"), turns, checks };
}
