#!/bin/bash
set -e

echo "=========================================="
echo " Starting Yoru Chatbot & ChromaDB (Render)"
echo "=========================================="

# Start ChromaDB daemon in background on port 8000
echo "--> Starting local ChromaDB instance..."
chroma run --path ./chroma --port 8000 --host 127.0.0.1 &
CHROMA_PID=$!

# Wait for ChromaDB to respond to health checks
echo "--> Waiting for ChromaDB to become ready..."
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -s http://127.0.0.1:8000/api/v2/heartbeat > /dev/null 2>&1 || curl -s http://127.0.0.1:8000/api/v1/heartbeat > /dev/null 2>&1; then
    echo "--> ChromaDB is online and ready!"
    break
  fi
  sleep 1
  RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  echo "⚠️ Warning: ChromaDB took longer than expected to start. Proceeding anyway..."
fi

# Ensure PORT is defined (Render assigns this dynamically)
export PORT=${PORT:-10000}
export CHROMA_URL="http://127.0.0.1:8000"

echo "--> Launching Node.js Express server on port $PORT..."
exec node rag_chatbot.js
