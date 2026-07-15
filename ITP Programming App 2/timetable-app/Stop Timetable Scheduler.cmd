@echo off
setlocal
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%POWERSHELL_EXE%" set "POWERSHELL_EXE=powershell.exe"

"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
set "STOP_EXIT_CODE=%ERRORLEVEL%"
if not "%STOP_EXIT_CODE%"=="0" pause
exit /b %STOP_EXIT_CODE%
