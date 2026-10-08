// The tester kit packager (scripts/package.mjs): what goes in, what never does, the zip it writes, and the check that reads it back.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateRawSync, crc32 } from "node:zlib";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

type Entry = { name: string; data: Buffer; mtime: Date };
let pkg: {
  forbiddenReason: (path: string) => string | null;
  isIncluded: (path: string) => boolean;
  listPackageFiles: (root: string) => string[];
  markdownToPlainText: (md: string) => string;
  createZip: (entries: Entry[]) => Buffer;
  listZipEntries: (zip: Buffer) => string[];
  findForbidden: (names: string[]) => string[];
  findSecrets: (entries: Entry[]) => string[];
  findMissing: (names: string[]) => string[];
  buildKit: (root?: string, options?: { also?: string[] }) => { names: string[]; forbidden: string[]; missing: string[]; outFile: string; bytes: number };
};
beforeAll(async () => {
  pkg = (await import(pathToFileURL(join(process.cwd(), "scripts", "package.mjs")).href)) as typeof pkg;
});

const dirs: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "anna-pkg-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function put(root: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
}

describe("what goes in the kit", () => {
  it.each([
    "src/app/page.tsx",
    "src/components/ChatApp.tsx",
    "prisma/schema.prisma",
    "prisma/migrations/20261007101337_init/migration.sql",
    "prisma/migrations/migration_lock.toml",
    "public/icons/anna-192.png",
    "scripts/start-server.mjs",
    "scripts/windows/install.ps1",
    "install-anna.cmd",
    "uninstall-anna.cmd",
    "update-anna.cmd",
    "package.json",
    "package-lock.json",
    "next.config.ts",
    "tsconfig.json",
  ])("includes %s", (path) => {
    expect(pkg.isIncluded(path)).toBe(true);
  });

  it.each([
    ".env",
    ".env.local",
    "prisma/dev.db",
    "prisma/dev.db-journal",
    "anna.db",
    "src/lib/cache.db",
    "logs/anna.log",
    "src/logs/anna.log",
    "backups/2026.zip",
    "node_modules/next/package.json",
    ".next/BUILD_ID",
    "release/ANNA-0.2.0.zip",
    "evals/reports/2026-10-07.md",
    "evals/cases.json",
    "docs/screenshots/slice7/start-light.png",
    ".git/config",
    "ANNA-tts/voices/anna_voice.pt",
    "ANNA-tts/speak.py",
    "tests/helpers.ts",
    "tsconfig.tsbuildinfo",
    "CLAUDE.md",
    "failure-modes.md",
    "docs/PLAN.md",
    ".env.example",
    "vitest.config.mts",
  ])("leaves out %s", (path) => {
    expect(pkg.isIncluded(path)).toBe(false);
  });

  it("explains why a path is forbidden", () => {
    expect(pkg.forbiddenReason("ANNA-tts/speak.py")).toMatch(/ANNA-tts/);
    expect(pkg.forbiddenReason(".env")).toMatch(/private/);
    expect(pkg.forbiddenReason("src/app/page.tsx")).toBeNull();
  });

  it("lists only allowed files from a folder that also holds forbidden ones", () => {
    const root = temp();
    put(root, {
      "package.json": "{}",
      "package-lock.json": "{}",
      "install-anna.cmd": "x",
      ".env": "GEMINI_API_KEY=secret",
      "src/app/page.tsx": "x",
      "src/data/local.db": "x",
      "prisma/schema.prisma": "x",
      "prisma/dev.db": "x",
      "prisma/migrations/1_init/migration.sql": "x",
      "logs/anna.log": "x",
      "node_modules/a/index.js": "x",
      ".next/BUILD_ID": "x",
      "ANNA-tts/voices/anna_voice.pt": "x",
      "tests/a.test.ts": "x",
      "evals/cases.json": "x",
      "docs/screenshots/a.png": "x",
      "scripts/start-server.mjs": "x",
    });
    expect(pkg.listPackageFiles(root)).toEqual([
      "install-anna.cmd",
      "package-lock.json",
      "package.json",
      "prisma/migrations/1_init/migration.sql",
      "prisma/schema.prisma",
      "scripts/start-server.mjs",
      "src/app/page.tsx",
    ]);
  });

  it("on the real repo the kit has what the install needs and nothing forbidden", () => {
    const files = pkg.listPackageFiles(process.cwd());
    expect(pkg.findForbidden(files)).toEqual([]);
    expect(pkg.findMissing([...files, "START HERE.txt"])).toEqual([]);
    expect(files.some((f) => f.startsWith("src/"))).toBe(true);
    expect(files).not.toContain("prisma/dev.db");
    expect(files.some((f) => /^(ANNA-tts|tests|evals|docs|logs|backups|node_modules|\.next|release)\//.test(f))).toBe(false);
  });
});

describe("the archive check", () => {
  it("passes a clean list and names every forbidden entry in a bad one", () => {
    expect(pkg.findForbidden(["src/app/page.tsx", "package.json", "START HERE.txt"])).toEqual([]);
    const problems = pkg.findForbidden(["src/app/page.tsx", "prisma/dev.db", ".env", "ANNA-tts/voices/anna_voice.pt", "node_modules/x/y.js", "logs/anna.log"]);
    expect(problems).toHaveLength(5);
    expect(problems.join("\n")).toMatch(/prisma\/dev\.db/);
    expect(problems.join("\n")).toMatch(/\.env:/);
    expect(problems.join("\n")).toMatch(/ANNA-tts/);
  });

  it("finds an entry that looks like it holds an API key, and ignores images", () => {
    const entry = (name: string, text: string): Entry => ({ name, data: Buffer.from(text), mtime: new Date() });
    expect(pkg.findSecrets([entry("a.ts", "const k = 'AIzaSyA-fake-test-key_0123456789abcdefgh'"), entry("b.txt", "GEMINI_API_KEY=abcd1234efgh"), entry("c.ts", "no secrets here")])).toEqual([
      "a.ts",
      "b.txt",
    ]);
    expect(pkg.findSecrets([entry("p.png", "AIzaSyA-fake-test-key_0123456789abcdefgh")])).toEqual([]);
    expect(pkg.findSecrets([entry("d.ts", "GEMINI_API_KEY is not set"), entry("e.env", "GEMINI_API_KEY=")])).toEqual([]);
  });

  it("reports what the install cannot work without", () => {
    expect(pkg.findMissing(["package.json"])).toContain("install-anna.cmd");
    expect(pkg.findMissing(["package.json"])).toContain("prisma/migrations/*/migration.sql");
  });
});

describe("buildKit", () => {
  function fixture(extra: Record<string, string> = {}) {
    const root = temp();
    put(root, {
      "package.json": JSON.stringify({ name: "anna", version: "9.9.9" }),
      "package-lock.json": "{}",
      "next.config.ts": "x",
      "tsconfig.json": "{}",
      "install-anna.cmd": "x",
      "uninstall-anna.cmd": "x",
      "docs/tester-guide.md": "# Guide\n\nHello\n",
      "prisma/schema.prisma": "x",
      "prisma/migrations/1_init/migration.sql": "x",
      "scripts/start-server.mjs": "x",
      "scripts/anna-env.mjs": "x",
      "scripts/windows/install.ps1": "x",
      "src/app/layout.tsx": "x",
      "public/icons/anna-192.png": "x",
      ...extra,
    });
    return root;
  }

  it("writes release/ANNA-<version>.zip with START HERE.txt in the root, and the check passes", () => {
    const root = fixture({ ".env": "GEMINI_API_KEY=should-not-ship-0000", "prisma/dev.db": "db", "ANNA-tts/a.py": "x" });
    const result = pkg.buildKit(root);
    expect(result.outFile).toBe(join(root, "release", "ANNA-9.9.9.zip"));
    expect(result.forbidden).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.names).toContain("START HERE.txt");
    expect(result.names).not.toContain(".env");
    expect(result.names).not.toContain("prisma/dev.db");
    expect(result.names.some((n) => n.startsWith("ANNA-tts/"))).toBe(false);
  });

  it("the check FAILS when a forbidden file is forced into the archive (and the bad zip is not left behind)", () => {
    const root = fixture({ "leftover.db": "db" });
    const result = pkg.buildKit(root, { also: ["leftover.db"] });
    expect(result.forbidden.join("\n")).toMatch(/leftover\.db/);
    expect(() => readFileSync(result.outFile)).toThrow();
  });

  it("refuses to package a file that looks like it holds a key", () => {
    const root = fixture({ "src/app/oops.ts": "const key = 'AIzaSyA-fake-test-key_0123456789abcdefgh';" });
    expect(() => pkg.buildKit(root)).toThrow(/API key/);
  });
});

describe("the zip itself", () => {
  const entries: Entry[] = [
    { name: "package.json", data: Buffer.from('{"version":"0.2.0"}'), mtime: new Date(2026, 9, 8, 10, 0) },
    { name: "src/app/páge.tsx", data: Buffer.from("export {};\n".repeat(500)), mtime: new Date(2026, 9, 8, 10, 0) },
    { name: "empty.txt", data: Buffer.alloc(0), mtime: new Date(2026, 9, 8, 10, 0) },
    { name: "public/a.bin", data: Buffer.from([0, 1, 2, 250, 251, 252]), mtime: new Date(2026, 9, 8, 10, 0) },
  ];

  it("reads back the same names, and every file inflates to the original bytes with a matching CRC", () => {
    const zip = pkg.createZip(entries);
    expect(pkg.listZipEntries(zip)).toEqual(entries.map((e) => e.name));

    let pos = 0;
    for (const entry of entries) {
      expect(zip.readUInt32LE(pos)).toBe(0x04034b50);
      const method = zip.readUInt16LE(pos + 8);
      const crc = zip.readUInt32LE(pos + 14);
      const packed = zip.readUInt32LE(pos + 18);
      const size = zip.readUInt32LE(pos + 22);
      const nameLength = zip.readUInt16LE(pos + 26);
      const start = pos + 30 + nameLength;
      const body = zip.subarray(start, start + packed);
      const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
      expect(data.equals(entry.data)).toBe(true);
      expect(size).toBe(entry.data.length);
      expect(crc).toBe(crc32(entry.data));
      pos = start + packed;
    }
  });

  it("is a zip that Windows' own tar (bsdtar) lists the same way", () => {
    const dir = temp();
    const file = join(dir, "kit.zip");
    writeFileSync(file, pkg.createZip(entries));
    const listed = spawnSync("tar", ["-tf", file], { encoding: "utf8" });
    if (listed.error || listed.status !== 0) return; // no tar on this machine: the round trip above still covers the format
    // Only ASCII names are compared: how tar prints a non-ASCII name depends on the console code page of whoever runs the test.
    const ascii = (names: string[]) => names.filter((name) => /^[\x20-\x7e]+$/.test(name));
    expect(ascii(listed.stdout.split(/\r?\n/).filter(Boolean))).toEqual(ascii(entries.map((e) => e.name)));
  });

  it("refuses something that is not a zip", () => {
    expect(() => pkg.listZipEntries(Buffer.from("not a zip file at all, just text"))).toThrow(/Not a zip/);
  });
});

describe("START HERE.txt", () => {
  it("is the guide as plain text: no Markdown marks, headings underlined, Windows line endings", () => {
    const text = pkg.markdownToPlainText("# Title\n\nSome `code` and **bold** and [a link](https://example.com).\n\n## Step one\n\n- item\n1. first\n");
    expect(text).toBe("TITLE\r\n=====\r\n\r\nSome code and bold and a link (https://example.com).\r\n\r\nSTEP ONE\r\n--------\r\n\r\n- item\r\n1. first\r\n");
  });

  it("the real guide converts cleanly and says the things the testers need", () => {
    const text = pkg.markdownToPlainText(readFileSync(join(process.cwd(), "docs", "tester-guide.md"), "utf8"));
    expect(text).not.toMatch(/[`*]|^#/m);
    expect(text).toMatch(/\r\n/);
    expect(text.replace(/\r\n/g, "\n")).not.toMatch(/(?<!\n)\n(?=\n\n)/); // no runs of blank lines
    for (const phrase of [
      "When you don't know what to do, ask ANNA.",
      "install-anna.cmd",
      "Windows protected your PC",
      "More info",
      "Run anyway",
      "aistudio.google.com/apikey",
      "no billing",
      "Export for Ari",
      "stays on this PC",
      "improve its products",
      "uninstall-anna.cmd",
      "%LOCALAPPDATA%\\ANNA",
      "%LOCALAPPDATA%\\ANNA\\logs\\anna.log",
    ]) {
      expect(text, `START HERE.txt should mention "${phrase}"`).toContain(phrase);
    }
  });
});
