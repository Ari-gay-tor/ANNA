// Reading and editing an env-style config file (config.env in tester mode, .env in dev mode).
// Editing is line based: only the one line is touched, so comments, other settings and line endings survive.
// The launcher (scripts/anna-env.mjs) has its own copy of the parser; tests/data-dir.test.ts checks the two agree.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/** The value part of a `NAME=value` line: quotes removed, or a trailing ` # comment` cut off an unquoted value. */
function unquote(raw: string): string {
  const value = raw.trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length >= 2) {
    const end = value.indexOf(quote, 1);
    if (end > 0) return value.slice(1, end);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

/** Every `NAME=value` in the text. A later line for the same name wins. */
export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const match = LINE.exec(line);
    if (match) out[match[1]!] = unquote(match[2]!);
  }
  return out;
}

/**
 * The text with `NAME` set to `value`. An existing `NAME=` line is replaced in place (the last one, which is the one
 * parseEnvText reads), otherwise the line is added at the end. Every other line is returned untouched.
 */
export function setEnvValue(text: string, name: string, value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error("Invalid setting name.");
  if (/[\r\n]/.test(value)) throw new Error("A setting value cannot contain a line break.");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.split(/\r?\n/);
  let at = -1;
  lines.forEach((line, index) => {
    const match = !/^\s*#/.test(line) ? LINE.exec(line) : null;
    if (match && match[1] === name) at = index;
  });
  const next = `${name}=${value}`;
  if (at >= 0) {
    lines[at] = next;
  } else {
    // Drop the empty element a trailing newline leaves, so the new line follows the last real line.
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    lines.push(next);
  }
  if (lines[lines.length - 1] !== "") lines.push("");
  return lines.join(eol);
}

/** Settings in the file, or {} when it does not exist. */
export function readEnvFile(path: string): Record<string, string> {
  try {
    return parseEnvText(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/** Sets one value in the file (creating the file and its folder if needed). Written to a temp file first, then renamed over it. */
export function writeEnvValue(path: string, name: string, value: string): void {
  let current = "";
  try {
    current = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, setEnvValue(current, name, value), "utf8");
  renameSync(temp, path);
}
