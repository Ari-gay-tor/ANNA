import { z } from "zod";
import { NOTE_MAX_LENGTH } from "@/data/feedback-repository";
import { errorResponse, parseBody } from "@/server/http";
import { getServices } from "@/server/anna";
import { APP_VERSION } from "@/server/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FlagBody = z.object({
  messageId: z.string().min(1).max(100),
  note: z.string().trim().max(NOTE_MAX_LENGTH, `Keep it under ${NOTE_MAX_LENGTH} characters.`).optional(),
});

/** Every flagged item, newest first, with whether its conversation still exists. */
export async function GET(): Promise<Response> {
  try {
    const services = getServices();
    const items = await services.feedback.list();
    const existing = await services.conversations.existingIds([...new Set(items.map((i) => i.conversationId))]);
    return Response.json({
      version: APP_VERSION,
      items: items.map(({ context: _context, operations: _operations, ...item }) => ({ ...item, conversationExists: existing.has(item.conversationId) })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Flags an ANNA reply as not helpful. */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await parseBody(request, FlagBody);
    const { item, created } = await getServices().feedback.create({ messageId: body.messageId, note: body.note ?? "" });
    return Response.json({ feedback: { id: item.id, messageId: item.messageId, note: item.note }, created }, { status: created ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
