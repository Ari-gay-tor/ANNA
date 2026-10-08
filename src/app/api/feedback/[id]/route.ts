import { AnnaError } from "@/core/domain/errors";
import { errorResponse, parseParams } from "@/server/http";
import { getServices } from "@/server/anna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await parseParams(context.params);
    if (!(await getServices().feedback.delete(id))) throw new AnnaError("NOT_FOUND", "Feedback not found.");
    return Response.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
