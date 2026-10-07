import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { missedMessage, reminderMessage } from "../src/components/reminder-text";
import {
  buildToastInvocation,
  createToastNotifier,
  TOAST_SCRIPT,
  type FiredReminder,
  type RunToastProcess,
  type ToastInvocation,
} from "../src/server/toast-notifier";

const NOW = new Date("2026-10-07T15:42:00Z");
const reminder = (text: string, extra: Partial<FiredReminder> = {}): FiredReminder => ({
  id: "r1",
  text,
  dueAt: new Date("2026-10-07T15:40:00Z"),
  timezone: "UTC",
  missed: false,
  ...extra,
});

// Everything a hostile reminder might try: quote breaking, PowerShell expansion, XML injection, command chaining, backticks, newlines.
const HOSTILE = [
  `call "Dad" and 'Mum'`,
  "pay $(Remove-Item -Recurse C:\\Users) now",
  "<script>alert(1)</script>",
  "'; Remove-Item -Recurse -Force C:\\; '",
  "tick`n`$env:USERNAME`r`0 backticks",
  "line one\nline two\r\nline three",
  `"><toast launch="calc.exe"><x a='`,
  "a && del /s /q C:\\ & echo b | more",
  "${process.env.SECRET} %PATH% $env:APPDATA",
];

function decodeScript(args: string[]): string {
  const i = args.indexOf("-EncodedCommand");
  return Buffer.from(args[i + 1]!, "base64").toString("utf16le");
}

describe("toast message text", () => {
  it("uses the banner wording, and the title is ANNA", () => {
    const { env } = buildToastInvocation(reminder("call Dad"), NOW);
    expect(env.ANNA_TOAST_TITLE).toBe("ANNA");
    expect(env.ANNA_TOAST_LINE1).toBe(reminderMessage({ text: "call Dad" }));
    expect(env.ANNA_TOAST_LINE1).toBe("You asked me to remind you to call Dad.");
    expect(env.ANNA_TOAST_LINE2).toBe("");
  });

  it("a missed reminder adds the banner's missed line, in the reminder's own timezone", () => {
    const dueAt = new Date("2026-10-07T22:00:00Z");
    const now = new Date("2026-10-07T23:30:00Z");
    const { env } = buildToastInvocation(reminder("call Dad", { missed: true, dueAt, timezone: "America/New_York" }), now);
    expect(env.ANNA_TOAST_LINE2).toBe(missedMessage({ dueAt: dueAt.toISOString(), timezone: "America/New_York" }, now));
    expect(env.ANNA_TOAST_LINE2).toBe("This was due at 6:00 PM, while ANNA wasn't running.");
  });

  it("the click URL is the loopback address on ANNA_PORT (default 3737)", () => {
    expect(buildToastInvocation(reminder("x"), NOW, {}).env.ANNA_TOAST_URL).toBe("http://127.0.0.1:3737/");
    expect(buildToastInvocation(reminder("x"), NOW, { ANNA_PORT: "4100" }).env.ANNA_TOAST_URL).toBe("http://127.0.0.1:4100/");
  });

  it("strips control characters that are illegal in XML (a NUL would make Node refuse the env value) but keeps newlines and tabs", () => {
    const { env } = buildToastInvocation(reminder("a\u0000b\u0001c\nd\te"), NOW);
    expect(env.ANNA_TOAST_LINE1).toBe("You asked me to remind you to abc\nd\te.");
  });
});

