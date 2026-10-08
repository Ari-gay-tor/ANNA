// Dev mode vs tester mode: where the data lives (scripts/anna-env.mjs, which the launcher uses, and src/server/data-dir.ts).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { activeConfig } from "../src/server/data-dir";

type Runtime = { mode: string; dataDir: string | null; configFile: string; logDir: string; port: number; vars: Record<string, string> };
let anna: {
  loadRuntime: (root: string, env: Record<string, string | undefined>, platform: string, home: string) => Runtime;
  resolveMode: (root: string, env: Record<string, string | undefined>, platform: string, home: string) => { mode: string; dataDir: string | null };
  databaseUrlFor: (file: string) => string;
};
beforeAll(async () => {
  anna = (await import(pathToFileURL(join(process.cwd(), "scripts", "anna-env.mjs")).href)) as typeof anna;
});

const dirs: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "anna-mode-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const LOCAL = "C:\\Users\\tester\\AppData\\Local";

describe("resolveMode", () => {
  it("an app folder with no .env is tester mode, with the data in %LOCALAPPDATA%\\ANNA", () => {
    const root = temp();
    expect(anna.resolveMode(root, { LOCALAPPDATA: LOCAL }, "win32", "C:\\Users\\tester")).toEqual({ mode: "tester", dataDir: join(LOCAL, "ANNA") });
  });

  it("an app folder with a .env is dev mode and nothing moves (Ari's repo)", () => {
    const root = temp();
    writeFileSync(join(root, ".env"), "GEMINI_API_KEY=abc\n");
    expect(anna.resolveMode(root, { LOCALAPPDATA: LOCAL }, "win32", "C:\\Users\\tester")).toEqual({ mode: "dev", dataDir: null });
  });

  it("ANNA_DATA_DIR overrides the folder, and means tester mode even when a .env exists", () => {
    const root = temp();
    expect(anna.resolveMode(root, { ANNA_DATA_DIR: "D:\\scratch\\data" }, "win32", "x")).toEqual({ mode: "tester", dataDir: "D:\\scratch\\data" });
    writeFileSync(join(root, ".env"), "A=1\n");
    expect(anna.resolveMode(root, { ANNA_DATA_DIR: "D:\\scratch\\data" }, "win32", "x").mode).toBe("tester");
    expect(anna.resolveMode(root, { ANNA_DATA_DIR: "   " }, "win32", "x").mode).toBe("dev"); // blank is not an override
  });

  it("falls back to AppData\\Local when LOCALAPPDATA is not set", () => {
    const root = temp();
    expect(anna.resolveMode(root, {}, "win32", "C:\\Users\\tester").dataDir).toBe(join("C:\\Users\\tester", "AppData", "Local", "ANNA"));
  });
});

describe("loadRuntime", () => {
  it("tester mode: config.env is loaded, DATABASE_URL points at anna.db in the data folder, logs go there too", () => {
    const root = temp();
    const data = join(temp(), "ANNA data"); // a space in the path, as in many Windows user names
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.env"), "GEMINI_API_KEY=file-key-1234\nANNA_PORT=3747\nDATABASE_URL=file:./elsewhere.db\n");
    const runtime = anna.loadRuntime(root, { ANNA_DATA_DIR: data, PATH: "p" }, "win32", "h");
    expect(runtime.mode).toBe("tester");
    expect(runtime.port).toBe(3747);
    expect(runtime.configFile).toBe(join(data, "config.env"));
    expect(runtime.logDir).toBe(join(data, "logs"));
    expect(runtime.vars.GEMINI_API_KEY).toBe("file-key-1234");
    expect(runtime.vars.ANNA_DATA_DIR).toBe(data);
    expect(runtime.vars.PATH).toBe("p");
    // Forced: a stray DATABASE_URL (in config.env or the environment) can never point ANNA at another database.
    expect(runtime.vars.DATABASE_URL).toBe(anna.databaseUrlFor(join(data, "anna.db")));
    expect(runtime.vars.DATABASE_URL).toMatch(/^file:.*ANNA data\/anna\.db$/);
    expect(anna.loadRuntime(root, { ANNA_DATA_DIR: data, DATABASE_URL: "file:./x.db" }, "win32", "h").vars.DATABASE_URL).toBe(runtime.vars.DATABASE_URL);
  });

  it("tester mode: a variable that is already set wins over config.env (the same rule as ANNA_PORT today)", () => {
    const root = temp();
    const data = temp();
    writeFileSync(join(data, "config.env"), "GEMINI_API_KEY=file-key\nANNA_PORT=3747\n");
    const runtime = anna.loadRuntime(root, { ANNA_DATA_DIR: data, GEMINI_API_KEY: "env-key", ANNA_PORT: "4100" }, "win32", "h");
    expect(runtime.vars.GEMINI_API_KEY).toBe("env-key");
    expect(runtime.port).toBe(4100);
  });

  it("tester mode with no config.env yet: default port, nothing breaks", () => {
    const runtime = anna.loadRuntime(temp(), { ANNA_DATA_DIR: temp() }, "win32", "h");
    expect(runtime.port).toBe(3737);
    expect(runtime.vars.GEMINI_API_KEY).toBeUndefined();
  });

  it("dev mode is exactly as before: port from .env, logs in the app folder, environment passed through untouched", () => {
    const root = temp();
    writeFileSync(join(root, ".env"), 'DATABASE_URL="file:./dev.db"\nANNA_PORT=4100\n');
    const runtime = anna.loadRuntime(root, { PATH: "p" }, "win32", "h");
    expect(runtime).toMatchObject({ mode: "dev", dataDir: null, port: 4100, logDir: join(root, "logs"), configFile: join(root, ".env") });
    expect(runtime.vars).toEqual({ PATH: "p" });
  });

  it.each(["abc", "0", "65536", "-1", ""])("an unusable ANNA_PORT %j falls back to 3737", (port) => {
    expect(anna.loadRuntime(temp(), { ANNA_DATA_DIR: temp(), ANNA_PORT: port }, "win32", "h").port).toBe(3737);
  });
});

describe("activeConfig (what the running server saves settings to)", () => {
  it("tester: config.env in the data folder named by ANNA_DATA_DIR", () => {
    expect(activeConfig({ ANNA_DATA_DIR: "D:\\data" }, "D:\\app")).toEqual({ mode: "tester", configFile: join("D:\\data", "config.env"), dataDir: "D:\\data" });
  });

  it("dev: the .env in the app folder", () => {
    expect(activeConfig({}, "D:\\app")).toEqual({ mode: "dev", configFile: join("D:\\app", ".env"), dataDir: null });
  });
});
