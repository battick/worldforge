@echo off
setlocal
cd /d "%~dp0"

rem Switch the console to UTF-8 so the server's Chinese messages are readable.
rem Without this, cmd.exe uses the legacy GBK code page and UTF-8 output turns into mojibake.
chcp 65001 >nul 2>nul

echo.
echo   WorldForge - starting local server
echo   ---------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [ERROR] Node.js not found.
  echo   Please install Node.js 18 or newer from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo   First run: building the app, this may take a minute...
  echo.
  if not exist "node_modules" (
    echo   Installing dependencies...
    call npm install --registry=https://registry.npmmirror.com
    if errorlevel 1 (
      echo   [ERROR] npm install failed.
      pause
      exit /b 1
    )
  )
  call npm run build
  if errorlevel 1 (
    echo   [ERROR] Build failed.
    pause
    exit /b 1
  )
  echo.
)

node server.mjs
rem exit code 0 means "another instance was already running" - no need to say it stopped.
if "%ERRORLEVEL%"=="0" goto :done
echo.
echo   Server stopped.
:done
echo.
pause
