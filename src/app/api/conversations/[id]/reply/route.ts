import { errorResponse } from "@/server/http";
import { getServices } from "@/server/anna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Retry: generate the assistant reply for a conversation whose latest message is from the user. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const assistantMessage = await getServices().anna.generateReply(id);
    return Response.json({ conversationId: id, assistantMessage });
  } catch (error) {
    return errorResponse(error);
  }
}
