// Turns a reminder time the model proposed into a UTC instant, in the user's saved timezone. Pure: the caller passes `now`.

import { DateTime, IANAZone } from "luxon";
import { MAX_REMINDER_MINUTES, MIN_REMINDER_MINUTES } from "../domain/reminder";
import { normalizeTimeZone } from "../domain/timezone";

export const LOCAL_DATE_TIME_FORMAT = "yyyy-MM-dd'T'HH:mm";

/** A reminder due this soon (or sooner) counts as already passed. */
export const MIN_LEAD_MS = 30_000;
export const MAX_LEAD_MS = 365 * 24 * 60 * 60 * 1000;

export const REASON_NO_TIMEZONE = "I don't know your timezone yet";
export const REASON_PASSED = "that time has already passed";
export const REASON_TOO_FAR = "that's more than a year away";
export const REASON_NONEXISTENT_TIME = "that time doesn't exist in your timezone (the clocks change then)";
export const REASON_UNREADABLE_TIME = "I couldn't read that date and time";
export const REASON_BAD_MINUTES = `I can only set "in N minutes" reminders from ${MIN_REMINDER_MINUTES} minute to 7 days; give a date and time instead`;
export const REASON_NO_TIME = "there was no time to set it for";

export interface ResolveReminderTimeInput {
  /** "YYYY-MM-DDTHH:mm" wall-clock time in `timeZone`. */
  localDateTime?: string;
  /** Whole minutes from `now`. */
  inMinutes?: number;
  /** IANA zone. Missing or invalid is rejected. */
  timeZone: string | undefined;
  now: Date;
}

export type ResolveReminderTimeResult = { ok: true; dueAt: Date } | { ok: false; reason: string };

const fail = (reason: string): ResolveReminderTimeResult => ({ ok: false, reason });

export function resolveReminderTime(input: ResolveReminderTimeInput): ResolveReminderTimeResult {
  const { localDateTime, inMinutes, timeZone, now } = input;
  // normalizeTimeZone rejects offsets like "+05:30", which luxon would otherwise accept as a zone.
  if (!timeZone || !normalizeTimeZone(timeZone) || !IANAZone.isValidZone(timeZone)) return fail(REASON_NO_TIMEZONE);

  let dueMs: number;
  if (inMinutes !== undefined) {
    if (!Number.isInteger(inMinutes) || inMinutes < MIN_REMINDER_MINUTES || inMinutes > MAX_REMINDER_MINUTES) {
      return fail(REASON_BAD_MINUTES);
    }
    dueMs = now.getTime() + inMinutes * 60_000;
  } else if (localDateTime !== undefined) {
    const resolved = resolveLocal(localDateTime, timeZone);
    if (!resolved.ok) return resolved;
    dueMs = resolved.ms;
  } else {
    return fail(REASON_NO_TIME);
  }

  if (dueMs <= now.getTime() + MIN_LEAD_MS) return fail(REASON_PASSED);
  if (dueMs - now.getTime() > MAX_LEAD_MS) return fail(REASON_TOO_FAR);
  return { ok: true, dueAt: new Date(dueMs) };
}

/**
 * Wall-clock time in a zone to an instant.
 * - Strict parse: exactly `yyyy-MM-dd'T'HH:mm`, a real calendar date.
 * - A time inside a spring-forward gap does not exist: luxon would silently shift it, so we look for an instant
 *   whose local wall time equals the input and reject when there is none.
 * - A time repeated by a fall-back happens twice: we take the earlier instant.
 */
function resolveLocal(text: string, timeZone: string): { ok: true; ms: number } | { ok: false; reason: string } {
  const wall = DateTime.fromFormat(text, LOCAL_DATE_TIME_FORMAT, { zone: "utc" });
  if (!wall.isValid || wall.toFormat(LOCAL_DATE_TIME_FORMAT) !== text) return { ok: false, reason: REASON_UNREADABLE_TIME };

  // The wall time read as if it were UTC. The real instant is that minus the zone's offset at that moment.
  // A zone changes offset at most once near any given moment, so the offsets a day either side cover both
  // sides of a transition.
  const wallMs = wall.toMillis();
  const offsetsMinutes = new Set(
    [-24, 24].map((hours) => DateTime.fromMillis(wallMs + hours * 3_600_000, { zone: timeZone }).offset),
  );
  const matches = [...offsetsMinutes]
    .map((offset) => wallMs - offset * 60_000)
    .filter((ms) => DateTime.fromMillis(ms, { zone: timeZone }).toFormat(LOCAL_DATE_TIME_FORMAT) === text)
    .sort((a, b) => a - b);

  const earliest = matches[0];
  return earliest === undefined ? { ok: false, reason: REASON_NONEXISTENT_TIME } : { ok: true, ms: earliest };
}
