@echo off
REM AROK Monitor — demo launcher
cd /d "%~dp0backend"

if not exist ..\.venv (
  echo Creating virtual environment...
  python -m venv ..\.venv
)
call ..\.venv\Scripts\activate.bat

pip install -q -r requirements.txt

echo.
echo  AROK Monitor demo starting at http://127.0.0.1:8420
echo  (demo mode ON - control actions are simulated; set AROK_DEMO=0 for live)
echo.
start "" http://127.0.0.1:8420
python main.py
