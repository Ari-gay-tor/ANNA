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

export function buildSystemPrompt(now: Date, timeZone: string): string {
  return `${SYSTEM_PROMPT}\n\n${buildContextBlock(now, timeZone)}`;
}
