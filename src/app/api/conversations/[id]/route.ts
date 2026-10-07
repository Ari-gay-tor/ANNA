import { AnnaError } from "@/core/domain/errors";
import { errorResponse } from "@/server/http";
import { getServices } from "@/server/anna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const conversation = await getServices().conversations.get(id);
    if (!conversation) throw new AnnaError("NOT_FOUND", "Conversation not found.");
    const { messages, ...rest } = conversation;
    return Response.json({ conversation: rest, messages });
  } catch (error) {
    return errorResponse(error);
  }
}
