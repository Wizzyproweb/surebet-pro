# SureBet Pro v5.0 - Deploy Guide

## 📦 Opcje wdrożenia

### 1. Docker (zalecane)
```bash
cd deploy
docker-compose up -d
```
App na http://localhost:80

### 2. Python bezpośrednio
```bash
pip install flask gunicorn
bash start_production.sh
```
App na http://localhost:5001

### 3. Render.com (darmowy hosting)
1. Zaloguj się na render.com
2. New Web Service → połącz repozytorium
3. Ustaw: `start.sh` jako Start Command
4. Dodaj zmienne: `PYTHON_VERSION=3.12.0`

### 4. Railway.app
1. Zaloguj się na railway.app
2. New Project → Deploy from repo
3. Railway auto-wykryje konfigurację

### 5. VPS (DigitalOcean, Linode, Vultr)
```bash
git clone <repo> surebet_pro
cd surebet_pro
pip install flask gunicorn
gunicorn wsgi:application --bind 0.0.0.0:80 --workers 2 --threads 4
```

## 🔑 Po wdrożeniu (z netem)
1. Wejdź na http://twoja-domena.pl
2. Zaloguj się: wizzyeazy7@gmail.com / admin
3. Aplikacja AUTOMATYCZNIE połączy się z The Odds API
4. Surebety pojawią się w ciągu 30 sekund! 🎯

## 💳 Płatności (opcjonalnie)
Dodaj klucze API w Ustawieniach:
- **Stripe:** dashboard.stripe.com → API keys
- **PayPal:** developer.paypal.com → Apps
- **Przelewy24:** panel.przelewy24.pl → API
