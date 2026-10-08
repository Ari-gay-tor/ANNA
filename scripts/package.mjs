// Builds release/ANNA-<version>.zip: the tester kit. No dependencies (a small zip writer on node:zlib).
//
//   npm run package
//
// Only what a tester needs goes in (an allow-list), and then the finished archive is read back and checked: the build FAILS if
// the archive holds anything forbidden (a .env, a database, logs, node_modules, Ari's private ANNA-tts folder, tests, ...) or
// something that looks like an API key. The pure functions below are tested in tests/package.test.ts.

import { crc32, deflateRawSync } from "node:zlib";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- What goes in -----------------------------------------------------------------------------------------------------------

/** Folders whose files are packaged (recursively). */
const INCLUDED_DIRS = ["src", "public", "scripts", "prisma/migrations"];
/** Single files packaged from the app folder's root, besides the *.cmd files. */
const INCLUDED_ROOT_FILES = ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "prisma/schema.prisma"];

/** Never in the archive, wherever they sit in the tree. */
const FORBIDDEN_ANYWHERE = ["node_modules", ".next", ".git", "logs", "backups", "release", "ANNA-tts"];
/** Never in the archive when they are at the top. */
const FORBIDDEN_TOP = ["tests", "evals", "docs/screenshots"];
const FORBIDDEN_NAME = /^\.env(\..*)?$|\.(db|db-journal|db-wal|db-shm|sqlite|sqlite3|tsbuildinfo|log|zip|pem|key)$/i;

/** Why `path` (relative, any slashes) must not be packaged, or null if it is fine. */
export function forbiddenReason(path) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const name = parts[parts.length - 1] ?? "";
  for (const part of parts.slice(0, -1)) {
    if (FORBIDDEN_ANYWHERE.includes(part)) return `inside "${part}"`;
  }
  if (FORBIDDEN_ANYWHERE.includes(name)) return `is "${name}"`;
  const joined = parts.join("/");
  for (const top of FORBIDDEN_TOP) {
    if (joined === top || joined.startsWith(`${top}/`)) return `is under "${top}"`;
  }
  if (FORBIDDEN_NAME.test(name) && name !== ".env.example") return `is a private or generated file (${name})`;
  return null;
}

/** True when `path` (relative to the app folder) belongs in the tester kit. */
export function isIncluded(path) {
  const normal = path.replace(/\\/g, "/");
  if (forbiddenReason(normal)) return false;
  if (INCLUDED_ROOT_FILES.includes(normal)) return true;
  if (!normal.includes("/") && normal.toLowerCase().endsWith(".cmd")) return true;
  return INCLUDED_DIRS.some((dir) => normal.startsWith(`${dir}/`));
}

/** Every packaged file under `root`, as sorted relative paths with forward slashes. */
export function listPackageFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join("/");
      if (entry.isDirectory()) {
        if (!forbiddenReason(`${rel}/x`)) walk(full);
      } else if (entry.isFile() && isIncluded(rel)) {
        out.push(rel);
      }
    }
  };
  walk(root);
  return out.sort();
}

// ---- START HERE.txt ---------------------------------------------------------------------------------------------------------

/** docs/tester-guide.md as plain text for Notepad: no Markdown marks, headings underlined, Windows line endings. */
export function markdownToPlainText(markdown) {
  const out = [];
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    let line = raw
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1");
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const text = heading[2];
      if (heading[1].length === 1) {
        out.push(text.toUpperCase(), "=".repeat(Math.min(text.length, 70)));
      } else {
        out.push("", text.toUpperCase(), "-".repeat(Math.min(text.length, 70)));
      }
      continue;
    }
    line = line.replace(/^(\s*)[-*]\s+/, "$1- ");
    out.push(line);
  }
  return `${out.join("\r\n").replace(/(\r\n){3,}/g, "\r\n\r\n").trimEnd()}\r\n`;
}

// ---- Zip (store/deflate, UTF-8 names, no zip64: the kit is a few MB) ------------------------------------------------------

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = (Math.max(date.getFullYear(), 1980) - 1980) * 512 + (date.getMonth() + 1) * 32 + date.getDate();
  return { time, day: day };
}

/** entries: [{ name (forward slashes), data (Buffer), mtime (Date) }] -> the zip file as a Buffer. */
export function createZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data, mtime } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const packed = data.length > 0 ? deflateRawSync(data) : data;
    const method = data.length > 0 ? 8 : 0;
    const crc = crc32(data);
    const { time, day } = dosDateTime(mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: names are UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, packed);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4); // version made by (MS-DOS, 2.0)
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(method, 10);
    head.writeUInt16LE(time, 12);
    head.writeUInt16LE(day, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(packed.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(nameBytes.length, 28);
    head.writeUInt32LE(0x20, 38); // external attributes: archive
    head.writeUInt32LE(offset, 42);
    central.push(head, nameBytes);

    offset += local.length + nameBytes.length + packed.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBytes, end]);
}

