# Installs ANNA as a one-click app: checks Node, installs packages, sets up the database, builds ANNA, adds the Desktop and
# Start menu shortcuts, starts it at login, then starts it now and opens the window.
# Safe to run again: shortcuts are overwritten, never duplicated, and your data is migrated, never deleted.
#
# Where the data lives: in a tester folder (no .env here) it is %LOCALAPPDATA%\ANNA, outside this folder, so a newer zip
# never loses it. In Ari's repo (a .env exists) nothing moves. See docs\app.md.
#
# The three folder parameters default to your real folders, and -DataDir to %LOCALAPPDATA%\ANNA. Pass others to try the install
# without touching them (the shortcuts then remember the data folder). -SkipBuild skips npm install / migrate / build,
# -NoLaunch skips starting ANNA, and -MinNodeMajor changes the Node version that is required (all three are for testing).
param(
    [string]$DesktopDir = [Environment]::GetFolderPath('Desktop'),
    [string]$StartMenuDir = [Environment]::GetFolderPath('Programs'),
    [string]$StartupDir = [Environment]::GetFolderPath('Startup'),
    [string]$DataDir,
    [int]$MinNodeMajor = 22,
    [switch]$SkipBuild,
    [switch]$NoLaunch
)
. "$PSScriptRoot\common.ps1"
Set-AnnaDataDirOverride $DataDir

$totalSteps = 5
function Write-Step([int]$Number, [string]$Text) {
    Write-Host ''
    Write-Host "Step $Number/$totalSteps  $Text" -ForegroundColor Cyan
}

function New-AnnaShortcut([string]$LinkPath, [string]$Script, [string]$ExtraArguments) {
    New-Item -ItemType Directory -Force (Split-Path $LinkPath) | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($LinkPath)
    $link.TargetPath = $script:PowerShellExe
    $link.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $Script + '"' + $ExtraArguments
    $link.WorkingDirectory = $script:AnnaRoot
    $link.IconLocation = $script:AnnaIcon + ',0'
    $link.WindowStyle = 7   # minimized, so the PowerShell console never sits on screen
    $link.Description = 'ANNA'
    $link.Save()
}

try {
    $mode = Get-AnnaMode
    $tester = $mode.Mode -eq 'tester'
    Write-Host 'Installing ANNA.' -ForegroundColor Cyan
    if ($tester) {
        Write-Host "Your data will be kept in $($mode.DataDir), outside this folder, so updating never touches it."
    } else {
        Write-Host 'Dev mode (this folder has a .env): your data stays where it is.'
    }
    Set-AnnaSetupEnv

    # 1. Node 22 or newer, and downloaded-file blocks.
    Write-Step 1 'Checking Node.js'
    $null = Confirm-AnnaNode $MinNodeMajor
    $unblocked = Unblock-AnnaScripts
    if ($unblocked -gt 0) { Write-Host "  Unblocked $unblocked downloaded file(s), so Windows will not warn about them again." }

    # 2-4. Packages, data, build. ANNA is stopped first so no file (the Prisma engine, .next) is locked. A tester who unpacked a
    #      newer zip into a new folder may still have the old folder's ANNA running on the same port, so any ANNA is stopped.
    if ($SkipBuild) {
        Write-Step 2 'Installing packages: skipped (-SkipBuild)'
        Write-Step 3 'Setting up your data'
        Initialize-AnnaData
        Write-Host '  Database update skipped (-SkipBuild).'
        Write-Step 4 'Building ANNA: skipped (-SkipBuild)'
    } else {
        Write-Host '  Stopping ANNA if it is running...'
        & "$PSScriptRoot\stop-anna.ps1" -AnyFolder:$tester
        Write-Step 2 'Installing packages (a few minutes the first time; needs the internet)'
        Install-AnnaPackages
        Write-Step 3 'Setting up your data'
        Initialize-AnnaData
        Update-AnnaDatabase
        Write-Host "  Database is up to date: $(Get-AnnaDatabasePath)"
        Write-Step 4 'Building ANNA (a few minutes)'
        Build-Anna
    }

    # 5. Icon, shortcuts, start at login, start now.
    Write-Step 5 'Adding shortcuts and starting ANNA'
    if (-not (Test-Path $script:AnnaIcon)) { & "$PSScriptRoot\make-icons.ps1" }
    $extra = if ($mode.Overridden) { ' -DataDir "' + $mode.DataDir + '"' } else { '' }
    $paths = Get-ShortcutPaths $DesktopDir $StartMenuDir $StartupDir
    New-AnnaShortcut $paths.Desktop (Join-Path $PSScriptRoot 'open-anna.ps1') $extra
    New-AnnaShortcut $paths.StartMenu (Join-Path $PSScriptRoot 'open-anna.ps1') $extra
    # Start at login: a shortcut in the Startup folder (per user, easy to remove).
    New-AnnaShortcut $paths.Startup (Join-Path $PSScriptRoot 'start-anna.ps1') $extra
    Write-Host "  Desktop shortcut:    $($paths.Desktop)"
    Write-Host "  Start menu shortcut: $($paths.StartMenu)"
    Write-Host "  Start at login:      $($paths.Startup)"
    if ($NoLaunch) {
        Write-Host '  Not starting ANNA now (-NoLaunch).'
    } else {
        & "$PSScriptRoot\open-anna.ps1"
        if ($LASTEXITCODE -ne 0) { throw "ANNA is installed but did not start. See $($mode.LogFile) for the reason." }
    }

    Write-Host ''
    Write-Host 'SUCCESS: ANNA is installed.' -ForegroundColor Green
    Write-Host 'Open her any time with the ANNA icon on your Desktop or in the Start menu. She also starts quietly when you log in to Windows.'
    if ($tester) {
        Write-Host 'The first time, ANNA asks for a free Gemini key. Follow the steps on the screen.'
        Write-Host "Your data (kept when you update): $($mode.DataDir)"
        Write-Host "If something goes wrong, send Ari this file: $($mode.LogFile)"
    } else {
        Write-Host "Your data stays in $(Get-AnnaDatabasePath) and .env, logs are in $($mode.LogFile)."
    }
    Write-Host 'To remove ANNA: uninstall-anna.cmd.'
    exit 0
} catch {
    Write-Host ''
    Write-Host "FAILED: ANNA was not installed. $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Nothing of yours was deleted. You can run install-anna.cmd again.'
    exit 1
}
