# Shared helpers for the ANNA Windows scripts. Dot-source it: . "$PSScriptRoot\common.ps1"
# Keep this file ASCII only: Windows PowerShell 5.1 reads a BOM-less file as the ANSI code page.

$ErrorActionPreference = 'Stop'

$script:AnnaRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:AnnaIcon = Join-Path $PSScriptRoot 'anna.ico'
$script:PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

# Two modes (keep the rules in step with scripts\anna-env.mjs):
#   dev     the app folder has a .env (Ari's repo). Nothing moves: .env, prisma\dev.db and logs\ stay in the app folder.
#   tester  the app folder has no .env. Data lives in the data folder, %LOCALAPPDATA%\ANNA by default:
#             anna.db, config.env (GEMINI_API_KEY, ANNA_PORT, ...) and logs\anna.log.
# ANNA_DATA_DIR (or the -DataDir parameter of the scripts) overrides the data folder and always means tester mode.

# Call right after dot-sourcing, with the script's -DataDir parameter. An empty value changes nothing.
function Set-AnnaDataDirOverride([string]$Path) {
    if ($Path -and $Path.Trim()) {
        $env:ANNA_DATA_DIR = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path.Trim())
    }
}

# Mode, DataDir ($null in dev mode), Overridden (the data folder was chosen with ANNA_DATA_DIR), ConfigFile, LogDir, LogFile.
function Get-AnnaMode {
    $override = if ($env:ANNA_DATA_DIR) { $env:ANNA_DATA_DIR.Trim() } else { '' }
    $dataDir = $null
    if ($override) {
        $dataDir = $override
    } elseif (-not (Test-Path (Join-Path $script:AnnaRoot '.env'))) {
        $local = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
        $dataDir = Join-Path $local 'ANNA'
    }
    if ($dataDir) {
        $logDir = Join-Path $dataDir 'logs'
        return [pscustomobject]@{
            Mode = 'tester'; DataDir = $dataDir; Overridden = [bool]$override
            ConfigFile = Join-Path $dataDir 'config.env'; LogDir = $logDir; LogFile = Join-Path $logDir 'anna.log'
        }
    }
    $logDir = Join-Path $script:AnnaRoot 'logs'
    [pscustomobject]@{
        Mode = 'dev'; DataDir = $null; Overridden = $false
        ConfigFile = Join-Path $script:AnnaRoot '.env'; LogDir = $logDir; LogFile = Join-Path $logDir 'anna.log'
    }
}

# The SQLite file ANNA uses: anna.db in the data folder, or the one DATABASE_URL in .env points at (relative paths are relative to prisma\).
function Get-AnnaDatabasePath {
    $mode = Get-AnnaMode
    if ($mode.Mode -eq 'tester') { return Join-Path $mode.DataDir 'anna.db' }
    foreach ($line in Get-Content $mode.ConfigFile) {
        if ($line -match '^\s*DATABASE_URL\s*=\s*["'']?file:([^"''#\s]+)') {
            $path = $Matches[1]
            if ([System.IO.Path]::IsPathRooted($path)) { return $path }
            return [System.IO.Path]::GetFullPath((Join-Path (Join-Path $script:AnnaRoot 'prisma') $path))
        }
    }
    return Join-Path $script:AnnaRoot 'prisma\dev.db'
}

