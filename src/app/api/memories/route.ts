import { errorResponse } from "@/server/http";
import { getServices } from "@/server/anna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ memories: await getServices().memoryService.list() });
  } catch (error) {
    return errorResponse(error);
  }
}
