// ANNA's server listens on 127.0.0.1 only, so no other PC can reach it. This is the second wall, for requests that do come from
// this PC: a web page open in the browser must not be able to read or change the key (cross-site requests, DNS rebinding).

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

function hostnameOf(host: string): string {
  return host.replace(/:\d+$/, "").toLowerCase();
}

/** True when the request names a loopback host, is not cross-site, and (for a body) is JSON. */
export function isLocalRequest(request: Request, options: { json?: boolean } = {}): boolean {
  const host = request.headers.get("host");
  if (!host || !LOCAL_HOSTNAMES.has(hostnameOf(host))) return false;

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== host.toLowerCase()) return false;
    } catch {
      return false;
    }
  }
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;

  if (options.json && !/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) return false;
  return true;
}

/** A 403 response when the request is not local, otherwise null. */
export function rejectIfNotLocal(request: Request, options: { json?: boolean } = {}): Response | null {
  if (isLocalRequest(request, options)) return null;
  return Response.json({ error: { kind: "FORBIDDEN", message: "ANNA only accepts this from this PC." } }, { status: 403 });
}
