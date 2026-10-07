import { errorResponse, parseParams } from "@/server/http";
import { getServices } from "@/server/anna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dismisses a fired reminder. 404 if unknown, 409 if it has not fired. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await parseParams(context.params);
    return Response.json({ reminder: await getServices().reminderService.acknowledge(id) });
  } catch (error) {
    return errorResponse(error);
  }
}
