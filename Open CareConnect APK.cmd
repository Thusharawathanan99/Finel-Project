@echo off
setlocal
powershell.exe -NoProfile -File "%~dp0scripts\open-careconnect-apk.ps1"
if errorlevel 1 pause
endlocal
