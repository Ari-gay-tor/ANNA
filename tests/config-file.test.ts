import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseEnvText, readEnvFile, setEnvValue, writeEnvValue } from "../src/server/config-file";

const dirs: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "anna-config-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SAMPLE = [
  "# ANNA settings",
  "ANNA_PROVIDER=gemini",
  "GEMINI_API_KEY=old-key-0000",
  'GEMINI_MODEL="gemini-3.8-flash"   # primary',
  "",
  "# ANNA_PORT=4100",
  "ANNA_PORT=3747",
  "",
].join("\n");

describe("parseEnvText", () => {
  it("reads NAME=value lines, drops quotes and trailing comments, ignores comment lines", () => {
    expect(parseEnvText(SAMPLE)).toEqual({
      ANNA_PROVIDER: "gemini",
      GEMINI_API_KEY: "old-key-0000",
      GEMINI_MODEL: "gemini-3.8-flash",
      ANNA_PORT: "3747",
    });
  });

  it("handles CRLF files and a later line winning over an earlier one", () => {
    expect(parseEnvText("A=1\r\nB=2\r\nA=3\r\n")).toEqual({ A: "3", B: "2" });
  });

  it("agrees with the launcher's own parser (scripts/anna-env.mjs) on the same text", async () => {
    const mod = (await import(pathToFileURL(join(process.cwd(), "scripts", "anna-env.mjs")).href)) as { parseEnvText: (text: string) => Record<string, string> };
    for (const text of [SAMPLE, SAMPLE.replace(/\n/g, "\r\n"), "export X='a b'\nY=\nZ = 5 # five\n"]) {
      expect(mod.parseEnvText(text)).toEqual(parseEnvText(text));
    }
  });
});

describe("setEnvValue", () => {
  it("replaces the existing line and leaves every other line exactly as it was", () => {
    const next = setEnvValue(SAMPLE, "GEMINI_API_KEY", "new-key-1111");
    expect(next).toBe(SAMPLE.replace("old-key-0000", "new-key-1111"));
  });

  it("does not touch a commented-out line with the same name", () => {
    const next = setEnvValue(SAMPLE, "ANNA_PORT", "4000");
    expect(next).toContain("# ANNA_PORT=4100");
    expect(parseEnvText(next).ANNA_PORT).toBe("4000");
  });

  it("appends a missing setting after the last line", () => {
    const next = setEnvValue("A=1\nB=2\n", "GEMINI_API_KEY", "k1234567");
    expect(next).toBe("A=1\nB=2\nGEMINI_API_KEY=k1234567\n");
  });

  it("creates the content for an empty file, and keeps CRLF line endings", () => {
    expect(setEnvValue("", "A", "1")).toBe("A=1\n");
    expect(setEnvValue("A=1\r\nB=2\r\n", "B", "3")).toBe("A=1\r\nB=3\r\n");
    expect(setEnvValue("A=1\r\n", "C", "3")).toBe("A=1\r\nC=3\r\n");
  });

  it("refuses a value with a line break (it could add a second setting) and a bad name", () => {
    expect(() => setEnvValue("", "A", "x\nB=2")).toThrow();
    expect(() => setEnvValue("", "A B", "x")).toThrow();
  });
});

describe("writeEnvValue / readEnvFile (the config file on disk)", () => {
  it("round trip: a written key reads back, and the other lines are preserved", () => {
    const file = join(temp(), "config.env");
    writeFileSync(file, SAMPLE, "utf8");
    writeEnvValue(file, "GEMINI_API_KEY", "round-trip-9999");
    expect(readEnvFile(file).GEMINI_API_KEY).toBe("round-trip-9999");
    expect(readFileSync(file, "utf8")).toBe(SAMPLE.replace("old-key-0000", "round-trip-9999"));
    expect(readEnvFile(file).ANNA_PORT).toBe("3747");
  });

  it("creates the file and its folder when they do not exist yet, and a second write replaces the first", () => {
    const file = join(temp(), "ANNA data", "config.env");
    expect(readEnvFile(file)).toEqual({});
    writeEnvValue(file, "GEMINI_API_KEY", "first-key-1");
    writeEnvValue(file, "GEMINI_API_KEY", "second-key-2");
    expect(readFileSync(file, "utf8")).toBe("GEMINI_API_KEY=second-key-2\n");
  });
});
