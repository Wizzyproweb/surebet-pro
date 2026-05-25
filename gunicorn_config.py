"""
SureBet Pro - Gunicorn Production Configuration
"""
import os
import multiprocessing

bind = f"0.0.0.0:{os.environ.get('PORT', '5001')}"
workers = int(os.environ.get('WORKERS', multiprocessing.cpu_count() * 2 + 1))
worker_class = 'gthread'
threads = int(os.environ.get('THREADS', 4))
timeout = 120
keepalive = 5
worker_connections = 1000
max_requests = 10000
max_requests_jitter = 1000

# Logging
accesslog = '-'
errorlog = '-'
loglevel = os.environ.get('LOG_LEVEL', 'info')

# SSL (optional)
# keyfile = '/path/to/key.pem'
# certfile = '/path/to/cert.pem'

# Security
limit_request_line = 4096
limit_request_fields = 100
