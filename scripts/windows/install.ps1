# Installs ANNA as a one-click app: builds it, adds the Desktop and Start menu shortcuts, starts it at login,
# then starts it now and opens the window. Safe to run again: shortcuts are overwritten, never duplicated.
#
# The three folder parameters default to your real folders. Pass others to try the install without touching them.
# -SkipBuild skips npm install / prisma migrate deploy / build, and -NoLaunch skips starting ANNA (both are for testing).
param(
    [string]$DesktopDir = [Environment]::GetFolderPath('Desktop'),
    [string]$StartMenuDir = [Environment]::GetFolderPath('Programs'),
    [string]$StartupDir = [Environment]::GetFolderPath('Startup'),
    [switch]$SkipBuild,
    [switch]$NoLaunch
)
. "$PSScriptRoot\common.ps1"

function New-AnnaShortcut([string]$LinkPath, [string]$Script) {
    New-Item -ItemType Directory -Force (Split-Path $LinkPath) | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($LinkPath)
    $link.TargetPath = $script:PowerShellExe
    $link.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $Script + '"'
    $link.WorkingDirectory = $script:AnnaRoot
    $link.IconLocation = $script:AnnaIcon + ',0'
    $link.WindowStyle = 7   # minimized, so the PowerShell console never sits on screen
    $link.Description = 'ANNA'
    $link.Save()
}

try {
    # 1. Node 22 or newer.
    $node = Find-Node
    if (-not $node) { throw 'Node.js was not found. Install Node 22 or newer from https://nodejs.org, then run install-anna.cmd again.' }
    $version = (& $node --version).Trim()
    if ($version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) {
        throw "ANNA needs Node 22 or newer, but this PC has $version. Install the current LTS from https://nodejs.org, then run install-anna.cmd again."
    }
    Write-Host "Node $version found."

    # 2. Build. ANNA is stopped first so no file (the Prisma engine, .next) is locked.
    if (-not $SkipBuild) {
        & "$PSScriptRoot\stop-anna.ps1"
        Invoke-AnnaSetup
    }

    # 3. Icon, then the shortcuts.
    if (-not (Test-Path $script:AnnaIcon)) { & "$PSScriptRoot\make-icons.ps1" }
    $paths = Get-ShortcutPaths $DesktopDir $StartMenuDir $StartupDir
    New-AnnaShortcut $paths.Desktop (Join-Path $PSScriptRoot 'open-anna.ps1')
    New-AnnaShortcut $paths.StartMenu (Join-Path $PSScriptRoot 'open-anna.ps1')
    # 4. Start at login: a shortcut in the Startup folder (per user, easy to remove).
    New-AnnaShortcut $paths.Startup (Join-Path $PSScriptRoot 'start-anna.ps1')

    # 5. Start now.
    if (-not $NoLaunch) {
        & "$PSScriptRoot\open-anna.ps1"
        if ($LASTEXITCODE -ne 0) { throw 'ANNA is installed but did not start. See logs\anna.log for the reason.' }
    }

    # 6. Summary.
    Write-Host ''
    Write-Host "ANNA is installed. Open it with the ANNA shortcut on your Desktop or in the Start menu ($($paths.Desktop))."
    Write-Host "It starts quietly in the background whenever you log in to Windows ($($paths.Startup))."
    Write-Host "Your data stays in prisma\dev.db and .env, logs are in logs\anna.log. To remove ANNA: uninstall-anna.cmd."
    exit 0
} catch {
    Write-Host ''
    Write-Host "ANNA was not installed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
