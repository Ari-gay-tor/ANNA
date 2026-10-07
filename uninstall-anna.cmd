@echo off
rem Double-click to uninstall ANNA. Runs scripts\windows\uninstall.ps1.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\uninstall.ps1" %*
set ANNA_RC=%ERRORLEVEL%
if not defined ANNA_NO_PAUSE pause
exit /b %ANNA_RC%
