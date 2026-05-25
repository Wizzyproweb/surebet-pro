#!/bin/bash
# SureBet Pro v5.0 - Production Start Script (z venv)
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Kill any existing instances
pkill -f "gunicorn.*wsgi:application" 2>/dev/null
sleep 1

# Setup virtual environment (działa na Python 3.12+ Debian/Ubuntu)
VENV_DIR="$DIR/venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "🔧 Tworzę wirtualne środowisko Python..."
    python3 -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"

# Install dependencies (tylko jeśli brak)
if ! pip list 2>/dev/null | grep -q flask; then
    echo "📦 Instaluję zależności..."
    pip install flask gunicorn requests -q
fi

# Clean database if needed
if [ ! -f "data/database.json" ]; then
    echo "🗄️ Tworzę świeżą bazę danych..."
    python3 -c "
import json, hashlib
from datetime import datetime
salt = 'a1b2c3d4e5f6a7b8'
pwd_hash = hashlib.sha256(('admin' + salt).encode()).hexdigest()
db = {
    'users': {'admin': {'username': 'admin', 'email': 'wizzyeazy7@gmail.com',
        'password_hash': pwd_hash, 'salt': salt,
        'first_name': 'Jakub', 'last_name': 'Maciejewski',
        'birth_date': '1994-01-28', 'created_at': datetime.now().isoformat(),
        'last_login': None, 'settings': {'role': 'admin'},
        'sessions': []}},
    'settings': {'theoddsapi_key': '8e4a252d3acac06f32e91b74acd75e71',
        'live_data_enabled': True, 'preview_mode': False,
        'admin_email': 'wizzyeazy7@gmail.com', 'user_name': 'Jakub Maciejewski'},
}
with open('data/database.json', 'w') as f: json.dump(db, f, indent=2)
print('Database created')
"
fi

# Start gunicorn
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║     🎯 SureBet Pro v5.0                      ║"
echo "║     http://localhost:5001                     ║"
echo "║                                              ║"
echo "║     👑 Admin: wizzyeazy7@gmail.com / admin   ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

gunicorn wsgi:application \
    --bind 0.0.0.0:5001 \
    --workers 1 \
    --threads 4 \
    --worker-class gthread \
    --daemon \
    --pid /tmp/sb_pid.pid \
    --error-logfile /tmp/sb_error.log \
    --access-logfile /tmp/sb_access.log \
    --log-level info \
    --timeout 120 \
    --keep-alive 5

sleep 3
curl -s http://localhost:5001/api/ping && echo ""
echo "✅ App running on http://0.0.0.0:5001"
