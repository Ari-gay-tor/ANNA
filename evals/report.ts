// Turns a finished (or partial) run into the Markdown report Ari reads. Pure: no files, no clock besides what is passed in.

import { DateTime } from "luxon";
import type { OperationResult } from "../src/core/domain/memory";
import { DEFAULT_GEMINI_FALLBACKS, DEFAULT_GEMINI_MODEL, parseProviderNames } from "../src/server/providers";
import { LOCAL_FORMAT } from "./checks";
import type { CaseResult, TurnRecord } from "./run-case";
import type { RunSummary } from "./run-all";

export interface ReportMeta {
  /** Real wall-clock time of the run (not the fixed eval clock). */
  date: Date;
  providerChain: string;
  delayMs: number;
  /** The EVAL_ONLY ids, when a subset was requested. */
  only: readonly string[] | null;
  totalCases: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-07-1530", machine-local time. */
export function reportStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** Which providers and models are configured. Never includes keys. */
export function describeProviderChain(env: Record<string, string | undefined>): string {
  return parseProviderNames(env.ANNA_PROVIDER)
    .map((name) => {
      if (name === "gemini") {
        const primary = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
        const fallbacks = (env.GEMINI_FALLBACK_MODELS ?? DEFAULT_GEMINI_FALLBACKS)
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean);
        return `gemini (${[primary, ...fallbacks.filter((m) => m !== primary)].join(" -> ")})`;
      }
      if (name === "openai-compatible") return `openai-compatible (${env.OPENAI_COMPAT_MODEL?.trim() || "model not set"})`;
      return name;
    })
    .join(" -> ");
}

const percent = (part: number, whole: number) => (whole === 0 ? "n/a" : `${Math.round((part / whole) * 100)}%`);

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
}

export function describeOp(op: OperationResult, timeZone: string): string {
  switch (op.kind) {
    case "memory.created":
      return `memory.created [${op.type}] "${op.statement}"`;
    case "memory.updated":
      return `memory.updated "${op.previousStatement}" -> "${op.statement}"`;
    case "memory.rejected":
      return `memory.rejected (${op.origin}): ${op.reason}`;
    case "memory.skipped_duplicate":
      return `memory.skipped_duplicate "${op.statement}"`;
    case "reminder.created":
      return `reminder.created "${op.text}" due ${DateTime.fromISO(op.dueAt, { zone: timeZone }).toFormat(LOCAL_FORMAT)} ${timeZone} (${op.dueAt})`;
    case "reminder.rejected":
      return `reminder.rejected: ${op.reason}`;
  }
}

function statusLine(r: CaseResult): string {
  if (r.status === "pass") return "✅ PASS";
  if (r.status === "fail") return "❌ FAIL";
  const error = r.turns.find((t) => t.error)?.error;
  return `❌ ERROR (${error?.kind ?? "unknown"}): no reply to check`;
}

function seedLines(r: CaseResult): string[] {
  const seed = r.case.seed;
  const lines = [`Setup: timezone ${r.timeZone}, fixed clock ${r.nowLocal} local.`, ""];
  for (const m of seed?.memories ?? []) lines.push(`- Seeded memory [${m.type}, ${m.origin}]: ${m.statement}`);
  for (const [i, prior] of (seed?.priorConversations ?? []).entries()) {
    lines.push(`- Seeded earlier conversation ${i + 1}:`);
    for (const m of prior.messages) lines.push(`  - ${m.role}: ${m.content}`);
  }
  if (seed?.messages?.length) {
    lines.push("- Seeded earlier messages in this conversation:");
    for (const m of seed.messages) {
      const extra = [m.selectedOption ? "tapped option" : "", m.clarification ? `options: ${m.clarification.options.join(" / ")} / Not sure` : ""].filter(Boolean);
      lines.push(`  - ${m.role}${extra.length ? ` (${extra.join("; ")})` : ""}: ${m.content}`);
    }
  }
  return lines;
}

