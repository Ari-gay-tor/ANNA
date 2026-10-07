// Config for `npm run eval` (behavior evals against the real provider). `npm test` uses vitest.config.mts and never runs these.
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

const EVAL_ENV_PREFIXES = ["ANNA_", "GEMINI_", "OPENAI_COMPAT_", "EVAL_"];

/** .env values only for the variables the evals use; variables already set in the shell win (ANNA_PROVIDER=fake npm run eval). */
function evalEnv(): Record<string, string> {
  const fromFile = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...fromFile, ...process.env })) {
    if (value !== undefined && EVAL_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) env[key] = value;
  }
  return env;
}

export default defineConfig({
  test: {
    include: ["evals/**/*.eval.ts"],
    globalSetup: ["evals/global-setup.ts"],
    env: evalEnv(),
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 120_000,
    fileParallelism: false,
    // Always show the [eval] progress lines (some environments default to a reporter that hides console output).
    reporters: ["default"],
  },
});
