@echo off
REM AROK Monitor — run as desktop app (no browser) without packaging
cd /d "%~dp0backend"
call ..\.venv\Scripts\activate.bat 2>nul || (
  python -m venv ..\.venv && call ..\.venv\Scripts\activate.bat
)
pip install -q -r requirements.txt -r requirements-desktop.txt
python desktop.py