# In tester mode the setup commands (prisma generate / migrate deploy / next build) must see the data folder's database.
# This only sets the variable for this PowerShell process and its children.
function Set-AnnaSetupEnv {
    $mode = Get-AnnaMode
    if ($mode.Mode -eq 'tester') {
        $env:DATABASE_URL = 'file:' + (Get-AnnaDatabasePath).Replace('\', '/')
    }
}

# The port: ANNA_PORT from the environment, else from the config file (.env or config.env), else 3737.
# Keep the rules in step with scripts\start-server.mjs and src\server\app-config.ts.
function Get-AnnaPort {
    $raw = $env:ANNA_PORT
    if (-not $raw) {
        $configFile = (Get-AnnaMode).ConfigFile
        if (Test-Path $configFile) {
            foreach ($line in Get-Content $configFile) {
                if ($line -match '^\s*ANNA_PORT\s*=\s*["'']?(\d+)["'']?\s*(#.*)?$') { $raw = $Matches[1]; break }
            }
        }
    }
    if ($raw -and $raw.Trim() -match '^\d+$') {
        $port = [int]$raw.Trim()
        if ($port -ge 1 -and $port -le 65535) { return $port }
    }
    return 3737
}

# Appends one line to anna.log (the server's own output goes to the same file). Never throws.
function Write-AnnaLog([string]$Message) {
    try {
        $mode = Get-AnnaMode
        New-Item -ItemType Directory -Force $mode.LogDir | Out-Null
        $line = '[anna] ' + (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') + ' ' + $Message + "`n"
        $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($line)
        $stream = [System.IO.File]::Open($mode.LogFile, 'Append', 'Write', 'ReadWrite')
        try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    } catch { }
}

# Asks /api/health. Returns 'anna' (it is ANNA), 'other' (something else answered HTTP) or 'none' (no HTTP answer).
function Get-AnnaHealth([int]$Port) {
    try {
        $request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/api/health")
        $request.Proxy = $null
        $request.Timeout = 2500
        $response = $request.GetResponse()
        try {
            $text = (New-Object System.IO.StreamReader($response.GetResponseStream())).ReadToEnd()
        } finally { $response.Close() }
        $json = $text | ConvertFrom-Json
        if ($json.ok -eq $true -and $json.app -eq 'anna') { return 'anna' }
        return 'other'
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) { return 'other' }
        return 'none'
    } catch {
        return 'other'
    }
}

# The process listening on the port, or $null. Returns Pid, Name and CommandLine.
function Get-PortListener([int]$Port) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $conn) { return $null }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($conn.OwningProcess)" -ErrorAction SilentlyContinue
    [pscustomobject]@{
        Pid         = [int]$conn.OwningProcess
        Name        = if ($proc) { $proc.Name } else { '' }
        CommandLine = if ($proc -and $proc.CommandLine) { $proc.CommandLine } else { '' }
    }
}

# True when the command line is Next's server started from this repo.
function Test-IsAnnaServer([string]$CommandLine) {
    if (-not $CommandLine) { return $false }
    return ($CommandLine -match 'next') -and ($CommandLine.IndexOf($script:AnnaRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
}

function Find-Node {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    $fallback = Join-Path $env:ProgramFiles 'nodejs\node.exe'
    if (Test-Path $fallback) { return $fallback }
    return $null
}

# "v22.16.0" from node.exe, and its major number. $null when node cannot be run.
function Get-NodeVersion([string]$NodePath) {
    try {
        $version = (& $NodePath --version).Trim()
        if ($version -match '^v(\d+)\.') { return [pscustomobject]@{ Text = $version; Major = [int]$Matches[1] } }
    } catch { }
    return $null
}

# Makes sure Node $MinMajor or newer is available, offering to install it with winget. Returns the path to node.exe.
# Throws a plain message when it cannot be done (the caller prints it).
function Confirm-AnnaNode([int]$MinMajor = 22) {
    $downloadHint = 'Download the LTS version from https://nodejs.org/en/download, install it, then run install-anna.cmd again.'
    $node = Find-Node
    $version = if ($node) { Get-NodeVersion $node } else { $null }
    if ($version -and $version.Major -ge $MinMajor) {
        Write-Host "  Node $($version.Text) found."
        return $node
    }

    if ($version) {
        Write-Host "  ANNA needs Node $MinMajor or newer, but this PC has $($version.Text)."
    } else {
        Write-Host '  Node.js was not found on this PC.'
    }
    $winget = Get-Command winget -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $winget) {
        throw "winget is not available on this PC, so Node.js cannot be installed automatically. $downloadHint"
    }
    $answer = $null
    try { $answer = Read-Host 'Node.js is needed. Install it now with winget? [Y/n]' } catch { }
    if ($null -eq $answer) { throw "Node.js is needed, and there was nobody to ask about installing it. $downloadHint" }
    if ($answer.Trim() -match '^(n|no)$') { throw "Node.js is needed. $downloadHint" }

    Write-Host '  Installing Node.js with winget (Windows may ask you to approve it)...'
    & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "winget could not install Node.js (code $LASTEXITCODE). $downloadHint" }

    # The installer changed the PATH for new windows; pick it up in this one.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $node = Find-Node
    $version = if ($node) { Get-NodeVersion $node } else { $null }
    if ($version -and $version.Major -ge $MinMajor) {
        Write-Host "  Node $($version.Text) is installed."
        return $node
    }
    throw 'Node.js was installed, but this window cannot see it yet. Close this window and double-click install-anna.cmd again.'
}

