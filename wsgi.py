"""
SureBet Pro v5.0 - WSGI Entry Point for Render/Gunicorn
"""
import sys, os

# Add app directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Render sets PORT env var
port = os.environ.get("PORT", "10000")
os.environ["HOST"] = "0.0.0.0"
os.environ["PORT"] = str(port)

from app import app as application
