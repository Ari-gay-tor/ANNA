import { activeConfig } from "@/server/data-dir";
import { errorResponse, parseBody } from "@/server/http";
import { GeminiKeyBody, MESSAGES, keyStatus, setupRequired, updateGeminiKey } from "@/server/key-setup";
import { rejectIfNotLocal } from "@/server/local-only";
import { resetServices } from "@/server/anna";
import { APP_VERSION } from "@/server/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether setup is needed, the last 4 characters of the saved key (never the key), and where the data lives. */
export function GET(request: Request): Response {
  const blocked = rejectIfNotLocal(request);
  if (blocked) return blocked;
  const config = activeConfig();
  return Response.json({
    required: setupRequired(process.env),
    ...keyStatus(process.env),
    mode: config.mode,
    dataDir: config.dataDir,
    version: APP_VERSION,
  });
}

/** Checks a Gemini key with one tiny real call and, if it works (or only today's quota is used up), saves it and starts using it. */
export async function PUT(request: Request): Promise<Response> {
  const blocked = rejectIfNotLocal(request, { json: true });
  if (blocked) return blocked;
  try {
    const { key } = await parseBody(request, GeminiKeyBody);
    const result = await updateGeminiKey(key, {
      configFile: activeConfig().configFile,
      env: process.env,
      resetServices,
      log: (line) => console.log(line),
    });
    switch (result.status) {
      case "valid":
        return Response.json({ saved: true, status: "valid", ...keyStatus(process.env) });
      case "quota":
        return Response.json({ saved: true, status: "quota", message: MESSAGES.quota, ...keyStatus(process.env) });
      case "invalid":
        return Response.json({ error: { kind: "CONFIG", message: MESSAGES.invalid } }, { status: 422 });
      case "unreachable":
        return Response.json({ error: { kind: "UNAVAILABLE", message: MESSAGES.unreachable } }, { status: 503 });
      case "save_failed":
        return Response.json({ error: { kind: "INTERNAL", message: MESSAGES.saveFailed } }, { status: 500 });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
