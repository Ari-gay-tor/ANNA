// A fresh, migrated SQLite database per eval case. Same approach as tests/helpers.ts, in its own folder
// so `npm test` and `npm run eval` never clobber each other's template.

import { copyFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "../src/data/prisma";

export const EVAL_DB_DIR = join(process.cwd(), "node_modules", ".anna-eval");

export interface EvalDb {
  db: PrismaClient;
  /** Disconnects and deletes the file. */
  dispose(): Promise<void>;
}

export function freshEvalDb(): EvalDb {
  const file = join(EVAL_DB_DIR, `${randomUUID()}.db`);
  copyFileSync(join(EVAL_DB_DIR, "template.db"), file);
  const db = createPrismaClient(`file:${file.replace(/\\/g, "/")}`);
  return {
    db,
    async dispose() {
      await db.$disconnect();
      rmSync(file, { force: true });
    },
  };
}
