import { SetupAnswersSchema } from "@/core/domain/setup";
import { errorResponse, parseBody } from "@/server/http";
import { rejectIfNotLocal } from "@/server/local-only";
import { getServices } from "@/server/anna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Saves the "About you" answers: validated here, then turned into memories (source "setup") by the core. */
export async function POST(request: Request): Promise<Response> {
  const blocked = rejectIfNotLocal(request, { json: true });
  if (blocked) return blocked;
  try {
    const answers = await parseBody(request, SetupAnswersSchema);
    return Response.json(await getServices().onboarding.saveAnswers(answers));
  } catch (error) {
    return errorResponse(error);
  }
}
