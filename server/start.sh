#!/bin/sh
set -e

echo "[Startup] Starting deployment script..."

# Note: prisma generate is done at build time (Dockerfile), no need to repeat here

# Retry loop for database migrations
echo "[Startup] Running database migrations..."
MAX_RETRIES=30
COUNT=0

# Try prisma migrate deploy first (production-safe, uses migration files)
# If this fails (e.g., no baseline exists), fall back to db push
if npx prisma migrate deploy --config ./prisma/prisma.config.ts 2>/dev/null; then
  echo "[Startup] Migrations applied via migrate deploy."
else
  echo "[Startup] migrate deploy failed, using db push to sync schema..."
  until npx prisma db push --accept-data-loss --config ./prisma/prisma.config.ts; do
    COUNT=$((COUNT+1))
    if [ $COUNT -ge $MAX_RETRIES ]; then
      echo "[Startup] Schema sync failed after $MAX_RETRIES attempts. Exiting."
      exit 1
    fi
    echo "[Startup] Schema sync failed (attempt $COUNT/$MAX_RETRIES). Retrying in 5s..."
    sleep 5
  done
  echo "[Startup] Schema synced via db push."
fi

echo "[Startup] Database ready."

# Start the application with increased heap memory (4GB) to prevent OOM during heavy processing
echo "[Startup] Starting Node.js application..."
export NODE_OPTIONS="--max-old-space-size=4096"
exec npm start

