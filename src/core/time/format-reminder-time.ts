// Display formatting for reminder times, always in the reminder's own timezone. Pure (Intl only, so the UI can use it).

const FALLBACK_ZONE = "UTC";

// U+202F (narrow no-break space, which newer ICU puts before AM/PM) and U+00A0, built from code points so the source stays plain ASCII.
const NARROW_SPACES = new RegExp(`[${String.fromCharCode(0x202f, 0xa0)}]`, "g");

function parts(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions): Record<string, string> {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, ...options });
  } catch {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: FALLBACK_ZONE, ...options });
  }
  const out: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) out[part.type] = part.value;
  return out;
}

/** "yyyy-MM-dd" of `date` in `timeZone`. */
function localDay(date: Date, timeZone: string): string {
  const p = parts(date, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** "6:00 PM". Newer ICU puts a narrow no-break space before PM; normalize it to a plain space. */
export function formatTimeOfDay(date: Date, timeZone: string): string {
  const p = parts(date, timeZone, { hour: "numeric", minute: "2-digit", hour12: true });
  return `${p.hour}:${p.minute} ${p.dayPeriod}`.replace(NARROW_SPACES, " ");
}

/** True when `date` falls on the same calendar day as `now` in `timeZone`. */
export function isSameLocalDay(date: Date, now: Date, timeZone: string): boolean {
  return localDay(date, timeZone) === localDay(now, timeZone);
}

/** "Today 6:00 PM", "Tomorrow 6:00 PM", or "Fri Oct 9, 6:00 PM" (with the year when it is not this year). */
export function formatReminderDue(dueAt: Date, timeZone: string, now: Date): string {
  const time = formatTimeOfDay(dueAt, timeZone);
  const day = localDay(dueAt, timeZone);
  const today = localDay(now, timeZone);
  if (day === today) return `Today ${time}`;
  if (day === nextDay(today)) return `Tomorrow ${time}`;
  const showYear = day.slice(0, 4) !== today.slice(0, 4);
  const p = parts(dueAt, timeZone, { weekday: "short", month: "short", day: "numeric", ...(showYear ? { year: "numeric" } : {}) });
  return `${p.weekday} ${p.month} ${p.day}${showYear ? ` ${p.year}` : ""}, ${time}`;
}
