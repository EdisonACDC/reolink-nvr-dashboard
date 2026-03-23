#!/bin/bash
set -e

PGDATA="/data/postgres"

echo "[NVR] Starting Reolink NVR Dashboard..."

# Decompress pre-built bundles on first run
if [ -f /app/artifacts/api-server/dist/index.mjs.gz ] && [ ! -f /app/artifacts/api-server/dist/index.mjs ]; then
    echo "[NVR] Decompressing server bundle..."
    gunzip -k /app/artifacts/api-server/dist/index.mjs.gz
fi
FRONTEND_JS=$(ls /app/artifacts/nvr-dashboard/dist/public/assets/*.js.gz 2>/dev/null | head -1)
if [ -n "$FRONTEND_JS" ] && [ ! -f "${FRONTEND_JS%.gz}" ]; then
    echo "[NVR] Decompressing frontend bundle..."
    gunzip -k "$FRONTEND_JS"
fi

# Create postgres user if missing
if ! id postgres > /dev/null 2>&1; then
    addgroup -S postgres 2>/dev/null || true
    adduser -S -D -H -G postgres postgres 2>/dev/null || true
fi

# Initialize PostgreSQL on first run
if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "[NVR] Initializing database for the first time..."
    mkdir -p "$PGDATA"
    chown -R postgres:postgres "$PGDATA"
    su-exec postgres initdb -D "$PGDATA" -U postgres --auth-host=trust --auth-local=trust
fi

# Start PostgreSQL
chown -R postgres:postgres "$PGDATA"
echo "[NVR] Starting database..."
su-exec postgres pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" start -w -o "-c listen_addresses=localhost"

# Create database and apply schema
su-exec postgres createdb nvrdb 2>/dev/null || true
su-exec postgres psql nvrdb -f /app/init.sql 2>/dev/null || true
echo "[NVR] Database ready."

export DATABASE_URL="postgresql://postgres@localhost/nvrdb"
export PORT=3000
export NODE_ENV=production
export ADDON_MODE=true

echo "[NVR] Starting web server on port 3000..."
exec node /app/artifacts/api-server/dist/index.mjs