/** The entry names in a zip, read from its central directory. Throws if the archive is not a zip. */
export function listZipEntries(zip) {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Not a zip file (no end-of-archive record).");
  const count = zip.readUInt16LE(end + 10);
  let pos = zip.readUInt32LE(end + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) throw new Error("Damaged zip (bad central directory).");
    const nameLength = zip.readUInt16LE(pos + 28);
    const extraLength = zip.readUInt16LE(pos + 30);
    const commentLength = zip.readUInt16LE(pos + 32);
    names.push(zip.toString("utf8", pos + 46, pos + 46 + nameLength));
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

// ---- Checks on the finished archive ---------------------------------------------------------------------------------------

/** Problems with a list of archive entry names: anything forbidden. An empty list means the archive is clean. */
export function findForbidden(names) {
  const problems = [];
  for (const name of names) {
    const reason = forbiddenReason(name);
    if (reason) problems.push(`${name}: ${reason}`);
  }
  return problems;
}

const KEY_LIKE = /AIza[0-9A-Za-z_-]{30,}|GEMINI_API_KEY\s*=\s*["']?[A-Za-z0-9_.-]{8,}|GROQ_API_KEY\s*=\s*\S{8,}|OPENAI_COMPAT_API_KEY\s*=\s*\S{8,}/;

/** Names of text entries that contain something that looks like a real API key. */
export function findSecrets(entries) {
  return entries.filter(({ name, data }) => !/\.(png|ico)$/i.test(name) && KEY_LIKE.test(data.toString("utf8"))).map((e) => e.name);
}

const REQUIRED = [
  "START HERE.txt",
  "install-anna.cmd",
  "uninstall-anna.cmd",
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "prisma/schema.prisma",
  "scripts/start-server.mjs",
  "scripts/anna-env.mjs",
  "scripts/windows/install.ps1",
  "src/app/layout.tsx",
  "public/icons/anna-192.png",
];

/** Entries a tester's install cannot work without. Returns the missing ones. */
export function findMissing(names) {
  const missing = REQUIRED.filter((name) => !names.includes(name));
  if (!names.some((name) => /^prisma\/migrations\/[^/]+\/migration\.sql$/.test(name))) missing.push("prisma/migrations/*/migration.sql");
  return missing;
}

// ---- Build ------------------------------------------------------------------------------------------------------------------

/**
 * Builds the zip and checks it. `options.also` force-adds files that would normally be left out; it exists only to prove the
 * archive check fails on a forbidden file (npm run package -- --also=<file>). A zip that fails the check is deleted.
 */
export function buildKit(root = ROOT, options = {}) {
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const guide = join(root, "docs", "tester-guide.md");
  if (!existsSync(guide)) throw new Error("docs/tester-guide.md is missing, so START HERE.txt cannot be made.");

  const entries = listPackageFiles(root).map((name) => {
    const full = join(root, name);
    return { name, data: readFileSync(full), mtime: statSync(full).mtime };
  });
  for (const name of options.also ?? []) {
    const full = join(root, name);
    entries.push({ name: name.replace(/\\/g, "/"), data: readFileSync(full), mtime: statSync(full).mtime });
  }
  entries.push({ name: "START HERE.txt", data: Buffer.from(markdownToPlainText(readFileSync(guide, "utf8")), "utf8"), mtime: new Date() });

  const secrets = findSecrets(entries);
  if (secrets.length > 0) throw new Error(`These files look like they contain an API key, so nothing was packaged: ${secrets.join(", ")}`);

  const outDir = join(root, "release");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `ANNA-${version}.zip`);
  writeFileSync(outFile, createZip(entries));

  // Read the archive back from disk and check what is really in it.
  const names = listZipEntries(readFileSync(outFile));
  const forbidden = findForbidden(names);
  const missing = findMissing(names);
  const bytes = statSync(outFile).size;
  if (forbidden.length > 0 || missing.length > 0) rmSync(outFile, { force: true });
  return { version, outFile, names, forbidden, missing, bytes };
}

function main() {
  const also = process.argv.filter((arg) => arg.startsWith("--also=")).map((arg) => arg.slice(7));
  const { version, outFile, names, forbidden, missing, bytes } = buildKit(ROOT, { also });
  const topLevel = new Map();
  for (const name of names) {
    const top = name.includes("/") ? `${name.split("/")[0]}/` : name;
    topLevel.set(top, (topLevel.get(top) ?? 0) + 1);
  }
  console.log(`ANNA ${version} tester kit: ${outFile}`);
  console.log(`${names.length} files, ${(bytes / 1024).toFixed(0)} KB (${(bytes / 1048576).toFixed(2)} MB)`);
  for (const [top, count] of topLevel) console.log(`  ${top}${top.endsWith("/") ? ` (${count} files)` : ""}`);
  if (forbidden.length > 0 || missing.length > 0) {
    for (const problem of forbidden) console.error(`FORBIDDEN in the archive: ${problem}`);
    for (const name of missing) console.error(`MISSING from the archive: ${name}`);
    console.error("The archive check FAILED, so the zip was deleted.");
    process.exit(1);
  }
  console.log("Archive check passed: nothing forbidden is in the zip, and everything the install needs is.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`Packaging failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
