#!/bin/sh
set -e

echo "[Startup] Starting deployment script..."

# ── Auto-derive CORS / URL vars from APP_URL ─────────────────────────────────
# Only fills in values that aren't already set, so existing stack.env files
# continue to work unchanged (${VAR:-default} keeps explicit values).
if [ -n "$APP_URL" ]; then
  # Strip trailing slash — CORS origin matching is strict about this
  APP_URL=$(echo "$APP_URL" | sed 's|/*$||')

  export CLIENT_URL="${CLIENT_URL:-$APP_URL}"
  export CORS_ORIGIN="${CORS_ORIGIN:-$APP_URL}"
  export CORS_ORIGINS="${CORS_ORIGINS:-$APP_URL}"

  if [ -z "$API_URL" ]; then
    case "$APP_URL" in
      http://localhost*|http://127.0.0.1*|https://localhost*|https://127.0.0.1*)
        export API_URL="http://localhost:3000"
        ;;
      *)
        # https://myapp.example.com -> https://api.myapp.example.com
        export API_URL="$(echo "$APP_URL" | sed 's|://|://api.|')"
        ;;
    esac
  fi

  echo "[Startup] URL config (auto-derived where not explicitly set):"
  echo "  APP_URL=${APP_URL}"
  echo "  API_URL=${API_URL}"
  echo "  CLIENT_URL=${CLIENT_URL}"
  echo "  CORS_ORIGINS=${CORS_ORIGINS}"
fi

# ── Auto-construct DATABASE_URL ───────────────────────────────────────────────
# Avoids Docker Compose interpolation issues where ${VAR} in environment:
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

# Apply versioned SQL only: db push cannot install custom migration SQL/triggers.
echo "[Startup] Running database migrations..."
# Inherit stdout/stderr so the original Prisma/database error remains visible.
if npx prisma migrate deploy --config ./prisma/prisma.config.ts; then
  echo "[Startup] Migrations applied via migrate deploy."
else
  migration_status=$?
  echo "[Startup] ERROR: prisma migrate deploy failed (exit ${migration_status}); application startup stopped." >&2
  echo "[Startup] Preserve the original Prisma error above. Inspect migration status with the same image and database environment:" >&2
  echo "[Startup]   npx prisma migrate status --config ./prisma/prisma.config.ts (from the server directory)" >&2
  echo "[Startup] See docs/migration-startup-recovery.md before retrying; prior db push may have left migration-history drift or missing SQL triggers." >&2
  echo "[Startup] No automatic db push, resolve, reset, or retry is performed. ALLOW_DB_PUSH_FALLBACK is no longer supported." >&2
  exit "$migration_status"
fi

echo "[Startup] Database ready."

# The image owns the immutable source; uploads may be an old persistent volume.
# Invalid/missing production packages stop startup before the API can serve them.
node "$(dirname "$0")/scripts/install_plugin_download.js"

# Start the application with capped heap.
# Respect preconfigured NODE_OPTIONS from Compose/env; default to 6GB.
echo "[Startup] Starting Node.js application..."
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}"
exec npm start
