import { errorResponse } from "@/server/http";
import { getServices } from "@/server/anna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pending reminders (soonest first) and those fired or cancelled in the last 7 days (newest first). */
export async function GET(): Promise<Response> {
  try {
    return Response.json(await getServices().reminderService.list());
  } catch (error) {
    return errorResponse(error);
  }
}
