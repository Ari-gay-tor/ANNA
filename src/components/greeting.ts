// The start screen's greeting, from the local clock. A plain function so it can be tested.

/** "Good morning" before noon, "Good afternoon" until 6 pm, otherwise "Good evening" (local clock). */
export function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
