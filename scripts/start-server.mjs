// Starts the production server: `next start`, bound to 127.0.0.1 only, output appended to anna.log.
//
//   npm run app:start            stays in the foreground until the server exits (Ctrl+C to stop)
//   node scripts/start-server.mjs --detach   starts the server in the background and returns (what start-anna.ps1 uses)
//
// Dev mode (the app folder has a .env) and tester mode (it does not: data lives in %LOCALAPPDATA%\ANNA) are described in
// scripts/anna-env.mjs. In tester mode config.env is loaded and passed to the server as environment variables, together with
// DATABASE_URL pointing at anna.db in the data folder. The log is logs/anna.log in the app folder (dev) or in the data folder (tester).
// Port: ANNA_PORT from the environment, else from the config file, else 3737. Keep the port rules in step with
// src/server/app-config.ts and scripts/windows/common.ps1.

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuntime } from "./anna-env.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = loadRuntime(ROOT);
const LOG_DIR = runtime.logDir;
const LOG_FILE = join(LOG_DIR, "anna.log");
const MAX_LOG_BYTES = 5 * 1024 * 1024;

/** One generation of history: anna.log.1 holds the previous log once the current one passes 5 MB (checked at each start). */
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
const port = runtime.port;
const nextBin = join(ROOT, "node_modules", "next", "dist", "bin", "next");
const where = runtime.dataDir ? `tester mode, data in ${runtime.dataDir}` : "dev mode";

mkdirSync(LOG_DIR, { recursive: true });
rotateLog();
const logFd = openSync(LOG_FILE, "a");
writeSync(logFd, `\n[anna] ---- starting ${new Date().toISOString()} on 127.0.0.1:${port} (${where}) ----\n`);

const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: ROOT,
  env: runtime.vars,
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
  console.log(`ANNA is starting on http://127.0.0.1:${port}/ (log: ${LOG_FILE}). Press Ctrl+C to stop.`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill());
  child.on("exit", (code) => process.exit(code ?? 1));
}
