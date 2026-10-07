# What the ANNA shortcut runs: make sure the server is up, then open ANNA in her own Edge window (no tabs, no address bar).
# If that window is already open it is brought to the front instead of opening a second one.
# Falls back to the default browser if Edge is not installed.
param([switch]$NoDialog)
. "$PSScriptRoot\common.ps1"

# Finds an open ANNA app window: a visible Edge window whose title is exactly "ANNA" (a normal tab's window title ends with
# "- Microsoft Edge", so it never matches), restores it if minimized and brings it forward. Returns $true if one was found.
function Show-ExistingAnnaWindow {
    try {
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AnnaWindowFinder {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    public static bool Show() {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate (IntPtr h, IntPtr l) {
            if (!IsWindowVisible(h)) return true;
            StringBuilder title = new StringBuilder(64); GetWindowText(h, title, 64);
            StringBuilder cls = new StringBuilder(64); GetClassName(h, cls, 64);
            if (title.ToString() == "ANNA" && cls.ToString() == "Chrome_WidgetWin_1") { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        if (found == IntPtr.Zero) return false;
        if (IsIconic(found)) ShowWindow(found, 9);
        SetForegroundWindow(found);
        return true;
    }
}
'@
        return [AnnaWindowFinder]::Show()
    } catch {
        return $false
    }
}

& "$PSScriptRoot\start-anna.ps1"
$code = $LASTEXITCODE
if ($code -ne 0) {
    # The shortcut has no console, so say it in a dialog or the click would look like nothing happened.
    if (-not $NoDialog) {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show("ANNA could not start (code $code).`n`nSee logs\anna.log in the ANNA folder:`n$script:AnnaRoot", 'ANNA', 'OK', 'Warning')
    }
    exit $code
}

if (Show-ExistingAnnaWindow) {
    Write-Host 'ANNA window was already open; brought it to the front.'
    exit 0
}

$url = 'http://127.0.0.1:' + (Get-AnnaPort) + '/'
$edge = Find-Edge
if ($edge) {
    Start-Process -FilePath $edge -ArgumentList "--app=$url"
} else {
    Write-AnnaLog 'open-anna: Microsoft Edge not found, using the default browser'
    Start-Process $url
}
