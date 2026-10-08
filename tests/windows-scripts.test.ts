// Guards for the Windows install scripts: they must stay ASCII (PowerShell 5.1 reads a BOM-less file as the ANSI code page),
// must parse, and must keep the behaviours the tester kit promises.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "scripts", "windows");
const scripts = readdirSync(dir).filter((f) => f.endsWith(".ps1"));
const read = (name: string) => readFileSync(join(dir, name), "utf8");

describe("scripts/windows/*.ps1", () => {
  it.each(scripts)("%s is ASCII only", (name) => {
    expect([...readFileSync(join(dir, name))].filter((byte) => byte > 127)).toEqual([]);
  });

  it.skipIf(process.platform !== "win32")("all of them parse in Windows PowerShell", () => {
    const command = `$bad = 0; foreach ($f in Get-ChildItem '${dir}' -Filter *.ps1) { $e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$t, [ref]$e); foreach ($x in $e) { $bad++; Write-Output ($f.Name + ': ' + $x.Message) } }; Write-Output "errors=$bad"`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" });
    expect(result.stdout.trim()).toBe("errors=0");
  });

  it("the installer offers winget with exactly the command the brief names, and checks Node 22", () => {
    const common = read("common.ps1");
    expect(common).toContain("Node.js is needed. Install it now with winget? [Y/n]");
    expect(common).toContain("winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements");
    expect(common).toMatch(/\[int\]\$MinMajor = 22/);
    expect(common).toContain("https://nodejs.org/en/download");
    expect(read("install.ps1")).toMatch(/\[int\]\$MinNodeMajor = 22/);
  });

  it("the installer unblocks downloaded scripts, counts its steps, and ends with a clear SUCCESS or FAILED line", () => {
    expect(read("common.ps1")).toContain("Unblock-File");
    const install = read("install.ps1");
    for (const step of ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5"]) expect(install).toContain(`Write-Step ${step.slice(5)} `);
    expect(install).toContain("$totalSteps = 5");
    expect(install).toContain("SUCCESS: ANNA is installed.");
    expect(install).toContain("FAILED: ANNA was not installed.");
  });

  it("the data lives outside the app folder in tester mode, and the installer never deletes it", () => {
    const common = read("common.ps1");
    expect(common).toContain("'ANNA'"); // %LOCALAPPDATA%\ANNA
    expect(common).toContain("anna.db");
    expect(common).toContain("config.env");
    expect(common).toContain("prisma migrate deploy");
    for (const name of scripts) expect(read(name), `${name} must not delete data`).not.toMatch(/Remove-Item[^\n]*(DataDir|anna\.db|config\.env)/i);
  });
});
