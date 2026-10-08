import { z } from "zod";
import { AnnaError } from "@/core/domain/errors";
import { annotateOperations, reminderIdsIn } from "@/core/runtime/annotate-operations";
import { TITLE_MAX_LENGTH } from "@/core/runtime/anna";
import { errorResponse, parseBody } from "@/server/http";
import { getServices } from "@/server/anna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchBody = z.object({
  title: z
    .string()
    .trim()
    .min(1, "A title cannot be empty.")
    .max(TITLE_MAX_LENGTH, `A title can be at most ${TITLE_MAX_LENGTH} characters.`),
});

type Context = { params: Promise<{ id: string }> };

/** Rename a conversation. */
export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await parseBody(request, PatchBody);
    const conversation = await getServices().conversations.rename(id, body.title);
    if (!conversation) throw new AnnaError("NOT_FOUND", "Conversation not found.");
    return Response.json({ conversation });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Delete a conversation and its messages. Memories and reminders made from it stay. */
export async function DELETE(_request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!(await getServices().conversations.delete(id))) throw new AnnaError("NOT_FOUND", "Conversation not found.");
    return Response.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const conversation = await getServices().conversations.get(id);
    if (!conversation) throw new AnnaError("NOT_FOUND", "Conversation not found.");
    const { messages, ...rest } = conversation;
    // Chips need to know whether the memory they point at has since been forgotten, and where each reminder stands.
    const existingIds = new Set((await getServices().memories.list()).map((m) => m.id));
    const reminderStatuses = await getServices().reminderService.statuses(reminderIdsIn(messages));
    return Response.json({ conversation: rest, messages: annotateOperations(messages, existingIds, reminderStatuses) });
  } catch (error) {
    return errorResponse(error);
  }
}
