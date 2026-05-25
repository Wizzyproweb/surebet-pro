# 🚀 Deploy SureBet Pro na Render.com

## Krok 1: Przygotuj repozytorium

```bash
# W katalogu surebet_pro zainicjuj git
cd surebet_pro
git init
git add .
git commit -m "SureBet Pro v5.0"
```

## Krok 2: Utwórz repozytorium na GitHub

1. Wejdź na https://github.com
2. Kliknij **New repository**
3. Nazwij np. `surebet-pro`
4. Nie dodawaj README ani .gitignore
5. Kliknij **Create repository**

```bash
# Podłącz lokalne repozytorium
git remote add origin https://github.com/TWOJA_NAZWA/surebet-pro.git
git branch -M main
git push -u origin main
```

## Krok 3: Deploy na Render

1. Wejdź na https://dashboard.render.com
2. Kliknij **New + → Web Service**
3. Połącz swoje GitHub konto
4. Wybierz repozytorium `surebet-pro`
5. Render automatycznie wykryje `render.yaml` ✅

### LUB skonfiguruj ręcznie:

| Pole | Wartość |
|------|---------|
| **Name** | `surebet-pro` |
| **Region** | `Frankfurt (EU)` |
| **Branch** | `main` |
| **Runtime** | `Python 3` |
| **Build Command** | `bash render-build.sh` |
| **Start Command** | `gunicorn wsgi:application --bind 0.0.0.0:$PORT --workers 1 --threads 4 --worker-class gthread --timeout 120 --log-level info` |
| **Plan** | `Free` |

### Zmienne środowiskowe (Env Variables):

| Key | Value | Uwagi |
|-----|-------|-------|
| `PYTHON_VERSION` | `3.12.0` | Wymagane |
| `THEODDSAPI_KEY` | `8e4a252d3acac06f32e91b74acd75e71` | Twój klucz API (opcjonalnie) |
| `ADMIN_EMAIL` | `wizzyeazy7@gmail.com` | Email admina |
| `ADMIN_PASSWORD` | `admin` | Hasło admina (zmień w produkcji!) |

## Krok 4: Gotowe! 🎉

Po deploymentu (trwa ~3 minuty):

```
https://surebet-pro.onrender.com
```

### Dane logowania:
- **Email:** `wizzyeazy7@gmail.com`
- **Hasło:** `admin`

## ⚠️ Uwagi do wersji Free

| Ograniczenie | Wartość |
|-------------|---------|
| Czas uruchomienia | 30-60s (usypia po 15 min bez ruchu) |
| RAM | 512 MB |
| Dysk | Ephemeral (dane giną przy restarcie) |
| CPU | 0.1 vCPU |
| Ruch | 100 GB/miesiąc |

> **Ważne:** Render Free "usypia" serwis po 15 minutach braku aktywności.  
> Przy pierwszym wejściu po przerwie odczekaj ~30 sekund na uruchomienie.

## 🔄 Auto-wake (opcjonalnie)

Aby zapobiec usypianiu, możesz użyć serwisu monitoringu:
```bash
# https://uptimerobot.com - darmowy, pinguje co 5 min
# Ustaw monitorowanie na https://surebet-pro.onrender.com/api/ping
```

## 📱 Po deploymentu

1. Wejdź na `https://surebet-pro.onrender.com`
2. Zaloguj się admin/admin
3. W Ustawieniach → Klucze API dodaj własny klucz The Odds API
4. Gotowe! Surebety pojawią się automatycznie ✅

## 🐳 Alternatywa: Docker na VPS

Jeśli wolisz własny serwer (np. DigitalOcean za $6/miesiąc):

```bash
git clone https://github.com/TWOJA_NAZWA/surebet-pro.git
cd surebet-pro
docker-compose up -d
```

Aplikacja na `http://TWOJE_IP:5001`
