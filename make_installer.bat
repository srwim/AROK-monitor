@echo off
REM AROK Monitor — build desktop exe + installer
REM Requires: Node 18+, Inno Setup 6 (ISCC on PATH or default install location)

cd /d "%~dp0"
call .venv\Scripts\activate.bat 2>nul || (
  python -m venv .venv && call .venv\Scripts\activate.bat
)

echo [1/4] Installing build deps...
pip install -q -r backend\requirements.txt -r backend\requirements-desktop.txt pyinstaller

echo [2/4] Building React frontend...
cd frontend
call npm install --silent
call npm run build || goto :err
cd ..

echo [3/4] Building AROK.exe with PyInstaller...
cd backend
pyinstaller arok.spec --noconfirm || goto :err
cd ..

echo [4/4] Building installer with Inno Setup...
where iscc >nul 2>nul && (iscc installer.iss || goto :err) || (
  if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" (
    "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" installer.iss || goto :err
  ) else (
    echo Inno Setup not found - install from jrsoftware.org, or grab the exe from backend\dist\AROK\
    goto :end
  )
)

echo.
echo  Done. Installer: installer_out\AROK-Setup-1.5.1.exe
goto :end
:err
echo BUILD FAILED - see output above.
:end
pause
