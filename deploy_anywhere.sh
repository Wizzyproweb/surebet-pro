#!/bin/bash
# SureBet Pro v5.0 - Deploy anywhere
# Usage: bash deploy_anywhere.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  SureBet Pro v5.0 - Deployment${NC}"
echo -e "${GREEN}============================================${NC}"

# Detect environment
if command -v docker &>/dev/null; then
    echo -e "${YELLOW}✅ Docker detected${NC}"
    HAS_DOCKER=true
fi

if [ -f "Dockerfile" ]; then
    echo -e "${YELLOW}✅ Dockerfile ready${NC}"
fi

echo ""
echo "Select deployment option:"
echo "1) 🐳 Docker (recommended)"
echo "2) 🐍 Python directly"
echo "3) ☁️  Railway.app (cloud)"  
echo "4) 🎯 Render.com (cloud)"
echo "5) 🖥️  VPS (DigitalOcean/Linode)"
echo "6) 📱 Local only (current device)"
read -p "Choose [1-6]: " choice

case $choice in
    1)
        echo -e "${GREEN}Building and starting Docker container...${NC}"
        docker-compose up -d --build
        echo -e "${GREEN}✅ App running on http://localhost:5001${NC}"
        ;;
    2)
        echo -e "${GREEN}Starting with gunicorn...${NC}"
        pip install -q flask gunicorn requests
        bash start_production.sh
        ;;
    3)
        echo -e "${GREEN}For Railway.app:${NC}"
        echo "1. Install Railway CLI: npm i -g @railway/cli"
        echo "2. railway login"
        echo "3. railway init"
        echo "4. railway up"
        echo ""
        echo "Or use the web UI at https://railway.app"
        echo "Connect your repo, Railway auto-detects config"
        ;;
    4)
        echo -e "${GREEN}For Render.com:${NC}"
        echo "1. Go to https://render.com"
        echo "2. New Web Service → Connect your repo"
        echo "3. Start Command: gunicorn wsgi:application --bind 0.0.0.0:\$PORT"
        echo "4. Build Command: pip install flask gunicorn requests"
        echo "5. Add env var: PYTHON_VERSION=3.12.0"
        ;;
    5)
        echo -e "${GREEN}For VPS (Ubuntu/Debian):${NC}"
        echo "sudo apt update && sudo apt install -y python3 python3-pip"
        echo "git clone <your-repo-url> surebet_pro"
        echo "cd surebet_pro && pip install flask gunicorn requests"
        echo "gunicorn wsgi:application --bind 0.0.0.0:80 --workers 2 --threads 4"
        ;;
    6)
        echo -e "${GREEN}Starting locally on port 5001...${NC}"
        bash start_production.sh
        echo -e "${GREEN}✅ App running on http://localhost:5001${NC}"
        echo -e "${YELLOW}Admin: wizzyeazy7@gmail.com / admin${NC}"
        ;;
esac
