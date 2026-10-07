# Use after pulling new code: stops ANNA, reinstalls packages, applies database migrations, rebuilds, starts ANNA again.
. "$PSScriptRoot\common.ps1"

try {
    & "$PSScriptRoot\stop-anna.ps1"
    if ($LASTEXITCODE -ne 0) { throw 'ANNA could not be stopped, so it was not updated. Close it (see docs\app.md) and run this again.' }
    Invoke-AnnaSetup
    & "$PSScriptRoot\start-anna.ps1"
    if ($LASTEXITCODE -ne 0) { throw 'ANNA was updated but did not start. See logs\anna.log for the reason.' }
    Write-Host ''
    Write-Host 'ANNA is updated and running. Open it with the ANNA shortcut.'
    exit 0
} catch {
    Write-Host ''
    Write-Host "Update stopped: $($_.Exception.Message) ANNA is not running right now." -ForegroundColor Red
    exit 1
}
