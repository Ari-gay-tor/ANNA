import { z } from "zod";
import { errorResponse, parseBody } from "@/server/http";
import { getServices } from "@/server/anna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ChatBody = z.object({
  conversationId: z.string().min(1).optional(),
  text: z.string().trim().min(1, "Message is empty.").max(8000, "Message is too long (max 8000 characters)."),
});

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, ChatBody);
    const result = await getServices().anna.handleMessage(body);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
