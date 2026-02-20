#!/usr/bin/env bash
# Libra Ingestion Sidecar — Linux/macOS/Render startup

set -e
cd "$(dirname "$0")"

# Create venv if missing
if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install -r requirements.txt --quiet

echo "Starting ingestion sidecar on http://0.0.0.0:8001"
python -m uvicorn main:app --host 0.0.0.0 --port "${PORT:-8001}"
