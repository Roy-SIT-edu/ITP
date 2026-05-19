@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0quicklaunch.ps1"
if errorlevel 1 pause
