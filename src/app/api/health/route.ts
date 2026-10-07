export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The launcher scripts call this to tell "ANNA is already running" from "another program has the port". */
export function GET(): Response {
  return Response.json({ ok: true, app: "anna" });
}
