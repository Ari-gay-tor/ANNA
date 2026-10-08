import { errorResponse } from "@/server/http";
import { rejectIfNotLocal } from "@/server/local-only";
import { getServices } from "@/server/anna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Setup was finished or skipped: it stops showing. */
export async function POST(request: Request): Promise<Response> {
  const blocked = rejectIfNotLocal(request, { json: true });
  if (blocked) return blocked;
  try {
    await getServices().onboarding.complete();
    return Response.json({ completed: true });
  } catch (error) {
    return errorResponse(error);
  }
}
