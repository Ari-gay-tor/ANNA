import { describe, expect, it } from "vitest";
import { GET } from "../src/app/api/health/route";

describe("GET /api/health", () => {
  it("answers { ok: true, app: 'anna' } so the launcher can tell ANNA from another program on the port", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, app: "anna" });
  });
});
