@echo off
echo ======================================
echo    MARBOYS POS System Starting...
echo ======================================
echo.
echo Checking if Node.js is installed...

node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Node.js is not installed!
    echo Please download and install from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo Node.js detected:
node --version
echo.
echo Starting Server (minimized)...
start /min "MARBOYS Server" cmd /c "cd /d "%~dp0server" && npm start"

timeout /t 5 /nobreak >nul

echo Starting Client (minimized)...
start /min "MARBOYS Client" cmd /c "cd /d "%~dp0client" && npm run dev"

timeout /t 5 /nobreak >nul

echo Opening browser...
start http://localhost:5173

echo.
echo ======================================
echo    MARBOYS POS is running!
echo    Browser will open automatically
echo ======================================
echo.
echo Press any key to close this window...
pause >nul
