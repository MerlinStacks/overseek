#!/bin/sh
set -e

echo "[Startup] Starting deployment script..."

# Ensure Prisma Client is up to date
echo "[Startup] Generating Prisma Client..."
npx prisma generate

# Retry loop for database migrations
# This handles the case where Postgres is not yet ready to accept connections
echo "[Startup] Running database migrations..."
MAX_RETRIES=30
COUNT=0

until npx prisma migrate deploy; do
  COUNT=$((COUNT+1))
  if [ $COUNT -ge $MAX_RETRIES ]; then
    echo "[Startup] Migration failed after $MAX_RETRIES attempts. Exiting."
    exit 1
  fi
  echo "[Startup] Migration failed (attempt $COUNT/$MAX_RETRIES). Retrying in 5s..."
  sleep 5
done

echo "[Startup] Migrations applied successfully."

# Start the application
echo "[Startup] Starting Node.js application..."
exec npm start
