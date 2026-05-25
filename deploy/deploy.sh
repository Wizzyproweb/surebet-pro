#!/bin/bash
# SureBet Pro - Deploy anywhere
# Użycie: bash deploy.sh

echo "===================================="
echo "  SureBet Pro v5.0 - Deployment"
echo "===================================="
echo ""

# Detect platform
if command -v docker &> /dev/null; then
    echo "✅ Docker detected"
    HAS_DOCKER=true
fi

if command -v python3 &> /dev/null; then
    echo "✅ Python detected"
    HAS_PYTHON=true
fi

# Option 1: Docker
if [ "$HAS_DOCKER" = true ]; then
    echo ""
    echo "Wybierz opcję:"
    echo "  1) Docker (zalecane)"
    echo "  2) Python bezpośrednio"
    echo "  3) Wyjście"
    read -p "Wybierz [1-3]: " choice
    
    if [ "$choice" = "1" ]; then
        cd "$(dirname "$0")/.."
        docker-compose up -d --build
        echo "✅ Aplikacja uruchomiona na porcie 80"
        echo "   http://localhost"
        exit 0
    elif [ "$choice" = "2" ]; then
        cd "$(dirname "$0")/.."
        pip install flask gunicorn
        bash start_production.sh
        exit 0
    fi
fi

# Option 2: Direct Python
cd "$(dirname "$0")/.."
pip install flask gunicorn
bash start_production.sh
