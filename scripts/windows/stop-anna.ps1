# Stops the ANNA server and nothing else.
# The server is the process listening on the ANNA port whose command line contains "next" and this repo's path.
# Exit codes: 0 stopped or was not running, 2 the port is held by another program (left alone), 3 could not stop it.
# -AnyFolder (used by install-anna.cmd) also stops an ANNA server that was started from a different folder, for example the
# old folder after a newer zip was unpacked somewhere else. It still never stops a program that does not answer as ANNA.
param(
    [string]$DataDir,
    [switch]$AnyFolder
)
. "$PSScriptRoot\common.ps1"
Set-AnnaDataDirOverride $DataDir

$port = Get-AnnaPort
$listener = Get-PortListener $port
if (-not $listener) {
    Write-Host "ANNA is not running (nothing is listening on port $port)."
    exit 0
}
if (-not (Test-IsAnnaServer $listener.CommandLine)) {
    if ($AnyFolder -and (Get-AnnaHealth $port) -eq 'anna') {
        Write-Host "An ANNA from another folder is running on port $port. Stopping it so this one can take over."
    } else {
        Write-Host "Port $port is used by another program ($($listener.Name), process $($listener.Pid)). It is not ANNA, so it was left alone."
        exit 2
    }
}

Write-Host "Stopping ANNA (process $($listener.Pid))..."
& taskkill.exe /PID $listener.Pid /T /F | Out-Null

$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
    if (-not (Get-PortListener $port)) {
        Write-AnnaLog "stop-anna: stopped process $($listener.Pid)"
        Write-Host 'ANNA stopped.'
        exit 0
    }
    Start-Sleep -Milliseconds 300
}
Write-Host "ANNA is still listening on port $port after 10 seconds."
exit 3