# Windows marks files from a downloaded zip as "from the internet". Remove that mark from ANNA's scripts. Returns how many were marked.
function Unblock-AnnaScripts {
    $files = @(Get-ChildItem -Path $script:AnnaRoot -File -Filter '*.cmd' -ErrorAction SilentlyContinue) +
        @(Get-ChildItem -Path (Join-Path $script:AnnaRoot 'scripts') -Recurse -File -ErrorAction SilentlyContinue)
    $count = 0
    foreach ($file in $files) {
        if (Get-Item -LiteralPath $file.FullName -Stream 'Zone.Identifier' -ErrorAction SilentlyContinue) {
            Unblock-File -LiteralPath $file.FullName
            $count++
        }
    }
    return $count
}

function Find-Edge {
    $keys = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe'
    )
    foreach ($key in $keys) {
        $item = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
        $path = if ($item) { $item.'(default)' } else { $null }
        if ($path -and (Test-Path $path)) { return $path }
    }
    foreach ($base in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) {
        if (-not $base) { continue }
        $candidate = Join-Path $base 'Microsoft\Edge\Application\msedge.exe'
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

# --- Setup steps (used by install.ps1 and update.ps1). Each throws a plain message on failure. ---

# First install in a tester folder: npm ci (exact versions from package-lock.json). After that, npm install. Dev mode: npm install, as always.
function Install-AnnaPackages {
    Push-Location $script:AnnaRoot
    try {
        $tester = (Get-AnnaMode).Mode -eq 'tester'
        if ($tester -and -not (Test-Path (Join-Path $script:AnnaRoot 'node_modules'))) {
            & npm.cmd ci --no-audit --no-fund
        } elseif ($tester) {
            & npm.cmd install --no-audit --no-fund
        } else {
            & npm.cmd install
        }
        if ($LASTEXITCODE -ne 0) { throw 'Installing the packages failed (see the error above). Check your internet connection, then run this again.' }
    } finally {
        Pop-Location
    }
}

# Tester mode: creates the data folder and an empty anna.db the first time. Never deletes or replaces anything. Dev mode: nothing to do.
function Initialize-AnnaData {
    $mode = Get-AnnaMode
    if ($mode.Mode -ne 'tester') {
        Write-Host '  Dev mode: ANNA keeps using .env and the database named in it, in this folder.'
        return
    }
    New-Item -ItemType Directory -Force $mode.LogDir | Out-Null
    $db = Get-AnnaDatabasePath
    if (Test-Path $db) {
        Write-Host "  Found your existing data in $($mode.DataDir). It is kept as it is."
    } else {
        New-Item -ItemType File $db | Out-Null
        Write-Host "  Created your database in $($mode.DataDir)"
    }
}

# prisma migrate deploy against the active database: adds what is missing and keeps what is there.
function Update-AnnaDatabase {
    Push-Location $script:AnnaRoot
    try {
        Set-AnnaSetupEnv
        & npx.cmd prisma migrate deploy
        if ($LASTEXITCODE -ne 0) { throw "Preparing the database failed (see the error above). Your data was not changed. Database file: $(Get-AnnaDatabasePath)" }
    } finally {
        Pop-Location
    }
}

function Build-Anna {
    Push-Location $script:AnnaRoot
    try {
        Set-AnnaSetupEnv
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Building ANNA failed (see the error above). Fix it, then run this again.' }
    } finally {
        Pop-Location
    }
}

# npm install, prisma migrate deploy and build, in the app folder (update.ps1).
function Invoke-AnnaSetup {
    Set-AnnaSetupEnv
    Write-Host 'Installing packages...'
    Install-AnnaPackages
    Initialize-AnnaData
    Write-Host 'Preparing the database (prisma migrate deploy)...'
    Update-AnnaDatabase
    Write-Host 'Building ANNA (npm run build)...'
    Build-Anna
}

function Get-ShortcutPaths([string]$DesktopDir, [string]$StartMenuDir, [string]$StartupDir) {
    [pscustomobject]@{
        Desktop   = Join-Path $DesktopDir 'ANNA.lnk'
        StartMenu = Join-Path $StartMenuDir 'ANNA.lnk'
        Startup   = Join-Path $StartupDir 'ANNA server.lnk'
    }
}
