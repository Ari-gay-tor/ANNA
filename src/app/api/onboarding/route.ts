import { errorResponse } from "@/server/http";
import { rejectIfNotLocal } from "@/server/local-only";
import { getOnboardingStatus } from "@/server/onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether first-run setup is done, whether it still needs a key, and the saved "About you" answers. Never a key. */
export async function GET(request: Request): Promise<Response> {
  const blocked = rejectIfNotLocal(request);
  if (blocked) return blocked;
  try {
    return Response.json(await getOnboardingStatus());
  } catch (error) {
    return errorResponse(error);
  }
}
