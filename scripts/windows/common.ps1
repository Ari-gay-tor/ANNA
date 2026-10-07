# Shared helpers for the ANNA Windows scripts. Dot-source it: . "$PSScriptRoot\common.ps1"
# Keep this file ASCII only: Windows PowerShell 5.1 reads a BOM-less file as the ANSI code page.

$ErrorActionPreference = 'Stop'

$script:AnnaRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:AnnaLogDir = Join-Path $script:AnnaRoot 'logs'
$script:AnnaLogFile = Join-Path $script:AnnaLogDir 'anna.log'
$script:AnnaIcon = Join-Path $PSScriptRoot 'anna.ico'
$script:PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

# The port: ANNA_PORT from the environment, else from .env, else 3737.
# Keep the rules in step with scripts\start-server.mjs and src\server\app-config.ts.
function Get-AnnaPort {
    $raw = $env:ANNA_PORT
    if (-not $raw) {
        $envFile = Join-Path $script:AnnaRoot '.env'
        if (Test-Path $envFile) {
            foreach ($line in Get-Content $envFile) {
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

# Appends one line to logs\anna.log (the server's own output goes to the same file). Never throws.
function Write-AnnaLog([string]$Message) {
    try {
        New-Item -ItemType Directory -Force $script:AnnaLogDir | Out-Null
        $line = '[anna] ' + (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') + ' ' + $Message + "`n"
        $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($line)
        $stream = [System.IO.File]::Open($script:AnnaLogFile, 'Append', 'Write', 'ReadWrite')
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

# npm install, prisma migrate deploy and build, in the repo. Throws a plain message on the first failure.
function Invoke-AnnaSetup {
    Push-Location $script:AnnaRoot
    try {
        Write-Host 'Installing packages (npm install)...'
        & npm.cmd install
        if ($LASTEXITCODE -ne 0) { throw 'npm install failed. Fix the error above, then run this again.' }
        Write-Host 'Preparing the database (prisma migrate deploy)...'
        & npx.cmd prisma migrate deploy
        if ($LASTEXITCODE -ne 0) { throw 'prisma migrate deploy failed. Fix the error above (is DATABASE_URL in .env right?), then run this again.' }
        Write-Host 'Building ANNA (npm run build)...'
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'npm run build failed. Fix the error above, then run this again.' }
    } finally {
        Pop-Location
    }
}

function Get-ShortcutPaths([string]$DesktopDir, [string]$StartMenuDir, [string]$StartupDir) {
    [pscustomobject]@{
        Desktop   = Join-Path $DesktopDir 'ANNA.lnk'
        StartMenu = Join-Path $StartMenuDir 'ANNA.lnk'
        Startup   = Join-Path $StartupDir 'ANNA server.lnk'
    }
}
