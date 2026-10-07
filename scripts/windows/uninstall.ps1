# Stops ANNA and removes the shortcuts and the start-at-login entry. Your data is left alone.
# Same folder parameters as install.ps1.
param(
    [string]$DesktopDir = [Environment]::GetFolderPath('Desktop'),
    [string]$StartMenuDir = [Environment]::GetFolderPath('Programs'),
    [string]$StartupDir = [Environment]::GetFolderPath('Startup')
)
. "$PSScriptRoot\common.ps1"

& "$PSScriptRoot\stop-anna.ps1"

$paths = Get-ShortcutPaths $DesktopDir $StartMenuDir $StartupDir
foreach ($path in @($paths.Desktop, $paths.StartMenu, $paths.Startup)) {
    if (Test-Path $path) {
        Remove-Item $path -Force
        Write-Host "Removed $path"
    } else {
        Write-Host "Not found (already removed): $path"
    }
}

Write-Host ''
Write-Host 'ANNA is uninstalled. Your data was NOT deleted:'
Write-Host "  database and memories: $(Join-Path $script:AnnaRoot 'prisma\dev.db')"
Write-Host "  settings and API key:  $(Join-Path $script:AnnaRoot '.env')"
Write-Host "  logs:                  $script:AnnaLogDir"
Write-Host 'Delete the ANNA folder yourself if you want all of it gone.'
exit 0
