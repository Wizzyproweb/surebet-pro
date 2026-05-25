#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# SureBet Pro v4.0 — Production Deployment Script
# Użycie: bash production.sh
# ═══════════════════════════════════════════════════════════════════════

set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

# Konfiguracja
PORT="${PORT:-5001}"
HOST="${HOST:-0.0.0.0}"
MODE="${MODE:-production}"

# Kolory
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     ${GREEN}🎯 SureBet Pro v4.0${BLUE}                                   ║${NC}"
echo -e "${BLUE}║     ${YELLOW}Zaawansowany system surebetów z auto-obstawianiem${BLUE}     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Sprawdź Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python 3 wymagany${NC}"
    exit 1
fi

# Zainstaluj zależności
echo -e "${BLUE}[setup]${NC} Sprawdzanie zależności..."
pip install --break-system-packages -r requirements.txt -q 2>/dev/null || pip install -r requirements.txt -q

# Utwórz katalog danych
mkdir -p data

# Zatrzymaj istniejącą instancję
if [ -f "surebet.pid" ]; then
    OLD_PID=$(cat surebet.pid)
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo -e "${YELLOW}[setup]${NC} Zatrzymywanie poprzedniej instancji (PID: $OLD_PID)..."
        kill "$OLD_PID" 2>/dev/null || true
        sleep 2
    fi
    rm -f surebet.pid
fi

# Uruchom aplikację
echo -e "${GREEN}[start]${NC} Uruchamianie SureBet Pro na http://${HOST}:${PORT}"
echo ""

# Użyj setsid aby proces żył po zamknięciu terminala
if command -v setsid &> /dev/null; then
    setsid python3 app.py > /tmp/surebet_pro.log 2>&1 &
else
    nohup python3 app.py > /tmp/surebet_pro.log 2>&1 &
fi

PID=$!
echo $PID > surebet.pid

# Poczekaj na gotowość
sleep 3

# Sprawdź czy działa
if kill -0 "$PID" 2>/dev/null; then
    echo -e "${GREEN}✅ Aplikacja uruchomiona!${NC}"
    echo -e "${GREEN}📱 Otwarta na: http://${HOST}:${PORT}${NC}"
    echo -e "${GREEN}📋 Logi: tail -f /tmp/surebet_pro.log${NC}"
    echo ""
    echo -e "${YELLOW}📊 Główne funkcje:${NC}"
    echo -e "  ${GREEN}•${NC} 🔍 Znajdowanie surebetów (50+ aktywnych)"
    echo -e "  ${GREEN}•${NC} 💎 Value betting z Kelly Criterion"
    echo -e "  ${GREEN}•${NC} 📊 Multi-market analysis"
    echo -e "  ${GREEN}•${NC} 🤖 Automatyczne obstawianie"
    echo -e "  ${GREEN}•${NC} 💰 Demo i Real konto"
    echo -e "  ${GREEN}•${NC} 💳 System wpłat (BLIK, karta, przelew, crypto)"
    echo -e "  ${GREEN}•${NC} 📈 Inwestycje z planami Daily/Weekly/Monthly"
    echo -e "  ${GREEN}•${NC} 📱 PWA - działa jak aplikacja na telefonie"
else
    echo -e "${RED}❌ Błąd uruchamiania. Sprawdź logi:${NC}"
    echo -e "  tail -f /tmp/surebet_pro.log"
    cat /tmp/surebet_pro.log | tail -10
    exit 1
fi

# Test API
echo ""
echo -e "${BLUE}[test]${NC} Testowanie API..."
sleep 2
if curl -s http://localhost:${PORT}/api/ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ API działa poprawnie${NC}"
else
    echo -e "${RED}⚠️ API nie odpowiada. Sprawdź logi.${NC}"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  🎯 SureBet Pro gotowy do użycia!                           ║${NC}"
echo -e "${GREEN}║  Otwórz http://${HOST}:${PORT} w przeglądarce                   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
