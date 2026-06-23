@echo off
REM AROK Monitor — build the React UI (requires Node 18+)
cd /d "%~dp0frontend"
call npm install
call npm run build
echo.
echo  Build complete. Restart run_demo.bat - the React UI is now served automatically.
pause
