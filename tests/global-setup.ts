// Builds a template SQLite database from the Prisma migrations once per test run.
// Each test then copies it, so no test touches dev.db.
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export const TEMPLATE_DIR = join(process.cwd(), "node_modules", ".anna-test");

export default function setup(): void {
  rmSync(TEMPLATE_DIR, { recursive: true, force: true });
  mkdirSync(TEMPLATE_DIR, { recursive: true });
  const url = `file:${join(TEMPLATE_DIR, "template.db").replace(/\\/g, "/")}`;
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
