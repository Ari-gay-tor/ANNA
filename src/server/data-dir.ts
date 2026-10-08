// Which config file the running server saves settings to, and where the user's data lives.
// The launcher (scripts/anna-env.mjs) decides the mode and tells the server by setting ANNA_DATA_DIR in tester mode.

import { join } from "node:path";
import type { Env } from "./app-config";

export interface ActiveConfig {
  /** tester: no .env in the app folder, data in the data folder. dev: the app folder has a .env and nothing moved. */
  mode: "tester" | "dev";
  /** The file a saved setting (the Gemini key) is written to: config.env in the data folder, or .env in the app folder. */
  configFile: string;
  /** The data folder in tester mode, null in dev mode. */
  dataDir: string | null;
}

export function activeConfig(env: Env = process.env, cwd: string = process.cwd()): ActiveConfig {
  const dataDir = env.ANNA_DATA_DIR?.trim();
  if (dataDir) return { mode: "tester", configFile: join(dataDir, "config.env"), dataDir };
  return { mode: "dev", configFile: join(cwd, ".env"), dataDir: null };
}
