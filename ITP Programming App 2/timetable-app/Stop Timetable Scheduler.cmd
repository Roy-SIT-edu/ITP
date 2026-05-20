@echo off
echo Stopping Timetable Scheduler services...

:: Stop Python processes (Backend)
taskkill /F /IM python.exe /T >nul 2>&1

:: Stop Node processes (Frontend)
taskkill /F /IM node.exe /T >nul 2>&1

echo.
echo Services have been stopped.
echo You can now close this window.
timeout /t 3 >nul
