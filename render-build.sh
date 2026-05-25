#!/bin/bash
# Render.com build script for SureBet Pro
set -e

echo "🎯 SureBet Pro - Render Build"
echo "================================"

# Create virtual environment
echo "🔧 Creating virtual environment..."
python3 -m venv venv
source venv/bin/activate

# Install dependencies
echo "📦 Installing dependencies..."
pip install --upgrade pip -q
pip install flask gunicorn requests -q

# Create data directory
mkdir -p data

# Pre-create database with admin account
echo "🗄️ Initializing database..."
python3 -c "
import json, hashlib, os
from datetime import datetime

salt = 'a1b2c3d4e5f6a7b8'
admin_pwd = os.environ.get('ADMIN_PASSWORD', 'admin')
pwd_hash = hashlib.sha256((admin_pwd + salt).encode()).hexdigest()
api_key = os.environ.get('THEODDSAPI_KEY', '8e4a252d3acac06f32e91b74acd75e71')

db = {
    'users': {'admin': {
        'username': 'admin',
        'email': os.environ.get('ADMIN_EMAIL', 'wizzyeazy7@gmail.com'),
        'password_hash': pwd_hash,
        'salt': salt,
        'first_name': 'Jakub',
        'last_name': 'Maciejewski',
        'birth_date': '1994-01-28',
        'created_at': datetime.now().isoformat(),
        'last_login': None,
        'settings': {'role': 'admin'},
        'sessions': []
    }},
    'settings': {
        'theoddsapi_key': api_key,
        'live_data_enabled': True,
        'preview_mode': False,
        'admin_email': os.environ.get('ADMIN_EMAIL', 'wizzyeazy7@gmail.com'),
        'user_name': 'Jakub Maciejewski',
    },
    'account_mode': 'demo',
    'demo_bankroll': {'balance': 100000.0, 'initial_balance': 100000.0, 'deposits': 100000.0, 'withdrawals': 0, 'peak_balance': 100000.0},
    'real_bankroll': {'balance': 0.0, 'initial_balance': 0.0, 'deposits': 0.0, 'withdrawals': 0.0, 'peak_balance': 0.0},
}

with open('data/database.json', 'w') as f:
    json.dump(db, f, indent=2)

print('Database created successfully')
print(f'Admin: {os.environ.get(\"ADMIN_EMAIL\", \"wizzyeazy7@gmail.com\")}')
print(f'API Key: {\"SET ✅\" if api_key else \"NOT SET ❌\"}')
"

echo ""
echo "✅ Build complete"
