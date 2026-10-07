import { AnnaError } from "@/core/domain/errors";
import { annotateOperations } from "@/core/runtime/annotate-operations";
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
    // Chips need to know whether the memory they point at has since been forgotten.
    const existingIds = new Set((await getServices().memories.list()).map((m) => m.id));
    return Response.json({ conversation: rest, messages: annotateOperations(messages, existingIds) });
  } catch (error) {
    return errorResponse(error);
  }
}
