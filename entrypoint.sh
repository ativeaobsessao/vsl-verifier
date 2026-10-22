#!/bin/bash
set -e

echo "=== VSL Verifier Multi-Runtime Boot ==="

# 1. Iniciar worker Python Scrapling em background
echo "Iniciando Python Scrapling Stealth Worker (:5001)..."
python3 scraper_service/service.py &

# 2. Aguardar o worker Python estar saudavel
echo "Aguardando inicializacao do motor Scrapling..."
MAX_WAIT=25
WAIT_COUNT=0
READY=0

while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
  if curl -s http://127.0.0.1:5001/health | grep -q "ok"; then
    echo "Python Scrapling Stealth Worker pronto e saudavel!"
    READY=1
    break
  fi
  sleep 1
  WAIT_COUNT=$((WAIT_COUNT + 1))
done

if [ $READY -ne 1 ]; then
  echo "AVISO: Worker Python demorou mais de 25s para responder. Continuando boot..."
fi

# 3. Executar o Gateway Node.js principal
echo "Iniciando Node.js Gateway (:3000)..."
exec npm start
