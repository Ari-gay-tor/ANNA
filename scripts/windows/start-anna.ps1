# Starts the ANNA server silently (no window). Does nothing if ANNA is already running.
# Exit codes: 0 running, 2 the port is taken by another program, 3 did not become healthy in time, 4 cannot start (no Node, or not built).
. "$PSScriptRoot\common.ps1"

$port = Get-AnnaPort

# One start at a time: the login entry and a shortcut click can arrive together.
$mutex = New-Object System.Threading.Mutex($false, 'Local\ANNA-start')
$owned = $false
try {
    try { $owned = $mutex.WaitOne(45000) } catch [System.Threading.AbandonedMutexException] { $owned = $true }

    if ((Get-AnnaHealth $port) -eq 'anna') {
        Write-Host "ANNA is already running on port $port."
        exit 0
    }

    $listener = Get-PortListener $port
    if ($listener -and -not (Test-IsAnnaServer $listener.CommandLine)) {
        $msg = "Port $port is used by another program ($($listener.Name), process $($listener.Pid)), so ANNA was not started. Close that program or set ANNA_PORT in .env to a free port."
        Write-AnnaLog $msg
        Write-Host $msg
        exit 2
    }

    if (-not $listener) {
        $node = Find-Node
        if (-not $node) {
            $msg = 'Node.js was not found, so ANNA was not started. Install Node 22 or newer from https://nodejs.org and run install-anna.cmd again.'
            Write-AnnaLog $msg
            Write-Host $msg
            exit 4
        }
        if (-not (Test-Path (Join-Path $script:AnnaRoot '.next\BUILD_ID'))) {
            $msg = 'ANNA has not been built yet, so it was not started. Run install-anna.cmd (or update-anna.cmd) first.'
            Write-AnnaLog $msg
            Write-Host $msg
            exit 4
        }
        $launcher = Join-Path $script:AnnaRoot 'scripts\start-server.mjs'
        $env:ANNA_PORT = [string]$port
        Start-Process -FilePath $node -ArgumentList @('"' + $launcher + '"', '--detach') -WorkingDirectory $script:AnnaRoot -WindowStyle Hidden
        Write-AnnaLog "start-anna: started the server on port $port"
    }
    # else: an ANNA server is on the port but not answering yet (still starting); just wait for it below.

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if ((Get-AnnaHealth $port) -eq 'anna') {
            Write-Host "ANNA is running on port $port."
            exit 0
        }
        Start-Sleep -Milliseconds 500
    }
    $msg = "ANNA did not answer on port $port within 30 seconds. See logs\anna.log for the reason."
    Write-AnnaLog $msg
    Write-Host $msg
    exit 3
} finally {
    if ($owned) { try { $mutex.ReleaseMutex() } catch { } }
    $mutex.Dispose()
}
