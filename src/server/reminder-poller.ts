// Fires due reminders while the server is running. Started once from src/instrumentation.ts.

import { fireDueReminders } from "../core/runtime/fire-due-reminders";
import { getPrisma } from "../data/prisma";
import { PrismaReminderRepository } from "../data/reminder-repository";

export const POLL_INTERVAL_MS = 15_000;

type Log = (line: string) => void;

/**
 * Wraps `run` so that a tick is skipped while the previous one is still running, and so that
 * errors are logged instead of thrown (an unhandled rejection in a timer would take the server down).
 */
export function createGuardedTick(run: () => Promise<void>, log: Log): () => Promise<void> {
  let inFlight = false;
  return async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await run();
    } catch (error) {
      log(`[anna] reminder poller error: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      inFlight = false;
    }
  };
}

const globalForPoller = globalThis as unknown as { __annaReminderPoller?: boolean };

/** Runs once now, then every 15 s. Calling it again (e.g. after a hot reload) does nothing. */
export function startReminderPoller(log: Log = (line) => console.log(line)): void {
  if (globalForPoller.__annaReminderPoller) return;
  globalForPoller.__annaReminderPoller = true;

  // Deliberately not getServices(): the poller starts from instrumentation.ts, which Next bundles separately from the route
  // handlers. If it created the shared services, their error classes would be a different copy from the ones http.ts checks
  // with instanceof, and every route error would turn into a 500. The Prisma client is shared (it lives on globalThis).
  const reminders = new PrismaReminderRepository(getPrisma());
  const tick = createGuardedTick(async () => {
    const fired = await fireDueReminders({ reminders, now: new Date() });
    if (fired.length > 0) log(`[anna] fired ${fired.length} reminder(s)`);
  }, log);

  void tick();
  setInterval(() => void tick(), POLL_INTERVAL_MS).unref?.();
  log("[anna] reminder poller started");
}
