@echo off
echo ======================================
echo    MARBOYS POS - Setup Wizard
echo ======================================
echo.

REM Check if Node.js is installed
echo [Step 1/4] Checking Node.js installation...
node --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Node.js is not installed!
    echo.
    echo Please download and install Node.js from:
    echo https://nodejs.org/en/download/
    echo.
    echo After installation, run this SETUP.bat again.
    echo.
    pause
    exit /b 1
)

echo Node.js found: 
node --version
echo.

REM Check if npm is available
echo [Step 2/4] Checking npm...
npm --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm not found!
    pause
    exit /b 1
)
echo npm version: 
npm --version
echo.

REM Install server dependencies
echo [Step 3/4] Installing SERVER dependencies...
echo This may take a few minutes...
echo.
cd /d "%~dp0server"
call npm install
if errorlevel 1 (
    echo ERROR: Server dependencies installation failed!
    pause
    exit /b 1
)
echo.
echo Server dependencies installed successfully!
echo.

REM Install client dependencies
echo [Step 4/4] Installing CLIENT dependencies...
echo This may take a few minutes...
echo.
cd /d "%~dp0client"
call npm install
if errorlevel 1 (
    echo ERROR: Client dependencies installation failed!
    pause
    exit /b 1
)
echo.
echo Client dependencies installed successfully!
echo.

REM Setup complete
echo ======================================
echo    SETUP COMPLETE!
echo ======================================
echo.
echo You can now start MARBOYS POS by running:
echo    START-MARBOYS.bat
echo.
echo OR manually run:
echo    - Server: cd server ^&^& npm start
echo    - Client: cd client ^&^& npm run dev
echo.
echo ======================================
echo.
pause
