@echo off
:: Libra Ingestion Sidecar — Windows startup
:: Run from the ingestion-service directory

cd /d "%~dp0"

:: Create virtual env if it doesn't exist
if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
)

:: Activate and install deps
call .venv\Scripts\activate.bat
pip install -r requirements.txt --quiet

:: Start sidecar on port 8001
echo Starting ingestion sidecar on http://localhost:8001
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
