import { z } from "zod";
import { normalizeTimeZone } from "@/core/domain/timezone";
import { TIMEZONE_SETTING_KEY } from "@/core/runtime/anna";
import { InvalidRequestError, errorResponse, parseBody } from "@/server/http";
import { getServices } from "@/server/anna";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TimezoneBody = z.object({ timezone: z.string().min(1).max(100) });

export async function PUT(request: Request): Promise<Response> {
  try {
    const { timezone } = await parseBody(request, TimezoneBody);
    const normalized = normalizeTimeZone(timezone);
    if (!normalized) throw new InvalidRequestError(`"${timezone}" is not a valid IANA timezone.`);
    await getServices().settings.set(TIMEZONE_SETTING_KEY, normalized);
    return Response.json({ timezone: normalized });
  } catch (error) {
    return errorResponse(error);
  }
}
