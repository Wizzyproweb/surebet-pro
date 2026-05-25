#!/bin/bash
# SureBet Pro - stabilny start
cd "$(dirname "$0")"
rm -f data/database.json  # fresh start
exec python3 -c "
from app import app, engine, invest_engine
import threading
engine.start()
invest_engine.start()
print('✅ SureBet Pro v5.0 uruchomiony na http://0.0.0.0:5001')
app.run(host='0.0.0.0', port=5001, threaded=True, use_reloader=False)
"
