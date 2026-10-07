import type { Memory } from "../domain/memory";
import { SYSTEM_PROMPT } from "../prompts/system";

export const DEFAULT_TIMEZONE = "UTC";

/** "Wednesday 2026-10-07 15:42" in the given IANA zone. Falls back to UTC if the zone is unusable. */
export function formatLocalNow(now: Date, timeZone: string): { text: string; timeZone: string } {
  try {
    return { text: format(now, timeZone), timeZone };
  } catch {
    return { text: format(now, DEFAULT_TIMEZONE), timeZone: DEFAULT_TIMEZONE };
  }
}

function format(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function buildContextBlock(now: Date, timeZone: string): string {
  const local = formatLocalNow(now, timeZone);
  return [
    "Context:",
    `- Current local date and time: ${local.text}`,
    `- User timezone (IANA): ${local.timeZone}`,
  ].join("\n");
}

export const MEMORY_SECTION_HEADER =
  "What you know about the user (saved memories; use only when relevant; never claim to know anything not listed here or said in this conversation):";

/** YYYY-MM-DD in the given zone. Falls back to UTC if the zone is unusable. */
function formatLocalDate(date: Date, timeZone: string): string {
  const day = (zone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  try {
    return day(timeZone);
  } catch {
    return day(DEFAULT_TIMEZONE);
  }
}

/** One line per memory. Statements are flattened to a single line so they cannot fake extra list items. */
export function buildMemorySection(memories: readonly Memory[], timeZone: string): string {
  const lines =
    memories.length === 0
      ? ["- Nothing saved yet."]
      : memories.map((m) => {
          const statement = m.statement.replace(/\s+/g, " ").trim();
          return `- [${m.id}] (${m.type}, saved ${formatLocalDate(m.createdAt, timeZone)}) ${statement}`;
        });
  return [MEMORY_SECTION_HEADER, ...lines].join("\n");
}

/** `memories` must already be the selected set (see selectContextMemories). */
export function buildSystemPrompt(now: Date, timeZone: string, memories: readonly Memory[] = []): string {
  return [SYSTEM_PROMPT, buildContextBlock(now, timeZone), buildMemorySection(memories, timeZone)].join("\n\n");
}
