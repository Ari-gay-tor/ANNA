import { z } from "zod";
import { MAX_STATEMENT_LENGTH } from "@/core/domain/memory";
import { errorResponse, parseBody } from "@/server/http";
import { getServices } from "@/server/anna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchBody = z.object({
  statement: z
    .string()
    .trim()
    .min(1, "A memory cannot be empty.")
    .max(MAX_STATEMENT_LENGTH, `A memory can be at most ${MAX_STATEMENT_LENGTH} characters.`),
});

type Context = { params: Promise<{ id: string }> };

/** Edit the wording. The runtime marks the memory as edited by the user (confidence 1.0). */
export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await parseBody(request, PatchBody);
    return Response.json({ memory: await getServices().memoryService.edit(id, body.statement) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    await getServices().memoryService.remove(id);
    return Response.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
