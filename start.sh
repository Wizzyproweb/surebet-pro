#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# SureBet Pro v4.0 — Production Start Script
# ═══════════════════════════════════════════════════════════════════════

set -e
cd "$(dirname "$0")"

APP_NAME="SureBet Pro"
PORT="${PORT:-5001}"
HOST="${HOST:-0.0.0.0}"
WORKERS="${WORKERS:-4}"
LOG_LEVEL="${LOG_LEVEL:-info}"
MODE="${MODE:-production}"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     🎯 ${APP_NAME} v4.0                                      ║"
echo "║     Uruchamianie w trybie: ${MODE}                           ║"
echo "║     Port: ${PORT}                                            ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required"
    exit 1
fi

# Create data directory
mkdir -p data

# Install dependencies if needed
if [ ! -f "venv/bin/python" ]; then
    echo "[setup] Tworzenie środowiska wirtualnego..."
    python3 -m venv venv
    source venv/bin/activate
    pip install --upgrade pip -q
    pip install -r requirements.txt -q
    pip install gunicorn -q
else
    source venv/bin/activate
fi

# Clean startup
echo ""
echo "📊 Aplikacja dostępna pod adresem: http://${HOST}:${PORT}"
echo "📱 Otwórz na telefonie lub w przeglądarce"
echo ""

if [ "$MODE" = "development" ] || [ "$MODE" = "dev" ]; then
    # Development mode - Flask dev server
    python3 app.py
else
    # Production mode - Gunicorn
    exec gunicorn wsgi:application \
        --config gunicorn_config.py \
        --bind ${HOST}:${PORT} \
        --workers ${WORKERS} \
        --worker-class gthread \
        --threads 4 \
        --log-level ${LOG_LEVEL} \
        --access-logfile - \
        --error-logfile - \
        --capture-output \
        --enable-stdio-inheritance
fi
