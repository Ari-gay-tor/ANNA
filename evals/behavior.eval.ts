// `npm run eval`: runs evals/cases.json against the real provider (createProvider(process.env)) and writes
// evals/reports/<YYYY-MM-DD-HHmm>.md. Not part of `npm test`.
//
// Env: EVAL_ONLY=<id,id> runs a subset; EVAL_DELAY_MS sets the gap between provider calls (default 4000).
// Exit code: 0 when every case got a reply (failed behavior checks are reported, not errors); non-zero when the provider
// failed on any case or the run stopped early, because then the report is incomplete.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProvider } from "../src/server/providers";
import { freshEvalDb } from "./db";
import { loadCases } from "./load-cases";
import { buildReport, describeProviderChain, reportStamp } from "./report";
import { runAll } from "./run-all";

const DEFAULT_DELAY_MS = 4000;
const REPORT_DIR = join(process.cwd(), "evals", "reports");

function parseDelay(raw: string | undefined): number {
  if (!raw?.trim()) return DEFAULT_DELAY_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`EVAL_DELAY_MS must be a whole number of milliseconds (got "${raw}").`);
  return value;
}

function reportPath(date: Date): string {
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = reportStamp(date);
  let path = join(REPORT_DIR, `${stamp}.md`);
  // Two runs in the same minute must not overwrite each other.
  for (let n = 2; existsSync(path); n++) path = join(REPORT_DIR, `${stamp}-${n}.md`);
  return path;
}

describe("behavior evals", () => {
  it("runs the cases and writes a report", async () => {
    const all = loadCases();
    const only = process.env.EVAL_ONLY?.split(",").map((id) => id.trim()).filter(Boolean) ?? null;
    if (only) {
      const unknown = only.filter((id) => !all.some((c) => c.id === id));
      if (unknown.length > 0) throw new Error(`EVAL_ONLY names unknown case id(s): ${unknown.join(", ")}`);
    }
    const cases = only ? all.filter((c) => only.includes(c.id)) : all;
    const delayMs = parseDelay(process.env.EVAL_DELAY_MS);
    const date = new Date();

    const summary = await runAll({
      cases,
      provider: createProvider(process.env, (line) => console.log(line)),
      delayMs,
      makeDb: freshEvalDb,
      onCaseDone: (result, { index, total }) => {
        const error = result.turns.find((t) => t.error)?.error;
        const latency = result.turns.reduce((sum, t) => sum + t.latencyMs, 0);
        console.log(`[eval] ${index + 1}/${total} ${result.case.id}: ${result.status.toUpperCase()}${error ? ` (${error.kind})` : ""} ${latency} ms`);
      },
    });

    const path = reportPath(date);
    writeFileSync(path, buildReport(summary, { date, providerChain: describeProviderChain(process.env), delayMs, only, totalCases: cases.length }), "utf8");
    const passed = summary.results.filter((r) => r.status === "pass").length;
    console.log(`[eval] ${passed}/${summary.results.length} passed. Report: ${path}`);

    const errored = summary.results.filter((r) => r.status === "error").map((r) => r.case.id);
    expect(errored, "cases that got no reply because the provider failed (the report is incomplete)").toEqual([]);
    expect(summary.stoppedReason, "the run stopped early; the report is partial").toBeNull();
  }, 60 * 60 * 1000);
});
