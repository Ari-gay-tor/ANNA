import { errorResponse } from "@/server/http";
import { getServices } from "@/server/anna";
import { desktopToastsEnabled } from "@/server/app-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reminders that have fired and not been dismissed. The banner polls this.
 * `serverToasts` tells the page the server shows Windows toasts itself, so the page must not also show its own notification.
 */
export async function GET(): Promise<Response> {
  try {
    return Response.json({ reminders: await getServices().reminderService.due(), serverToasts: desktopToastsEnabled() });
  } catch (error) {
    return errorResponse(error);
  }
}
