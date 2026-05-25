# 🎯 SureBet Pro v5.0

**Najbardziej zaawansowana aplikacja do surebetów na telefon.**

![Version](https://img.shields.io/badge/version-5.0.0-brightgreen)
![Python](https://img.shields.io/badge/python-3.10+-blue)
![Flask](https://img.shields.io/badge/flask-3.0+-lightgrey)

## ✨ Funkcje

### 🎯 Wyszukiwanie Surebetów
- Automatyczne skanowanie 50+ bukmacherów
- Obsługa rynków: 1X2, AH (Handicap), O/U (Ponad/Poniżej), BTTS
- Filtrowanie po sporcie, marży, dacie
- Sortowanie po zysku, dacie, pewności

### 💎 Value Betting
- Wykrywanie przewartościowanych kursów
- Kelly Criterion dla optymalnego stakowania
- Analiza Expected Value (EV)

### 📊 Zaawansowane narzędzia
- **Kalkulatory:** Surebet, Kelly, Dutching, Podatkowy, Walut
- **Analiza marż** bukmacherskich
- **Backtesting** strategii
- **Historia kursów** z wykresami

### 🤖 Automatyzacja
- **Auto-Bet:** Automatyczne obstawianie znalezionych surebetów
- **Auto-Rejestracja:** Automatyczne zakładanie kont u bukmacherów
- **Powiadomienia** dźwiękowe i wizualne
- **Alerty** o nowych okazjach

### 💰 System finansowy
- Konto DEMO (100 000 PLN wirtualnie) i REAL
- **Wpłaty:** Stripe, PayPal, BLIK, Przelewy24, Karty, Krypto, Skrill
- **Wypłaty:** Bank, BLIK, Krypto, PayPal, Skrill
- **Inwestycje:** Plany inwestycyjne z daily/weekly/monthly ROI
- Pełna historia transakcji

### 🔒 Bezpieczeństwo
- Weryfikacja email
- PIN do wypłat
- Szyfrowane sesje
- HTTPS ready

## 🚀 Szybki start

```bash
cd surebet_pro
pip install flask gunicorn requests
bash start_production.sh
```

Otwórz: **http://localhost:5001**

## 📱 Dostęp z telefonu

Aplikacja jest w pełni responsywna i działa jako PWA (Progressive Web App).

### Z sieci lokalnej
```bash
# Znajdź IP swojego komputera
ip addr show | grep inet
# Otwórz na telefonie: http://TWOJE_IP:5001
```

### Deployment na serwer
```bash
bash deploy_anywhere.sh
# Wybierz opcję: Docker, Railway, Render, VPS
```

## 🔑 Dane logowania

| Rola | Email | Hasło |
|------|-------|-------|
| 👑 **Admin** | wizzyeazy7@gmail.com | admin |

## 🏗️ Struktura projektu

```
surebet_pro/
├── app.py                 # Backend Flask (3400+ linii, 91 API endpointów)
├── wsgi.py                # Gunicorn entry point
├── start_production.sh    # Uruchomienie produkcyjne
├── deploy_anywhere.sh     # Deployment na różne platformy
├── Dockerfile             # Docker
├── docker-compose.yml     # Docker Compose
├── requirements.txt       # Zależności Python
├── static/
│   ├── js/app.js         # Frontend SPA (165KB)
│   └── css/style.css     # Glassmorphism design (29KB)
├── templates/
│   └── index.html        # PWA shell
├── data/
│   └── database.json     # Baza danych (auto-tworzona)
└── deploy/               # Konfiguracje deploymentu
```

## 🔧 Wymagania

- Python 3.10+
- Flask 3.0+
- Gunicorn 21.2+
- 100MB RAM (minimum)
- Dostęp do internetu (dla prawdziwych surebetów)

## 📡 API The Odds

Aplikacja używa **The Odds API** do pobierania prawdziwych kursów.

1. Zarejestruj się na https://the-odds-api.com (darmowe 500 zapytań/miesiąc)
2. Otrzymasz klucz API na email
3. Wklej klucz w Ustawieniach → Klucze API

Bez klucza API aplikacja działa w trybie symulacji z realistycznymi danymi.

## 💳 Płatności (opcjonalnie)

Dodaj klucze API w **Ustawienia → Klucze API Płatności**:
- **Stripe:** dashboard.stripe.com → API keys
- **PayPal:** developer.paypal.com → Apps
- **Przelewy24:** panel.przelewy24.pl → API

Bez kluczy płatności działają w trybie symulacji.

## 📋 API Endpointy

### Auth
- `POST /api/auth/login` - Logowanie
- `POST /api/auth/register` - Rejestracja
- `GET /api/auth/me` - Status sesji

### Surebety
- `GET /api/surebets` - Lista surebetów
- `GET /api/surebets/<id>` - Szczegóły
- `GET /api/surebets/best` - Najlepsze okazje

### Bankroll
- `GET /api/bankroll` - Stan konta
- `POST /api/deposit/create` - Utwórz wpłatę
- `POST /api/deposit/confirm` - Potwierdź wpłatę
- `POST /api/withdraw/create` - Wypłata

### Engine
- `GET /api/engine/stats` - Statystyki silnika
- `POST /api/engine/start` - Start silnika
- `POST /api/engine/stop` - Stop silnika

## 👨‍💻 Autor

Jakub Maciejewski (wizzyeazy7@gmail.com)

## 📜 Licencja

Projekt prywatny - wszelkie prawa zastrzeżone.
