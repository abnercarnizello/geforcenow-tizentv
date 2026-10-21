@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\compat\start.ps1" -TvIp 192.168.15.9
if errorlevel 1 pause
endlocal
