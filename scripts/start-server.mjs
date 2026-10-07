// Starts the production server: `next start`, bound to 127.0.0.1 only, output appended to logs/anna.log.
//
//   npm run app:start            stays in the foreground until the server exits (Ctrl+C to stop)
//   node scripts/start-server.mjs --detach   starts the server in the background and returns (what start-anna.ps1 uses)
//
// Port: ANNA_PORT from the environment, else from .env, else 3737. Keep the port rules in step with
// src/server/app-config.ts and scripts/windows/common.ps1.

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR = join(ROOT, "logs");
const LOG_FILE = join(LOG_DIR, "anna.log");
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const DEFAULT_PORT = 3737;

function portFromEnvFile() {
  try {
    const text = readFileSync(join(ROOT, ".env"), "utf8");
    const match = text.match(/^\s*ANNA_PORT\s*=\s*["']?(\d+)["']?\s*(?:#.*)?$/m);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

function resolvePort() {
  const raw = (process.env.ANNA_PORT ?? portFromEnvFile() ?? "").trim();
  if (!/^\d+$/.test(raw)) return DEFAULT_PORT;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
}

/** One generation of history: logs/anna.log.1 holds the previous log once the current one passes 5 MB (checked at each start). */
function rotateLog() {
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_LOG_BYTES) {
      rmSync(`${LOG_FILE}.1`, { force: true });
      renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
  } catch {
    // Not worth failing the start over; the log just keeps growing.
  }
}

const detach = process.argv.includes("--detach");
const port = resolvePort();
const nextBin = join(ROOT, "node_modules", "next", "dist", "bin", "next");

mkdirSync(LOG_DIR, { recursive: true });
rotateLog();
const logFd = openSync(LOG_FILE, "a");
writeSync(logFd, `\n[anna] ---- starting ${new Date().toISOString()} on 127.0.0.1:${port} ----\n`);

const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: ROOT,
  stdio: ["ignore", logFd, logFd],
  windowsHide: true,
  detached: detach,
});
closeSync(logFd);

child.on("error", (error) => {
  console.error(`ANNA could not start: ${error.message}`);
  process.exit(1);
});

if (detach) {
  child.unref();
  // Give a spawn failure (the "error" event) a moment to show up before reporting success.
  setTimeout(() => process.exit(0), 300);
} else {
  console.log(`ANNA is starting on http://127.0.0.1:${port}/ (log: logs/anna.log). Press Ctrl+C to stop.`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill());
  child.on("exit", (code) => process.exit(code ?? 1));
}