function turnBlock(t: TurnRecord, timeZone: string): string[] {
  const lines = [`**Turn ${t.turn}, user${t.selectedOption ? " (tapped option)" : ""}:**`, "", quote(t.text), ""];
  if (t.error || !t.reply) {
    lines.push(`**ANNA:** no reply. Provider error ${t.error?.kind ?? "unknown"}: ${t.error?.message ?? ""}`, "");
    return lines;
  }
  const { reply } = t;
  lines.push(
    `**ANNA** (${t.words} words, ${t.latencyMs} ms${t.calls > 1 ? `, ${t.calls} provider calls` : ""}, model ${t.model ?? "unknown"}):`,
    "",
    quote(reply.content),
    "",
  );
  if (reply.clarification) {
    lines.push(`Clarification question: ${reply.clarification.question}`, `Options: ${reply.clarification.options.join(" | ")}`, "");
  }
  lines.push(reply.operations.length === 0 ? "Ops: none" : "Ops:");
  for (const op of reply.operations) lines.push(`- ${describeOp(op, timeZone)}`);
  lines.push("");
  return lines;
}

function caseSection(r: CaseResult): string[] {
  const c = r.case;
  const lines = [`### ${statusLine(r)} \`${c.id}\` (${c.category})`, "", c.description, "", `Good looks like: ${c.good}`, "", ...seedLines(r), ""];
  for (const t of r.turns) lines.push(...turnBlock(t, r.timeZone));
  const unsent = c.turns.length - r.turns.length;
  if (unsent > 0) lines.push(`(${unsent} later turn(s) not sent because an earlier turn failed.)`, "");
  lines.push("Checks:", "");
  if (r.checks.length === 0) lines.push("- (none ran: no reply was produced)");
  for (const check of r.checks) lines.push(`- ${check.pass ? "✅" : "❌"} ${check.turn ? `[turn ${check.turn}] ` : ""}${check.name}: ${check.reason}`);
  lines.push("", "Reviewer notes:", "");
  return lines;
}

export function buildReport(summary: RunSummary, meta: ReportMeta): string {
  const { results } = summary;
  const passed = results.filter((r) => r.status === "pass").length;
  const errored = results.filter((r) => r.status === "error").length;
  const models = [...new Set(results.flatMap((r) => r.turns.map((t) => t.model).filter((m): m is string => m !== null)))];
  const latencies = results.flatMap((r) => r.turns.filter((t) => t.reply).map((t) => t.latencyMs));
  const med = median(latencies);
  const categories = [...new Set(results.map((r) => r.case.category))];
  const when = DateTime.fromJSDate(meta.date).toFormat("yyyy-MM-dd HH:mm");

  const header: string[] = [`# ANNA behavior eval, ${when}`, ""];
  if (summary.stoppedReason) header.push(`**PARTIAL RUN. ${summary.stoppedReason}.**`, "");
  header.push(
    `- Date: ${when} (machine local time)`,
    `- Provider chain: ${meta.providerChain}`,
    `- Models that answered: ${models.length ? models.join(", ") : "none"}`,
    `- Passed: **${passed}/${results.length}** (${percent(passed, results.length)})${errored ? `; ${errored} of the failures errored before a reply` : ""}`,
    `- Cases run: ${results.length} of ${meta.totalCases}${meta.only ? ` (subset: EVAL_ONLY=${meta.only.join(",")})` : ""}${summary.notRun.length ? `; not run: ${summary.notRun.join(", ")}` : ""}`,
    `- Latency per reply (time inside the provider): median ${med === null ? "n/a" : `${med} ms`}, max ${latencies.length ? `${Math.max(...latencies)} ms` : "n/a"}, over ${latencies.length} replies`,
    `- Pacing: ${meta.delayMs} ms between provider calls. Fixed clock per case (default 2026-10-07 10:00 local).`,
    "",
    "## Pass rate by category",
    "",
    "| Category | Passed | Total | Rate |",
    "|---|---|---|---|",
  );
  for (const category of categories) {
    const inCategory = results.filter((r) => r.case.category === category);
    const ok = inCategory.filter((r) => r.status === "pass").length;
    header.push(`| ${category} | ${ok} | ${inCategory.length} | ${percent(ok, inCategory.length)} |`);
  }
  header.push("", "## Cases (failed first)", "");

  const ordered = [...results.filter((r) => r.status !== "pass"), ...results.filter((r) => r.status === "pass")];
  const body = ordered.flatMap((r) => [...caseSection(r), "---", ""]);
  return `${[...header, ...body].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
