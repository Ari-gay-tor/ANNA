// Windows toast notifications for fired reminders, so they show even when the ANNA window is closed.
//
// SECURITY: reminder text comes from the model and the user, so it never goes into the command line or into the script source.
// The PowerShell script below is a constant. The text reaches it only through environment variables of the child process, and
// the script XML-escapes it before building the toast XML. tests/toast-notifier.test.ts pins both properties.

import { spawn } from "node:child_process";
import { missedMessage, reminderMessage } from "../components/reminder-text";
import { appUrl, desktopToastsEnabled, type Env } from "./app-config";

/** A reminder that just fired. */
export interface FiredReminder {
  id: string;
  text: string;
  dueAt: Date;
  timezone: string;
  missed: boolean;
}

export interface ReminderNotifier {
  /** Resolves when done; never needs to throw (the poller also guards against it). */
  notify(reminder: FiredReminder): Promise<void>;
}

/** A notifier that does nothing. */
export const silentNotifier: ReminderNotifier = { notify: async () => {} };

/**
 * AppUserModelID of Windows PowerShell. It is registered by Windows itself, so a toast sent under it needs no
 * registration or Start-menu shortcut from us. The cost: Windows labels the toast "Windows PowerShell" in its header
 * (the title line still says ANNA), and the toast follows PowerShell's notification settings.
 */
const POWERSHELL_APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe";

/** The one script every toast runs. Constant on purpose: nothing is interpolated into it. */
export const TOAST_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
  $title = [System.Security.SecurityElement]::Escape([string]$env:ANNA_TOAST_TITLE)
  $line1 = [System.Security.SecurityElement]::Escape([string]$env:ANNA_TOAST_LINE1)
  $line2 = [System.Security.SecurityElement]::Escape([string]$env:ANNA_TOAST_LINE2)
  $url = [System.Security.SecurityElement]::Escape([string]$env:ANNA_TOAST_URL)
  $texts = '<text>' + $title + '</text><text>' + $line1 + '</text>'
  if ($line2) { $texts = $texts + '<text>' + $line2 + '</text>' }
  $xmlText = '<toast activationType="protocol" launch="' + $url + '"><visual><binding template="ToastGeneric">' + $texts + '</binding></visual></toast>'
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml($xmlText)
  if ($env:ANNA_TOAST_DRY_RUN -eq '1') {
    [Console]::Out.WriteLine($xmlText)
    exit 0
  }
  $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${POWERSHELL_APP_ID}').Show($toast)
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`;

export interface ToastInvocation {
  command: string;
  args: string[];
  /** Only the variables ANNA adds to the child's environment; the runner merges them over the server's own. */
  env: Record<string, string>;
}

/** Control characters that are not legal in XML (and a NUL would make Node refuse the env value). Newlines and tabs stay. */
function cleanForXml(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");
}

export function buildToastInvocation(reminder: FiredReminder, now: Date, env: Env = process.env): ToastInvocation {
  const shown = { dueAt: reminder.dueAt.toISOString(), timezone: reminder.timezone };
  return {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      Buffer.from(TOAST_SCRIPT, "utf16le").toString("base64"),
    ],
    env: {
      ANNA_TOAST_TITLE: "ANNA",
      ANNA_TOAST_LINE1: cleanForXml(reminderMessage({ text: reminder.text })),
      ANNA_TOAST_LINE2: reminder.missed ? cleanForXml(missedMessage(shown, now)) : "",
      ANNA_TOAST_URL: appUrl(env),
    },
  };
}

export interface RunResult {
  code: number | null;
  stderr: string;
}
export type RunToastProcess = (invocation: ToastInvocation) => Promise<RunResult>;

const TOAST_TIMEOUT_MS = 20_000;

/** Runs the child with a hidden window and waits for it to exit (or kills it after 20 s). */
export const runToastProcess: RunToastProcess = (invocation) =>
  new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      env: { ...process.env, ...invocation.env },
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 2000) stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ code: null, stderr: "timed out" });
    }, TOAST_TIMEOUT_MS);
    timer.unref?.();
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });

export interface ToastNotifierOptions {
  platform?: string;
  env?: Env;
  run?: RunToastProcess;
  log?: (line: string) => void;
  clock?: () => Date;
}

/** The first line of the child's stderr, cut to a length that keeps the log line short. */
function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "" && !l.startsWith("#<")) ?? "";
  return line.replace(/[\u0000-\u001F]/g, " ").trim().slice(0, 200);
}

/** Does nothing (and never spawns) unless desktopToastsEnabled(platform, env). Failures are logged as one line, never thrown. */
export function createToastNotifier(options: ToastNotifierOptions = {}): ReminderNotifier {
  const { platform = process.platform, env = process.env, run = runToastProcess, log = (line) => console.log(line), clock = () => new Date() } = options;
  return {
    async notify(reminder) {
      if (!desktopToastsEnabled(platform, env)) return;
      try {
        const result = await run(buildToastInvocation(reminder, clock(), env));
        if (result.code === 0) log(`[anna] toast shown for reminder ${reminder.id} (exit 0)`);
        else log(`[anna] toast failed for reminder ${reminder.id} (exit ${result.code ?? "none"}): ${firstLine(result.stderr)}`);
      } catch (error) {
        log(`[anna] toast could not start for reminder ${reminder.id}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    },
  };
}
