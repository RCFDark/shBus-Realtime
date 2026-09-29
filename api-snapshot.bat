@echo off
chcp 65001 >nul 2>nul
title Sihui Bus Realtime - API Snapshot
setlocal

pushd "%~dp0"

set "MANAGED_NODE=C:\Users\27404\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"

echo ============================================================
echo   Sihui Bus Realtime - API Snapshot
echo   Save live API responses to:  api访问\<timestamp>\
echo ============================================================
echo.

REM ------------------------------------------------------------
REM 1. Locate Node.js (system PATH first, then WorkBuddy's own)
REM ------------------------------------------------------------
set "NODE_BIN="
where node >nul 2>nul
if not errorlevel 1 set "NODE_BIN=node"
if not defined NODE_BIN (
    if exist "%MANAGED_NODE%" set "NODE_BIN=%MANAGED_NODE%"
)
if not defined NODE_BIN (
    echo [ERROR] Node.js was not found.
    echo         Please install Node.js 20+ from https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "%~dp0api-snapshot.mjs" (
    echo [ERROR] api-snapshot.mjs is missing.
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js : 
"%NODE_BIN%" -v
echo.

REM ------------------------------------------------------------
REM 2. Run the snapshot script
REM ------------------------------------------------------------
"%NODE_BIN%" "%~dp0api-snapshot.mjs" %*

REM ------------------------------------------------------------
REM 3. Open the output folder (path written by the script)
REM ------------------------------------------------------------
set "OUTDIR="
if exist "%~dp0api访问\.last-dir.txt" (
    set /p OUTDIR=<"%~dp0api访问\.last-dir.txt"
)
if defined OUTDIR (
    if exist "%OUTDIR%" start "" "%OUTDIR%"
)

echo Done.
popd
pause
