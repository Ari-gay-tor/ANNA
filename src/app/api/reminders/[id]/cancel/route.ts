import { errorResponse, parseParams } from "@/server/http";
import { getServices } from "@/server/anna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 404 if the reminder does not exist, 409 if it is not pending any more. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await parseParams(context.params);
    return Response.json({ reminder: await getServices().reminderService.cancel(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
