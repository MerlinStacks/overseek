#!/bin/sh
set -e

echo "[Startup] Starting deployment script..."

# Auto-construct DATABASE_URL from individual env vars if not explicitly set.
# This avoids Docker Compose interpolation issues where ${VAR} in environment:
# blocks don't read from env_file (only from host shell or .env file).
if [ -z "$DATABASE_URL" ]; then
  PG_USER="${POSTGRES_USER:-admin}"
  PG_PASS="${POSTGRES_PASSWORD:-password}"
  PG_HOST="${POSTGRES_HOST:-postgres}"
  PG_PORT="${POSTGRES_PORT:-5432}"
  PG_DB="${POSTGRES_DB:-overseek}"
  export DATABASE_URL="postgres://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${PG_DB}"
  echo "[Startup] DATABASE_URL constructed from env vars (host: ${PG_HOST})"
fi

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