describe("toast security: reminder text only travels in environment variables", () => {
  const benign = buildToastInvocation(reminder("call Dad"), NOW);

  it("the command and arguments are identical for every text", () => {
    for (const text of HOSTILE) {
      const hostile = buildToastInvocation(reminder(text), NOW);
      expect(hostile.command).toBe("powershell.exe");
      expect(hostile.args).toEqual(benign.args);
    }
  });

  it("the arguments are exactly the fixed flags plus the encoded constant script", () => {
    expect(benign.args.slice(0, 5)).toEqual(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand"]);
    expect(benign.args).toHaveLength(6);
    expect(decodeScript(benign.args)).toBe(TOAST_SCRIPT);
  });

  it("the decoded script source is the constant for every text, and no text or distinctive word from it is in the command line", () => {
    for (const text of HOSTILE) {
      const hostile = buildToastInvocation(reminder(text, { missed: true }), NOW);
      expect(decodeScript(hostile.args)).toBe(TOAST_SCRIPT);
      expect(TOAST_SCRIPT).not.toContain(text);
      const commandLine = [hostile.command, ...hostile.args].join("\n");
      for (const fragment of [text, ...text.split(/\s+/).filter((w) => w.length >= 6)]) {
        expect(commandLine).not.toContain(fragment);
      }
    }
  });

  it("the text arrives intact in ANNA_TOAST_LINE1 and nowhere else; only the four fixed variables are set", () => {
    for (const text of HOSTILE) {
      const { env } = buildToastInvocation(reminder(text), NOW);
      expect(env.ANNA_TOAST_LINE1).toBe(reminderMessage({ text }));
      expect(Object.keys(env).sort()).toEqual(["ANNA_TOAST_LINE1", "ANNA_TOAST_LINE2", "ANNA_TOAST_TITLE", "ANNA_TOAST_URL"]);
      expect(env.ANNA_TOAST_TITLE).toBe("ANNA");
      expect(env.ANNA_TOAST_LINE2).toBe("");
      expect(env.ANNA_TOAST_URL).toBe("http://127.0.0.1:3737/");
    }
  });

  it("the script XML-escapes every value it reads from the environment, and never evaluates it", () => {
    const reads = [...TOAST_SCRIPT.matchAll(/\$env:(ANNA_TOAST_\w+)/g)].map((m) => m[1]);
    expect(new Set(reads)).toEqual(new Set(["ANNA_TOAST_TITLE", "ANNA_TOAST_LINE1", "ANNA_TOAST_LINE2", "ANNA_TOAST_URL", "ANNA_TOAST_DRY_RUN"]));
    // Each text variable is read exactly once, as the argument of SecurityElement::Escape.
    for (const name of ["TITLE", "LINE1", "LINE2", "URL"]) {
      const escaped = new RegExp(`\\[System\\.Security\\.SecurityElement\\]::Escape\\(\\[string\\]\\$env:ANNA_TOAST_${name}\\)`);
      expect(TOAST_SCRIPT).toMatch(escaped);
      expect(TOAST_SCRIPT.split(`$env:ANNA_TOAST_${name}`)).toHaveLength(2);
    }
    expect(TOAST_SCRIPT).not.toMatch(/Invoke-Expression|\biex\b|Invoke-Command|Start-Process|-Command\b/i);
  });

  it.skipIf(process.platform !== "win32")(
    "real PowerShell: hostile text becomes escaped XML text and runs nothing (dry run: builds and loads the XML, shows no toast)",
    () => {
      for (const text of [HOSTILE[1]!, HOSTILE[2]!, HOSTILE[3]!, HOSTILE[5]!, HOSTILE[6]!]) {
        const invocation = buildToastInvocation(reminder(text, { missed: true }), NOW);
        const result = spawnSync(invocation.command, invocation.args, {
          env: { ...process.env, ...invocation.env, ANNA_TOAST_DRY_RUN: "1" },
          encoding: "utf8",
          windowsHide: true,
          timeout: 30_000,
        });
        expect(result.stderr).toBe("");
        expect(result.status).toBe(0);
        // No markup from the text reached the XML: only our own elements.
        const tags = [...result.stdout.matchAll(/<\/?([a-zA-Z]+)/g)].map((m) => m[1]);
        expect(new Set(tags)).toEqual(new Set(["toast", "visual", "binding", "text"]));
        expect(result.stdout).not.toContain("<script>");
        expect(result.stdout).not.toContain('launch="calc.exe"');
      }
    },
    90_000,
  );
});

describe("createToastNotifier gating and failure handling", () => {
  const ok: RunToastProcess = async () => ({ code: 0, stderr: "" });
  const spy = () => vi.fn<(i: ToastInvocation) => ReturnType<RunToastProcess>>(ok);

  it("on Windows it spawns exactly once per reminder", async () => {
    const run = spy();
    const logs: string[] = [];
    await createToastNotifier({ platform: "win32", env: {}, run, log: (l) => logs.push(l), clock: () => NOW }).notify(reminder("call Dad"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0].env.ANNA_TOAST_LINE1).toBe("You asked me to remind you to call Dad.");
    expect(logs).toEqual(["[anna] toast shown for reminder r1 (exit 0)"]);
  });

  it.each(["linux", "darwin"])("on %s it never spawns", async (platform) => {
    const run = spy();
    await createToastNotifier({ platform, env: {}, run, log: () => {} }).notify(reminder("call Dad"));
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["off", "OFF", " off "])("ANNA_DESKTOP_NOTIFICATIONS=%j means no spawn, even on Windows", async (value) => {
    const run = spy();
    await createToastNotifier({ platform: "win32", env: { ANNA_DESKTOP_NOTIFICATIONS: value }, run, log: () => {} }).notify(reminder("x"));
    expect(run).not.toHaveBeenCalled();
  });

  it("a non-zero exit is logged as one line with the first line of stderr, and does not throw", async () => {
    const logs: string[] = [];
    const run: RunToastProcess = async () => ({ code: 1, stderr: "\r\nThe type was not found\r\nat line 3\r\n" });
    await expect(createToastNotifier({ platform: "win32", env: {}, run, log: (l) => logs.push(l) }).notify(reminder("x"))).resolves.toBeUndefined();
    expect(logs).toEqual(["[anna] toast failed for reminder r1 (exit 1): The type was not found"]);
  });

  it("a spawn error (no powershell.exe) is logged as one line and does not throw", async () => {
    const logs: string[] = [];
    const run: RunToastProcess = async () => {
      throw new Error("spawn powershell.exe ENOENT");
    };
    await expect(createToastNotifier({ platform: "win32", env: {}, run, log: (l) => logs.push(l) }).notify(reminder("x"))).resolves.toBeUndefined();
    expect(logs).toEqual(["[anna] toast could not start for reminder r1: spawn powershell.exe ENOENT"]);
  });

  it("the log line never contains the reminder text", async () => {
    const logs: string[] = [];
    await createToastNotifier({ platform: "win32", env: {}, run: ok, log: (l) => logs.push(l) }).notify(reminder("secret surprise party"));
    expect(logs.join("\n")).not.toContain("surprise");
  });
});
