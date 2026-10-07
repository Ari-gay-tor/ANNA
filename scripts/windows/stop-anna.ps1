# Stops the ANNA server and nothing else.
# The server is the process listening on the ANNA port whose command line contains "next" and this repo's path.
# Exit codes: 0 stopped or was not running, 2 the port is held by another program (left alone), 3 could not stop it.
. "$PSScriptRoot\common.ps1"

$port = Get-AnnaPort
$listener = Get-PortListener $port
if (-not $listener) {
    Write-Host "ANNA is not running (nothing is listening on port $port)."
    exit 0
}
if (-not (Test-IsAnnaServer $listener.CommandLine)) {
    Write-Host "Port $port is used by another program ($($listener.Name), process $($listener.Pid)). It is not ANNA, so it was left alone."
    exit 2
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
