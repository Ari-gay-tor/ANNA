@echo off
rem Double-click to install ANNA. Runs scripts\windows\install.ps1.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\install.ps1" %*
set ANNA_RC=%ERRORLEVEL%
if not defined ANNA_NO_PAUSE pause
exit /b %ANNA_RC%
