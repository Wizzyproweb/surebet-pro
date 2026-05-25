#!/bin/bash
# SureBet Pro - Udostępnij w internecie przez localtunnel
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "🚀 Uruchamiam SureBet Pro online..."
echo ""

# Ensure the app is running
if ! curl -s http://localhost:5001/api/ping > /dev/null 2>&1; then
    echo "📦 Startuję aplikację..."
    bash start_production.sh
    sleep 5
fi

echo "🔗 Tworzę tunel internetowy (localtunnel)..."
echo ""

# Use node's localtunnel (npm install -g localtunnel)
# The lt command outputs the URL, capture it
npx localtunnel --port 5001 --subdomain surebet-pro 2>&1 | while read line; do
    echo "$line"
    if echo "$line" | grep -q "your url is:"; then
        URL=$(echo "$line" | grep -o "https://[^ ]*")
        echo ""
        echo "╔══════════════════════════════════════════════╗"
        echo "║     🎯 SureBet Pro ONLINE!                   ║"
        echo "║                                              ║"
        echo "║     🌐 $URL     ║"
        echo "║                                              ║"
        echo "║     👑 Admin: wizzyeazy7@gmail.com / admin  ║"
        echo "╚══════════════════════════════════════════════╝"
        echo ""
        # Save URL
        echo "$URL" > /tmp/surebet_online_url.txt
    fi
done
