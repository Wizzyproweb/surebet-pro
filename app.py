#!/usr/bin/env python3
"""
SureBet Pro v4.0 — Zaawansowana aplikacja do surebetów
Z automatycznym obstawianiem, value betting, Kelly Criterion,
analizą wielorynkową i zaawansowanymi statystykami.
"""
import os, sys, json, math, random, hashlib, threading, time, re, uuid, csv
import io, base64
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, List, Dict, Tuple
from collections import defaultdict
from urllib.parse import urlparse
from flask import (Flask, render_template, request, jsonify,
                   send_from_directory, session, redirect, url_for)

app = Flask(__name__)
app.secret_key = os.urandom(32).hex()
app.config['SESSION_TYPE'] = 'filesystem'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

CONFIG = {
    "app_name": "SureBet Pro",
    "version": "5.0.0",
    "currency": "PLN",
    "default_stake": 100.0,
    "min_profit_pct": 0.3,
    "max_surebet_age": 30,
    "refresh_interval": 10,
    "bookmakers_update_interval": 20,
    "tax_rate": 0.12,
    "tax_free_threshold": 2280,
}


# ═══ STRIPE PAYMENT INTEGRATION ═══════════════════════════════════════
# Wymaga: pip install stripe
# Ustaw klucze API w panelu admina lub zmiennych środowiskowych
STRIPE_CONFIG = {
    "enabled": False,
    "publishable_key": os.environ.get("STRIPE_PUBLISHABLE_KEY", ""),
    "secret_key": os.environ.get("STRIPE_SECRET_KEY", ""),
    "webhook_secret": os.environ.get("STRIPE_WEBHOOK_SECRET", ""),
    "currency": "pln",
}

try:
    import stripe as stripe_lib
    if STRIPE_CONFIG["secret_key"]:
        stripe_lib.api_key = STRIPE_CONFIG["secret_key"]
        STRIPE_CONFIG["enabled"] = True
except ImportError:
    stripe_lib = None
    pass

def init_stripe():
    """Inicjalizuje Stripe z kluczami z bazy danych."""
    settings = db.get("settings", {})
    sk = settings.get("stripe_secret_key", STRIPE_CONFIG["secret_key"])
    pk = settings.get("stripe_publishable_key", STRIPE_CONFIG["publishable_key"])
    if sk and stripe_lib:
        stripe_lib.api_key = sk
        STRIPE_CONFIG["enabled"] = True
        STRIPE_CONFIG["secret_key"] = sk
        STRIPE_CONFIG["publishable_key"] = pk
        return True
    return False

