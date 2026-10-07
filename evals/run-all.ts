// Runs cases one after another, each on its own fresh database, and stops early when the provider is clearly unusable.

import type { LLMProvider } from "../src/core/llm/provider";
import { instrument } from "./instrument";
import type { EvalDb } from "./db";
import { runCase, type CaseResult } from "./run-case";
import type { EvalCase } from "./types";

/** Two quota errors in a row means the free quota is gone, so further calls would only fail too. */
export const MAX_CONSECUTIVE_RATE_LIMITS = 2;

export interface RunAllOptions {
  cases: readonly EvalCase[];
  provider: LLMProvider;
  /** Minimum gap between provider calls. */
  delayMs: number;
  makeDb: () => EvalDb;
  onCaseDone?: (result: CaseResult, position: { index: number; total: number }) => void;
}

export interface RunSummary {
  results: CaseResult[];
  /** Ids that were not run because the run stopped early. */
  notRun: string[];
  /** Why the run stopped early, or null if every case ran. */
  stoppedReason: string | null;
}

export async function runAll(options: RunAllOptions): Promise<RunSummary> {
  const { cases, delayMs, makeDb, onCaseDone } = options;
  const provider = instrument(options.provider, delayMs);
  const results: CaseResult[] = [];
  let consecutiveRateLimits = 0;
  let stoppedReason: string | null = null;

  for (const [index, c] of cases.entries()) {
    const { db, dispose } = makeDb();
    let result: CaseResult;
    try {
      result = await runCase(c, { db, provider });
    } finally {
      await dispose();
    }
    results.push(result);
    onCaseDone?.(result, { index, total: cases.length });

    const error = result.turns.find((t) => t.error)?.error;
    consecutiveRateLimits = error?.kind === "RATE_LIMITED" ? consecutiveRateLimits + 1 : 0;
    if (error?.kind === "CONFIG") {
      stoppedReason = `Stopped after "${c.id}": the provider is misconfigured (${error.message})`;
    } else if (consecutiveRateLimits >= MAX_CONSECUTIVE_RATE_LIMITS) {
      stoppedReason = `Stopped after "${c.id}": ${MAX_CONSECUTIVE_RATE_LIMITS} RATE_LIMITED errors in a row (provider quota is exhausted)`;
    }
    if (stoppedReason) break;
  }

  return { results, notRun: cases.slice(results.length).map((c) => c.id), stoppedReason };
}
