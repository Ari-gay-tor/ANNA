// Automatic checks for the behavior evals. Pure functions: no database, no model, no clock.
// Each check says pass or fail with a short reason. A case passes only if every check passes.

import { DateTime } from "luxon";
import type { Clarification } from "../src/core/domain/clarification";
import type { OperationResult } from "../src/core/domain/memory";
import type { Checks, OpKind } from "./types";

export const DEFAULT_MAX_WORDS = 80;
export const DEFAULT_MAX_QUESTIONS = 1;
export const LOCAL_FORMAT = "yyyy-MM-dd HH:mm";

/** What the user sees from one ANNA reply: the stored text, the option buttons, and the executed operations. */
export interface ReplyOutput {
  content: string;
  clarification: Clarification | null;
  operations: readonly OperationResult[];
}

export interface CheckResult {
  name: string;
  pass: boolean;
  reason: string;
  /** 1-based turn number, set by the runner when a case checks more than one turn. */
  turn?: number;
}

const result = (name: string, pass: boolean, reason: string): CheckResult => ({ name, pass, reason });

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function countQuestions(text: string): number {
  return [...text].filter((ch) => ch === "?").length;
}

/** Lowercase, curly apostrophes and quotes straightened, so "don’t know" matches "don't know". */
function fold(text: string): string {
  return text
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .toLowerCase();
}

export function checkMaxWords(output: ReplyOutput, limit: number = DEFAULT_MAX_WORDS): CheckResult {
  const words = countWords(output.content);
  return result("maxWords", words <= limit, `${words} words, limit ${limit}`);
}

export function checkMaxQuestions(output: ReplyOutput, limit: number = DEFAULT_MAX_QUESTIONS): CheckResult {
  const questions = countQuestions(output.content);
  return result("maxQuestions", questions <= limit, `${questions} "?" in the reply, limit ${limit}`);
}

export function checkExpectClarification(output: ReplyOutput, expected: boolean | "either"): CheckResult {
  const asked = output.clarification !== null;
  if (expected === "either") return result("expectClarification", true, `either is fine (${asked ? "asked" : "did not ask"})`);
  return result(
    "expectClarification",
    asked === expected,
    expected ? (asked ? "asked a clarification" : "expected a clarification but there was none") : asked ? "asked a clarification but none was expected" : "no clarification, as expected",
  );
}

const kindsOf = (output: ReplyOutput): OpKind[] => output.operations.map((op) => op.kind);
const show = (kinds: readonly string[]) => (kinds.length === 0 ? "none" : [...kinds].sort().join(", "));

export function checkExpectOps(output: ReplyOutput, expected: readonly OpKind[] | "any"): CheckResult {
  if (expected === "any") return result("expectOps", true, `any ops allowed (got: ${show(kindsOf(output))})`);
  const got = kindsOf(output);
  const same = got.length === expected.length && [...got].sort().join("|") === [...expected].sort().join("|");
  return result("expectOps", same, same ? `ops: ${show(got)}` : `expected ops: ${show(expected)}; got: ${show(got)}`);
}

export function checkForbidOps(output: ReplyOutput, forbidden: readonly OpKind[]): CheckResult {
  const hit = kindsOf(output).filter((kind) => forbidden.includes(kind));
  return result("forbidOps", hit.length === 0, hit.length === 0 ? `none of: ${forbidden.join(", ")}` : `forbidden op(s) present: ${show(hit)}`);
}

export function checkForbiddenPhrases(output: ReplyOutput, phrases: readonly string[]): CheckResult {
  const text = fold(output.content);
  const hit = phrases.filter((p) => text.includes(fold(p)));
  return result("forbiddenPhrases", hit.length === 0, hit.length === 0 ? "no forbidden phrase" : `contains: ${hit.map((p) => `"${p}"`).join(", ")}`);
}

export function checkRequireAny(output: ReplyOutput, phrases: readonly string[]): CheckResult {
  const text = fold(output.content);
  const hit = phrases.filter((p) => text.includes(fold(p)));
  return result(
    "requireAny",
    hit.length > 0,
    hit.length > 0 ? `contains "${hit[0]}"` : `contains none of: ${phrases.map((p) => `"${p}"`).join(", ")}`,
  );
}

/** The local due time of the first reminder.created op, in `timeZone`, as "YYYY-MM-DD HH:mm". */
export function checkReminderDueLocal(output: ReplyOutput, expected: string, timeZone: string): CheckResult {
  const created = output.operations.find((op) => op.kind === "reminder.created");
  if (!created) return result("reminderDueLocal", false, `expected a reminder due ${expected}, but none was created`);
  const local = DateTime.fromISO(created.dueAt, { zone: timeZone }).toFormat(LOCAL_FORMAT);
  return result("reminderDueLocal", local === expected, local === expected ? `due ${local} ${timeZone}` : `expected due ${expected}, got ${local} (${timeZone})`);
}

/**
 * Every check that applies to one reply. maxWords and maxQuestions always run (with their defaults);
 * the others run only when the case asks for them.
 */
export function runChecks(output: ReplyOutput, checks: Checks, context: { timeZone: string }): CheckResult[] {
  const results = [checkMaxWords(output, checks.maxWords), checkMaxQuestions(output, checks.maxQuestions)];
  if (checks.expectClarification !== undefined) results.push(checkExpectClarification(output, checks.expectClarification));
  if (checks.expectOps !== undefined) results.push(checkExpectOps(output, checks.expectOps));
  if (checks.forbidOps !== undefined) results.push(checkForbidOps(output, checks.forbidOps));
  if (checks.forbiddenPhrases !== undefined) results.push(checkForbiddenPhrases(output, checks.forbiddenPhrases));
  if (checks.requireAny !== undefined) results.push(checkRequireAny(output, checks.requireAny));
  if (checks.reminderDueLocal !== undefined) results.push(checkReminderDueLocal(output, checks.reminderDueLocal, context.timeZone));
  return results;
}