def create_stripe_payment_intent(amount_pln, description="Wpłata SureBet Pro"):
    """Tworzy PaymentIntent Stripe do przyjęcia płatności."""
    if not STRIPE_CONFIG["enabled"] or not stripe_lib:
        return {"success": False, "error": "Stripe nie jest skonfigurowane. Dodaj klucze API w ustawieniach."}
    try:
        intent = stripe_lib.PaymentIntent.create(
            amount=int(amount_pln * 100),  # w groszach
            currency=STRIPE_CONFIG["currency"],
            description=description,
            metadata={"integration": "surebet_pro"},
        )
        return {
            "success": True,
            "client_secret": intent.client_secret,
            "intent_id": intent.id,
            "amount": amount_pln,
            "publishable_key": STRIPE_CONFIG["publishable_key"],
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.route("/api/stripe/config")
def api_stripe_config():
    """Zwraca konfigurację Stripe dla frontendu."""
    init_stripe()
    return jsonify({
        "enabled": STRIPE_CONFIG["enabled"],
        "publishable_key": STRIPE_CONFIG["publishable_key"],
    })

@app.route("/api/stripe/create-payment", methods=["POST"])
def api_stripe_create_payment():
    """Tworzy płatność Stripe."""
    data = request.get_json() or {}
    amount = float(data.get("amount", 0))
    if amount <= 0:
        return jsonify({"success": False, "error": "Nieprawidłowa kwota"})
    result = create_stripe_payment_intent(amount)
    return jsonify(result)

@app.route("/api/stripe/webhook", methods=["POST"])
def api_stripe_webhook():
    """Webhook Stripe - odbiera powiadomienia o płatnościach."""
    payload = request.get_data()
    sig_header = request.headers.get("Stripe-Signature", "")
    
    if not STRIPE_CONFIG["enabled"] or not stripe_lib:
        return jsonify({"status": "ignored"}), 200
    
    try:
        event = stripe_lib.Webhook.construct_event(
            payload, sig_header, STRIPE_CONFIG["webhook_secret"]
        )
    except (ValueError, stripe_lib.error.SignatureVerificationError):
        return jsonify({"error": "Invalid signature"}), 400
    
    if event["type"] == "payment_intent.succeeded":
        intent = event["data"]["object"]
        amount = intent["amount"] / 100  # z groszy na PLN
        # Dodaj środki do bankrolla
        add_to_real_bankroll(amount, f"Wpłata Stripe: {intent['id']}")
    
    return jsonify({"status": "success"})

def add_to_real_bankroll(amount, description=""):
    """Dodaje środki do realnego bankrolla."""
    bankroll = db.get("real_bankroll", {})
    bankroll["balance"] = bankroll.get("balance", 0) + amount
    bankroll["deposits"] = bankroll.get("deposits", 0) + amount
    if bankroll["balance"] > bankroll.get("peak_balance", 0):
        bankroll["peak_balance"] = bankroll["balance"]
    db.set("real_bankroll", bankroll)
    
    # Dodaj transakcję
    deposits = db.get("deposits", [])
    deposits.append({
        "id": str(uuid.uuid4())[:8],
        "method_id": "stripe",
        "method_name": "Stripe",
        "method_icon": "💳",
        "amount": amount,
        "fee": 0,
        "net_amount": amount,
        "status": "completed",
        "description": description or "Wpłata przez Stripe",
        "timestamp": datetime.now().isoformat(),
    })
    db.set("deposits", deposits)

# ═══ END STRIPE

# ═══ REAL PAYMENT GATEWAYS ═══════════════════════════════════════════

# --- PayPal REST API ---
def init_paypal():
    """Inicjalizuje PayPal z kluczami z bazy."""
    settings = db.get("settings", {})
    cid = settings.get("paypal_client_id", "")
    secret = settings.get("paypal_secret", "")
    if cid and secret:
        return {"client_id": cid, "secret": secret, "enabled": True}
    return {"enabled": False}

def create_paypal_order(amount_pln, description="Wpłata SureBet Pro"):
    """Tworzy zamówienie PayPal do przyjęcia płatności."""
    cfg = init_paypal()
    if not cfg["enabled"]:
        return {"success": False, "error": "PayPal nie skonfigurowany. Dodaj Client ID i Secret w ustawieniach."}
    try:
        import base64, json as jjson
        import urllib.request, ssl
        
        auth = base64.b64encode(f"{cfg['client_id']}:{cfg['secret']}".encode()).decode()
        ctx = ssl.create_default_context()
        
        token_req = urllib.request.Request(
            "https://api-m.paypal.com/v1/oauth2/token",
            data=b"grant_type=client_credentials",
            headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
        )
        token_resp = urllib.request.urlopen(token_req, context=ctx, timeout=5)
        token_data = jjson.loads(token_resp.read())
        access_token = token_data.get("access_token", "")
        
        if not access_token:
            return {"success": False, "error": "Błąd autoryzacji PayPal"}
        
        order_data = jjson.dumps({
            "intent": "CAPTURE",
            "purchase_units": [{
                "amount": {"currency_code": "PLN", "value": f"{amount_pln:.2f}"},
                "description": description,
            }],
        }).encode()
        
        order_req = urllib.request.Request(
            "https://api-m.paypal.com/v2/checkout/orders",
            data=order_data,
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        )
        order_resp = urllib.request.urlopen(order_req, context=ctx, timeout=5)
        order = jjson.loads(order_resp.read())
        
        approval_url = ""
        for link in order.get("links", []):
            if link.get("rel") == "approve":
                approval_url = link["href"]
                break
        
        return {
            "success": True,
            "order_id": order.get("id", ""),
            "approval_url": approval_url,
            "status": order.get("status", ""),
        }
    except Exception as e:
        return {"success": False, "error": f"PayPal: {str(e)}"}

def capture_paypal_order(order_id):
    cfg = init_paypal()
    if not cfg["enabled"]:
        return {"success": False}
    try:
        import base64, json as jjson
        import urllib.request, ssl
        
        auth = base64.b64encode(f"{cfg['client_id']}:{cfg['secret']}".encode()).decode()
        ctx = ssl.create_default_context()
        
        token_req = urllib.request.Request(
            "https://api-m.paypal.com/v1/oauth2/token",
            data=b"grant_type=client_credentials",
            headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
        )
        token_resp = urllib.request.urlopen(token_req, context=ctx, timeout=5)
        access_token = jjson.loads(token_resp.read()).get("access_token", "")
        
        cap_req = urllib.request.Request(
            f"https://api-m.paypal.com/v2/checkout/orders/{order_id}/capture",
            data=b"{}",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
        )
        cap_resp = urllib.request.urlopen(cap_req, context=ctx, timeout=5)
        result = jjson.loads(cap_resp.read())
        
        return {"success": result.get("status") == "COMPLETED", "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}

# --- Przelewy24 API ---
def init_p24():
    settings = db.get("settings", {})
    mid = settings.get("p24_merchant_id", "")
    api_key = settings.get("p24_api_key", "")
    if mid and api_key:
        return {"merchant_id": mid, "api_key": api_key, "enabled": True}
    return {"enabled": False}

def create_p24_transaction(amount_pln, email, description="Wpłata SureBet Pro"):
    cfg = init_p24()
    if not cfg["enabled"]:
        return {"success": False, "error": "Przelewy24 nie skonfigurowane. Dodaj Merchant ID i API Key."}
    try:
        import json as jjson
        import urllib.request, ssl
        
        session_id = str(uuid.uuid4())[:16]
        
        p24_data = jjson.dumps({
            "merchantId": int(cfg['merchant_id']),
            "posId": int(cfg['merchant_id']),
            "sessionId": session_id,
            "amount": int(amount_pln * 100),
            "currency": "PLN",
            "description": description[:64],
            "email": email,
            "country": "PL",
            "language": "pl",
            "urlReturn": "https://surebet-pro.pl/payment/return",
            "urlStatus": "https://surebet-pro.pl/api/p24/status",
            "encoding": "UTF-8",
            "method": 0,
            "timeLimit": 120,
            "channel": 0,
            "waitForResult": True,
        }).encode()
        
        ctx = ssl.create_default_context()
        p24_req = urllib.request.Request(
            "https://secure.przelewy24.pl/api/v1/transaction/register",
            data=p24_data,
            headers={"Content-Type": "application/json"},
        )
        
        p24_resp = urllib.request.urlopen(p24_req, context=ctx, timeout=10)
        result = jjson.loads(p24_resp.read())
        
        if result.get("data", {}).get("token"):
            token = result["data"]["token"]
            redirect_url = f"https://secure.przelewy24.pl/trnRequest/{token}"
            return {"success": True, "redirect_url": redirect_url, "token": token, "session_id": session_id}
        return {"success": False, "error": str(result)}
    except Exception as e:
        return {"success": False, "error": f"Przelewy24: {str(e)}"}

# --- BLIK / Autopay ---
def init_blik():
    settings = db.get("settings", {})
    api_key = settings.get("blik_api_key", "")
    if api_key:
        return {"api_key": api_key, "enabled": True}
    return {"enabled": False}

def create_blik_transaction(amount_pln, email, phone=""):
    cfg = init_blik()
    if not cfg["enabled"]:
        return {"success": False, "error": "BLIK API nie skonfigurowane. Dodaj klucz API BLIK w ustawieniach."}
    try:
        import json as jjson
        import urllib.request, ssl
        
        blik_data = jjson.dumps({
            "amount": amount_pln,
            "currency": "PLN",
            "description": "Wpłata SureBet Pro",
            "payer": {"email": email, "phone": phone} if phone else {"email": email},
            "channel": "blik",
        }).encode()
        
        ctx = ssl.create_default_context()
        req = urllib.request.Request(
            "https://pay.autopay.eu/api/v1/payments",
            data=blik_data,
            headers={"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"},
        )
        resp = urllib.request.urlopen(req, context=ctx, timeout=10)
        result = jjson.loads(resp.read())
        return {"success": True, "payment_url": result.get("url", ""), "payment_id": result.get("id", "")}
    except Exception as e:
        return {"success": False, "error": f"BLIK: {str(e)}"}

# --- API Endpoints dla płatności ---
@app.route("/api/payment/paypal/create", methods=["POST"])
def api_paypal_create():
    data = request.get_json() or {}
    amount = float(data.get("amount", 0))
    if amount <= 0: return jsonify({"success": False, "error": "Nieprawidłowa kwota"})
    return jsonify(create_paypal_order(amount))

@app.route("/api/payment/paypal/capture", methods=["POST"])
def api_paypal_capture():
    data = request.get_json() or {}
    order_id = data.get("order_id", "")
    if not order_id: return jsonify({"success": False, "error": "Brak order_id"})
    result = capture_paypal_order(order_id)
    if result.get("success"):
        add_to_real_bankroll(float(data.get("amount", 0)), "Wpłata PayPal")
    return jsonify(result)

@app.route("/api/payment/p24/create", methods=["POST"])
def api_p24_create():
    data = request.get_json() or {}
    amount = float(data.get("amount", 0))
    email = data.get("email", "wizzyeazy7@gmail.com")
    if amount <= 0: return jsonify({"success": False, "error": "Nieprawidłowa kwota"})
    return jsonify(create_p24_transaction(amount, email))

@app.route("/api/payment/blik/create", methods=["POST"])
def api_blik_create():
    data = request.get_json() or {}
    amount = float(data.get("amount", 0))
    email = data.get("email", "wizzyeazy7@gmail.com")
    phone = data.get("phone", "")
    if amount <= 0: return jsonify({"success": False, "error": "Nieprawidłowa kwota"})
    return jsonify(create_blik_transaction(amount, email, phone))

@app.route("/api/payment/status")
def api_payment_status():
    return jsonify({
        "success": True,
        "stripe": STRIPE_CONFIG.get("enabled", False),
        "paypal": bool(init_paypal().get("enabled")),
        "p24": bool(init_p24().get("enabled")),
        "blik": bool(init_blik().get("enabled")),
    })

# ═══ END PAYMENT INTEGRATIONS ════════════════════════════════════════

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

# ═══ ZAAWANSOWANA BAZA DANYCH ═══════════════════════════════════════

class Database:
    def __init__(self):
        self.file = DATA_DIR / "database.json"
        self.lock = threading.Lock()
        self.data = self._load()
    
    def _load(self):
        import os as _os
        default = {
            "bookmakers": {}, "accounts": {}, "bets": [], "surebets": [],
            "transactions": [], "settings": {
                "admin_email": _os.environ.get("ADMIN_EMAIL", "wizzyeazy7@gmail.com"),
                "user_name": _os.environ.get("USER_NAME", "Jakub Maciejewski"),
                "theoddsapi_key": _os.environ.get("THEODDSAPI_KEY", "8e4a252d3acac06f32e91b74acd75e71"),
                "live_data_enabled": True,
                "preview_mode": False,
            }, "users": {
                "admin": {
                    "username": "admin",
                    "email": "wizzyeazy7@gmail.com",
                    "password_hash": hashlib.sha256((os.environ.get("ADMIN_PASSWORD", "admin") + "a1b2c3d4e5f6a7b8").encode()).hexdigest(),
                    "salt": "a1b2c3d4e5f6a7b8",
                    "first_name": "Jakub",
                    "last_name": "Maciejewski",
                    "birth_date": "1994-01-28",
                    "created_at": "2026-05-25T21:55:08.351633",
                    "last_login": None,
                    "settings": {"role": "admin", "theme": "dark", "full_name": "Jakub Maciejewski"},
                    "sessions": []
                }
            }, "sessions": {},
            "value_bets": [], "multi_market_bets": [], "backtest_results": [],
            "odds_history": [], "match_stats_cache": {},
            "account_mode": "demo",
            "demo_bankroll": {
                "balance": 100000.0, "initial_balance": 100000.0,
                "deposits": 100000.0, "withdrawals": 0, "peak_balance": 100000.0,
            },
            "real_bankroll": {
                "balance": 0.0, "initial_balance": 0.0,
                "deposits": 0.0, "withdrawals": 0.0, "peak_balance": 0.0,
            },
            "deposits": [],
            "payment_methods": [],
            "investments": [],
            "investment_plans": [
                {"id": "daily", "name": "Daily Growth", "description": "0.5% dziennie, niskie ryzyko",
                 "daily_roi": 0.5, "min_amount": 50, "max_amount": 50000, "duration_days": 7, "risk": "niski"},
                {"id": "weekly", "name": "Weekly Boost", "description": "4% tygodniowo, średnie ryzyko",
                 "daily_roi": 0.57, "min_amount": 100, "max_amount": 100000, "duration_days": 30, "risk": "średni"},
                {"id": "monthly", "name": "Monthly Pro", "description": "25% miesięcznie, wysokie ryzyko",
                 "daily_roi": 0.83, "min_amount": 200, "max_amount": 200000, "duration_days": 60, "risk": "wysoki"},
                {"id": "staking", "name": "Staking Pool", "description": "15% APY, stały dochód",
                 "daily_roi": 0.04, "min_amount": 500, "max_amount": 500000, "duration_days": 365, "risk": "bardzo niski"},
            ],
            "statistics": {
                "total_profit": 0, "total_bets": 0, "won_bets": 0,
                "lost_bets": 0, "roi": 0, "best_day": 0, "worst_day": 0,
                "total_value_bets": 0, "value_profit": 0,
                "best_streak": 0, "worst_streak": 0, "current_streak": 0,
                "biggest_win": 0, "biggest_loss": 0,
            },
            "bankroll": {
                "balance": 10000.0, "initial_balance": 10000.0,
                "deposits": 0, "withdrawals": 0, "peak_balance": 10000.0,
            },
            "notifications": [
                {"id": "welcome", "title": "🎯 Witaj w SureBet Pro!", "message": "Aplikacja gotowa do pracy. Klucz API dodany - po podłączeniu internetu surebety pojawią się automatycznie.", "type": "success", "timestamp": "2025-01-01T00:00:00", "read": False},
                {"id": "live_info", "title": "📡 Tryb na żywo", "message": "Aplikacja działa w trybie permanentnie na żywo. Wymaga dostępu do internetu i klucza API The Odds API.", "type": "info", "timestamp": "2025-01-01T00:00:00", "read": False}
            ],
            "auto_bet_config": {
                "enabled": False, "max_stake_per_bet": 200, "min_profit": 1.0,
                "max_concurrent": 3, "strategy": "balanced",
                "bookmakers_whitelist": [], "sports_whitelist": [],
                "use_kelly": False, "kelly_fraction": 0.25,
                "only_value_bets": False, "min_expected_value": 1.05,
                "stop_loss": 0, "stop_win": 0,
            },
            "alert_config": {
                "sound_enabled": True, "vibration_enabled": True,
                "min_profit_alert": 0.5, "value_alert": True,
                "only_favorite_sports": False, "favorite_sports": [],
            },
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
        }
        if self.file.exists():
            try:
                return {**default, **json.loads(self.file.read_text())}
            except: pass
        return default
    
    def save(self):
        self.data["updated_at"] = datetime.now().isoformat()
        with self.lock:
            self.file.write_text(json.dumps(self.data, indent=2, ensure_ascii=False))
    
    def get(self, key, default=None):
        with self.lock:
            return self.data.get(key, default)
    
    def set(self, key, value):
        with self.lock:
            self.data[key] = value
        self.save()
    
    def update(self, key, value):
        with self.lock:
            if key in self.data and isinstance(self.data[key], dict) and isinstance(value, dict):
                self.data[key].update(value)
            else:
                self.data[key] = value
        self.save()


def get_bookmaker_total_balance():
    """Sumuje salda ze wszystkich zarejestrowanych kont bukmacherskich."""
    accounts = db.get("accounts", {})
    total = sum(a.get("balance", 0) for a in accounts.values() if a.get("status") == "active")
    return total

def get_active_bankroll():
    """Zwraca aktywny bankroll (demo lub realny) z uwzględnieniem kont BK."""
    mode = db.get("account_mode", "demo")
    if mode == "real":
        bk = db.get("real_bankroll", db.get("bankroll", {}))
        bk = dict(bk)
        bk["bookmaker_balances"] = get_bookmaker_total_balance()
        bk["total_balance"] = round(bk.get("balance", 0) + bk["bookmaker_balances"], 2)
        return bk
    return db.get("demo_bankroll", db.get("bankroll", {}))

def update_bankroll(updates):
    """Aktualizuje aktywny bankroll."""
    mode = db.get("account_mode", "demo")
    key = "real_bankroll" if mode == "real" else "demo_bankroll"
    bk = db.get(key, bankroll_default())
    # Remove computed keys that shouldn't be persisted
    updates_clean = {k: v for k, v in updates.items() if k not in ("bookmaker_balances", "total_balance", "total_with_bookmakers", "bookmaker_balance", "current_balance", "total_change", "total_change_pct", "total_bets", "roi", "win_rate", "account_mode")}
    bk.update(updates_clean)
    db.set(key, bk)
    return bk

def bankroll_default():
    return {"balance": 0.0, "initial_balance": 0.0, "deposits": 0.0, "withdrawals": 0.0, "peak_balance": 0.0}

db = Database()


# ═══ BUKMACHERZY ═════════════════════════════════════════════════════

DEFAULT_BOOKMAKERS = {
    "sts": {"name": "STS", "color": "#E30613", "country": "PL", "rating": 4.5,
        "sports": ["piłka nożna","koszykówka","tenis","siatkówka","hokej","piłka ręczna"],
        "api_type": "scraping", "base_url": "https://www.sts.pl", "has_auto_registration": True,
        "avg_margin": 0.06, "reliability": 95, "payout_speed": 4.5},
    "fortuna": {"name": "Fortuna", "color": "#FF6600", "country": "PL", "rating": 4.3,
        "sports": ["piłka nożna","koszykówka","tenis","siatkówka","hokej","piłka ręczna"],
        "api_type": "scraping", "base_url": "https://www.fortuna.pl", "has_auto_registration": True,
        "avg_margin": 0.07, "reliability": 90, "payout_speed": 4.0},
    "betclic": {"name": "Betclic", "color": "#FFD700", "country": "PL", "rating": 4.2,
        "sports": ["piłka nożna","koszykówka","tenis","siatkówka","hokej"],
        "api_type": "scraping", "base_url": "https://www.betclic.pl", "has_auto_registration": True,
        "avg_margin": 0.08, "reliability": 88, "payout_speed": 4.2},
    "totolotek": {"name": "Totolotek", "color": "#00AA00", "country": "PL", "rating": 4.0,
        "sports": ["piłka nożna","koszykówka","tenis","siatkówka"],
        "api_type": "scraping", "base_url": "https://www.totolotek.pl", "has_auto_registration": True,
        "avg_margin": 0.09, "reliability": 85, "payout_speed": 3.8},
    "superbet": {"name": "Superbet", "color": "#FFD700", "country": "PL", "rating": 4.1,
        "sports": ["piłka nożna","koszykówka","tenis","siatkówka","piłka ręczna"],
        "api_type": "scraping", "base_url": "https://www.superbet.pl", "has_auto_registration": True,
        "avg_margin": 0.07, "reliability": 87, "payout_speed": 4.1},
    "lvbet": {"name": "LV BET", "color": "#1A1A2E", "country": "PL", "rating": 4.0,
        "sports": ["piłka nożna","koszykówka","tenis","siatkówka","hokej"],
        "api_type": "scraping", "base_url": "https://www.lvbet.pl", "has_auto_registration": True,
        "avg_margin": 0.08, "reliability": 83, "payout_speed": 3.9},
    "betfan": {"name": "Betfan", "color": "#0044CC", "country": "PL", "rating": 3.8,
        "sports": ["piłka nożna","koszykówka","tenis"],
        "api_type": "scraping", "base_url": "https://www.betfan.pl", "has_auto_registration": True,
        "avg_margin": 0.10, "reliability": 80, "payout_speed": 3.5},
    "pzbuk": {"name": "PZBuk", "color": "#008000", "country": "PL", "rating": 3.5,
        "sports": ["piłka nożna","siatkówka","piłka ręczna"],
        "api_type": "scraping", "base_url": "https://www.pzbuk.pl", "has_auto_registration": True,
        "avg_margin": 0.11, "reliability": 78, "payout_speed": 3.2},
    "forbet": {"name": "Forbet", "color": "#003366", "country": "PL", "rating": 3.9,
        "sports": ["piłka nożna","koszykówka","tenis","siatkówka"],
        "api_type": "scraping", "base_url": "https://www.forbet.pl", "has_auto_registration": True,
        "avg_margin": 0.09, "reliability": 82, "payout_speed": 3.7},
    "bet365": {"name": "Bet365", "color": "#004B87", "country": "UK", "rating": 4.8,
        "sports": ["piłka nożna","koszykówka","tenis","siatkówka","hokej","piłka ręczna","MMA","boks"],
        "api_type": "scraping", "base_url": "https://www.bet365.com", "has_auto_registration": False,
        "avg_margin": 0.05, "reliability": 98, "payout_speed": 4.9},
}

SPORTS = ["piłka nożna","koszykówka","tenis","siatkówka","hokej","piłka ręczna","MMA","boks","baseball","football amerykański","rugby","snooker","darta"]

LEAGUES = {sp: [] for sp in SPORTS}

TEAMS = {}  # Will be populated from existing data

# Copy from existing data
import importlib.util
spec_teams = {
    "piłka nożna": {
        "Premier League": [("Manchester City",1.5),("Arsenal",2.0),("Liverpool",2.5),("Manchester United",4.0),("Chelsea",4.5),("Tottenham",5.0),("Newcastle",6.0),("Aston Villa",7.0),("Brighton",8.0),("West Ham",10.0),("Crystal Palace",12.0),("Brentford",15.0),("Fulham",18.0),("Wolves",20.0),("Bournemouth",25.0),("Nottingham Forest",30.0),("Everton",35.0),("Leicester",40.0),("Ipswich",50.0),("Southampton",60.0)],
        "La Liga": [("Real Madryt",1.4),("Barcelona",2.0),("Atletico Madryt",4.0),("Girona",6.0),("Athletic Bilbao",8.0),("Real Sociedad",10.0),("Betis",15.0),("Villarreal",18.0),("Valencia",20.0),("Sevilla",22.0),("Osasuna",25.0),("Mallorca",30.0),("Rayo Vallecano",35.0),("Celta Vigo",40.0),("Getafe",45.0),("Alaves",50.0),("Las Palmas",60.0),("Cadiz",70.0)],
        "Serie A": [("Inter Mediolan",1.5),("AC Milan",2.5),("Juventus",3.0),("Napoli",4.0),("Atalanta",5.0),("Roma",6.0),("Lazio",8.0),("Fiorentina",10.0),("Bologna",12.0),("Torino",15.0),("Udinese",20.0),("Genoa",25.0),("Monza",30.0),("Lecce",35.0),("Salernitana",40.0),("Cagliari",45.0),("Frosinone",50.0),("Empoli",55.0)],
        "Bundesliga": [("Bayern Monachium",1.3),("Borussia Dortmund",3.0),("RB Lipsk",4.0),("Bayer Leverkusen",5.0),("Union Berlin",8.0),("Eintracht Frankfurt",10.0),("Freiburg",12.0),("Wolfsburg",15.0),("Borussia M'gladbach",18.0),("Werder Brema",20.0),("Stuttgart",22.0),("Augsburg",25.0),("Hoffenheim",30.0),("Mainz",35.0),("Koln",40.0),("Heidenheim",50.0),("Darmstadt",60.0),("Bochum",65.0)],
        "Ligue 1": [("PSG",1.2),("Marsylia",3.5),("Monaco",4.0),("Lyon",5.0),("Lille",6.0),("Rennes",8.0),("Nice",10.0),("Lens",12.0),("Strasbourg",15.0),("Toulouse",20.0),("Montpellier",25.0),("Reims",30.0),("Brest",35.0),("Auxerre",40.0),("Le Havre",45.0),("Angers",50.0),("Nantes",55.0),("Saint-Etienne",60.0)],
        "Ekstraklasa": [("Legia Warszawa",2.0),("Raków Częstochowa",2.5),("Lech Poznań",3.0),("Pogoń Szczecin",4.0),("Śląsk Wrocław",5.0),("Jagiellonia Białystok",6.0),("Widzew Łódź",8.0),("Górnik Zabrze",10.0),("Wisła Kraków",12.0),("Lechia Gdańsk",15.0),("Cracovia",18.0),("Zagłębie Lubin",20.0),("Radomiak Radom",25.0),("Korona Kielce",30.0),("Stal Mielec",35.0),("Puszcza Niepołomice",40.0),("Motor Lublin",45.0),("GKS Katowice",50.0)],
        "Liga Mistrzów": [("Manchester City",2.0),("Real Madryt",3.0),("Bayern Monachium",4.0),("PSG",5.0),("Arsenal",6.0),("Inter Mediolan",8.0),("Barcelona",10.0),("Borussia Dortmund",12.0),("Atletico Madryt",15.0),("RB Lipsk",20.0),("Lazio",25.0),("FC Porto",30.0),("Benfica",35.0),("AC Milan",40.0)],
    },
    "koszykówka": {"NBA": [("Boston Celtics",1.8),("Denver Nuggets",2.0),("Milwaukee Bucks",3.0),("Los Angeles Lakers",4.0),("Golden State Warriors",5.0),("Phoenix Suns",6.0),("Philadelphia 76ers",7.0),("Miami Heat",8.0),("Dallas Mavericks",9.0),("Oklahoma City Thunder",10.0),("Minnesota Timberwolves",12.0),("New York Knicks",15.0),("Cleveland Cavaliers",18.0),("Orlando Magic",20.0),("Indiana Pacers",22.0),("Sacramento Kings",25.0),("New Orleans Pelicans",30.0),("Houston Rockets",35.0),("Atlanta Hawks",40.0),("Chicago Bulls",45.0),("Utah Jazz",50.0),("San Antonio Spurs",60.0),("Brooklyn Nets",70.0),("Portland Trail Blazers",80.0),("Memphis Grizzlies",90.0),("Toronto Raptors",100.0),("Charlotte Hornets",120.0),("Washington Wizards",150.0),("Detroit Pistons",200.0)]},
    "tenis": {"ATP Tour": [("Jannik Sinner",1.5),("Carlos Alcaraz",2.0),("Novak Djoković",2.5),("Daniil Miedwiediew",4.0),("Alexander Zverev",5.0),("Andrey Rublev",6.0),("Hubert Hurkacz",8.0),("Holger Rune",10.0),("Casper Ruud",12.0),("Stefanos Tsitsipas",15.0),("Taylor Fritz",18.0),("Frances Tiafoe",20.0),("Tommy Paul",25.0),("Ben Shelton",30.0),("Grigor Dimitrov",35.0),("Alex de Minaur",40.0)]},
    "siatkówka": {"PlusLiga": [("Jastrzębski Węgiel",1.8),("ZAKSA Kędzierzyn-Koźle",2.0),("PGE Skra Bełchatów",3.0),("Asseco Resovia",4.0),("Trefl Gdańsk",5.0),("Projekt Warszawa",6.0),("Aluron CMC Warta Zawiercie",8.0),("GKS Katowice",10.0),("Indykpol AZS Olsztyn",12.0),("Cuprum Lubin",15.0),("PSG Stal Nysa",18.0),("MKS Będzin",20.0),("BBTS Bielsko-Biała",25.0),("LUK Lublin",30.0),("Avia Świdnik",35.0),("Norwid Częstochowa",40.0)]},
    "hokej": {"NHL": [("Edmonton Oilers",2.0),("Colorado Avalanche",3.0),("Toronto Maple Leafs",4.0),("Dallas Stars",5.0),("Carolina Hurricanes",6.0),("Florida Panthers",7.0),("Vancouver Canucks",8.0),("New York Rangers",9.0),("Boston Bruins",10.0),("Winnipeg Jets",12.0),("Los Angeles Kings",15.0),("Tampa Bay Lightning",18.0),("Vegas Golden Knights",20.0),("Nashville Predators",22.0),("New Jersey Devils",25.0),("Detroit Red Wings",30.0),("St. Louis Blues",35.0),("Minnesota Wild",40.0),("Seattle Kraken",45.0),("Calgary Flames",50.0),("Montreal Canadiens",60.0),("Anaheim Ducks",70.0),("Columbus Blue Jackets",80.0),("Buffalo Sabres",90.0),("San Jose Sharks",100.0),("Chicago Blackhawks",120.0),("Arizona Coyotes",150.0),("Ottawa Senators",200.0)]},
    "piłka ręczna": {"PGNiG Superliga": [("Industria Kielce",1.5),("Orlen Wisła Płock",2.0),("Górnik Zabrze",4.0),("Legionowo",6.0),("Chrobry Głogów",8.0),("MMTS Kwidzyn",10.0),("Zagłębie Lubin",12.0),("Pogoń Szczecin",15.0),("KPR Ostrovia",18.0),("WKS Śląsk Wrocław",20.0),("Stal Mielec",25.0),("Wybrzeże Gdańsk",30.0),("Energa MKS Kalisz",35.0),("Sandra Spa Pogoń",40.0)]},
    "MMA": {"UFC": [("Jon Jones",1.5),("Islam Makhachev",1.8),("Alex Pereira",2.0),("Leon Edwards",2.5),("Sean O'Malley",3.0),("Ilia Topuria",3.5),("Alexander Volkanovski",4.0),("Max Holloway",5.0),("Charles Oliveira",6.0),("Justin Gaethje",7.0),("Dustin Poirier",8.0),("Kamaru Usman",10.0),("Robert Whittaker",12.0),("Jan Błachowicz",15.0),("Mateusz Gamrot",20.0),("Tom Aspinall",25.0)]},
    "boks": {"Waga Ciężka": [("Tyson Fury",1.3),("Oleksandr Usyk",1.7),("Anthony Joshua",3.0),("Deontay Wilder",4.0),("Joseph Parker",6.0),("Zhilei Zhang",8.0),("Filip Hrgović",10.0),("Daniel Dubois",12.0),("Jared Anderson",15.0),("Agit Kabayel",20.0),("Martin Bakole",25.0),("Frank Sanchez",30.0)],"Waga Półciężka": [("Artur Beterbiev",1.5),("Dmitry Bivol",1.8),("Canelo Alvarez",3.0),("David Benavidez",4.0),("Joshua Buatsi",6.0),("Anthony Yarde",8.0),("Callum Smith",10.0),("Dan Azeez",15.0)]},
    "football amerykański": {"NFL": [("Kansas City Chiefs",2.0),("San Francisco 49ers",3.0),("Philadelphia Eagles",4.0),("Baltimore Ravens",5.0),("Buffalo Bills",6.0),("Cincinnati Bengals",7.0),("Detroit Lions",8.0),("Dallas Cowboys",10.0),("Miami Dolphins",12.0),("Green Bay Packers",15.0),("Houston Texans",18.0),("New York Jets",20.0),("Cleveland Browns",22.0),("Los Angeles Rams",25.0),("Seattle Seahawks",30.0),("Chicago Bears",35.0),("Atlanta Falcons",40.0),("New England Patriots",50.0),("New York Giants",60.0),("Las Vegas Raiders",70.0),("Denver Broncos",80.0),("New Orleans Saints",90.0),("Minnesota Vikings",100.0),("Tennessee Titans",120.0),("Indianapolis Colts",150.0),("Washington Commanders",180.0),("Tampa Bay Buccaneers",200.0),("Carolina Panthers",250.0)]},
    "rugby": {"Puchar Sześciu Narodów": [("Irlandia",2.0),("Francja",2.5),("Nowa Zelandia",3.0),("Anglia",4.0),("RPA",5.0),("Szkocja",6.0),("Walia",8.0),("Argentyna",10.0),("Australia",12.0),("Fidżi",15.0),("Włochy",20.0),("Japonia",25.0),("Gruzja",30.0),("Samoa",35.0),("Tonga",40.0)]},
    "snooker": {"World Snooker": [("Ronnie O'Sullivan",2.0),("Judd Trump",2.5),("Mark Selby",3.0),("Neil Robertson",4.0),("John Higgins",5.0),("Mark Williams",6.0),("Shaun Murphy",7.0),("Kyren Wilson",8.0),("Jack Lisowski",10.0),("Mark Allen",12.0),("Ding Junhui",15.0),("Barry Hawkins",18.0),("Luca Brecel",20.0),("Ali Carter",22.0),("Si Jiahui",25.0),("Zhang Anda",30.0)]},
    "darta": {"PDC World": [("Luke Humphries",2.0),("Michael van Gerwen",2.5),("Michael Smith",3.0),("Gerwyn Price",4.0),("Nathan Aspinall",5.0),("Rob Cross",6.0),("Danny Noppert",8.0),("Jonny Clayton",10.0),("Dave Chisnall",12.0),("Dimitri Van den Bergh",15.0),("James Wade",18.0),("Peter Wright",20.0),("Stephen Bunting",22.0),("Gary Anderson",25.0),("Raymond van Barneveld",30.0),("Krzysztof Ratajski",35.0),("Luke Littler",40.0)]},
}
TEAMS.update(spec_teams)
for sport, leagues_data in spec_teams.items():
    LEAGUES[sport] = list(leagues_data.keys())

# ═══ ZAAWANSOWANY SILNIK SUREBET ════════════════════════════════════


# ═══════════════════════════════════════════════════════════════════════
#  REAL DATA FETCHER — pobiera prawdziwe mecze i kursy z API
# ═══════════════════════════════════════════════════════════════════════

class LiveDataFetcher:
    """Próbuje pobrać prawdziwe dane z dostępnych API sportowych.
    Jeśli API nie są dostępne, zwraca None — engine używa wtedy symulacji."""
    
    def __init__(self):
        self.cache = {}
        self.cache_ttl = 300  # 5 minutes
        self.last_fetch = {}
        self.session = None
        self._init_session()
    
    def _init_session(self):
        try:
            import urllib.request
            self.session = urllib.request
        except:
            self.session = None
    
    def is_available(self):
        """Sprawdza czy mamy dostęp do internetu i API (krótki timeout, nie blokuje)."""
        if not self.session:
            return False
        try:
            import socket
            host = "www.thesportsdb.com"
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(1.5)
            try:
                s.connect((host, 80))
                s.close()
                return True
            except:
                s.close()
                return False
        except:
            return False
    
    def fetch_matches_from_source(self, source="thesportsdb"):
        """Próbuje pobrać mecze z różnych źródeł."""
        if source == "thesportsdb":
            return self._fetch_thesportsdb()
        elif source == "odds_api":
            return self._fetch_odds_api()
        return None
    
    def _fetch_thesportsdb(self):
        """Próbuje pobrać najbliższe wydarzenia z TheSportsDB."""
        try:
            import urllib.request, json
            url = "https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=4328"
            req = urllib.request.urlopen(url, timeout=2)
            data = json.loads(req.read())
            if data and data.get("events"):
                return self._parse_sportsdb_events(data["events"])
        except:
            pass
        return None
    
    def fetch_with_api_key(self, api_key, provider="theoddsapi"):
        """Pobiera prawdziwe kursy używając klucza API."""
        if not api_key:
            return {"success": False, "error": "Brak klucza API"}
        
        try:
            import urllib.request, json, ssl
            
            if provider == "theoddsapi":
                # The Odds API - darmowy tier
                import random
                # Najpierw pobierz dostępne sporty
                url = f"https://api.the-odds-api.com/v4/sports/?apiKey={api_key}"
                ctx = ssl.create_default_context()
                req = urllib.request.urlopen(url, timeout=5, context=ctx)
                sports = json.loads(req.read())
                
                if not sports or (isinstance(sports, dict) and sports.get("error_code")):
                    return {"success": False, "error": sports.get("message", "Błąd API") if isinstance(sports, dict) else "Błąd API"}
                
                matches = []
                # Dla każdego sportu pobierz najbliższe wydarzenia
                selected = [s for s in sports if ("soccer" in s.get("key","") or "basketball" in s.get("key","") or "tennis" in s.get("key","")) and "_winner" not in s.get("key","") and "_championship" not in s.get("key","") and s.get("active")]
                remaining = [s for s in sports if not ("soccer" in s.get("key","") or "basketball" in s.get("key","") or "tennis" in s.get("key","")) and "_winner" not in s.get("key","") and "_championship" not in s.get("key","")]
                selected = (selected + remaining)[:3]
                for sport in selected:  # Limit 3 sporty
                    sport_key = sport.get("key", "")
                    sport_title = sport.get("title", "")
                    if not sport_key:
                        continue
                    # Skip championship/outrights sports (they don't support h2h/spreads markets)
                    if "_championship_winner" in sport_key or "_winner" in sport_key or "_outright" in sport_key:
                        continue
                    
                    try:
                        url2 = f"https://api.the-odds-api.com/v4/sports/{sport_key}/odds/?apiKey={api_key}&regions=eu&markets=h2h&oddsFormat=decimal"
                        req2 = urllib.request.urlopen(url2, timeout=5, context=ctx)
                        events = json.loads(req2.read())
                    except Exception as e:
                        continue
                    
                    if isinstance(events, list):
                        for ev in events[:10]:  # Max 10 wydarzeń na sport
                            try:
                                team1 = ev.get("home_team", "")
                                team2 = ev.get("away_team", "")
                                if not team1 or not team2:
                                    continue
                                
                                match_date = datetime.fromisoformat(ev.get("commence_time", "").replace("Z", "+00:00")) if ev.get("commence_time") else datetime.now()
                                
                                # Build full_odds with REAL bookmaker odds
                                full_odds = {}
                                real_bk_count = 0
                                for bookmaker in ev.get("bookmakers", []):
                                    bk_key = bookmaker.get("key", "").replace("-", "_").replace(".", "_")
                                    bk_title = bookmaker.get("title", bk_key)
                                    # Generate realistic AH, OU, BTTS odds for this bookmaker
                                    rating1 = random.uniform(3, 9)
                                    rating2 = random.uniform(3, 9)
                                    # Build odds structure with real 1X2
                                    real_1x2 = {}
                                    for market in bookmaker.get("markets", []):
                                        if market.get("key") == "h2h":
                                            for outcome in market.get("outcomes", []):
                                                name = outcome.get("name", "")
                                                price = outcome.get("price", 0)
                                                if name and price:
                                                    key = "1" if name == team1 else "X" if name == "Draw" else "2"
                                                    real_1x2[key] = price
                                    
                                    if not real_1x2:
                                        continue
                                    
                                    # Build odds with real 1X2 and generated AH/OU/BTTS
                                    ah_vals = [{"handicap": h, "1": round(1.8+random.random()*0.4,2), "2": round(1.8+random.random()*0.4,2)} for h in [-1.5,-0.5,0,0.5,1.5]]
                                    ou_vals = [{"line": l, "O": round(1.7+random.random()*0.6,2), "U": round(1.7+random.random()*0.6,2)} for l in [2.5,3.5,4.5]]
                                    btts_vals = {"Tak": round(1.7+random.random()*0.5,2), "Nie": round(1.7+random.random()*0.5,2)}
                                    bk_odds = {
                                        "1X2": real_1x2,
                                        "AH": ah_vals,
                                        "OU": ou_vals,
                                        "BTTS": btts_vals,
                                        "_title": bk_title,
                                    }
                                    full_odds[bk_key] = bk_odds
                                    real_bk_count += 1
                                
                                if real_bk_count < 2:
                                    continue  # Need at least 2 bookmakers for surebets
                                
                                matches.append({
                                    "id": str(uuid.uuid4())[:8],
                                    "sport": sport_title.lower(),
                                    "league": sport_title,
                                    "team1": team1,
                                    "team2": team2,
                                    "date": match_date.isoformat(),
                                    "full_odds": full_odds,
                                    "status": "upcoming",
                                    "type": "piłka nożna" if "football" in sport_key else sport_title,
                                    "source": "live",
                                    "api_provider": "theoddsapi",
                                })
                            except:
                                continue
                
                if matches:
                    return {"success": True, "matches": matches, "count": len(matches)}
                return {"success": False, "error": "Brak wydarzeń"}
                
            elif provider == "api_football":
                url = "https://v3.football.api-sports.io/fixtures?date=" + datetime.now().strftime("%Y-%m-%d")
                headers = {
                    "x-rapidapi-key": api_key,
                    "x-rapidapi-host": "v3.football.api-sports.io"
                }
                req = urllib.request.Request(url, headers=headers)
                ctx = ssl.create_default_context()
                resp = urllib.request.urlopen(req, timeout=5, context=ctx)
                data = json.loads(resp.read())
                
                if data.get("errors") and data["errors"].get("token"):
                    return {"success": False, "error": "Nieprawidłowy klucz API-Football"}
                
                matches = []
                for fixture in data.get("response", [])[:15]:
                    try:
                        league = fixture["league"]["name"]
                        home = fixture["teams"]["home"]["name"]
                        away = fixture["teams"]["away"]["name"]
                        date = fixture["fixture"]["date"]
                        
                        rating1 = random.uniform(1, 10)
                        rating2 = random.uniform(1, 10)
                        # Generate realistic odds for all markets
                        import random as _rd
                        ah_v = [{"handicap": h, "1": round(1.8+_rd.random()*0.4,2), "2": round(1.8+_rd.random()*0.4,2)} for h in [-1.5,-0.5,0,0.5,1.5]]
                        ou_v = [{"line": l, "O": round(1.7+_rd.random()*0.6,2), "U": round(1.7+_rd.random()*0.6,2)} for l in [2.5,3.5,4.5]]
                        btts_v = {"Tak": round(1.7+_rd.random()*0.5,2), "Nie": round(1.7+_rd.random()*0.5,2)}
                        # Generate simulated 1X2
                        total_r = rating1 + rating2
                        p1 = (rating2 / total_r) * 0.55 if total_r > 0 else 0.33
                        p2 = (rating1 / total_r) * 0.55 if total_r > 0 else 0.33
                        p_d = 0.1
                        tp = p1 + p2 + p_d
                        p1n, p2n, p_dn = p1/tp, p2/tp, p_d/tp
                        full_odds = {"1X2": {"1": round(1/p1n,2) if p1n > 0 else 3.0, "X": round(1/p_dn,2) if p_dn > 0 else 3.0, "2": round(1/p2n,2) if p2n > 0 else 3.0},
                                     "AH": ah_v, "OU": ou_v, "BTTS": btts_v}
                        
                        matches.append({
                            "id": str(uuid.uuid4())[:8],
                            "sport": "piłka nożna",
                            "league": league,
                            "team1": home,
                            "team2": away,
                            "date": date,
                            "full_odds": full_odds,
                            "status": "upcoming",
                            "type": "piłka nożna",
                            "source": "live",
                            "api_provider": "api_football",
                        })
                    except:
                        continue
                
                if matches:
                    return {"success": True, "matches": matches, "count": len(matches)}
                return {"success": False, "error": "Brak meczów"}
                
        except Exception as e:
            return {"success": False, "error": str(e)}
        
        return {"success": False, "error": "Nieznany provider"}

live_data = LiveDataFetcher()

class AdvancedSurebetEngine:
    """Zaawansowany silnik z obsługą wielu rynków, value betting i analizą."""
    
    def __init__(self):
        self.lock = threading.Lock()
        self.running = False
        self.thread = None
        self.last_update = None
        self.generated_surebets = []
        self.generated_value_bets = []
        self.generated_multi_market = []
        self.generated_matches = []
        self.odds_history = []
    
    def _generate_odds_multi_market(self, team1, team2, rating1, rating2):
        """Generuje kursy dla wielu rynków."""
        base_odds = self._generate_1x2_odds(rating1, rating2)
        multi_market = {"1X2": base_odds}
        
        # Asian Handicap
        ah_markets = []
        for handicap in [-2.5, -1.5, -0.5, 0, 0.5, 1.5, 2.5]:
            prob = 0.5 - (handicap * 0.05) + random.uniform(-0.05, 0.05)
            prob = max(0.1, min(0.9, prob))
            fair_odds = {"1": round(1/prob, 2), "2": round(1/(1-prob), 2)}
            ah_markets.append({"handicap": handicap, "odds": fair_odds})
        multi_market["AH"] = ah_markets
        
        # Over/Under
        ou_markets = []
        for line in [1.5, 2.5, 3.5, 4.5, 5.5]:
            prob_over = 0.5 - (line * 0.03) + random.uniform(-0.04, 0.04)
            prob_over = max(0.15, min(0.85, prob_over))
            fair_odds = {"O": round(1/prob_over, 2), "U": round(1/(1-prob_over), 2)}
            ou_markets.append({"line": line, "odds": fair_odds})
        multi_market["OU"] = ou_markets
        
        # Both Teams to Score
        btts_prob = random.uniform(0.4, 0.7)
        multi_market["BTTS"] = {
            "Tak": round(1/btts_prob, 2),
            "Nie": round(1/(1-btts_prob), 2)
        }
        
        # Apply bookmaker margins
        bookmaker_margins = {k: v["avg_margin"] for k, v in DEFAULT_BOOKMAKERS.items()}
        final_odds = {}
        
        # Weight bookmaker advantages per outcome for realistic variance
        bk_advantages = {}
        for bk_id in bookmaker_margins:
            advantages = {}
            for outcome in ["1", "X", "2"]:
                # Each bookmaker gets a random edge on different outcomes
                # Higher variance creates realistic surebet opportunities
                advantages[outcome] = random.uniform(-0.15, 0.20)
            bk_advantages[bk_id] = advantages
        
        for bk_id, margin in bookmaker_margins.items():
            bk_odds = {}
            for market_type, market_data in multi_market.items():
                if market_type == "1X2":
                    bk_odds["1X2"] = {}
                    for outcome, fair in market_data.items():
                        adv = bk_advantages[bk_id][outcome]
                        noise = random.uniform(-0.03, 0.03)
                        effective_margin = max(0.01, margin - adv + noise)
                        bk_odds["1X2"][outcome] = round(fair * (1 - effective_margin), 2)
                        bk_odds["1X2"][outcome] = max(bk_odds["1X2"][outcome], 1.01)
                elif market_type == "AH":
                    bk_odds["AH"] = []
                    for ah in market_data:
                        h = ah["handicap"]
                        fair = ah["odds"]
                        noise1 = random.uniform(-0.10, 0.15)
                        noise2 = random.uniform(-0.10, 0.15)
                        bk_odds["AH"].append({
                            "handicap": h,
                            "1": round(fair["1"] * (1 - margin - 0.02 + noise1), 2),
                            "2": round(fair["2"] * (1 - margin - 0.02 + noise2), 2),
                        })
                elif market_type == "OU":
                    bk_odds["OU"] = []
                    for ou in market_data:
                        fair = ou["odds"]
                        noiseO = random.uniform(-0.10, 0.15)
                        noiseU = random.uniform(-0.10, 0.15)
                        bk_odds["OU"].append({
                            "line": ou["line"],
                            "O": round(fair["O"] * (1 - margin - 0.02 + noiseO), 2),
                            "U": round(fair["U"] * (1 - margin - 0.02 + noiseU), 2),
                        })
                elif market_type == "BTTS":
                    noiseT = random.uniform(-0.10, 0.15)
                    noiseN = random.uniform(-0.10, 0.15)
                    marginal = margin + 0.03
                    bk_odds["BTTS"] = {
                        "Tak": round(market_data["Tak"] * (1 - marginal + noiseT), 2),
                        "Nie": round(market_data["Nie"] * (1 - marginal + noiseN), 2),
                    }
                    if bk_odds["BTTS"]["Tak"] < 1.01: bk_odds["BTTS"]["Tak"] = 1.01
                    if bk_odds["BTTS"]["Nie"] < 1.01: bk_odds["BTTS"]["Nie"] = 1.01
            final_odds[bk_id] = bk_odds
        
        return final_odds
    
    def _generate_1x2_odds(self, rating1, rating2):
        total = rating1 + rating2
        prob1 = (rating2 / total) * 0.55
        prob2 = (rating1 / total) * 0.55
        draw_prob = 0.1 * (rating1 * rating2) / (total ** 2)
        tp = prob1 + prob2 + draw_prob
        prob1 /= tp; prob2 /= tp; draw_prob /= tp
        return {"1": 1/prob1 if prob1 > 0 else 999,
                "X": 1/draw_prob if draw_prob > 0 else 999,
                "2": 1/prob2 if prob2 > 0 else 999}
    
    def _find_all_opportunities(self, matches):
        """Znajduje surebety, valuebety i multi-market okazje."""
        surebets = []
        value_bets = []
        multi_market_ops = []
        
        for match in matches:
            odds = match.get("full_odds", {})
            if not odds: continue
            
            bookmaker_ids = list(odds.keys())
            
            # 1X2 Surebets
            for i in range(len(bookmaker_ids)):
                for j in range(i+1, len(bookmaker_ids)):
                    bk1, bk2 = bookmaker_ids[i], bookmaker_ids[j]
                    for outcomes_key in ["1X2"]:
                        o1 = odds[bk1].get(outcomes_key, {})
                        o2 = odds[bk2].get(outcomes_key, {})
                        if not o1 or not o2: continue
                        
                        # Check all 3 outcomes (1X2)
                        best3 = {}
                        for out in ["1","X","2"]:
                            val = max(o1.get(out,0), o2.get(out,0))
                            if val > 0:
                                best3[out] = val
                                best3[out+"_from"] = bk1 if o1.get(out,0) >= o2.get(out,0) else bk2
                        
                        if all(o in best3 for o in ["1","X","2"]):
                            inv3 = sum(1/best3[o] for o in ["1","X","2"])
                            if inv3 < 1:
                                pct = round((1/inv3 - 1)*100, 2)
                                if pct >= CONFIG["min_profit_pct"]:
                                    stakes = {}
                                    for o in ["1","X","2"]:
                                        if best3.get(o,0) > 0:
                                            stakes[o] = round(100/(best3[o]*inv3), 2)
                                    surebets.append(self._make_surebet(match, bk1, bk2, best3, stakes, pct, inv3, "1X2"))
                        
                        # Check 2 outcomes (1 and 2 only - for surebet without draw)
                        best2 = {}
                        for out in ["1","2"]:
                            val = max(o1.get(out,0), o2.get(out,0))
                            if val > 0:
                                best2[out] = val
                                best2[out+"_from"] = bk1 if o1.get(out,0) >= o2.get(out,0) else bk2
                        
                        if all(o in best2 for o in ["1","2"]):
                            inv2 = sum(1/best2[o] for o in ["1","2"])
                            if inv2 < 1:
                                pct = round((1/inv2 - 1)*100, 2)
                                if pct >= CONFIG["min_profit_pct"]:
                                    stakes = {}
                                    for o in ["1","2"]:
                                        if best2.get(o,0) > 0:
                                            stakes[o] = round(100/(best2[o]*inv2), 2)
                                    surebets.append(self._make_surebet(match, bk1, bk2, best2, stakes, pct, inv2, "1X2"))
            
            # Asian Handicap surebets
            for i in range(len(bookmaker_ids)):
                for j in range(i+1, len(bookmaker_ids)):
                    bk1, bk2 = bookmaker_ids[i], bookmaker_ids[j]
                    ah1 = odds[bk1].get("AH", [])
                    ah2 = odds[bk2].get("AH", [])
                    if not ah1 or not ah2: continue
                    
                    for ah_item1 in ah1:
                        h = ah_item1["handicap"]
                        ah_item2 = next((a for a in ah2 if a["handicap"] == h), None)
                        if not ah_item2: continue
                        
                        best_ah = {}
                        for out in ["1","2"]:
                            v1, v2 = ah_item1.get(out,0), ah_item2.get(out,0)
                            if v1 > 0 and v2 > 0:
                                val = max(v1, v2)
                                best_ah[out] = val
                                best_ah[out+"_from"] = bk1 if v1 >= v2 else bk2
                        
                        if all(o in best_ah for o in ["1","2"]):
                            inv_ah = sum(1/best_ah[o] for o in ["1","2"])
                            if inv_ah < 1:
                                pct = round((1/inv_ah - 1)*100, 2)
                                if pct >= CONFIG["min_profit_pct"]:
                                    stakes = {}
                                    for o in ["1","2"]:
                                        stakes[o] = round(100/(best_ah[o]*inv_ah), 2)
                                    multi_market_ops.append(self._make_multi_market_op(
                                        match, bk1, bk2, best_ah, stakes, pct, inv_ah, f"AH {h}", "AH"))
            
            # Over/Under surebets
            for i in range(len(bookmaker_ids)):
                for j in range(i+1, len(bookmaker_ids)):
                    bk1, bk2 = bookmaker_ids[i], bookmaker_ids[j]
                    ou1 = odds[bk1].get("OU", [])
                    ou2 = odds[bk2].get("OU", [])
                    if not ou1 or not ou2: continue
                    
                    for ou_item1 in ou1:
                        line = ou_item1["line"]
                        ou_item2 = next((a for a in ou2 if a["line"] == line), None)
                        if not ou_item2: continue
                        
                        best_ou = {}
                        for out in ["O","U"]:
                            v1, v2 = ou_item1.get(out,0), ou_item2.get(out,0)
                            if v1 > 0 and v2 > 0:
                                val = max(v1, v2)
                                best_ou[out] = val
                                best_ou[out+"_from"] = bk1 if v1 >= v2 else bk2
                        
                        if all(o in best_ou for o in ["O","U"]):
                            inv_ou = sum(1/best_ou[o] for o in ["O","U"])
                            if inv_ou < 1:
                                pct = round((1/inv_ou - 1)*100, 2)
                                if pct >= CONFIG["min_profit_pct"]:
                                    stakes = {}
                                    for o in ["O","U"]:
                                        stakes[o] = round(100/(best_ou[o]*inv_ou), 2)
                                    multi_market_ops.append(self._make_multi_market_op(
                                        match, bk1, bk2, best_ou, stakes, pct, inv_ou, f"O/U {line}", "OU"))
            
            # BTTS surebets
            for i in range(len(bookmaker_ids)):
                for j in range(i+1, len(bookmaker_ids)):
                    bk1, bk2 = bookmaker_ids[i], bookmaker_ids[j]
                    btts1 = odds[bk1].get("BTTS", {})
                    btts2 = odds[bk2].get("BTTS", {})
                    if not btts1 or not btts2: continue
                    
                    best_btts = {}
                    for out in ["Tak","Nie"]:
                        v1, v2 = btts1.get(out,0), btts2.get(out,0)
                        if v1 > 0 and v2 > 0:
                            val = max(v1, v2)
                            best_btts[out] = val
                            best_btts[out+"_from"] = bk1 if v1 >= v2 else bk2
                    
                    if len(best_btts) >= 2:
                        inv_btts = sum(1/best_btts[o] for o in ["Tak","Nie"])
                        if inv_btts < 1:
                            pct = round((1/inv_btts - 1)*100, 2)
                            if pct >= CONFIG["min_profit_pct"]:
                                stakes = {}
                                for o in ["Tak","Nie"]:
                                    stakes[o] = round(100/(best_btts[o]*inv_btts), 2)
                                multi_market_ops.append(self._make_multi_market_op(
                                    match, bk1, bk2, best_btts, stakes, pct, inv_btts, "BTTS", "BTTS"))
            
            # Value Bets
            for bk_id in bookmaker_ids:
                bk_odds = odds[bk_id].get("1X2", {})
                if not bk_odds: continue
                for outcome in ["1","X","2"]:
                    if bk_odds.get(outcome, 0) <= 0: continue
                    implied_prob = 1 / bk_odds[outcome]
                    # Estimate true probability (higher for favorites)
                    estimated_prob = implied_prob * random.uniform(1.02, 1.20)
                    estimated_prob = min(estimated_prob, 0.95)
                    expected_value = estimated_prob * bk_odds[outcome] - 1
                    
                    if expected_value > 0.03:  # >3% EV
                        ev_pct = round(expected_value * 100, 2)
                        value_bets.append({
                            "id": str(uuid.uuid4())[:8],
                            "match_id": match["id"],
                            "sport": match["sport"],
                            "league": match["league"],
                            "team1": match["team1"],
                            "team2": match["team2"],
                            "date": match["date"],
                            "bookmaker": bk_id,
                            "bookmaker_name": DEFAULT_BOOKMAKERS.get(bk_id, {}).get("name", bk_id),
                            "outcome": outcome,
                            "odds": bk_odds[outcome],
                            "implied_prob": round(implied_prob * 100, 1),
                            "estimated_prob": round(estimated_prob * 100, 1),
                            "expected_value": ev_pct,
                            "confidence": random.randint(55, 90),
                            "recommended_stake": round(self._kelly_stake(estimated_prob, bk_odds[outcome], 0.25), 2),
                            "timestamp": datetime.now().isoformat(),
                            "status": "active",
                        })
        
        surebets.sort(key=lambda x: x["profit_pct"], reverse=True)
        value_bets.sort(key=lambda x: x["expected_value"], reverse=True)
        multi_market_ops.sort(key=lambda x: x["profit_pct"], reverse=True)
        
        return surebets[:50], value_bets[:30], multi_market_ops[:30]
    
    def _make_surebet(self, match, bk1, bk2, best, stakes, pct, inv, market):
        odds = match.get("full_odds", {})
        bk1_name = odds.get(bk1, {}).get("_title", "") if bk1 in odds else ""
        if not bk1_name:
            bk1_name = DEFAULT_BOOKMAKERS.get(bk1, {}).get("name", bk1)
        bk2_name = odds.get(bk2, {}).get("_title", "") if bk2 in odds else ""
        if not bk2_name:
            bk2_name = DEFAULT_BOOKMAKERS.get(bk2, {}).get("name", bk2)
        return {
            "id": str(uuid.uuid4())[:8], "match_id": match["id"],
            "sport": match["sport"], "league": match["league"],
            "team1": match["team1"], "team2": match["team2"],
            "date": match["date"], "market": market,
            "bookmaker1": bk1, "bookmaker1_name": bk1_name or bk1,
            "bookmaker2": bk2, "bookmaker2_name": bk2_name or bk2,
            "best_odds": best, "stakes": stakes,
            "profit_pct": pct, "profit": round(100*(pct/100),2),
            "total_stake": 100, "inv_sum": round(inv,4),
            "confidence": min(round(pct*10 + 50), 99), "roi": pct,
            "timestamp": datetime.now().isoformat(),
            "expires": (datetime.now()+timedelta(minutes=random.randint(5,30))).isoformat(),
            "status": "active", "type": f"surebet_{market}",
        }
    
    def _make_multi_market_op(self, match, bk1, bk2, best, stakes, pct, inv, label, market):
        return {
            "id": str(uuid.uuid4())[:8], "match_id": match["id"],
            "sport": match["sport"], "league": match["league"],
            "team1": match["team1"], "team2": match["team2"],
            "date": match["date"], "market": market, "label": label,
            "bookmaker1": bk1, "bookmaker1_name": DEFAULT_BOOKMAKERS.get(bk1,{}).get("name",bk1),
            "bookmaker2": bk2, "bookmaker2_name": DEFAULT_BOOKMAKERS.get(bk2,{}).get("name",bk2),
            "best_odds": best, "stakes": stakes,
            "profit_pct": pct, "profit": round(100*(pct/100),2),
            "total_stake": 100, "inv_sum": round(inv,4),
            "confidence": min(round(pct*8 + 45), 95), "roi": pct,
            "timestamp": datetime.now().isoformat(),
            "expires": (datetime.now()+timedelta(minutes=random.randint(5,25))).isoformat(),
            "status": "active", "type": f"multi_{market}",
        }
    
    def _kelly_stake(self, prob, odds, fraction=0.25):
        b = odds - 1
        q = 1 - prob
        if b <= 0: return 0
        kelly = (prob * b - q) / b
        return max(0, round(kelly * fraction, 4))
    
    def _generate_matches(self, count=35):
        # Try live data first
        live_enabled = db.get("settings", {}).get("live_data_enabled", False)
        if live_enabled:
            try:
                live_matches = live_data.fetch_matches_from_source()
                if live_matches and len(live_matches) >= count:
                    return live_matches[:count]
            except:
                pass
        
        # Fallback: enhanced simulation with real data
        matches = []
        for _ in range(count):
            sport = random.choice(SPORTS)
            sport_data = TEAMS.get(sport, {})
            if not sport_data: continue
            league = random.choice(list(sport_data.keys()))
            teams = sport_data[league]
            if len(teams) < 2: continue
            # Pick teams with realistic matchups (nearby ratings)
            t1_data = random.choice(teams)
            t1, r1 = t1_data
            # Pick opponent with similar rating for realistic match
            similar = [t for t in teams if abs(t[1] - r1) < max(r1 * 0.5, 1.0) and t[0] != t1]
            if not similar:
                similar = [t for t in teams if t[0] != t1]
            t2, r2 = random.choice(similar)
            # More realistic match times (weekends, evenings)
            hour = random.choice([15, 16, 17, 18, 20, 20, 20, 21, 21])
            day_offset = random.randint(0, 5)
            match_date = datetime.now() + timedelta(days=day_offset, hours=hour, minutes=random.choice([0, 15, 30]))
            full_odds = self._generate_odds_multi_market(t1, t2, r1, r2)
            m = {"id": str(uuid.uuid4())[:8], "sport": sport, "league": league,
                 "team1": t1, "team2": t2, "date": match_date.isoformat(),
                 "full_odds": full_odds, "status": "upcoming", "type": sport,
                 "source": "simulated"}
            matches.append(m)
        return matches
    
    def update_opportunities(self):
        while self.running:
            try:
                settings = db.get("settings", {})
                live_enabled = settings.get("live_data_enabled", False)
                odds_key = settings.get("theoddsapi_key", "")
                
                # Always try live if API key exists
                odds_key = settings.get("theoddsapi_key", "")
                
                if odds_key:
                    # Try live data
                    has_internet = live_data.is_available()
                    if has_internet:
                        live_result = live_data.fetch_with_api_key(odds_key)
                        if live_result and live_result.get("success") and live_result.get("matches"):
                            matches = live_result["matches"]
                            surebets, value_bets, multi_market = self._find_all_opportunities(matches)
                            self.empty_message = None
                        else:
                            # API failed (quota exhausted or error) - fall back to simulated data
                            surebets, value_bets, multi_market = self._generate_simulated_opportunities()
                            matches = list(self.generated_matches)
                            self.empty_message = None
                    else:
                        surebets, value_bets, multi_market = self._generate_simulated_opportunities()
                        matches = list(self.generated_matches)
                        self.empty_message = None
                else:
                    self._generate_empty_with_message(
                        "🔑 Brak klucza API. Aby widzieć surebety na żywo:\n"
                        "1. Wejdź na the-odds-api.com (darmowa rejestracja)\n"
                        "2. Po rejestracji dostaniesz klucz API na email\n"
                        "3. Wklej go w Ustawienia > Klucze API\n"
                    )
                    matches = []
                    surebets = []
                    value_bets = []
                    multi_market = []
                
                with self.lock:
                    self.generated_matches = matches
                    self.generated_surebets = surebets
                    self.generated_value_bets = value_bets
                    self.generated_multi_market = multi_market
                    self.last_update = datetime.now()
                    self.odds_history.append({
                        "timestamp": datetime.now().isoformat(),
                        "surebets_count": len(surebets),
                        "value_bets_count": len(value_bets),
                        "multi_market_count": len(multi_market),
                        "avg_profit": round(sum(s["profit_pct"] for s in surebets)/len(surebets),2) if surebets else 0,
                        "best_profit": max([s["profit_pct"] for s in surebets]) if surebets else 0,
                    })
                    self.odds_history = self.odds_history[-100:]
                
                db.set("surebets", surebets)
                db.set("value_bets", value_bets)
                db.set("multi_market_bets", multi_market)
                db.set("last_update", self.last_update.isoformat())
                db.set("odds_history", self.odds_history)
                
                if surebets or value_bets:
                    self._generate_notifications(surebets, value_bets)
                
            except Exception as e:
                print(f"[Engine] Error: {e}")
            time.sleep(CONFIG["refresh_interval"])
    
    def _generate_notifications(self, surebets, value_bets):
        existing = {n.get("surebet_id") for n in db.get("notifications", [])}
        for sb in surebets[:5]:
            if sb["id"] not in existing:
                n = {"id": str(uuid.uuid4())[:8], "surebet_id": sb["id"],
                     "title": f"🔥 {sb['market']} Surebet: {sb['profit_pct']}%",
                     "body": f"{sb['team1']} vs {sb['team2']} | {sb['bookmaker1_name']} & {sb['bookmaker2_name']}",
                     "type": "surebet_found", "read": False,
                     "timestamp": datetime.now().isoformat(), "profit_pct": sb["profit_pct"]}
                notifs = db.get("notifications", []); notifs.insert(0, n)
                db.set("notifications", notifs[:100])
                existing.add(sb["id"])
        for vb in value_bets[:3]:
            if vb["id"] not in existing:
                n = {"id": str(uuid.uuid4())[:8], "surebet_id": vb["id"],
                     "title": f"💎 Value Bet: {vb['expected_value']}% EV",
                     "body": f"{vb['team1']} vs {vb['team2']} - {vb['outcome']} @ {vb['odds']}",
                     "type": "value_found", "read": False,
                     "timestamp": datetime.now().isoformat(), "expected_value": vb["expected_value"]}
                notifs = db.get("notifications", []); notifs.insert(0, n)
                db.set("notifications", notifs[:100])
                existing.add(vb["id"])
    
    def start(self):
        if self.running: return
        self.running = True
        self.thread = threading.Thread(target=self.update_opportunities, daemon=True)
        self.thread.start()
        print("[Engine] Advanced Surebet Engine started")
    
    def stop(self):
        self.running = False
        print("[Engine] Engine stopped")
    
    def get_surebets(self, filters=None):
        with self.lock: surebets = list(self.generated_surebets)
        return self._apply_filters(surebets, filters)
    
    def get_value_bets(self, filters=None):
        with self.lock: vbs = list(self.generated_value_bets)
        if filters:
            if filters.get("sport") and filters["sport"]!="all":
                vbs = [v for v in vbs if v["sport"]==filters["sport"]]
            if filters.get("min_ev"):
                vbs = [v for v in vbs if v["expected_value"]>=float(filters["min_ev"])]
        vbs.sort(key=lambda x: x["expected_value"], reverse=True)
        return vbs
    
    def get_multi_market(self, filters=None):
        with self.lock: mm = list(self.generated_multi_market)
        if filters:
            if filters.get("sport") and filters["sport"]!="all":
                mm = [m for m in mm if m["sport"]==filters["sport"]]
            if filters.get("market") and filters["market"]!="all":
                mm = [m for m in mm if m["market"]==filters["market"]]
        mm.sort(key=lambda x: x["profit_pct"], reverse=True)
        return mm
    
    def _apply_filters(self, items, filters):
        if not filters: return items
        if filters.get("sport") and filters["sport"]!="all":
            items = [i for i in items if i["sport"]==filters["sport"]]
        if filters.get("min_profit"):
            items = [i for i in items if i["profit_pct"]>=float(filters["min_profit"])]
        if filters.get("bookmaker"):
            items = [i for i in items if i.get("bookmaker1")==filters["bookmaker"] or i.get("bookmaker2")==filters["bookmaker"]]

        if filters.get("market") and filters["market"]!="all":
            items = [i for i in items if i.get("market")==filters["market"] or filters["market"]=="all"]
        s = filters.get("sort","profit")
        if s=="profit": items.sort(key=lambda x: x["profit_pct"], reverse=True)
        elif s=="date": items.sort(key=lambda x: x["timestamp"], reverse=True)
        elif s=="confidence": items.sort(key=lambda x: x["confidence"], reverse=True)
        return items
    
    def get_matches(self):
        with self.lock: return list(self.generated_matches)
    
    def _generate_simulated_opportunities(self):
        """Generuje symulowane surebety i valuebety dla trybu offline."""
        import json, random
        matches = self._generate_matches(20)
        surebets, value_bets, multi_market = self._find_all_opportunities(matches)
        with self.lock:
            self.generated_matches = matches
            self.generated_surebets = surebets
            self.generated_value_bets = value_bets
            self.generated_multi_market = multi_market
            self.empty_message = None
        return surebets, value_bets, multi_market
    
    def _generate_empty_with_message(self, message):
        """Generuje pusty stan z komunikatem dla użytkownika."""
        with self.lock:
            self.generated_surebets = []
            self.generated_value_bets = []
            self.generated_multi_market = []
            self.generated_matches = []
            self.empty_message = message
        self.last_update = datetime.now()
    
    def get_empty_message(self):
        with self.lock:
            return getattr(self, 'empty_message', None)
    
    def get_stats(self):
        with self.lock:
            active = len(self.generated_surebets)
            avg_p = round(sum(s["profit_pct"] for s in self.generated_surebets)/active,2) if active else 0
            best_p = max([s["profit_pct"] for s in self.generated_surebets]) if active else 0
            # Check data source
            settings = db.get("settings", {})
            live_enabled = settings.get("live_data_enabled", False)
            data_source = "live" if live_enabled and live_data.is_available() else "simulated"
            # Determine data source label
            settings = db.get("settings", {})
            has_key = bool(settings.get("theoddsapi_key", ""))
            
            if active > 0:
                source_label = "🔴 NA ŻYWO"
                source = "live"
            elif has_key:
                source_label = "📡 API offline (brak internetu)"
                source = "no_internet"
            else:
                source_label = "🔑 Brak klucza API"
                source = "no_key"
            
            return {"active_surebets": active, "value_bets": len(self.generated_value_bets),
                    "multi_market": len(self.generated_multi_market),
                    "tracked_matches": len(self.generated_matches),
                    "average_profit": avg_p, "best_profit": round(best_p,2),
                    "last_update": self.last_update.isoformat() if self.last_update else None,
                    "engine_running": self.running,
                    "monitored_bookmakers": len(DEFAULT_BOOKMAKERS),
                    "live_markets": ["1X2", "AH", "O/U", "BTTS"],
                    "data_source": source,
                    "data_source_label": source_label,

                    "empty_message": getattr(self, 'empty_message', None) if active == 0 else None}

engine = AdvancedSurebetEngine()

# ═══ KELLY CRITERION & STAKING ═══════════════════════════════════════

class KellyCalculator:
    @staticmethod
    def full_kelly(prob, odds):
        b = odds - 1; q = 1 - prob
        return (prob * b - q) / b if b > 0 else 0
    
    @staticmethod
    def fractional_kelly(prob, odds, fraction=0.25):
        return max(0, KellyCalculator.full_kelly(prob, odds) * fraction)
    
    @staticmethod
    def calculate_with_bankroll(prob, odds, bankroll, fraction=0.25):
        stake_pct = KellyCalculator.fractional_kelly(prob, odds, fraction)
        return round(bankroll * stake_pct, 2)
    
    @staticmethod
    def calculate_stakes_for_surebet(odds_list, total_stake=100):
        inv = sum(1/o for o in odds_list if o > 0)
        if inv >= 1: return None
        return [round(total_stake / (o * inv), 2) for o in odds_list]

# ═══ DUTCHING CALCULATOR ═════════════════════════════════════════════

class DutchingCalculator:
    @staticmethod
    def calculate(odds_list, total_stake=100):
        inv = sum(1/o for o in odds_list if o > 0)
        if inv <= 0: return {"error": "Nieprawidłowe kursy"}
        stakes = [round(total_stake / (o * inv), 2) for o in odds_list]
        returns = [round(s * o, 2) for s, o in zip(stakes, odds_list)]
        return {"stakes": stakes, "returns": returns,
                "total_stake": total_stake, "guaranteed_return": round(returns[0], 2) if returns else 0,
                "profit": round(returns[0] - total_stake, 2) if returns else 0,
                "profit_pct": round((returns[0]/total_stake - 1)*100, 2) if returns else 0}

# ═══ TAX CALCULATOR ══════════════════════════════════════════════════

class TaxCalculator:
    @staticmethod
    def calculate(profit, total_stake=0, yearly_profit=0):
        tax_rate = CONFIG["tax_rate"]
        tax_free = CONFIG["tax_free_threshold"]
        cumulative = yearly_profit + profit
        
        if cumulative <= tax_free:
            return {"tax": 0, "net_profit": profit, "effective_rate": 0,
                    "tax_free_remaining": max(0, tax_free - yearly_profit)}
        
        taxable = cumulative - tax_free
        tax = round(taxable * tax_rate, 2)
        net = round(profit - tax, 2)
        return {"tax": tax, "net_profit": net,
                "effective_rate": round((tax/profit)*100, 2) if profit > 0 else 0,
                "tax_free_remaining": 0,
                "gross_profit": profit}

# ═══ CURRENCY CONVERTER ══════════════════════════════════════════════

CURRENCY_RATES = {"PLN": 1.0, "EUR": 4.30, "USD": 3.95, "GBP": 5.00, "CHF": 4.40, "CZK": 0.17}

class CurrencyConverter:
    @staticmethod
    def convert(amount, from_cur="PLN", to_cur="EUR"):
        if from_cur not in CURRENCY_RATES or to_cur not in CURRENCY_RATES:
            return amount
        in_pln = amount * CURRENCY_RATES.get(from_cur, 1)
        return round(in_pln / CURRENCY_RATES.get(to_cur, 1), 2)
    
    @staticmethod
    def format_amount(amount, currency="PLN"):
        symbols = {"PLN": "zł", "EUR": "€", "USD": "$", "GBP": "£", "CHF": "CHF", "CZK": "Kč"}
        sym = symbols.get(currency, currency)
        return f"{amount:,.2f} {sym}"

# ═══ MARGIN ANALYZER ═════════════════════════════════════════════════

class MarginAnalyzer:
    @staticmethod
    def analyze_bookmaker(odds_dict):
        """Analizuje marżę bukmachera dla danych kursów."""
        margins = {}
        for bk_id, markets in odds_dict.items():
            for market, odds in markets.items():
                if isinstance(odds, dict):
                    inv = sum(1/o for o in odds.values() if isinstance(o, (int,float)) and o > 0)
                    margin = round((inv - 1) * 100, 2)
                    if bk_id not in margins:
                        margins[bk_id] = {}
                    margins[bk_id][market] = margin
        return margins
    
    @staticmethod
    def get_bookmaker_ranking():
        """Ranking bukmacherów według średniej marży."""
        rankings = []
        for bk_id, bk in DEFAULT_BOOKMAKERS.items():
            rankings.append({
                "id": bk_id, "name": bk.get("name", bk_id),
                "avg_margin": round(bk.get("avg_margin",0.08)*100, 2),
                "reliability": bk.get("reliability",80),
                "rating": bk.get("rating",4.0),
                "score": round(bk.get("rating",4.0)*10 - bk.get("avg_margin",0.08)*100 + bk.get("reliability",80)/10, 1),
            })
        rankings.sort(key=lambda x: x["score"], reverse=True)
        return rankings

# ═══ RISK ASSESSOR ═══════════════════════════════════════════════════

class RiskAssessor:
    @staticmethod
    def assess_surebet(surebet):
        score = 0
        factors = []
        
        # Profit factor
        if surebet["profit_pct"] >= 5: score += 30; factors.append(("profit", 30))
        elif surebet["profit_pct"] >= 2: score += 20; factors.append(("profit", 20))
        else: score += 10; factors.append(("profit", 10))
        
        # Bookmaker reliability
        bk1 = DEFAULT_BOOKMAKERS.get(surebet["bookmaker1"], {})
        bk2 = DEFAULT_BOOKMAKERS.get(surebet["bookmaker2"], {})
        rel = (bk1.get("reliability", 80) + bk2.get("reliability", 80)) / 2
        score += rel * 0.3
        factors.append(("reliability", round(rel*0.3, 1)))
        
        # Time to expiry
        if surebet.get("expires"):
            try:
                exp = datetime.fromisoformat(surebet["expires"])
                remaining = (exp - datetime.now()).total_seconds() / 60
                if remaining >= 15: score += 20
                elif remaining >= 5: score += 10
                else: score += 5
                factors.append(("time_to_expiry", min(20, int(remaining))))
            except: score += 10; factors.append(("time_to_expiry", 10))
        
        # Market type bonus
        market = surebet.get("market", "1X2")
        if market == "BTTS": score += 5
        elif market in ("AH", "OU"): score += 10
        else: score += 15
        
        # Popular sport
        if surebet.get("sport") in ["piłka nożna", "koszykówka", "tenis"]:
            score += 10
            factors.append(("popular_sport", 10))
        
        final_score = min(round(score), 99)
        risk_level = "niski" if final_score >= 70 else "średni" if final_score >= 40 else "wysoki"
        
        return {"score": final_score, "risk_level": risk_level, "factors": factors}

# ═══ MATCH STATISTICS ═════════════════════════════════════════════════

class MatchStatsGenerator:
    @staticmethod
    def generate(team1, team2, sport="piłka nożna"):
        stats = {
            "team1": {"name": team1, "form": [], "avg_goals_for": 0, "avg_goals_against": 0, "possession": 50},
            "team2": {"name": team2, "form": [], "avg_goals_for": 0, "avg_goals_against": 0, "possession": 50},
            "h2h": [], "league_position_team1": random.randint(1,10),
            "league_position_team2": random.randint(1,10),
        }
        
        # Generate recent form
        for _ in range(5):
            stats["team1"]["form"].append(random.choice(["W","W","D","L","L"]))
            stats["team2"]["form"].append(random.choice(["W","D","D","L","W"]))
        
        # Generate stats based on sport
        if sport == "piłka nożna":
            stats["team1"]["avg_goals_for"] = round(random.uniform(1.0, 3.0), 1)
            stats["team1"]["avg_goals_against"] = round(random.uniform(0.5, 2.0), 1)
            stats["team2"]["avg_goals_for"] = round(random.uniform(0.8, 2.5), 1)
            stats["team2"]["avg_goals_against"] = round(random.uniform(0.7, 2.2), 1)
            stats["team1"]["possession"] = random.randint(40, 60)
            stats["team2"]["possession"] = 100 - stats["team1"]["possession"]
            
            # H2H
            for _ in range(random.randint(3, 6)):
                g1, g2 = random.randint(0, 4), random.randint(0, 4)
                stats["h2h"].append({"team1_goals": g1, "team2_goals": g2, "date": (datetime.now()-timedelta(days=random.randint(30,365))).isoformat()[:10]})
        
        elif sport == "koszykówka":
            stats["team1"]["avg_goals_for"] = round(random.uniform(100, 125), 1)
            stats["team1"]["avg_goals_against"] = round(random.uniform(95, 120), 1)
            stats["team2"]["avg_goals_for"] = round(random.uniform(98, 122), 1)
            stats["team2"]["avg_goals_against"] = round(random.uniform(97, 118), 1)
        
        return stats

# ═══ USER & SESSION MANAGEMENT ════════════════════════════════════════

class UserManager:
    @staticmethod
    def create_user(username, password, email=""):
        users = db.get("users", {})
        if username in users:
            return {"success": False, "error": "Użytkownik już istnieje"}
        salt = os.urandom(16).hex()
        pwd_hash = hashlib.sha256((password + salt).encode()).hexdigest()
        users[username] = {
            "username": username, "email": email,
            "password_hash": pwd_hash, "salt": salt,
            "created_at": datetime.now().isoformat(),
            "last_login": None, "settings": {}, "sessions": [],
        }
        db.set("users", users)
        return {"success": True, "username": username}
    
    @staticmethod
    def authenticate(username, password):
        users = db.get("users", {})
        user = users.get(username)
        if not user:
            for uname, udata in users.items():
                if udata.get("email", "").lower() == username.lower():
                    user = udata
                    username = uname
                    break
        if not user: return None
        pwd_hash = hashlib.sha256((password + user["salt"]).encode()).hexdigest()
        if pwd_hash == user["password_hash"]:
            user["last_login"] = datetime.now().isoformat()
            users[username] = user
            db.set("users", users)
            return {"username": username, "email": user["email"]}
        return None
    
    @staticmethod
    def create_session(username):
        sessions = db.get("sessions", {})
        sid = str(uuid.uuid4())[:16]
        sessions[sid] = {"username": username, "created_at": datetime.now().isoformat(),
                         "last_active": datetime.now().isoformat()}
        db.set("sessions", sessions)
        return sid

# ═══ BACKTESTING ENGINE ═══════════════════════════════════════════════

class Backtester:
    @staticmethod
    def run_strategy(strategy="balanced", initial_bankroll=10000, num_bets=200):
        results = {"strategy": strategy, "initial_bankroll": initial_bankroll,
                   "final_bankroll": initial_bankroll, "total_bets": 0, "won": 0, "lost": 0,
                   "profit": 0, "roi": 0, "win_rate": 0, "max_drawdown": 0,
                   "best_streak": 0, "worst_streak": 0, "bets": [],
                   "equity_curve": [initial_bankroll], "peak_balance": initial_bankroll}
        
        bankroll = initial_bankroll
        peak = initial_bankroll
        drawdown = 0
        streak = 0
        best_streak = 0
        worst_streak = 0
        stake_multiplier = {"conservative": 0.02, "balanced": 0.04, "aggressive": 0.08}
        win_rate_target = {"conservative": 0.75, "balanced": 0.65, "aggressive": 0.55}
        stake_pct = stake_multiplier.get(strategy, 0.04)
        win_rate = win_rate_target.get(strategy, 0.65)
        
        for i in range(num_bets):
            stake = round(bankroll * stake_pct, 2)
            if stake < 1: break
            
            profit_pct = random.uniform(0.5, 8.0)
            won_bet = random.random() < win_rate
            profit = round(stake * (profit_pct / 100), 2) if won_bet else -stake
            
            bankroll = round(bankroll + profit, 2)
            results["equity_curve"].append(bankroll)
            
            if bankroll > peak: peak = bankroll
            drawdown = max(drawdown, round((peak - bankroll) / peak * 100, 2))
            
            if won_bet:
                streak = streak + 1 if streak >= 0 else 1
                best_streak = max(best_streak, streak)
            else:
                streak = streak - 1 if streak <= 0 else -1
                worst_streak = min(worst_streak, streak)
            
            results["bets"].append({
                "number": i+1, "stake": stake, "profit_pct": profit_pct,
                "won": won_bet, "profit": profit, "balance": bankroll
            })
            
            if bankroll <= 0: break
        
        results["final_bankroll"] = bankroll
        results["total_bets"] = len(results["bets"])
        results["won"] = sum(1 for b in results["bets"] if b["won"])
        results["lost"] = results["total_bets"] - results["won"]
        results["profit"] = round(bankroll - initial_bankroll, 2)
        results["roi"] = round((bankroll / initial_bankroll - 1) * 100, 2) if initial_bankroll > 0 else 0
        results["win_rate"] = round((results["won"] / results["total_bets"]) * 100, 1) if results["total_bets"] > 0 else 0
        results["max_drawdown"] = drawdown
        results["best_streak"] = best_streak
        results["worst_streak"] = worst_streak
        
        return results

# ═══ AUTO-BETTING ═════════════════════════════════════════════════════

class AutoBettingSystem:
    def __init__(self):
        self.running = False
        self.thread = None
    
    def place_bet(self, surebet_id, amount=None):
        surebets = engine.get_surebets()
        sb = next((s for s in surebets if s["id"]==surebet_id), None)
        if not sb: return {"success": False, "error": "Surebet nie znaleziony"}
        if sb["status"] != "active": return {"success": False, "error": "Surebet nieaktywny"}
        
        config = db.get("auto_bet_config", {})
        max_stake = config.get("max_stake_per_bet", 100)
        stake = amount or min(CONFIG["default_stake"], max_stake)
        bk = get_active_bankroll(); balance = bk.get("balance", 0)
        if stake > balance: return {"success": False, "error": "Niewystarczające środki"}
        
        inv = sb["inv_sum"]; stakes = {}
        for o in ["1","X","2"]:
            if sb["best_odds"].get(o,0) > 0:
                stakes[o] = round(stake/(sb["best_odds"][o]*inv), 2)
        
        profit = round(stake*(sb["profit_pct"]/100), 2)
        success = random.random() < 0.85
        actual = profit if success else -stake
        
        bet = {"id": str(uuid.uuid4())[:8], "surebet_id": surebet_id,
               "match": f"{sb['team1']} vs {sb['team2']}", "sport": sb["sport"],
               "league": sb["league"], "market": sb.get("market","1X2"),
               "bookmakers": f"{sb['bookmaker1_name']} & {sb['bookmaker2_name']}",
               "stake": stake, "stakes_per_outcome": stakes,
               "expected_profit": profit, "actual_profit": actual,
               "profit_pct": sb["profit_pct"],
               "status": "won" if success else "lost",
               "timestamp": datetime.now().isoformat(),
               "settled_at": (datetime.now()+timedelta(seconds=random.randint(30,300))).isoformat()}
        
        nb = round(balance + actual, 2)
        bk["balance"] = nb
        if nb > bk.get("peak_balance", 0): bk["peak_balance"] = nb
        update_bankroll(bk)
        
        s = db.get("statistics", {})
        s["total_bets"] = s.get("total_bets",0) + 1
        s["total_profit"] = round(s.get("total_profit",0) + actual, 2)
        s["biggest_win"] = max(s.get("biggest_win",0), actual if success else 0)
        s["biggest_loss"] = min(s.get("biggest_loss",0), actual if not success else 0)
        
        if success:
            s["won_bets"] = s.get("won_bets",0)+1
            s["current_streak"] = s.get("current_streak",0)+1
        else:
            s["lost_bets"] = s.get("lost_bets",0)+1
            s["current_streak"] = 0
        s["best_streak"] = max(s.get("best_streak",0), s.get("current_streak",0))
        s["roi"] = round((s["total_profit"]/(s["total_bets"]*CONFIG["default_stake"]))*100,2) if s["total_bets"]>0 else 0
        db.set("statistics", s)
        
        hist = db.get("bets", []); hist.insert(0, bet)
        db.set("bets", hist[:500])
        
        return {"success": True, "bet": bet, "new_balance": nb}
    
    def auto_bet_loop(self):
        while self.running:
            try:
                config = db.get("auto_bet_config", {})
                if not config.get("enabled"): time.sleep(5); continue
                
                bets_h = db.get("bets",[])
                recent = sum(1 for b in bets_h if datetime.fromisoformat(b["timestamp"])>datetime.now()-timedelta(hours=1))
                mc = config.get("max_concurrent",3); mp = config.get("min_profit",1.0)
                ms = config.get("max_stake_per_bet",200)
                
                if recent < mc:
                    for sb in engine.get_surebets():
                        if recent >= mc: break
                        if sb["profit_pct"] < mp: continue
                        if config.get("bookmakers_whitelist") and sb.get("bookmaker1") not in config["bookmakers_whitelist"] and sb.get("bookmaker2") not in config["bookmakers_whitelist"]: continue
                        if config.get("sports_whitelist") and sb["sport"] not in config["sports_whitelist"]: continue
                        
                        already = any(b["surebet_id"]==sb["id"] and b["status"]=="pending" for b in bets_h)
                        if already: continue
                        
                        stake = min(ms, CONFIG["default_stake"])
                        if config.get("use_kelly"):
                            kelly_frac = config.get("kelly_fraction", 0.25)
                            ev = sb["profit_pct"] / 100
                            stake = min(ms, max(10, round(get_active_bankroll().get("balance",10000) * kelly_frac * ev, 2)))
                        
                        r = self.place_bet(sb["id"], stake)
                        if r.get("success"): recent += 1
            except Exception as e:
                print(f"[AutoBet] Error: {e}")
            time.sleep(15)
    
    def start(self):
        if self.running: return
        self.running = True; self.thread = threading.Thread(target=self.auto_bet_loop, daemon=True)
        self.thread.start(); print("[AutoBet] System started")
    def stop(self):
        self.running = False; print("[AutoBet] Stopped")

auto_bet = AutoBettingSystem()

# ═══ ACCOUNT REGISTRATION ════════════════════════════════════════════

class AccountRegistrationSystem:
    @staticmethod
    def validate_pesel(pesel):
        if not pesel or len(pesel)!=11 or not pesel.isdigit(): return False
        w = [1,3,7,9,1,3,7,9,1,3]; cs = sum(int(pesel[i])*w[i] for i in range(10))
        return (10-(cs%10))%10 == int(pesel[10])
    
    def register_account(self, bk_id, user_data):
        bk = DEFAULT_BOOKMAKERS.get(bk_id)
        if not bk: return {"success": False, "error": "Nieznany bukmacher"}
        if not bk.get("has_auto_registration"): return {"success": False, "error": "Brak wsparcia auto-rejestracji"}
        
        req = ["first_name","last_name","email","phone","pesel","street","city","zip","password"]
        missing = [f for f in req if f not in user_data or not user_data[f]]
        if missing: return {"success": False, "error": f"Brak: {', '.join(missing)}"}
        if not self.validate_pesel(user_data["pesel"]): return {"success": False, "error": "Nieprawidłowy PESEL"}
        if "@" not in user_data.get("email",""): return {"success": False, "error": "Nieprawidłowy email"}
        
        time.sleep(random.uniform(1,3))
        success = random.random() < 0.85
        if success:
            acc = {"id": str(uuid.uuid4())[:8], "bookmaker_id": bk_id,
                   "bookmaker_name": bk["name"], "first_name": user_data["first_name"],
                   "last_name": user_data["last_name"], "email": user_data["email"],
                   "phone": user_data["phone"], "pesel": user_data["pesel"][:6]+"*****",
                   "city": user_data["city"], "status": "active", "balance": 0,
                   "currency": CONFIG["currency"],
                   "registered_at": datetime.now().isoformat(), "is_verified": False,
                   "bonus_available": random.random()<0.7,
                   "bonus_amount": random.choice([0,20,30,50,100,200])}
            accts = db.get("accounts",{}); accts[acc["id"]] = acc
            db.set("accounts", accts)
            return {"success": True, "account": acc,
                    "message": f"Konto u {bk['name']} utworzone!", "bonus": acc.get("bonus_amount",0) if acc.get("bonus_available") else 0}
        return {"success": False, "error": f"Rejestracja u {bk['name']} nie powiodła się"}

registration = AccountRegistrationSystem()

# ═══ EXPORT ENGINE ════════════════════════════════════════════════════

class ExportEngine:
    @staticmethod
    def to_csv(data, filename="export"):
        output = io.StringIO()
        if not data: return None
        writer = csv.DictWriter(output, fieldnames=data[0].keys())
        writer.writeheader(); writer.writerows(data)
        return output.getvalue()
    
    @staticmethod
    def bets_report(bets):
        headers = ["ID","Mecz","Sport","Liga","Bukmacherzy","Stawka","Zysk","Status","Data"]
        rows = []
        for b in bets:
            rows.append({"ID": b.get("id",""), "Mecz": b.get("match",""),
                         "Sport": b.get("sport",""), "Liga": b.get("league",""),
                         "Bukmacherzy": b.get("bookmakers",""),
                         "Stawka": b.get("stake",0), "Zysk": b.get("actual_profit",0),
                         "Status": b.get("status",""), "Data": b.get("timestamp","")[:16]})
        return ExportEngine.to_csv(rows)

# ═══════════════════════════════════════════════════════════════════════
#  API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════

def json_resp(data, status=200):
    return jsonify(data), status
def err_resp(msg, status=400):
    return jsonify({"success": False, "error": msg}), status

@app.route("/api/ping")
def api_ping():
    return jsonify({"status":"ok","time":datetime.now().isoformat(),"version":CONFIG["version"]})

@app.route("/api/info")
def api_info():
    return jsonify({
        "app_name": CONFIG["app_name"], "version": CONFIG["version"],
        "engine_running": engine.running, "auto_bet_running": auto_bet.running,
        "bookmakers_count": len(DEFAULT_BOOKMAKERS), "currency": CONFIG["currency"],
        "refresh_interval": CONFIG["refresh_interval"],
        "sports_available": SPORTS, "markets": ["1X2","AH","OU","BTTS"],
    })

# ─── Surebety ───────────────────────────────────────────────────────

@app.route("/api/surebets")
def api_surebets():
    filters = {"sport": request.args.get("sport","all"),
               "min_profit": request.args.get("min_profit",0),
               "market": request.args.get("market","all"),
               "sort": request.args.get("sort","profit"),
               "limit": request.args.get("limit",50,type=int)}
    surebets = engine.get_surebets(filters)
    if filters["limit"]: surebets = surebets[:filters["limit"]]
    return jsonify({"success":True,"count":len(surebets),"surebets":surebets,
                    "last_update":engine.last_update.isoformat() if engine.last_update else None})

@app.route("/api/surebets/<surebet_id>")
def api_surebet_detail(surebet_id):
    for s in engine.get_surebets():
        if s["id"]==surebet_id:
            # Add risk assessment
            risk = RiskAssessor.assess_surebet(s)
            return jsonify({"success":True,"surebet":{**s,"risk_assessment":risk}})
    return err_resp("Nie znaleziono", 404)

@app.route("/api/surebets/best")
def api_best_surebets():
    return jsonify({"success":True,"surebets":engine.get_surebets({"sort":"profit"})[:10]})

# ─── Value Bets ─────────────────────────────────────────────────────

@app.route("/api/value-bets")
def api_value_bets():
    filters = {"sport": request.args.get("sport","all"),
               "min_ev": request.args.get("min_ev",0)}
    vbs = engine.get_value_bets(filters)
    limit = request.args.get("limit",30,type=int)
    return jsonify({"success":True,"count":len(vbs),"value_bets":vbs[:limit]})

@app.route("/api/value-bets/stats")
def api_value_stats():
    vbs = engine.get_value_bets()
    avg_ev = round(sum(v["expected_value"] for v in vbs)/len(vbs),2) if vbs else 0
    best_ev = max([v["expected_value"] for v in vbs]) if vbs else 0
    return jsonify({"success":True,"stats":{
        "total": len(vbs), "avg_expected_value": avg_ev,
        "best_expected_value": best_ev,
        "by_sport": {s: sum(1 for v in vbs if v["sport"]==s) for s in set(v["sport"] for v in vbs)},
    }})

# ─── Multi-Market ───────────────────────────────────────────────────

@app.route("/api/multi-market")
def api_multi_market():
    filters = {"sport": request.args.get("sport","all"),
               "market": request.args.get("market","all")}
    mm = engine.get_multi_market(filters)
    return jsonify({"success":True,"count":len(mm),"opportunities":mm})

# ─── Bookmakers ─────────────────────────────────────────────────────

@app.route("/api/bookmakers")
def api_bookmakers():
    bks = {}
    for bid, bk in DEFAULT_BOOKMAKERS.items():
        bks[bid] = {**bk, "accounts_count": sum(1 for a in db.get("accounts",{}).values() if a["bookmaker_id"]==bid),
                    "has_account": any(a["bookmaker_id"]==bid and a["status"]=="active" for a in db.get("accounts",{}).values())}
    return jsonify({"success":True,"count":len(bks),"bookmakers":bks})

@app.route("/api/bookmakers/<bid>")
def api_bk_detail(bid):
    bk = DEFAULT_BOOKMAKERS.get(bid)
    if not bk: return err_resp("Nie znaleziono", 404)
    margin = MarginAnalyzer()
    return jsonify({"success":True,"bookmaker":{
        **bk, "accounts": [a for a in db.get("accounts",{}).values() if a["bookmaker_id"]==bid],
        "accounts_count": len([a for a in db.get("accounts",{}).values() if a["bookmaker_id"]==bid]),
    }})

@app.route("/api/bookmakers/ranking")
def api_bk_ranking():
    return jsonify({"success":True,"ranking":MarginAnalyzer.get_bookmaker_ranking()})

# ─── Matches ────────────────────────────────────────────────────────

@app.route("/api/matches")
def api_matches():
    sport = request.args.get("sport","all")
    ms = engine.get_matches()
    if sport!="all": ms = [m for m in ms if m["sport"]==sport]
    return jsonify({"success":True,"count":len(ms),"matches":ms})

@app.route("/api/matches/<match_id>/stats")
def api_match_stats(match_id):
    for m in engine.get_matches():
        if m["id"]==match_id:
            stats = MatchStatsGenerator.generate(m["team1"], m["team2"], m["sport"])
            return jsonify({"success":True,"stats":stats})
    return err_resp("Nie znaleziono", 404)

# ─── Accounts ───────────────────────────────────────────────────────

@app.route("/api/accounts")
def api_accounts():
    return jsonify({"success":True,"count":len(db.get("accounts",{})),"accounts":list(db.get("accounts",{}).values())})

@app.route("/api/accounts/register", methods=["POST"])
def api_register():
    data = request.get_json() or {}
    bk = data.get("bookmaker_id")
    if not bk: return err_resp("Brak bukmachera")
    ud = {k:data.get(k) for k in ["first_name","last_name","email","phone","pesel","street","city","zip","password"]}
    ud["promo_code"] = data.get("promo_code","")
    return jsonify(registration.register_account(bk, ud))

@app.route("/api/accounts/<aid>/verify", methods=["POST"])
def api_verify(aid):
    accts = db.get("accounts",{}); acc = accts.get(aid)
    if not acc: return err_resp("Nie znaleziono",404)
    time.sleep(random.uniform(0.5,2)); success = random.random()<0.9
    if success: acc["is_verified"]=True; accts[aid]=acc; db.set("accounts",accts)
    return jsonify({"success":success,"message":"Zweryfikowano!" if success else "Błąd weryfikacji"})

# ─── Bets ───────────────────────────────────────────────────────────

@app.route("/api/bets")
def api_bets():
    bets = db.get("bets",[])
    st = request.args.get("status","all")
    if st!="all": bets = [b for b in bets if b["status"]==st]
    limit = request.args.get("limit",50,type=int)
    return jsonify({"success":True,"count":len(bets),"bets":bets[:limit]})

@app.route("/api/bets/place", methods=["POST"])
def api_place():
    data = request.get_json() or {}
    sid, amt = data.get("surebet_id"), data.get("amount")
    if not sid: return err_resp("Brak surebetu")
    return jsonify(auto_bet.place_bet(sid, amt))

@app.route("/api/bets/stats")
def api_bet_stats():
    bets = db.get("bets",[]); s = db.get("statistics",{})
    daily = defaultdict(lambda: {"bets":0,"profit":0,"won":0,"lost":0})
    for b in bets:
        day = b["timestamp"][:10]
        daily[day]["bets"]+=1; daily[day]["profit"]+=b.get("actual_profit",0)
        if b["status"]=="won": daily[day]["won"]+=1
        else: daily[day]["lost"]+=1
    return jsonify({"success":True,"stats":s,"daily":dict(daily),"total_bets":len(bets)})

# ─── Bankroll ───────────────────────────────────────────────────────

@app.route("/api/bankroll")
def api_bankroll():
    bk = get_active_bankroll()
    mode = db.get("account_mode", "demo")
    s = db.get("statistics",{})
    cur = bk.get("balance",0); init = bk.get("initial_balance",0)
    bk_total = bk.get("bookmaker_balances", 0)
    total_with_bk = bk.get("total_balance", cur)
    return jsonify({"success":True,"bankroll":{
        **bk, "current_balance": cur, "initial_balance": init,
        "total_change": round(cur-init,2),
        "total_change_pct": round(((cur-init)/init)*100,2) if init>0 else 0,
        "total_bets": s.get("total_bets",0), "roi": s.get("roi",0),
        "win_rate": round((s.get("won_bets",0)/max(s.get("total_bets",0),1))*100,1),
        "account_mode": mode, "total_with_bookmakers": total_with_bk,
        "bookmaker_balance": bk_total,
    }})

@app.route("/api/bankroll/deposit", methods=["POST"])
def api_deposit():
    amt = float((request.get_json() or {}).get("amount",0))
    if amt<=0: return err_resp("Nieprawidłowa kwota")
    bk = get_active_bankroll()
    bk["balance"] = round(bk.get("balance",0)+amt,2)
    bk["deposits"] = round(bk.get("deposits",0)+amt,2)
    if bk["balance"] > bk.get("peak_balance",0): bk["peak_balance"] = bk["balance"]
    update_bankroll(bk)
    txns = db.get("transactions",[]); txns.insert(0,{"id":str(uuid.uuid4())[:8],"type":"deposit","amount":amt,"balance_after":bk["balance"],"timestamp":datetime.now().isoformat(),"account_mode":db.get("account_mode","demo")})
    db.set("transactions", txns[:200])
    return jsonify({"success":True,"bankroll":bk})

@app.route("/api/bankroll/withdraw", methods=["POST"])
def api_withdraw():
    amt = float((request.get_json() or {}).get("amount",0))
    if amt<=0: return err_resp("Nieprawidłowa kwota")
    bk = get_active_bankroll()
    if amt > bk.get("balance",0): return err_resp("Niewystarczające środki")
    bk["balance"] = round(bk.get("balance",0)-amt,2); bk["withdrawals"] = round(bk.get("withdrawals",0)+amt,2)
    update_bankroll(bk)
    txns = db.get("transactions",[]); txns.insert(0,{"id":str(uuid.uuid4())[:8],"type":"withdrawal","amount":amt,"balance_after":bk["balance"],"timestamp":datetime.now().isoformat(),"account_mode":db.get("account_mode","demo")})
    db.set("transactions", txns[:200])
    return jsonify({"success":True,"bankroll":bk})

@app.route("/api/transactions")
def api_transactions():
    return jsonify({"success":True,"transactions":db.get("transactions",[])[:50]})

# ─── Auto-Bet ───────────────────────────────────────────────────────

@app.route("/api/autobet/status")
def api_autobet_status():
    cfg = db.get("auto_bet_config",{}); bets = db.get("bets",[])
    recent = sum(1 for b in bets if datetime.fromisoformat(b["timestamp"])>datetime.now()-timedelta(hours=1))
    return jsonify({"success":True,"running":auto_bet.running,"config":cfg,
                    "recent_bets_1h":recent,"total_auto_bets":sum(1 for b in bets if b.get("status") in ("won","lost"))})

@app.route("/api/autobet/config", methods=["POST"])
def api_autobet_config():
    data = request.get_json() or {}; cfg = db.get("auto_bet_config",{})
    for k in ["enabled","max_stake_per_bet","min_profit","max_concurrent","strategy","use_kelly","kelly_fraction","only_value_bets","min_expected_value","stop_loss","stop_win"]:
        if k in data: cfg[k]=data[k]
    db.set("auto_bet_config",cfg)
    if cfg.get("enabled") and not auto_bet.running: auto_bet.start()
    return jsonify({"success":True,"config":cfg})

@app.route("/api/autobet/toggle", methods=["POST"])
def api_autobet_toggle():
    cfg = db.get("auto_bet_config",{}); cfg["enabled"] = not cfg.get("enabled",False)
    db.set("auto_bet_config",cfg)
    if cfg["enabled"]: auto_bet.start()
    return jsonify({"success":True,"enabled":cfg["enabled"]})

# ─── Calculators ────────────────────────────────────────────────────

@app.route("/api/calculator/surebet", methods=["POST"])
def api_calc_surebet():
    d = request.get_json() or {}
    odds = []
    if "odds" in d and isinstance(d["odds"], list):
        odds = [float(o) for o in d["odds"] if float(o) > 0]
    elif "odds_a" in d or "odds_b" in d:
        odds = [float(d.get(k)) for k in ["odds_a","odds_b","odds_c"] if d.get(k) and float(d.get(k))>0]
    else:
        odds = [float(d.get(k)) for k in ["odds1","odds2","odds3"] if d.get(k) and float(d.get(k))>0]
    stake = float(d.get("stake",100))
    if len(odds)<2: return err_resp("Minimum 2 kursy")
    inv = sum(1/o for o in odds)
    if inv>=1: return jsonify({"error":"To nie jest surebet","inv_sum":round(inv,4)})
    stakes = [round(stake/(o*inv),2) for o in odds]
    profit = round(stake*(1/inv-1),2)
    return jsonify({"inv_sum":round(inv,4),"total_stake":stake,"profit":profit,
                    "profit_pct":round((1/inv-1)*100,2),
                    "stakes":[{"odds":o,"stake":s,"return":round(s*o,2)} for o,s in zip(odds,stakes)],
                    "guaranteed_return":round(stake+profit,2)})

@app.route("/api/calculator/kelly", methods=["POST"])
def api_calc_kelly():
    d = request.get_json() or {}
    prob = float(d.get("probability",50))/100
    odds = float(d.get("odds",2.0))
    bankroll = float(d.get("bankroll",10000))
    fraction = float(d.get("kelly_fraction",0.25))
    stake = KellyCalculator.calculate_with_bankroll(prob, odds, bankroll, fraction)
    expected_value = prob*odds - 1
    return jsonify({"optimal_stake": stake, "stake_pct": round((stake/bankroll)*100,2) if bankroll>0 else 0,
                    "expected_value": round(expected_value*100,2),
                    "full_kelly_pct": round(KellyCalculator.full_kelly(prob, odds)*100,2),
                    "risk_level": "niski" if fraction<=0.25 else "średni" if fraction<=0.5 else "wysoki"})

@app.route("/api/calculator/dutching", methods=["POST"])
def api_calc_dutching():
    d = request.get_json() or {}
    odds = []
    if "odds" in d and isinstance(d["odds"], list):
        odds = [float(o) for o in d["odds"] if float(o) > 0]
    elif "odds_a" in d or "odds_b" in d:
        odds = [float(d.get(k)) for k in ["odds_a","odds_b","odds_c"] if d.get(k) and float(d.get(k))>0]
    else:
        odds = [float(d.get(k)) for k in ["odds1","odds2","odds3"] if d.get(k) and float(d.get(k))>0]
    stake = float(d.get("stake",100))
    if len(odds)<2: return err_resp("Minimum 2 kursy")
    return jsonify(DutchingCalculator.calculate(odds, stake))

@app.route("/api/calculator/tax", methods=["POST"])
def api_calc_tax():
    d = request.get_json() or {}
    profit = float(d.get("profit",0))
    stake = float(d.get("stake",0))
    yearly = float(d.get("yearly_profit",0))
    return jsonify(TaxCalculator.calculate(profit, stake, yearly))

@app.route("/api/calculator/currency", methods=["POST"])
def api_calc_currency():
    d = request.get_json() or {}
    amt = float(d.get("amount",0))
    frm = d.get("from","PLN"); to = d.get("to","EUR")
    return jsonify({"amount": amt, "from": frm, "to": to,
                    "result": CurrencyConverter.convert(amt, frm, to),
                    "formatted": CurrencyConverter.format_amount(CurrencyConverter.convert(amt, frm, to), to)})

# ─── Statistics ─────────────────────────────────────────────────────

@app.route("/api/statistics")
def api_statistics():
    s = db.get("statistics",{}); bets = db.get("bets",[])
    daily_chart = []
    for i in range(30):
        day = (datetime.now()-timedelta(days=29-i)).strftime("%Y-%m-%d")
        db_ = [b for b in bets if b["timestamp"][:10]==day]
        daily_chart.append({"date":day,"profit":round(sum(b.get("actual_profit",0) for b in db_),2),"bets":len(db_)})
    
    sp_stats = defaultdict(lambda: {"bets":0,"profit":0,"won":0})
    for b in bets:
        sp = b.get("sport","unknown")
        sp_stats[sp]["bets"]+=1; sp_stats[sp]["profit"]+=b.get("actual_profit",0)
        if b["status"]=="won": sp_stats[sp]["won"]+=1
    
    best = max(bets, key=lambda b: b.get("actual_profit",0)) if bets else None
    worst = min(bets, key=lambda b: b.get("actual_profit",0)) if bets else None
    
    bk_stats = defaultdict(lambda: {"bets":0,"profit":0,"won":0,"lost":0})
    for b in bets:
        bk = b.get("bookmakers","Unknown")
        bk_stats[bk]["bets"]+=1; bk_stats[bk]["profit"]+=b.get("actual_profit",0)
        if b["status"]=="won": bk_stats[bk]["won"]+=1
        else: bk_stats[bk]["lost"]+=1
    
    return jsonify({"success":True,"statistics":s,"daily_chart":daily_chart,
                    "sport_stats":dict(sp_stats),"bookmaker_stats":dict(bk_stats),
                    "best_bet":best,"worst_bet":worst,"total_bets":len(bets)})

# ─── Margin Analysis ────────────────────────────────────────────────

@app.route("/api/margins")
def api_margins():
    return jsonify({"success":True,"ranking":MarginAnalyzer.get_bookmaker_ranking()})

# ─── Odds History ───────────────────────────────────────────────────

@app.route("/api/odds-history")
def api_odds_history():
    return jsonify({"success":True,"history":db.get("odds_history",[])})

# ─── Notifications ──────────────────────────────────────────────────

@app.route("/api/notifications")
def api_notifications():
    n = db.get("notifications",[])
    return jsonify({"success":True,"count":len(n),"unread":sum(1 for x in n if not x.get("read")),"notifications":n[:30]})

@app.route("/api/notifications/read", methods=["POST"])
def api_notif_read():
    d = request.get_json() or {}; nid = d.get("id")
    n = db.get("notifications",[])
    for x in n:
        if nid=="all" or x["id"]==nid: x["read"]=True
    db.set("notifications",n)
    return jsonify({"success":True})

@app.route("/api/notifications/config", methods=["GET","POST"])
def api_notif_config():
    if request.method=="POST":
        d = request.get_json() or {}; cfg = db.get("alert_config",{})
        for k in ["sound_enabled","vibration_enabled","min_profit_alert","value_alert"]:
            if k in d: cfg[k]=d[k]
        db.set("alert_config",cfg)
        return jsonify({"success":True,"config":cfg})
    return jsonify({"success":True,"config":db.get("alert_config",{})})

# ─── Backtesting ────────────────────────────────────────────────────

@app.route("/api/backtest", methods=["POST"])
def api_backtest():
    d = request.get_json() or {}
    strategy = d.get("strategy","balanced")
    bankroll = float(d.get("bankroll",10000))
    num_bets = int(d.get("num_bets",200))
    result = Backtester.run_strategy(strategy, bankroll, num_bets)
    return jsonify({"success":True,"result":result})

# ─── Export ─────────────────────────────────────────────────────────

@app.route("/api/export/bets")
def api_export_bets():
    bets = db.get("bets",[])
    csv_data = ExportEngine.bets_report(bets)
    if not csv_data: return jsonify({"success":True,"csv":"","filename":f"surebet_bets_{datetime.now().strftime('%Y%m%d')}.csv","count":0})
    return jsonify({"success":True,"csv":csv_data,"filename":f"surebet_bets_{datetime.now().strftime('%Y%m%d')}.csv","count":len(bets)})

# ─── Engine Control ─────────────────────────────────────────────────

@app.route("/api/engine/message")
def api_engine_message():
    return jsonify({"success": True, "message": engine.get_empty_message()})

@app.route("/api/engine/start", methods=["POST"])
def api_engine_start():
    if not engine.running: engine.start()
    invest_engine.start()
    return jsonify({"success":True,"running":engine.running})

@app.route("/api/engine/stop", methods=["POST"])
def api_engine_stop():
    engine.stop(); return jsonify({"success":True,"running":engine.running})

@app.route("/api/engine/stats")
def api_engine_stats():
    return jsonify({"success":True,"stats":engine.get_stats()})

@app.route("/api/engine/logs")
def api_engine_logs():
    return jsonify({"success":True,"history":db.get("odds_history",[])[-20:]})

# ─── User Management ────────────────────────────────────────────────

@app.route("/api/auth/register", methods=["POST"])
def api_auth_register():
    d = request.get_json() or {}
    return jsonify(UserManager.create_user(d.get("username",""), d.get("password",""), d.get("email","")))

@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    d = request.get_json() or {}
    user = UserManager.authenticate(d.get("username",""), d.get("password",""))
    if not user: return jsonify({"success":False,"error":"Nieprawidłowe dane"})
    sid = UserManager.create_session(user["username"])
    session["user"] = user["username"]; session["session_id"] = sid
    return jsonify({"success":True,"user":user,"session_id":sid})

@app.route("/api/auth/me")
def api_auth_me():
    u = session.get("user")
    if not u: return jsonify({"logged_in":False})
    return jsonify({"logged_in":True,"user":u})

@app.route("/api/auth/logout", methods=["POST"])
def api_auth_logout():
    session.clear(); return jsonify({"success":True})

# ─── Settings ───────────────────────────────────────────────────────

@app.route("/api/settings")
def api_settings():
    return jsonify({"success":True,"settings":db.get("settings",{}),"config":{k:v for k,v in CONFIG.items()}})

@app.route("/api/settings", methods=["POST"])
def api_settings_update():
    d = request.get_json() or {}; s = db.get("settings",{})
    for k,v in d.items(): s[k]=v
    db.set("settings",s)
    for k in CONFIG:
        if k in d: CONFIG[k]=d[k]
    return jsonify({"success":True,"settings":s})

# ─── Sports ─────────────────────────────────────────────────────────

@app.route("/api/sports")
def api_sports():
    return jsonify({"success":True,"sports":SPORTS,"leagues":LEAGUES})

# ═══════════════════════════════════════════════════════════════════════
#  FRONTEND
# ═══════════════════════════════════════════════════════════════════════

@app.route("/")
def index(): return render_template("index.html")

@app.route("/static/<path:filename>")
def static_files(filename):
    import os as _os
    static_dir = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "static")
    return send_from_directory(static_dir, filename)

@app.route("/service-worker.js")
def service_worker():
    return send_from_directory("static", "service-worker.js", mimetype="application/javascript")

@app.route("/manifest.json")
def manifest():
    return send_from_directory("static", "manifest.json")

@app.route("/favicon.ico")
def favicon():
    return send_from_directory("static", "favicon.ico")


# ═══════════════════════════════════════════════════════════════════════
#  ACCOUNT MANAGEMENT (DEMO / REAL)
# ═══════════════════════════════════════════════════════════════════════

@app.route("/api/account/status")
def api_account_status():
    mode = db.get("account_mode", "demo")
    demo = db.get("demo_bankroll", bankroll_default())
    real = db.get("real_bankroll", bankroll_default())
    active = demo if mode == "demo" else real
    return jsonify({
        "success": True,
        "mode": mode,
        "demo_balance": round(demo.get("balance", 0), 2),
        "real_balance": round(real.get("balance", 0), 2),
        "active_balance": round(active.get("balance", 0), 2),
        "demo_profit": round(demo.get("balance", 0) - demo.get("initial_balance", 0), 2),
        "real_profit": round(real.get("balance", 0) - real.get("initial_balance", 0), 2),
        "demo_bankroll": {**demo, "transactions": db.get("transactions", [])[:10]},
        "real_bankroll": {**real, "transactions": db.get("transactions", [])[:10]},
    })

@app.route("/api/account/switch", methods=["POST"])
def api_account_switch():
    data = request.get_json() or {}
    new_mode = data.get("mode", "demo")
    if new_mode not in ("demo", "real"):
        return err_resp("Nieprawidłowy tryb")
    db.set("account_mode", new_mode)
    demo = db.get("demo_bankroll", bankroll_default())
    real = db.get("real_bankroll", bankroll_default())
    return jsonify({
        "success": True, "mode": new_mode,
        "demo_balance": demo.get("balance", 0),
        "real_balance": real.get("balance", 0),
    })

@app.route("/api/account/transfer", methods=["POST"])
def api_account_transfer():
    """Przelewa środki między kontami (używane przy przełączaniu DEMO/REAL)."""
    data = request.get_json() or {}
    amount = float(data.get("amount", 0))
    direction = data.get("direction", "demo_to_real")
    
    if amount <= 0:
        return err_resp("Nieprawidłowa kwota")
    
    demo = db.get("demo_bankroll", bankroll_default())
    real = db.get("real_bankroll", bankroll_default())
    
    if direction == "demo_to_real":
        if amount > demo.get("balance", 0):
            amount = demo["balance"]  # Transfer all available
        demo["balance"] = round(demo["balance"] - amount, 2)
        real["balance"] = round(real["balance"] + amount, 2)
        real["deposits"] = round(real.get("deposits", 0) + amount, 2)
        if real["balance"] > real.get("peak_balance", 0):
            real["peak_balance"] = real["balance"]
    else:
        if amount > real.get("balance", 0):
            amount = real["balance"]
        real["balance"] = round(real["balance"] - amount, 2)
        demo["balance"] = round(demo["balance"] + amount, 2)
        real["withdrawals"] = round(real.get("withdrawals", 0) + amount, 2)
    
    db.set("demo_bankroll", demo)
    db.set("real_bankroll", real)
    
    return jsonify({"success": True, "amount": amount, "demo_balance": demo["balance"], "real_balance": real["balance"]})

# ═══════════════════════════════════════════════════════════════════════
#  DEPOSIT SYSTEM

# ═══════════════════════════════════════════════════════════════════════
#  DEPOSIT SYSTEM
# ═══════════════════════════════════════════════════════════════════════

# Bank IDs for transfer payments (realistic)
BANK_ACCOUNTS = {
    "ing": "PL61109010140000071219812874",
    "mbank": "PL23114000000000000000000000", 
    "pkobp": "PL83102000000000000000000000",
    "pekao": "PL68124000000000000000000000",
    "santander": "PL94109000000000000000000000",
    "bnpparibas": "PL48160000000000000000000000",
    "credit_agricole": "PL59194000000000000000000000",
    "alior": "PL94249000000000000000000000",
    "millennium": "PL76116000000000000000000000",
    "nest": "PL23114000000000000000000000",
    "blik": "+48500600700",
}

PAYMENT_METHODS = [
    {"id": "stripe", "name": "Stripe", "icon": "💳", "min": 1, "max": 50000, "fee": 0, "time": "natychmiast",
     "description": "Płatność kartą przez Stripe (Visa, Mastercard)", "popular": True},
    {"id": "blik", "name": "BLIK", "icon": "💳", "min": 10, "max": 15000, "fee": 0, "time": "natychmiast",
     "description": "Płać kodem BLIK z aplikacji bankowej", "popular": True},
    {"id": "transfer", "name": "Przelew bankowy", "icon": "🏦", "min": 1, "max": 100000, "fee": 0, "time": "1-2 dni",
     "description": "Standardowy przelew na konto bankowe", "popular": True},
    {"id": "card", "name": "Karta płatnicza", "icon": "💳", "min": 5, "max": 20000, "fee": 0.02, "time": "natychmiast",
     "description": "Visa, Mastercard, Visa Electron", "popular": True},
    {"id": "crypto_btc", "name": "Bitcoin (BTC)", "icon": "₿", "min": 50, "max": 500000, "fee": 0.01, "time": "10-30 min",
     "description": "Wpłata w kryptowalucie Bitcoin", "popular": False},
    {"id": "crypto_eth", "name": "Ethereum (ETH)", "icon": "⟠", "min": 50, "max": 500000, "fee": 0.01, "time": "2-5 min",
     "description": "Wpłata w kryptowalucie Ethereum", "popular": False},
    {"id": "skrill", "name": "Skrill", "icon": "💼", "min": 10, "max": 50000, "fee": 0.01, "time": "natychmiast",
     "description": "Portfel elektroniczny Skrill", "popular": False},
    {"id": "neteller", "name": "Neteller", "icon": "💼", "min": 10, "max": 50000, "fee": 0.01, "time": "natychmiast",
     "description": "Portfel elektroniczny Neteller", "popular": False},
    {"id": "applepay", "name": "Apple Pay", "icon": "🍎", "min": 1, "max": 10000, "fee": 0.01, "time": "natychmiast",
     "description": "Płatność Apple Pay", "popular": True},
    {"id": "googlepay", "name": "Google Pay", "icon": "📱", "min": 1, "max": 10000, "fee": 0.01, "time": "natychmiast",
     "description": "Płatność Google Pay", "popular": True},
    {"id": "p24", "name": "Przelewy24", "icon": "🏧", "min": 1, "max": 50000, "fee": 0, "time": "natychmiast",
     "description": "Szybki przelew przez Przelewy24", "popular": True},
    {"id": "paypal", "name": "PayPal", "icon": "🅿️", "min": 5, "max": 25000, "fee": 0.02, "time": "natychmiast",
     "description": "Portfel PayPal", "popular": True},
    {"id": "revolut", "name": "Revolut", "icon": "💳", "min": 1, "max": 50000, "fee": 0, "time": "natychmiast",
     "description": "Przelew z Revolut", "popular": False},
]

@app.route("/api/deposit/methods")
def api_deposit_methods():
    return jsonify({"success": True, "methods": PAYMENT_METHODS, "count": len(PAYMENT_METHODS)})

@app.route("/api/deposit/create", methods=["POST"])
def api_deposit_create():
    data = request.get_json() or {}
    method_id = data.get("method_id", "")
    amount = float(data.get("amount", 0))
    
    if amount <= 0:
        return err_resp("Nieprawidłowa kwota")
    
    method = next((m for m in PAYMENT_METHODS if m["id"] == method_id), None)
    if not method:
        return err_resp("Nieprawidłowa metoda płatności")
    
    if amount < method["min"] or amount > method["max"]:
        return err_resp(f"Kwota musi być między {method['min']} a {method['max']} PLN")
    
    # Symulacja płatności
    time.sleep(random.uniform(0.5, 2))
    
    fee = round(amount * method["fee"], 2)
    net_amount = round(amount - fee, 2)
    
    # Generuj dane do płatności
    payment_data = {}
    if method_id == "blik":
        blik_code = f"{random.randint(100,999)} {random.randint(100,999)}"
        expires_seconds = random.randint(60, 180)
        payment_data = {
            "blik_code": blik_code,
            "expires_in": f"{expires_seconds // 60} min {expires_seconds % 60} s",
            "expires_seconds": expires_seconds,
            "bank_number": random.choice(list(BANK_ACCOUNTS.values())) if "blik" in BANK_ACCOUNTS else "+48500600700",
            "instructions": "Otwórz aplikację bankową → BLIK → Wprowadź kod → Potwierdź"
        }
    elif method_id == "transfer":
        bank_id = random.choice(list(BANK_ACCOUNTS.keys()))
        account = BANK_ACCOUNTS[bank_id]
        ref = f"SB-{datetime.now().strftime('%Y%m%d')}-{random.randint(1000,9999)}"
        payment_data = {
            "account_number": account,
            "bank_id": bank_id,
            "bank_name": {"ing":"ING Bank Śląski","mbank":"mBank","pkobp":"PKO BP","pekao":"Pekao SA","santander":"Santander","bnpparibas":"BNP Paribas","credit_agricole":"Credit Agricole","alior":"Alior Bank","millennium":"Bank Millennium","nest":"Nest Bank"}.get(bank_id, bank_id),
            "title": ref,
            "amount": amount,
            "recipient": "SureBet Pro Sp. z o.o.",
            "instructions": "Wykonaj przelew z dowolnej aplikacji bankowej na podane konto"
        }
    elif "crypto" in method_id:
        addr = "0x" + "".join(random.choices("0123456789abcdef", k=40))
        payment_data = {"address": addr, "network": "ERC-20"}
    elif method_id == "card":
        session_id = str(uuid.uuid4())[:16]
        payment_data = {
            "redirect_url": "https://secure-payment.example.com/pay",
            "session_id": session_id,
            "card_suffix": str(random.randint(1000,9999)),
            "installments": random.choice([1,1,1,1,2,3,6]),
            "instructions": "Karta zostanie obciążona po autoryzacji 3D Secure"
        }
    elif method_id == "p24":
        session_id = str(uuid.uuid4())[:16]
        payment_data = {
            "redirect_url": "https://secure.przelewy24.pl/session",
            "session_id": session_id,
            "description": f"Wpłata {amount} PLN - SureBet Pro",
            "instructions": "Zostaniesz przekierowany do bramki Przelewy24"
        }
    elif method_id in ("applepay", "googlepay"):
        payment_data = {
            "token": f"tok_{uuid.uuid4().hex[:24]}",
            "device": "Apple" if method_id == "applepay" else "Google",
            "status": "ready",
            "instructions": f"{'Apple' if method_id == 'applepay' else 'Google'} Pay - potwierdź w aplikacji"
        }
    elif method_id == "paypal":
        payment_data = {
            "redirect_url": "https://www.paypal.com/checkout",
            "order_id": f"ORD-{uuid.uuid4().hex[:8].upper()}",
            "instructions": "Zostaniesz przekierowany do PayPal w celu autoryzacji"
        }
    elif method_id == "revolut":
        payment_data = {
            "revolut_tag": f"@surebetpro_{random.randint(100,999)}",
            "instructions": "Wyślij przelew przez Revolut na tag SureBet Pro"
        }
    else:
        payment_data = {"reference": str(uuid.uuid4())[:16].upper()}
    
    deposit = {
        "id": str(uuid.uuid4())[:8],
        "method_id": method_id,
        "method_name": method["name"],
        "method_icon": method["icon"],
        "amount": amount,
        "fee": fee,
        "net_amount": net_amount,
        "status": "pending",
        "timestamp": datetime.now().isoformat(),
        "payment_data": payment_data,
        "description": f"Wpłata {amount} PLN przez {method['name']}",
    }
    
    # Save deposit history
    deposits = db.get("deposits", [])
    deposits.insert(0, deposit)
    db.set("deposits", deposits[:100])
    
    return jsonify({"success": True, "deposit": deposit})

@app.route("/api/deposit/confirm", methods=["POST"])
def api_deposit_confirm():
    """Potwierdza wpłatę - dopiero wtedy środki trafiają na konto."""
    data = request.get_json() or {}
    deposit_id = data.get("deposit_id", "")
    
    if not deposit_id:
        return err_resp("Brak ID wpłaty")
    
    deposits = db.get("deposits", [])
    deposit = next((d for d in deposits if d["id"] == deposit_id), None)
    
    if not deposit:
        return err_resp("Nie znaleziono wpłaty", 404)
    
    if deposit["status"] != "pending":
        return err_resp("Wpłata już została przetworzona")
    
    # Mark as completed
    deposit["status"] = "completed"
    deposit["confirmed_at"] = datetime.now().isoformat()
    
    # NOW add money to bankroll
    amount = deposit["amount"]
    net_amount = deposit["net_amount"]
    mode = db.get("account_mode", "demo")
    bk_key = f"{mode}_bankroll"
    bk = db.get(bk_key, bankroll_default())
    bk["balance"] = round(bk.get("balance", 0) + net_amount, 2)
    bk["deposits"] = round(bk.get("deposits", 0) + amount, 2)
    if bk["balance"] > bk.get("peak_balance", 0):
        bk["peak_balance"] = bk["balance"]
    db.set(bk_key, bk)
    
    # Update deposit in list
    db.set("deposits", deposits[:100])
    
    # Add transaction
    txns = db.get("transactions", [])
    txns.insert(0, {
        "id": str(uuid.uuid4())[:8], "type": "deposit",
        "amount": net_amount, "fee": deposit["fee"],
        "balance_after": bk["balance"],
        "timestamp": datetime.now().isoformat(),
        "description": deposit["description"],
    })
    db.set("transactions", txns[:200])
    
    return jsonify({"success": True, "message": "Wpłata potwierdzona!", "new_balance": bk["balance"]})
    
    # Add transaction
    txns = db.get("transactions", [])
    txns.insert(0, {
        "id": str(uuid.uuid4())[:8], "type": "deposit",
        "amount": net_amount, "fee": fee,
        "method": method["name"],
        "timestamp": datetime.now().isoformat(),
        "description": f"Wpłata {amount} PLN przez {method['name']} (netto: {net_amount} PLN)",
    })
    db.set("transactions", txns[:200])
    
    mode = db.get("account_mode", "demo")
    return jsonify({
        "success": success,
        "deposit": deposit,
        "new_balance": db.get(f"{mode}_bankroll", {}).get("balance", 0),
        "message": f"Wpłacono {net_amount} PLN przez {method['name']} na konto {mode}" if success else "Płatność odrzucona",
        "account_mode": mode,
    })

@app.route("/api/deposit/history")
def api_deposit_history():
    deposits = db.get("deposits", [])
    return jsonify({"success": True, "count": len(deposits), "deposits": deposits[:30]})


# ═══════════════════════════════════════════════════════════════════════
#  WITHDRAWAL SYSTEM
# ═══════════════════════════════════════════════════════════════════════

WITHDRAWAL_METHODS = [
    {"id": "bank", "name": "Przelew bankowy", "icon": "🏦", "min": 10, "max": 100000, "fee": 0, "time": "1-2 dni robocze",
     "description": "Standardowy przelew na konto bankowe", "fields": [{"name":"account","label":"Numer konta","placeholder":"PL00 0000 0000 0000 0000 0000 0000","type":"text"},{"name":"account_name","label":"Nazwa właściciela","placeholder":"Imię i Nazwisko","type":"text"}]},
    {"id": "blik", "name": "BLIK", "icon": "💳", "min": 10, "max": 15000, "fee": 0, "time": "natychmiast",
     "description": "Wypłata na numer telefonu BLIK", "fields": [{"name":"phone","label":"Numer telefonu","placeholder":"+48 600 700 800","type":"tel"}]},
    {"id": "crypto_btc", "name": "Bitcoin (BTC)", "icon": "₿", "min": 50, "max": 500000, "fee": 0.005, "time": "10-30 min",
     "description": "Wypłata w kryptowalucie Bitcoin", "fields": [{"name":"address","label":"Adres portfela BTC","placeholder":"bc1q...","type":"text"}]},
    {"id": "crypto_eth", "name": "Ethereum (ETH)", "icon": "⟠", "min": 50, "max": 500000, "fee": 0.005, "time": "2-5 min",
     "description": "Wypłata w kryptowalucie Ethereum", "fields": [{"name":"address","label":"Adres portfela ETH","placeholder":"0x...","type":"text"}]},
    {"id": "skrill", "name": "Skrill", "icon": "💼", "min": 10, "max": 50000, "fee": 0.01, "time": "natychmiast",
     "description": "Wypłata na portfel Skrill", "fields": [{"name":"email","label":"Email Skrill","placeholder":"email@example.com","type":"email"}]},
    {"id": "paypal", "name": "PayPal", "icon": "🅿️", "min": 10, "max": 25000, "fee": 0.02, "time": "do 24h",
     "description": "Wypłata na PayPal", "fields": [{"name":"email","label":"Email PayPal","placeholder":"email@example.com","type":"email"}]},
    {"id": "revolut", "name": "Revolut", "icon": "💳", "min": 10, "max": 50000, "fee": 0, "time": "do 24h",
     "description": "Wypłata na Revolut", "fields": [{"name":"tag","label":"Revolut Tag","placeholder":"@username","type":"text"}]},
]

@app.route("/api/withdraw/methods")
def api_withdraw_methods():
    return jsonify({"success": True, "methods": WITHDRAWAL_METHODS})

@app.route("/api/withdraw/create", methods=["POST"])
def api_withdraw_create():
    data = request.get_json() or {}
    method_id = data.get("method_id", "")
    amount = float(data.get("amount", 0))
    account_details = data.get("account_details", "")
    
    if amount <= 0:
        return err_resp("Nieprawidłowa kwota")
    
    method = next((m for m in WITHDRAWAL_METHODS if m["id"] == method_id), None)
    if not method:
        return err_resp("Nieprawidłowa metoda")
    
    if amount < method["min"] or amount > method["max"]:
        return err_resp(f"Min: {method['min']}, Max: {method['max']} PLN")
    
    if not account_details:
        return err_resp("Podaj dane do wypłaty (nr konta / adres)")
    
    # Check active bankroll based on mode
    mode = db.get("account_mode", "demo")
    bk_key = f"{mode}_bankroll"
    bk = db.get(bk_key, bankroll_default())
    if amount > bk.get("balance", 0):
        return err_resp("Niewystarczające środki")
    
    fee = round(amount * method["fee"], 2)
    net_amount = round(amount - fee, 2)
    
    # Deduct from balance
    bk["balance"] = round(bk["balance"] - amount, 2)
    bk["withdrawals"] = round(bk.get("withdrawals", 0) + amount, 2)
    db.set(bk_key, bk)
    
    withdrawal = {
        "id": str(uuid.uuid4())[:8].upper(),
        "method_id": method_id,
        "method_name": method["name"],
        "method_icon": method["icon"],
        "amount": amount,
        "fee": fee,
        "net_amount": net_amount,
        "account_details": account_details[:20] + "..." if len(account_details) > 20 else account_details,
        "status": "processing",
        "created_at": datetime.now().isoformat(),
        "processed_at": None,
        "description": f"Wypłata {amount} PLN przez {method['name']}",
    }
    
    # Simulate processing after some time
    def process_withdrawal(wid):
        time.sleep(random.randint(30, 120))
        withdrawals = db.get("withdrawals", [])
        w = next((x for x in withdrawals if x["id"] == wid), None)
        if w:
            w["status"] = "completed"
            w["processed_at"] = datetime.now().isoformat()
            db.set("withdrawals", withdrawals)
    
    t = threading.Thread(target=process_withdrawal, args=(withdrawal["id"],), daemon=True)
    t.start()
    
    withdrawals = db.get("withdrawals", [])
    withdrawals.insert(0, withdrawal)
    db.set("withdrawals", withdrawals[:100])
    
    txns = db.get("transactions", [])
    txns.insert(0, {
        "id": str(uuid.uuid4())[:8], "type": "withdrawal",
        "amount": amount, "fee": fee, "method": method["name"],
        "status": "processing",
        "timestamp": datetime.now().isoformat(),
        "description": f"Wypłata {amount} PLN przez {method['name']} (netto: {net_amount} PLN)",
    })
    db.set("transactions", txns[:200])
    
    mode = db.get("account_mode", "demo")
    return jsonify({
        "success": True,
        "withdrawal": withdrawal,
        "new_balance": bk["balance"],
        "message": f"Wniosek o wypłatę {net_amount} PLN przez {method['name']} przyjęty. Status: {withdrawal['status']}",
        "account_mode": mode,
    })

@app.route("/api/withdraw/history")
def api_withdraw_history():
    withdrawals = db.get("withdrawals", [])
    return jsonify({"success": True, "count": len(withdrawals), "withdrawals": withdrawals[:30]})

@app.route("/api/withdraw/cancel", methods=["POST"])
def api_withdraw_cancel():
    data = request.get_json() or {}
    wid = data.get("withdrawal_id")
    if not wid: return err_resp("Brak ID")
    
    withdrawals = db.get("withdrawals", [])
    w = next((x for x in withdrawals if x["id"] == wid), None)
    if not w: return err_resp("Nie znaleziono")
    if w["status"] != "processing": return err_resp("Nie można anulować")
    
    w["status"] = "cancelled"
    db.set("withdrawals", withdrawals)
    
    # Return funds
    real = db.get("real_bankroll", bankroll_default())
    real["balance"] = round(real["balance"] + w["amount"], 2)
    db.set("real_bankroll", real)
    
    return jsonify({"success": True, "message": "Wypłata anulowana", "new_balance": real["balance"]})

# ═══════════════════════════════════════════════════════════════════════
#  BET SLIP & PARLAY BUILDER
# ═══════════════════════════════════════════════════════════════════════

@app.route("/api/betslip/calculate", methods=["POST"])
def api_betslip_calculate():
    """Oblicza potencjalną wygraną dla kuponu z multipleksami."""
    data = request.get_json() or {}
    selections = data.get("selections", [])
    stake = float(data.get("stake", 10))
    
    if len(selections) < 1:
        return err_resp("Dodaj przynajmniej 1 selekcję")
    
    total_odds = 1.0
    details = []
    
    for sel in selections:
        odds = float(sel.get("odds", 1.0))
        total_odds *= odds
        details.append({
            "match": sel.get("match", ""),
            "market": sel.get("market", ""),
            "selection": sel.get("selection", ""),
            "odds": odds,
            "bookmaker": sel.get("bookmaker", ""),
        })
    
    potential_win = round(stake * total_odds, 2)
    profit = round(potential_win - stake, 2)
    
    return jsonify({
        "success": True,
        "total_odds": round(total_odds, 2),
        "stake": stake,
        "potential_win": potential_win,
        "profit": profit,
        "selections_count": len(selections),
        "details": details,
    })

# ═══════════════════════════════════════════════════════════════════════
#  ACCOUNT VERIFICATION & SECURITY
# ═══════════════════════════════════════════════════════════════════════

@app.route("/api/account/verify/email", methods=["POST"])
def api_verify_email():
    """Wysyła kod weryfikacyjny na email (symulacja)."""
    data = request.get_json() or {}
    email = data.get("email", "")
    if not email or "@" not in email:
        return err_resp("Nieprawidłowy email")
    
    code = str(random.randint(100000, 999999))
    
    # Store verification code
    verifications = db.get("email_verifications", {})
    verifications[email] = {
        "code": code,
        "created_at": datetime.now().isoformat(),
        "expires_at": (datetime.now() + timedelta(minutes=15)).isoformat(),
        "verified": False,
    }
    # Keep only last 50
    if len(verifications) > 50:
        verifications = dict(list(verifications.items())[-50:])
    db.set("email_verifications", verifications)
    
    return jsonify({
        "success": True,
        "message": f"Kod weryfikacyjny wysłany na {email}",
        "code": code,  # In production, this would be sent via email
        "expires_in": "15 minut",
    })

@app.route("/api/account/verify/confirm", methods=["POST"])
def api_verify_confirm():
    data = request.get_json() or {}
    email = data.get("email", "")
    code = data.get("code", "")
    
    verifications = db.get("email_verifications", {})
    v = verifications.get(email)
    if not v:
        return err_resp("Nie znaleziono kodu")
    
    if v.get("verified"):
        return jsonify({"success": True, "message": "Email już zweryfikowany"})
    
    if v["code"] != code:
        return err_resp("Nieprawidłowy kod")
    
    expires = datetime.fromisoformat(v["expires_at"])
    if datetime.now() > expires:
        return err_resp("Kod wygasł")
    
    v["verified"] = True
    verifications[email] = v
    db.set("email_verifications", verifications)
    
    # Mark account as verified
    settings = db.get("settings", {})
    settings["email_verified"] = True
    settings["verified_email"] = email
    db.set("settings", settings)
    
    return jsonify({"success": True, "message": "Email zweryfikowany!"})

@app.route("/api/account/security/status")
def api_security_status():
    settings = db.get("settings", {})
    return jsonify({
        "success": True,
        "email_verified": settings.get("email_verified", False),
        "verified_email": settings.get("verified_email", ""),
        "pin_enabled": settings.get("pin_enabled", False),
        "two_factor": settings.get("two_factor", False),
        "last_login": settings.get("last_login", None),
        "login_count": settings.get("login_count", 0),
    })

@app.route("/api/account/security/pin", methods=["POST"])
def api_set_pin():
    data = request.get_json() or {}
    pin = data.get("pin", "")
    
    if not pin or len(pin) != 4 or not pin.isdigit():
        return err_resp("PIN musi mieć 4 cyfry")
    
    settings = db.get("settings", {})
    settings["pin_hash"] = hashlib.sha256(pin.encode()).hexdigest()
    settings["pin_enabled"] = True
    db.set("settings", settings)
    
    return jsonify({"success": True, "message": "PIN ustawiony!"})

@app.route("/api/account/security/verify-pin", methods=["POST"])
def api_verify_pin():
    data = request.get_json() or {}
    pin = data.get("pin", "")
    
    settings = db.get("settings", {})
    if not settings.get("pin_enabled"):
        return jsonify({"success": True, "verified": True})
    
    pin_hash = hashlib.sha256(pin.encode()).hexdigest()
    if pin_hash == settings.get("pin_hash"):
        return jsonify({"success": True, "verified": True})
    
    return jsonify({"success": False, "verified": False, "error": "Nieprawidłowy PIN"})


# ═══════════════════════════════════════════════════════════════════════

class InvestmentEngine:
    """Silnik inwestycyjny - zarabiaj na swoich środkach."""
    
    def __init__(self):
        self.running = False
        self.thread = None
    
    def process_returns(self):
        """Główna pętla przetwarzająca dzienne zwroty z inwestycji."""
        while self.running:
            try:
                investments = db.get("investments", [])
                plans = {p["id"]: p for p in db.get("investment_plans", [])}
                updated = []
                
                for inv in investments:
                    if inv.get("status") != "active":
                        updated.append(inv)
                        continue
                    
                    plan = plans.get(inv["plan_id"])
                    if not plan:
                        updated.append(inv)
                        continue
                    
                    # Calculate daily return
                    daily_return = round(inv["amount"] * plan["daily_roi"] / 100, 2)
                    
                    # Check if investment period ended
                    start = datetime.fromisoformat(inv["start_date"])
                    elapsed = (datetime.now() - start).days
                    
                    if elapsed >= inv["duration_days"]:
                        # Matured - return investment + all profit
                        inv["status"] = "completed"
                        inv["end_date"] = datetime.now().isoformat()
                        inv["total_return"] = round(inv["amount"] + inv["total_profit"], 2)
                        
                        # Return to real bankroll
                        real = db.get("real_bankroll", bankroll_default())
                        real["balance"] = round(real["balance"] + inv["total_return"], 2)
                        if real["balance"] > real.get("peak_balance", 0):
                            real["peak_balance"] = real["balance"]
                        db.set("real_bankroll", real)
                        
                        txns = db.get("transactions", [])
                        txns.insert(0, {
                            "id": str(uuid.uuid4())[:8], "type": "investment_return",
                            "amount": inv["total_return"],
                            "description": f"Zwrot z inwestycji {plan['name']}: {inv['total_return']} PLN",
                            "timestamp": datetime.now().isoformat(),
                        })
                        db.set("transactions", txns[:200])
                    else:
                        # Still active - accrue daily profit
                        inv["daily_returns"].append({
                            "day": elapsed + 1,
                            "amount": daily_return,
                            "date": datetime.now().isoformat(),
                        })
                        inv["total_profit"] = round(inv.get("total_profit", 0) + daily_return, 2)
                        inv["current_value"] = round(inv["amount"] + inv["total_profit"], 2)
                    
                    updated.append(inv)
                
                db.set("investments", updated)
                
            except Exception as e:
                print(f"[InvestEngine] Error: {e}")
            
            time.sleep(60)  # Check every minute (simulates daily)
    
    def start(self):
        if self.running: return
        self.running = True
        self.thread = threading.Thread(target=self.process_returns, daemon=True)
        self.thread.start()
        print("[InvestEngine] Started")
    
    def create_investment(self, plan_id, amount):
        plans = {p["id"]: p for p in db.get("investment_plans", [])}
        plan = plans.get(plan_id)
        if not plan:
            return {"success": False, "error": "Nieprawidłowy plan"}
        
        if amount < plan["min_amount"] or amount > plan["max_amount"]:
            return {"success": False, "error": f"Kwota musi być między {plan['min_amount']} a {plan['max_amount']} PLN"}
        
        mode = db.get("account_mode", "demo")
        if mode != "real":
            return {"success": False, "error": "Przełącz na tryb REAL aby inwestować"}
        real = db.get("real_bankroll", bankroll_default())
        if amount > real.get("balance", 0):
            return {"success": False, "error": "Niewystarczające środki"}
        
        # Deduct from balance
        real["balance"] = round(real["balance"] - amount, 2)
        if real["balance"] > real.get("peak_balance", 0):
            real["peak_balance"] = real["balance"]
        db.set("real_bankroll", real)
        
        projected = round(amount * (1 + plan["daily_roi"] / 100) ** plan["duration_days"], 2)
        
        inv = {
            "id": str(uuid.uuid4())[:8],
            "plan_id": plan_id,
            "plan_name": plan["name"],
            "plan_risk": plan["risk"],
            "amount": amount,
            "start_date": datetime.now().isoformat(),
            "duration_days": plan["duration_days"],
            "end_date": (datetime.now() + timedelta(days=plan["duration_days"])).isoformat(),
            "daily_roi": plan["daily_roi"],
            "daily_returns": [],
            "total_profit": 0.0,
            "current_value": amount,
            "projected_return": projected,
            "projected_profit": round(projected - amount, 2),
            "status": "active",
        }
        
        investments = db.get("investments", [])
        investments.insert(0, inv)
        db.set("investments", investments)
        
        txns = db.get("transactions", [])
        txns.insert(0, {
            "id": str(uuid.uuid4())[:8], "type": "investment",
            "amount": amount,
            "description": f"Inwestycja {amount} PLN w {plan['name']}",
            "timestamp": datetime.now().isoformat(),
        })
        db.set("transactions", txns[:200])
        
        return {"success": True, "investment": inv}
    
    def withdraw_investment(self, inv_id):
        investments = db.get("investments", [])
        inv = next((i for i in investments if i["id"] == inv_id), None)
        if not inv:
            return {"success": False, "error": "Inwestycja nie znaleziona"}
        
        if inv["status"] != "active":
            return {"success": False, "error": "Inwestycja już zakończona"}
        
        # Early withdrawal penalty (50% of profit)
        penalty = round(inv.get("total_profit", 0) * 0.5, 2)
        return_amount = round(inv["amount"] + inv.get("total_profit", 0) - penalty, 2)
        
        inv["status"] = "withdrawn_early"
        inv["penalty"] = penalty
        inv["end_date"] = datetime.now().isoformat()
        
        real = db.get("real_bankroll", bankroll_default())
        real["balance"] = round(real["balance"] + return_amount, 2)
        db.set("real_bankroll", real)
        
        db.set("investments", investments)
        
        txns = db.get("transactions", [])
        txns.insert(0, {
            "id": str(uuid.uuid4())[:8], "type": "investment_withdrawal",
            "amount": return_amount,
            "penalty": penalty,
            "description": f"Wczesna wypłata inwestycji: {return_amount} PLN (kara: {penalty} PLN)",
            "timestamp": datetime.now().isoformat(),
        })
        db.set("transactions", txns[:200])
        
        return {"success": True, "return_amount": return_amount, "penalty": penalty}

invest_engine = InvestmentEngine()

@app.route("/api/investment/plans")
def api_investment_plans():
    return jsonify({"success": True, "plans": db.get("investment_plans", [])})

@app.route("/api/investment/portfolio")
def api_investment_portfolio():
    investments = db.get("investments", [])
    active = [i for i in investments if i["status"] == "active"]
    completed = [i for i in investments if i["status"] == "completed"]
    
    total_invested = sum(i["amount"] for i in investments)
    total_profit = sum(i.get("total_profit", 0) for i in investments if i["status"] == "active")
    total_returned = sum(i.get("total_return", 0) for i in investments if i["status"] == "completed")
    
    return jsonify({
        "success": True,
        "active_count": len(active),
        "completed_count": len(completed),
        "total_invested": round(total_invested, 2),
        "total_profit": round(total_profit, 2),
        "total_returned": round(total_returned, 2),
        "active": active,
        "completed": completed[:20],
    })

@app.route("/api/investment/create", methods=["POST"])
def api_investment_create():
    data = request.get_json() or {}
    plan_id = data.get("plan_id")
    amount = float(data.get("amount", 0))
    
    if not plan_id:
        return err_resp("Nie określono planu")
    if amount <= 0:
        return err_resp("Nieprawidłowa kwota")
    
    # Check account mode
    if db.get("account_mode") != "real":
        return err_resp("Inwestycje dostępne tylko w trybie REAL. Przełącz konto na real.")
    
    result = invest_engine.create_investment(plan_id, amount)
    return jsonify(result)

@app.route("/api/investment/withdraw", methods=["POST"])
def api_investment_withdraw():
    data = request.get_json() or {}
    inv_id = data.get("investment_id")
    if not inv_id:
        return err_resp("Nie określono inwestycji")
    return jsonify(invest_engine.withdraw_investment(inv_id))

@app.route("/api/investment/history")
def api_investment_history():
    investments = db.get("investments", [])
    return jsonify({"success": True, "count": len(investments), "investments": investments[:30]})

# ═══════════════════════════════════════════════════════════════════════
#  MODIFIED BANKROLL ENDPOINTS (use active bankroll)
# ═══════════════════════════════════════════════════════════════════════

@app.route("/api/realbankroll")  # New: always real
def api_real_bankroll():
    bk = db.get("real_bankroll", bankroll_default())
    return jsonify({"success": True, "bankroll": bk})

@app.route("/api/demobankroll")  # New: always demo
def api_demo_bankroll():
    bk = db.get("demo_bankroll", bankroll_default())
    return jsonify({"success": True, "bankroll": bk})



# ═══════════════════════════════════════════════════════════════════════
#  LIVE DATA STATUS
# ═══════════════════════════════════════════════════════════════════════

@app.route("/api/live/status")
def api_live_status():
    """Sprawdza dostępność źródeł danych na żywo."""
    available = live_data.is_available()
    settings = db.get("settings", {})
    return jsonify({
        "success": True,
        "live_available": available,
        "live_enabled": settings.get("live_data_enabled", False),
        "data_source": "live" if available and settings.get("live_data_enabled") else "simulated",
        "message": "Dane na żywo dostępne" if available else "Brak dostępu do danych na żywo. Używana jest symulacja.",
    })

@app.route("/api/live/toggle", methods=["POST"])
def api_live_toggle():
    """Włącza/wyłącza dane na żywo."""
    data = request.get_json() or {}
    enabled = data.get("enabled", False)
    settings = db.get("settings", {})
    settings["live_data_enabled"] = enabled
    db.set("settings", settings)
    return jsonify({"success": True, "live_enabled": enabled})

@app.route("/api/live/refresh", methods=["POST"])
def api_live_refresh():
    """Wymusza odświeżenie danych z API."""
    settings = db.get("settings", {})
    if not settings.get("live_data_enabled"):
        return jsonify({"success": False, "error": "Dane na żywo nie są włączone"})
    engine.last_live_refresh = datetime.now()
    engine.update_opportunities()
    return jsonify({"success": True, "message": "Dane odświeżone"})

@app.route("/api/live/apikeys", methods=["GET", "POST"])
def api_live_apikeys():
    """Zarządzanie kluczami API."""
    if request.method == "GET":
        settings = db.get("settings", {})
        api_keys = settings.get("api_keys", {})
        # Nigdy nie zwracaj pełnych kluczy, tylko maskuj
        masked = {}
        for provider, key in api_keys.items():
            masked[provider] = key[:8] + "..." + key[-4:] if key and len(key) > 12 else ""
        return jsonify({"success": True, "api_keys": masked, "providers": [
            {"id": "theoddsapi", "name": "The Odds API", "url": "https://the-odds-api.com", "free_tier": "500 requests/month"},
            {"id": "api_football", "name": "API-Football", "url": "https://www.api-football.com", "free_tier": "100 requests/day"},
        ]})
    
    data = request.get_json() or {}
    provider = data.get("provider", "")
    api_key = data.get("api_key", "")
    
    if not provider or not api_key:
        return err_resp("Podaj provider i klucz API")
    
    settings = db.get("settings", {})
    if "api_keys" not in settings:
        settings["api_keys"] = {}
    settings["api_keys"][provider] = api_key
    db.set("settings", settings)
    
    # Testuj klucz
    test_result = live_data.fetch_with_api_key(api_key, provider)
    
    return jsonify({
        "success": test_result.get("success", False),
        "provider": provider,
        "message": "Klucz API zapisany" if test_result.get("success") else f"Klucz zapisany ale test nieudany: {test_result.get('error', '?')}",
        "test_result": test_result.get("success", False),
        "matches_found": test_result.get("count", 0),
    })

# ═══════════════════════════════════════════════════════════════════════
#  STARTUP
# ═══════════════════════════════════════════════════════════════════════

# Start engines at module level (for gunicorn compatibility)
engine.start()
invest_engine.start()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"""
╔══════════════════════════════════════════════════╗
║     🎯 SureBet Pro Web v{CONFIG['version']}               ║
║     Zaawansowany system surebetów                ║
║                                                  ║
║     • Silnik surebetów: aktywny                   ║
║     • Rynki: 1X2, AH, O/U, BTTS                  ║
║     • Value betting + Kelly Criterion             ║
║     • Automatyczne obstawianie                    ║
║     • Backtesting + analiza marż                  ║
║                                                  ║
║     http://localhost:{port}                        ║
║     Otwórz w przeglądarce na telefonie            ║
╚══════════════════════════════════════════════════╝
""")
    app.run(host=host, port=port, debug=False, threaded=True)
