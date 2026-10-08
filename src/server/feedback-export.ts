// The "Export for Ari" file: Markdown in the layout of failure-modes.md, with only the flagged items in it.
// Everything comes from the Feedback rows (text captured when the reply was flagged), so no other conversation and no memory
// is read, and an item still exports after its conversation was deleted.

import type { OperationResult } from "../core/domain/memory";
import type { FeedbackItem } from "../data/feedback-repository";

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** yyyy-MM-dd in the PC's own time zone. */
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

function localDateTime(date: Date): string {
  return `${localDate(date)} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function exportFileName(now: Date): string {
  return `anna-feedback-${localDate(now)}.md`;
}

/** One line per operation ANNA's reply carried. */
export function describeOperation(op: OperationResult): string {
  switch (op.kind) {
    case "memory.created":
      return `Saved to memory (${op.type}): "${op.statement}"`;
    case "memory.updated":
      return `Updated a memory: "${op.statement}" (was "${op.previousStatement}")`;
    case "memory.rejected":
      return `Memory not saved: ${op.reason}`;
    case "memory.skipped_duplicate":
      return `Memory already saved: "${op.statement}"`;
    case "reminder.created":
      return `Set a reminder: "${op.text}" at ${op.dueAt} (${op.timezone})`;
    case "reminder.rejected":
      return `Reminder not set: ${op.reason}`;
  }
}

/** Multi-line text as one field value: later lines are indented, so a pasted "###" or "---" can never look like structure. */
function field(label: string, text: string): string {
  const [first = "", ...rest] = text.split(/\r?\n/);
  return [`${label}: ${first}`.trimEnd(), ...rest.map((line) => (line ? `  ${line}` : ""))].join("\n");
}

function shortName(item: FeedbackItem): string {
  const source = (item.userText || item.replyText).replace(/\s+/g, " ").trim();
  if (!source) return "flagged reply";
  return source.length > 60 ? `${source.slice(0, 57).trimEnd()}...` : source;
}

function renderItem(item: FeedbackItem, version: string): string {
  const lines: string[] = [`### ${localDate(item.createdAt)}: ${shortName(item)}`];
  lines.push("User situation:");
  lines.push(field("What user asked", item.userText));
  lines.push(field("What ANNA did", item.replyText));
  if (item.operations.length > 0) {
    lines.push("Operations on that reply:");
    for (const op of item.operations) lines.push(`  - ${describeOperation(op)}`);
  }
  lines.push(field("What user actually needed", item.note));
  lines.push("Failure category:");
  lines.push("Desired behavior:");
  lines.push("");
  lines.push("The turns before the flagged reply:");
  if (item.context.length === 0) lines.push("  (none)");
  for (const turn of item.context) lines.push(field(`  ${turn.role === "user" ? "You" : "ANNA"}`, turn.content));
  lines.push("");
  lines.push(`Flagged: ${localDateTime(item.createdAt)}`);
  lines.push(`App version: ${version}`);
  return lines.join("\n");
}

export function renderFeedbackExport(items: readonly FeedbackItem[], options: { version: string; now: Date }): string {
  const { version, now } = options;
  const head = [
    "# ANNA feedback",
    "",
    `App version: ${version}`,
    `Exported: ${localDateTime(now)}`,
    `Flagged items: ${items.length}`,
    "",
    "Only the replies flagged as not helpful and the turns just before them are in this file.",
    "Failure category and desired behavior are left blank to fill in (see failure-modes.md).",
  ].join("\n");
  if (items.length === 0) return `${head}\n\nNothing was flagged.\n`;
  return `${head}\n\n---\n\n${items.map((item) => renderItem(item, version)).join("\n\n---\n\n")}\n`;
}
