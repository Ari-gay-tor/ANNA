import { errorResponse } from "@/server/http";
import { getServices } from "@/server/anna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reminders that have fired and not been dismissed. The banner polls this. */
export async function GET(): Promise<Response> {
  try {
    return Response.json({ reminders: await getServices().reminderService.due() });
  } catch (error) {
    return errorResponse(error);
  }
}
