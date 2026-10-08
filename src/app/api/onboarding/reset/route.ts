import { errorResponse } from "@/server/http";
import { rejectIfNotLocal } from "@/server/local-only";
import { getServices } from "@/server/anna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Run setup again": setup shows on the next load. Saved answers and memories stay. */
export async function POST(request: Request): Promise<Response> {
  const blocked = rejectIfNotLocal(request, { json: true });
  if (blocked) return blocked;
  try {
    await getServices().onboarding.reset();
    return Response.json({ completed: false });
  } catch (error) {
    return errorResponse(error);
  }
}
