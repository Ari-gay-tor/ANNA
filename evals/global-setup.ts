// Builds the template SQLite database from the Prisma migrations once per eval run.
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { EVAL_DB_DIR } from "./db";

export default function setup(): () => void {
  rmSync(EVAL_DB_DIR, { recursive: true, force: true });
  mkdirSync(EVAL_DB_DIR, { recursive: true });
  const url = `file:${join(EVAL_DB_DIR, "template.db").replace(/\\/g, "/")}`;
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  return () => rmSync(EVAL_DB_DIR, { recursive: true, force: true });
}
