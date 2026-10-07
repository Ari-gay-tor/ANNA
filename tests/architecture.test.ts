// Enforces the layering rule: src/core is pure. It must not import next, react,
// @prisma/client, node:fs, or anything under src/data, src/app, src/components, src/server.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const CORE = join(SRC, "core");

const FORBIDDEN_PACKAGES = ["next", "react", "react-dom", "@prisma/client", ".prisma/client", "prisma", "fs"];
const FORBIDDEN_DIRS = ["data", "app", "components", "server"];

/** Every module specifier in `source`: static imports, re-exports, dynamic import(), require(). */
export function extractSpecifiers(source: string): string[] {
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  const found = new Set<string>();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.add(match[1]!);
  }
  return [...found];
}

/** Why `specifier`, imported from `filePath` (relative to src/, posix style), is forbidden. null if allowed. */
export function forbiddenReason(filePath: string, specifier: string): string | null {
  const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  for (const pkg of FORBIDDEN_PACKAGES) {
    if (bare === pkg || bare.startsWith(`${pkg}/`)) return `imports "${specifier}"`;
  }

  let target: string | null = null;
  if (specifier.startsWith("@/")) target = specifier.slice(2); // tsconfig alias for src/
  else if (specifier.startsWith(".")) target = posix.normalize(posix.join(posix.dirname(filePath), specifier));
  else if (/^(?:\/|[a-zA-Z]:)/.test(specifier)) target = null; // absolute paths are not used in this repo
  if (target !== null) {
    const top = target.split("/")[0];
    if (top && FORBIDDEN_DIRS.includes(top)) return `imports "${specifier}" which reaches into src/${top}`;
  }
  return null;
}

export function findViolations(filePath: string, source: string): string[] {
  return extractSpecifiers(source)
    .map((s) => forbiddenReason(filePath, s))
    .filter((r): r is string => r !== null)
    .map((reason) => `${filePath}: ${reason}`);
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

describe("architecture: src/core imports", () => {
  it("scans real files (guard against a vacuous pass)", () => {
    const files = listFiles(CORE).filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(5);
  });

  it("no file under src/core imports a forbidden module", () => {
    const violations = listFiles(CORE)
      .filter((f) => /\.(?:tsx?|jsx?|mjs|cjs)$/.test(f))
      .flatMap((file) => findViolations(relative(SRC, file).split(sep).join("/"), readFileSync(file, "utf8")));
    expect(violations).toEqual([]);
  });
});

describe("architecture: the scanner itself detects forbidden imports", () => {
  const from = "core/runtime/example.ts";

  it.each([
    ['import { PrismaClient } from "@prisma/client";', "@prisma/client"],
    ['import next from "next";', "next"],
    ['import { NextResponse } from "next/server";', "next/server"],
    ['import React from "react";', "react"],
    ['import { createRoot } from "react-dom/client";', "react-dom/client"],
    ['import { readFileSync } from "node:fs";', "node:fs"],
    ['import fs from "fs";', "fs"],
    ['import { readFile } from "node:fs/promises";', "node:fs/promises"],
    ['import { getPrisma } from "../../data/prisma";', "src/data"],
    ['import { x } from "../../app/page";', "src/app"],
    ['import { Chat } from "../../components/Chat";', "src/components"],
    ['import { getServices } from "../../server/anna";', "src/server"],
    ['import { getServices } from "@/server/anna";', "src/server"],
    ['export * from "../../data/prisma";', "src/data"],
    ['const m = await import("@prisma/client");', "@prisma/client"],
    ['const fs = require("node:fs");', "node:fs"],
    ['import type { PrismaClient } from "@prisma/client";', "@prisma/client"],
    ["import {\n  a,\n  b,\n} from 'react';", "react"],
    ['import "next/dynamic";', "next/dynamic"],
  ])("flags %j", (source, expected) => {
    const violations = findViolations(from, source);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain(expected);
  });

  it.each([
    'import { z } from "zod";',
    'import { GoogleGenAI } from "@google/genai";',
    'import { x } from "./sibling";',
    'import { y } from "../domain/types";',
    'import { y } from "../ports";',
    'import { SYSTEM_PROMPT } from "../prompts/system";',
    'import { a } from "reactive-utils";',
    'import { a } from "nextra";',
    'import { a } from "@/core/domain/types";',
  ])("allows %j", (source) => {
    expect(findViolations(from, source)).toEqual([]);
  });

  it("resolves relative paths from the importing file's directory", () => {
    // From src/core/x.ts, "../data/p" is src/data/p (forbidden); from src/core/a/b/x.ts it is src/core/a/data/p (fine).
    expect(findViolations("core/x.ts", 'import a from "../data/p";')).toHaveLength(1);
    expect(findViolations("core/a/b/x.ts", 'import a from "../data/p";')).toHaveLength(0);
  });
});
