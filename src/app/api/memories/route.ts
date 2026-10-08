import { errorResponse } from "@/server/http";
import { getServices } from "@/server/anna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every memory, plus `sourceExists`: whether the conversation it came from is still there. Deleting a conversation
 * keeps its memories, so the Memory page uses this to show "from a deleted conversation" instead of a dead link.
 */
export async function GET(): Promise<Response> {
  try {
    const services = getServices();
    const memories = await services.memoryService.list();
    const sourceIds = [...new Set(memories.flatMap((m) => (m.sourceConversationId ? [m.sourceConversationId] : [])))];
    const existing = await services.conversations.existingIds(sourceIds);
    return Response.json({
      memories: memories.map((m) => ({ ...m, sourceExists: m.sourceConversationId !== null && existing.has(m.sourceConversationId) })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
