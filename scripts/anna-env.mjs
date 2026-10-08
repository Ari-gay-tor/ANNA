// Where ANNA keeps its data, and what config it runs with. Used by scripts/start-server.mjs and tested in tests/data-dir.test.ts.
//
// Two modes:
//   dev     the app folder has a .env (Ari's repo). Nothing changes: .env, prisma/dev.db and logs/ stay in the folder.
//   tester  the app folder has no .env. Data lives outside it, in the data folder (default %LOCALAPPDATA%\ANNA):
//             anna.db      the SQLite database
//             config.env   GEMINI_API_KEY, ANNA_PORT and other settings
//             logs\        anna.log
//           so extracting a newer zip over (or next to) the old folder never touches it.
// ANNA_DATA_DIR overrides the folder and always means tester mode (it is how the installer is tried out in a scratch folder).
//
// Keep the rules in step with scripts/windows/common.ps1 (Get-AnnaMode) and src/server/app-config.ts (resolvePort).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 3737;

/** `NAME=value` lines of an env file. Quotes are removed; a trailing ` # comment` is cut off an unquoted value. Later lines win. */
export function parseEnvText(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim();
    const quote = value[0];
    const end = (quote === '"' || quote === "'") && value.length >= 2 ? value.indexOf(quote, 1) : -1;
    out[match[1]] = end > 0 ? value.slice(1, end) : value.replace(/\s+#.*$/, "").trim();
  }
  return out;
}

function readEnvFile(path) {
  try {
    return parseEnvText(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** The default data folder: %LOCALAPPDATA%\ANNA on Windows (a ~/.anna folder elsewhere, for developers). */
export function defaultDataDir(env = process.env, platform = process.platform, home = homedir()) {
  const local = env.LOCALAPPDATA?.trim();
  if (local) return join(local, "ANNA");
  return platform === "win32" ? join(home, "AppData", "Local", "ANNA") : join(home, ".anna");
}

/** `file:` URL Prisma accepts for a SQLite file, with forward slashes. */
export function databaseUrlFor(dbFile) {
  return `file:${dbFile.replace(/\\/g, "/")}`;
}

/** { mode: "dev" } or { mode: "tester", dataDir } for an app folder. */
export function resolveMode(root, env = process.env, platform = process.platform, home = homedir()) {
  const override = env.ANNA_DATA_DIR?.trim();
  if (override) return { mode: "tester", dataDir: override };
  if (existsSync(join(root, ".env"))) return { mode: "dev", dataDir: null };
  return { mode: "tester", dataDir: defaultDataDir(env, platform, home) };
}

function validPort(raw) {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

/**
 * Everything the launcher needs.
 *   vars     the environment for the Next process: process.env, plus (tester mode) config.env underneath it
 *            and ANNA_DATA_DIR + DATABASE_URL on top. A variable that is already set wins over config.env.
 *   logDir   where anna.log goes
 *   port     ANNA_PORT from the environment, else from the config file, else 3737
 */
export function loadRuntime(root, env = process.env, platform = process.platform, home = homedir()) {
  const { mode, dataDir } = resolveMode(root, env, platform, home);
  if (mode === "dev") {
    const fileVars = readEnvFile(join(root, ".env"));
    return { mode, dataDir: null, configFile: join(root, ".env"), logDir: join(root, "logs"), port: validPort(env.ANNA_PORT ?? fileVars.ANNA_PORT) ?? DEFAULT_PORT, vars: { ...env } };
  }
  const configFile = join(dataDir, "config.env");
  const fileVars = readEnvFile(configFile);
  const vars = {
    ...fileVars,
    ...Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)),
    ANNA_DATA_DIR: dataDir,
    DATABASE_URL: databaseUrlFor(join(dataDir, "anna.db")),
  };
  return { mode, dataDir, configFile, logDir: join(dataDir, "logs"), port: validPort(env.ANNA_PORT ?? fileVars.ANNA_PORT) ?? DEFAULT_PORT, vars };
}
