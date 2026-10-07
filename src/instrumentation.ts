// Next calls register() once when the server starts (next dev and next start).
export async function register(): Promise<void> {
  // The poller uses Prisma, which cannot run in the edge runtime, so import it only under Node.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startReminderPoller } = await import("./server/reminder-poller");
    startReminderPoller();
  }
}
