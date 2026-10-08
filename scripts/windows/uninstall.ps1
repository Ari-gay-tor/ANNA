# Stops ANNA and removes the shortcuts and the start-at-login entry. Your data is left alone.
# Same folder parameters as install.ps1.
param(
    [string]$DesktopDir = [Environment]::GetFolderPath('Desktop'),
    [string]$StartMenuDir = [Environment]::GetFolderPath('Programs'),
    [string]$StartupDir = [Environment]::GetFolderPath('Startup'),
    [string]$DataDir
)
. "$PSScriptRoot\common.ps1"
Set-AnnaDataDirOverride $DataDir

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

$mode = Get-AnnaMode
Write-Host ''
Write-Host 'ANNA is uninstalled. Your data was NOT deleted:'
Write-Host "  database and memories: $(Get-AnnaDatabasePath)"
Write-Host "  settings and API key:  $($mode.ConfigFile)"
Write-Host "  logs:                  $($mode.LogDir)"
if ($mode.Mode -eq 'tester') {
    Write-Host "Delete the folder $($mode.DataDir) to remove all of it (this cannot be undone), and delete the ANNA folder you unzipped."
} else {
    Write-Host 'Delete the ANNA folder yourself if you want all of it gone.'
}
exit 0
