/**
 * Returns the canonical-case IANA name for `value` (e.g. "america/new_york" -> "America/New_York"),
 * or null if it is not a real IANA zone. Offsets like "+05:30" are rejected on purpose.
 *
 * `resolvedOptions().timeZone` rewrites some names to legacy aliases (Asia/Kolkata ->
 * Asia/Calcutta in Node), so we keep the name as given unless we can fix only its case.
 */
export function normalizeTimeZone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /^[+\-\d]/.test(trimmed)) return null;
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  const lower = trimmed.toLowerCase();
  const sameNameDifferentCase = resolved.toLowerCase() === lower ? resolved : undefined;
  return Intl.supportedValuesOf("timeZone").find((zone) => zone.toLowerCase() === lower) ?? sameNameDifferentCase ?? trimmed;
}
