@echo off
rem Double-click to set up and start BrowserQuiz (runs setup.ps1 without changing your PowerShell settings).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
echo.
pause
