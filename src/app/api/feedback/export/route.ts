import { errorResponse } from "@/server/http";
import { getServices } from "@/server/anna";
import { exportFileName, renderFeedbackExport } from "@/server/feedback-export";
import { rejectIfNotLocal } from "@/server/local-only";
import { APP_VERSION } from "@/server/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The "Export for Ari" download: anna-feedback-<date>.md with only the flagged items (and the turns just before them). */
export async function GET(request: Request): Promise<Response> {
  const blocked = rejectIfNotLocal(request);
  if (blocked) return blocked;
  try {
    const now = new Date();
    const body = renderFeedbackExport(await getServices().feedback.list(), { version: APP_VERSION, now });
    return new Response(body, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFileName(now)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
