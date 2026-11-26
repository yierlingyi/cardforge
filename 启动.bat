@echo off
rem ============================================================
rem  CardForge one-click launcher (Windows)
rem  Double-click this file. Everything else is automatic.
rem ============================================================
setlocal
title CardForge - SillyTavern Card IDE
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [ERROR] Node.js not found.
  echo.
  echo  Please install Node.js 18 or later:  https://nodejs.org/
  echo  After installing, run this file again.
  echo.
  pause
  exit /b 1
)

node "scripts\launch.mjs" %*
set EXITCODE=%errorlevel%

if not "%EXITCODE%"=="0" (
  echo.
  echo  Launcher exited with code %EXITCODE%.
  pause
)
endlocal
exit /b %EXITCODE%
