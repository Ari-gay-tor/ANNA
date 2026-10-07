import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CasesFileSchema, type EvalCase } from "./types";

export const CASES_PATH = join(process.cwd(), "evals", "cases.json");

/** Reads and validates evals/cases.json. Throws with the first problems found. */
export function loadCases(path: string = CASES_PATH): EvalCase[] {
  const parsed = CasesFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    const problems = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`${path} is invalid:\n${problems.join("\n")}`);
  }
  return parsed.data;
}
